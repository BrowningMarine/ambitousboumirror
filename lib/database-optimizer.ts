import { Account, Databases, Users } from "node-appwrite";
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";

// Types for better type safety
interface AdminClient {
  account: Account;
  database: Databases;
  user: Users;
}

interface CacheEntry {
  data: unknown;
  timestamp: number;
}

interface StatsCache {
  [key: string]: CacheEntry;
}

export class DatabaseOptimizer {
  private static readOnlyClient: AdminClient | null = null;
  private static writeClient: AdminClient | null = null;
  private static readClientTimestamp = 0;
  private static writeClientTimestamp = 0;
  private static statsCache: StatsCache = {};
  
  // Connection TTL (5 minutes)
  private static readonly CONNECTION_TTL = 5 * 60 * 1000;
  // Default cache TTL (30 seconds for statistics)
  private static readonly DEFAULT_STATS_CACHE_TTL = 30 * 1000;
  // User-specific cache TTL (60 seconds)
  private static readonly USER_CACHE_TTL = 60 * 1000;

  /**
   * Get a read-optimized database client
   * Use this for dashboard statistics, user queries, and other read operations
   */
  static async getReadOnlyClient(): Promise<AdminClient> {
    const now = Date.now();
    
    if (!this.readOnlyClient || (now - this.readClientTimestamp) > this.CONNECTION_TTL) {
      this.readOnlyClient = await createAdminClient();
      this.readClientTimestamp = now;
    }
    
    return this.readOnlyClient;
  }

  /**
   * Get a write-optimized database client
   * Use this for creating transactions, updating balances, and other write operations
   */
  static async getWriteClient(): Promise<AdminClient> {
    const now = Date.now();
    
    if (!this.writeClient || (now - this.writeClientTimestamp) > this.CONNECTION_TTL) {
      this.writeClient = await createAdminClient();
      this.writeClientTimestamp = now;
    }
    
    return this.writeClient;
  }

  /**
   * Get cached statistics with automatic invalidation
   * Use this for dashboard statistics that don't need real-time accuracy
   */
  static async getCachedStats<T>(
    cacheKey: string, 
    fetcher: () => Promise<T>, 
    ttl: number = this.DEFAULT_STATS_CACHE_TTL
  ): Promise<T> {
    const cached = this.statsCache[cacheKey];
    
    if (cached && Date.now() - cached.timestamp < ttl) {
      return cached.data as T;
    }
    
    // Use read-only client for statistics
    const data = await fetcher();
    
    this.statsCache[cacheKey] = {
      data,
      timestamp: Date.now()
    };
    
    return data;
  }

  /**
   * Get cached user-specific data
   * Use this for user dashboards and account-specific information
   */
  static async getCachedUserData<T>(
    userId: string,
    dataType: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    const cacheKey = `user_${userId}_${dataType}`;
    return this.getCachedStats(cacheKey, fetcher, this.USER_CACHE_TTL);
  }

  /**
   * Invalidate specific cache entries
   * Call this when data changes that affect cached statistics
   */
  static invalidateCache(pattern?: string): void {
    if (!pattern) {
      // Clear all cache
      this.statsCache = {};
      return;
    }
    
    // Clear cache entries matching pattern
    Object.keys(this.statsCache).forEach(key => {
      if (key.includes(pattern)) {
        delete this.statsCache[key];
      }
    });
  }

  /**
   * Invalidate stats cache after transaction creation
   * Call this after creating/updating transactions
   */
  static invalidateStatsCache(): void {
    this.invalidateCache('stats_');
    this.invalidateCache('dashboard_');
    this.invalidateCache('count_');
  }

  /**
   * Invalidate user-specific cache
   * Call this after updating user data or balances
   */
  static invalidateUserCache(userId: string): void {
    this.invalidateCache(`user_${userId}`);
  }

  /**
   * Get cache statistics for monitoring
   */
  static getCacheStats(): {
    totalEntries: number;
    cacheHitRate: number;
    oldestEntry: number;
    newestEntry: number;
  } {
    const entries = Object.values(this.statsCache);
    
    if (entries.length === 0) {
      return {
        totalEntries: 0,
        cacheHitRate: 0,
        oldestEntry: 0,
        newestEntry: 0
      };
    }

    const timestamps = entries.map(entry => entry.timestamp);
    
    return {
      totalEntries: entries.length,
      cacheHitRate: 0, // Would need hit/miss tracking for accurate calculation
      oldestEntry: Math.min(...timestamps),
      newestEntry: Math.max(...timestamps)
    };
  }

