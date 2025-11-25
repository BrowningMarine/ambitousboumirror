import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { Models } from "appwrite";

// Database connection pool and retry management
export class DatabaseConnectionManager {
  private static instance: DatabaseConnectionManager;
  private operationQueue: Map<string, { promise: Promise<unknown>; timestamp: number }>;
  private circuitBreaker: {
    failures: number;
    lastFailure: number;
    state: 'closed' | 'open' | 'half-open';
    consecutiveFailures: number;
    lastSuccessTime: number;
  };
  private cleanupInterval: NodeJS.Timeout | null = null;

  private constructor() {
    // Operation queue to prevent duplicate requests (with timestamps for cleanup)
    this.operationQueue = new Map();

    // Circuit breaker for database health
    // IMPROVEMENT: More lenient thresholds for bulk webhook processing
    this.circuitBreaker = {
      failures: 0,
      lastFailure: 0,
      state: 'closed',
      consecutiveFailures: 0, // Track consecutive failures without success
      lastSuccessTime: Date.now(),
    };

    // Start automatic cleanup of stale operations
    this.startCleanupInterval();
  }

  static getInstance(): DatabaseConnectionManager {
    if (!DatabaseConnectionManager.instance) {
      DatabaseConnectionManager.instance = new DatabaseConnectionManager();
    }
    return DatabaseConnectionManager.instance;
  }