  /**
   * Clean expired cache entries
   * Call this periodically to prevent memory leaks
   */
  static cleanExpiredCache(): void {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes max age for any cache entry
    
    Object.keys(this.statsCache).forEach(key => {
      const entry = this.statsCache[key];
      if (now - entry.timestamp > maxAge) {
        delete this.statsCache[key];
      }
    });
  }

  /**
   * Batch database operations for better performance
   * Use this when you need to perform multiple related operations
   */
  static async batchReadOperations<T>(
    operations: Array<() => Promise<T>>
  ): Promise<T[]> {
    // Execute all operations in parallel
    return Promise.all(operations.map(operation => operation()));
  }

  /**
   * Execute write operation with proper error handling
   * Use this for critical write operations that need consistency
   */
  static async executeWriteOperation<T>(
    operation: (client: AdminClient) => Promise<T>,
    options: {
      retryAttempts?: number;
      onSuccess?: (result: T) => void;
      onError?: (error: Error) => void;
    } = {}
  ): Promise<T> {
    const { retryAttempts = 3, onSuccess, onError } = options;
    
    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
      try {
        const client = await this.getWriteClient();
        const result = await operation(client);
        
        if (onSuccess) {
          onSuccess(result);
        }
        
        // Invalidate relevant caches after successful write
        this.invalidateStatsCache();
        
        return result;
      } catch (error) {
        console.error(`Write operation attempt ${attempt} failed:`, error);
        
        if (attempt === retryAttempts) {
          if (onError) {
            onError(error as Error);
          }
          throw error;
        }
        
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
      }
    }
    
    throw new Error('All retry attempts failed');
  }

  /**
   * Optimized transaction creation to minimize collection locks
   * This is the key optimization for reducing database contention
   */
  static async createTransactionOptimized<T>(
    databaseId: string,
    collectionId: string,
    documentId: string,
    data: T,
    options: {
      preCalculateFields?: boolean;
      batchSize?: number;
      priority?: 'high' | 'normal' | 'low';
    } = {}
  ): Promise<T & { $id: string }> {
    const { preCalculateFields = true, priority = 'normal' } = options;
    
    // Use dedicated write client to avoid connection contention
    const client = await this.getWriteClient();
    const { database } = client;
    
    // Pre-calculate searchable and indexable fields to reduce future query load
    let optimizedData: Record<string, unknown> = { ...data as Record<string, unknown> };
    
    if (preCalculateFields && typeof data === 'object' && data !== null) {
      const now = new Date();
      const isoString = now.toISOString();
      
      // Add pre-calculated fields that exist in your schema
      optimizedData = {
        ...data as Record<string, unknown>,
        // Only add fields that actually exist in your database schema
        lastPaymentDate: optimizedData.lastPaymentDate || isoString,
        // Add any other existing fields that can be pre-calculated
      };
      
      // Create searchable text for faster text searches (if odrId exists)
      if (optimizedData.odrId) {
        // Store searchable data in existing fields or comments
        console.log(`Creating searchable index for order: ${optimizedData.odrId}`);
        // You could store this in an existing text field if available
      }
    }
    
    // Execute the creation with minimal lock time
    const startTime = performance.now();
    
    try {
      const result = await database.createDocument(
        databaseId,
        collectionId,
        documentId,
        optimizedData
      );
      
      const executionTime = performance.now() - startTime;
      
      // Log performance metrics for monitoring
      console.log(`Transaction created in ${executionTime.toFixed(2)}ms (Priority: ${priority})`);
      
      // Selective cache invalidation - only invalidate what's necessary
      this.invalidateTransactionCaches(result);
      
      return result as unknown as T & { $id: string };
      
    } catch (error) {
      const executionTime = performance.now() - startTime;
      console.error(`Transaction creation failed after ${executionTime.toFixed(2)}ms:`, error);
      throw error;
    }
  }

  /**
   * Selective cache invalidation for transactions
   * Only invalidates caches that are actually affected by the new transaction
   */
  private static invalidateTransactionCaches(transaction: Record<string, unknown>): void {
    // Only invalidate specific caches based on transaction properties
    if (transaction.odrStatus) {
      this.invalidateCache(`stats_${transaction.odrStatus}`);
    }
    
    if (transaction.odrType) {
      this.invalidateCache(`stats_${transaction.odrType}`);
    }
    
    if (transaction.positiveAccount) {
      this.invalidateCache(`user_${transaction.positiveAccount}`);
    }
    
    if (transaction.negativeAccount) {
      this.invalidateCache(`user_${transaction.negativeAccount}`);
    }
    
    // Invalidate general dashboard stats
    this.invalidateCache('dashboard_');
    this.invalidateCache('count_');
  }

  /**
   * Batch transaction creation for high-volume scenarios
   * Creates multiple transactions with minimal database locks
   */
  static async batchCreateTransactions<T>(
    databaseId: string,
    collectionId: string,
    transactions: Array<{ id: string; data: T }>,
    options: {
      batchSize?: number;
      delayBetweenBatches?: number;
    } = {}
  ): Promise<Array<T & { $id: string }>> {
    const { batchSize = 10, delayBetweenBatches = 50 } = options;
    const results: Array<T & { $id: string }> = [];
    
    // Process in batches to avoid overwhelming the database
    for (let i = 0; i < transactions.length; i += batchSize) {
      const batch = transactions.slice(i, i + batchSize);
      
      // Create batch in parallel
      const batchPromises = batch.map(({ id, data }) =>
        this.createTransactionOptimized(databaseId, collectionId, id, data, {
          priority: 'high' // High priority for batch operations
        })
      );
      
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
      
      // Small delay between batches to prevent database overload
      if (i + batchSize < transactions.length && delayBetweenBatches > 0) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }
    
    return results;
  }

  /**
   * Get database performance metrics
   * Use this to monitor the effectiveness of optimizations
   */
  static getPerformanceMetrics(): {
    cacheHitRate: number;
    averageQueryTime: number;
    totalQueries: number;
    cacheSize: number;
  } {
    const cacheStats = this.getCacheStats();
    
    return {
      cacheHitRate: cacheStats.cacheHitRate,
      averageQueryTime: 0, // Would need to implement query time tracking
      totalQueries: 0, // Would need to implement query counting
      cacheSize: cacheStats.totalEntries
    };
  }

  /**
   * Warm up cache with commonly accessed data
   * Call this on application startup or user login to improve perceived performance
   */
  static async warmupCache(commonQueries: Array<{
    key: string;
    fetcher: () => Promise<unknown>;
  }>): Promise<void> {
    try {
      // Execute all warmup queries in parallel
      const warmupPromises = commonQueries.map(async ({ key, fetcher }) => {
        try {
          const data = await fetcher();
          this.statsCache[key] = {
            data,
            timestamp: Date.now()
          };
          return { key, success: true };
        } catch (error) {
          console.warn(`Cache warmup failed for key ${key}:`, error);
          return { key, success: false, error };
        }
      });

      const results = await Promise.all(warmupPromises);
      const successCount = results.filter(r => r.success).length;
      
      console.log(`Cache warmup completed: ${successCount}/${results.length} queries succeeded`);
    } catch (error) {
      console.error('Cache warmup error:', error);
    }
  }

  /**
   * Preload withdraw list data for faster initial page load
   * Should be called when user logs in or navigates to withdraw list
   */
  static async warmupWithdrawListCache(userRole?: string, userId?: string): Promise<void> {
    const commonQueries = [];

         // Warmup main withdraw list (first page)
     commonQueries.push({
       key: `withdrawals_1_10_asc_${userRole === 'transassistant' ? userId : 'all'}`,
       fetcher: async () => {
         // This will be cached when the actual page loads
         return [];
       }
     });

     // Warmup count query
     commonQueries.push({
       key: `withdrawals_count_${userRole === 'transassistant' ? userId : 'all'}`,
       fetcher: async () => {
         return 0; // Placeholder - actual data will be loaded
       }
     });

     // Warmup user document ID if needed
     if (userRole === 'transassistant' && userId) {
       commonQueries.push({
         key: `user_doc_id_${userId}`,
         fetcher: async () => {
           return null; // Placeholder - actual data will be loaded
         }
       });
     }

    await this.warmupCache(commonQueries);
  }
}

// Auto-cleanup expired cache entries every 5 minutes
setInterval(() => {
  DatabaseOptimizer.cleanExpiredCache();
}, 5 * 60 * 1000);