  // Automatic cleanup of stale operations (prevents memory leak)
  private startCleanupInterval(): void {
    // Clean up every 60 seconds
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const staleThreshold = 30000; // 30 seconds
      let cleanedCount = 0;
      
      for (const [key, op] of this.operationQueue.entries()) {
        if (now - op.timestamp > staleThreshold) {
          this.operationQueue.delete(key);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        console.warn(`[DB Manager] Cleaned up ${cleanedCount} stale operations from queue`);
      }
    }, 60000);
  }

  // Cleanup on shutdown (good practice)
  public destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.operationQueue.clear();
  }

  // Circuit breaker logic - IMPROVED for bulk webhook processing
  private isCircuitOpen(): boolean {
    const now = Date.now();
    
    // IMPROVEMENT: Auto-recover if we had recent successes
    const timeSinceLastSuccess = now - this.circuitBreaker.lastSuccessTime;
    if (this.circuitBreaker.state === 'open' && timeSinceLastSuccess < 30000) {
      // If we had a success within last 30 seconds, be forgiving
      this.circuitBreaker.state = 'half-open';
      this.circuitBreaker.consecutiveFailures = 0;
    }
    
    // Reset circuit after 2 minutes (increased from 60s)
    if (this.circuitBreaker.state === 'open' && now - this.circuitBreaker.lastFailure > 120000) {
      this.circuitBreaker.state = 'half-open';
      this.circuitBreaker.failures = 0;
      this.circuitBreaker.consecutiveFailures = 0;
    }

    return this.circuitBreaker.state === 'open';
  }

  private recordSuccess(): void {
    this.circuitBreaker.failures = Math.max(0, this.circuitBreaker.failures - 1); // Gradually reduce failure count
    this.circuitBreaker.consecutiveFailures = 0;
    this.circuitBreaker.lastSuccessTime = Date.now();
    this.circuitBreaker.state = 'closed';
  }

  private recordFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.consecutiveFailures++;
    this.circuitBreaker.lastFailure = Date.now();
    
    // IMPROVEMENT: Much more lenient threshold for bulk operations
    // Only open circuit after many consecutive failures (20 instead of 5)
    // This prevents circuit opening during bulk webhook processing (22 transactions)
    if (this.circuitBreaker.consecutiveFailures >= 20) {
      this.circuitBreaker.state = 'open';
      console.error(`[DB Manager] Circuit breaker opened after ${this.circuitBreaker.consecutiveFailures} consecutive failures`);
    }
  }

  // Exponential backoff retry logic with concurrent API awareness
  private async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = 3
  ): Promise<T> {
    // Check circuit breaker - BUT allow fallback operations to always proceed
    // Fallback operations end with '-fallback' suffix
    if (this.isCircuitOpen() && !operationName.endsWith('-fallback')) {
      throw new Error(`Database circuit breaker is open for ${operationName}`);
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        this.recordSuccess();
        return result;
      } catch (error) {
        lastError = error as Error;
        
        // IMPROVEMENT: Enhanced error detection with rate limit awareness
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isRetryableError = 
          error instanceof Error && (
            error.message.includes('520') ||
            error.message.includes('429') || // Rate limit
            error.message.includes('timeout') ||
            error.message.includes('connection') ||
            error.message.includes('network') ||
            error.message.includes('500') ||
            error.message.includes('502') ||
            error.message.includes('503') ||
            error.message.includes('ECONNRESET') ||
            error.message.includes('ETIMEDOUT')
          );

        if (!isRetryableError || attempt === maxRetries) {
          // Enhanced error logging for diagnosis
          if (!operationName.endsWith('-fallback')) {
            if (attempt === maxRetries) {
              console.error(`[DB Manager] Operation ${operationName} failed after ${maxRetries} retries. Error: ${errorMessage}`);
            }
            this.recordFailure();
          }
          throw error;
        }

        // OPTIMIZED: Smart exponential backoff without concurrency penalty
        // Only delay on actual network errors, not because of high traffic
        // Base delay: 100ms, 300ms, 700ms
        // Add random jitter (0-50ms) to prevent thundering herd
        const baseDelay = Math.min(100 * Math.pow(2, attempt - 1), 1000);
        const jitter = Math.random() * 50; // Reduced from 100ms to 50ms
        
        // REMOVED: concurrencyDelay - high traffic should not add artificial delays
        // The queue size is a RESULT of load, not a CAUSE of slowness
        const totalDelay = baseDelay + jitter;
        
        await new Promise(resolve => setTimeout(resolve, totalDelay));
        
        console.warn(`Database operation ${operationName} retry ${attempt}/${maxRetries} after ${Math.round(totalDelay)}ms (concurrent ops: ${this.operationQueue.size})`);
      }
    }

    // Don't record failure for fallback operations
    if (!operationName.endsWith('-fallback')) {
      this.recordFailure();
    }
    throw lastError || new Error(`Failed after ${maxRetries} retries`);
  }

  // Deduplicate identical operations
  private async withDeduplication<T>(
    operation: () => Promise<T>,
    operationKey: string
  ): Promise<T> {
    // Check if the same operation is already running
    const existingOperation = this.operationQueue.get(operationKey);
    if (existingOperation) {
      return existingOperation.promise as Promise<T>;
    }

    // Start new operation and cache the promise with timestamp
    const operationPromise = operation();
    this.operationQueue.set(operationKey, {
      promise: operationPromise,
      timestamp: Date.now()
    });

    try {
      const result = await operationPromise;
      this.operationQueue.delete(operationKey);
      return result;
    } catch (error) {
      this.operationQueue.delete(operationKey);
      throw error;
    }
  }

  // Safe database operations with retry and deduplication
  async listDocuments(
    databaseId: string,
    collectionId: string,
    queries?: string[],
    operationName: string = 'listDocuments'
  ): Promise<Models.DocumentList<Models.Document>> {
    const operationKey = `list:${databaseId}:${collectionId}:${JSON.stringify(queries)}`;
    
    return this.withDeduplication(
      () => this.withRetry(
        async () => {
          const { database } = await createAdminClient();
          return database.listDocuments(databaseId, collectionId, queries);
        },
        operationName
      ),
      operationKey
    );
  }

  async getDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
    operationName: string = 'getDocument'
  ): Promise<Models.Document> {
    const operationKey = `get:${databaseId}:${collectionId}:${documentId}`;
    
    return this.withDeduplication(
      () => this.withRetry(
        async () => {
          const { database } = await createAdminClient();
          return database.getDocument(databaseId, collectionId, documentId);
        },
        operationName
      ),
      operationKey
    );
  }

  async createDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data: object,
    operationName: string = 'createDocument'
  ): Promise<Models.Document> {
    // No deduplication for create operations (each should be unique)
    return this.withRetry(
      async () => {
        const { database } = await createAdminClient();
        return database.createDocument(databaseId, collectionId, documentId, data);
      },
      operationName
    );
  }

  async updateDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data: object,
    operationName: string = 'updateDocument'
  ): Promise<Models.Document> {
    // No deduplication for update operations (timing matters)
    return this.withRetry(
      async () => {
        const { database } = await createAdminClient();
        return database.updateDocument(databaseId, collectionId, documentId, data);
      },
      operationName,
      2 // Fewer retries for updates to prevent data corruption
    );
  }

  async deleteDocument(
    databaseId: string,
    collectionId: string,
    documentId: string,
    operationName: string = 'deleteDocument'
  ): Promise<void> {
    // No deduplication for delete operations (timing matters)
    await this.withRetry(
      async () => {
        const { database } = await createAdminClient();
        await database.deleteDocument(databaseId, collectionId, documentId);
      },
      operationName,
      2 // Fewer retries for deletes to prevent confusion
    );
  }

  // Get enhanced circuit breaker status for monitoring
  getHealthStatus() {
    // Health is based on circuit breaker state, not queue size
    // High queue size is expected during peak traffic and shouldn't be penalized
    const isHealthy = this.circuitBreaker.state === 'closed' && this.circuitBreaker.failures < 3;
    
    return {
      circuitBreakerState: this.circuitBreaker.state,
      failures: this.circuitBreaker.failures,
      lastFailure: this.circuitBreaker.lastFailure,
      queuedOperations: this.operationQueue.size,
      isHealthy: isHealthy,
      // Concurrency level is informational only, not a health indicator
      concurrencyLevel: this.operationQueue.size > 20 ? 'high' : this.operationQueue.size > 10 ? 'medium' : 'low',
      note: 'High concurrency is normal during peak traffic and does not affect performance'
    };
  }
}

// Export singleton instance
export const dbManager = DatabaseConnectionManager.getInstance();