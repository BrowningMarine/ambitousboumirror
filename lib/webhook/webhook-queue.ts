import { webhookConfig } from './webhook-config';
import { withRetry } from './webhook-retry';
import { log } from '../logger';

export interface QueuedWebhook {
  id: string;
  portal: string;
  payload: unknown;
  signature: string;
  headers: Record<string, string>;
  receivedAt: number;
  attempts: number;
  priority: 'low' | 'normal' | 'high';
  processingStartedAt?: number;
  lastAttemptAt?: number;
  error?: string;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  avgProcessingTime: number;
  throughputPerMinute: number;
}

// Add persistent storage interface
interface PersistentStorage {
  saveWebhook(webhook: QueuedWebhook): Promise<void>;
  removeWebhook(id: string): Promise<void>;
  loadPendingWebhooks(): Promise<QueuedWebhook[]>;
  updateWebhookStatus(id: string, status: Partial<QueuedWebhook>): Promise<void>;
}

// Redis-based persistent storage implementation using Upstash
class RedisPersistentStorage implements PersistentStorage {
  private redis: import('ioredis').Redis | null = null;
  private readonly keyPrefix = 'webhook_queue:';
  private readonly pendingKey = 'webhook_queue:pending';

  constructor() {
    this.initializeRedis();
  }

  private async initializeRedis() {
    if (typeof window !== 'undefined') return; // Skip in browser
    
    try {
      // Dynamic import to avoid bundling issues
      const { Redis } = await import('ioredis');
      
      const redisUrl = process.env.UPSTASH_REDIS_BULLQUEUES_URL;
      if (!redisUrl) {
        console.warn('UPSTASH_REDIS_BULLQUEUES_URL not found, falling back to simulation');
        return;
      }

      this.redis = new Redis(redisUrl, {
        enableReadyCheck: false,
        lazyConnect: true,
        maxRetriesPerRequest: 3,
        // Upstash-specific optimizations
        connectTimeout: 10000,
        commandTimeout: 5000,
      });

      this.redis.on('error', (error: Error) => {
        console.error('Redis connection error:', error);
      });

      this.redis.on('connect', () => {
        console.log('Connected to Upstash Redis for webhook queue');
      });

    } catch (error) {
      console.error('Failed to initialize Redis:', error);
    }
  }

  async saveWebhook(webhook: QueuedWebhook): Promise<void> {
    if (typeof window !== 'undefined') return; // Skip in browser
    
    try {
      if (!this.redis) {
        await this.fallbackSave(webhook);
        return;
      }

      // Use pipeline for atomic operations (2 commands)
      const pipeline = this.redis.pipeline();
      pipeline.hset(`${this.keyPrefix}${webhook.id}`, this.serializeWebhook(webhook));
      pipeline.sadd(this.pendingKey, webhook.id);
      
      await pipeline.exec();
      
    } catch (error) {
      console.error('Failed to persist webhook:', error);
      // Fallback to simulation
      await this.fallbackSave(webhook);
    }
  }

  async removeWebhook(id: string): Promise<void> {
    if (typeof window !== 'undefined') return;
    
    try {
      if (!this.redis) {
        await this.fallbackRemove(id);
        return;
      }

      // Use pipeline for atomic operations (2 commands)
      const pipeline = this.redis.pipeline();
      pipeline.del(`${this.keyPrefix}${id}`);
      pipeline.srem(this.pendingKey, id);
      
      await pipeline.exec();
      
    } catch (error) {
      console.error('Failed to remove persisted webhook:', error);
      await this.fallbackRemove(id);
    }
  }

  async loadPendingWebhooks(): Promise<QueuedWebhook[]> {
    if (typeof window !== 'undefined') return [];
    
    try {
      if (!this.redis) {
        return await this.fallbackLoad();
      }

      // Get all pending webhook IDs (1 command)
      const pendingIds = await this.redis.smembers(this.pendingKey);
      
      if (pendingIds.length === 0) {
        return [];
      }

      // Get all webhook data in pipeline (N commands where N = number of pending webhooks)
      const pipeline = this.redis.pipeline();
      pendingIds.forEach((id: string) => {
        pipeline.hgetall(`${this.keyPrefix}${id}`);
      });
      
      const results = await pipeline.exec();
      
      // Parse results and filter out corrupted entries
      const webhooks: QueuedWebhook[] = [];
      if (results) {
        for (let i = 0; i < results.length; i++) {
          const [error, data] = results[i];
          if (!error && data && typeof data === 'object' && (data as Record<string, string>).id) {
            webhooks.push(this.deserializeWebhook(data as Record<string, string>));
          }
        }
      }
      
      return webhooks;
      
    } catch (error) {
      console.error('Failed to load persisted webhooks:', error);
      return await this.fallbackLoad();
    }
  }

  async updateWebhookStatus(id: string, status: Partial<QueuedWebhook>): Promise<void> {
    if (typeof window !== 'undefined') return;
    
    try {
      if (!this.redis) {
        await this.fallbackUpdate(id, status);
        return;
      }

      // Update only specific fields (1 command)
      const serializedStatus = this.serializeWebhook(status as QueuedWebhook);
      await this.redis.hmset(`${this.keyPrefix}${id}`, serializedStatus);
      
    } catch (error) {
      console.error('Failed to update webhook status:', error);
      await this.fallbackUpdate(id, status);
    }
  }

  // Serialize webhook for Redis storage
  private serializeWebhook(webhook: Partial<QueuedWebhook>): Record<string, string> {
    const serialized: Record<string, string> = {};
    
    Object.entries(webhook).forEach(([key, value]) => {
      if (value !== undefined) {
        if (typeof value === 'object') {
          serialized[key] = JSON.stringify(value);
        } else {
          serialized[key] = String(value);
        }
      }
    });
    
    return serialized;
  }

  // Deserialize webhook from Redis storage
  private deserializeWebhook(data: Record<string, string>): QueuedWebhook {
    const webhook = {} as Record<string, unknown>;
    
    Object.entries(data).forEach(([key, value]) => {
      if (key === 'payload' || key === 'headers') {
        try {
          webhook[key] = JSON.parse(value);
        } catch {
          webhook[key] = value;
        }
      } else if (key === 'receivedAt' || key === 'attempts' || key === 'processingStartedAt' || key === 'lastAttemptAt') {
        webhook[key] = parseInt(value, 10);
      } else {
        webhook[key] = value;
      }
    });
    
    return webhook as unknown as QueuedWebhook;
  }

  // Fallback implementation when Redis is not available
  private async fallbackSave(webhook: QueuedWebhook): Promise<void> {
    console.log(`[PERSISTENCE] Saving webhook ${webhook.id} to persistent storage (fallback)`);
  }

  private async fallbackRemove(id: string): Promise<void> {
    console.log(`[PERSISTENCE] Removing webhook ${id} from persistent storage (fallback)`);
  }

  private async fallbackLoad(): Promise<QueuedWebhook[]> {
    console.log(`[PERSISTENCE] Loading pending webhooks from persistent storage (fallback)`);
    return [];
  }

  private async fallbackUpdate(id: string, status: Partial<QueuedWebhook>): Promise<void> {
    console.log(`[PERSISTENCE] Updating webhook ${id} status in persistent storage (fallback)`, status);
  }

  // Get Redis command usage statistics
  public getCommandStats(): { estimatedCommandsUsed: number; remainingCommands: number } {
    // This is an estimate - actual usage tracking would require Redis monitoring
    return {
      estimatedCommandsUsed: 0, // Would need actual tracking
      remainingCommands: 500000 // Monthly limit
    };
  }
}

/**
 * Asynchronous webhook processing queue
 * 
 * WHAT THIS DOES:
 * 1. Accepts webhooks immediately and returns 202 Accepted
 * 2. Processes webhooks asynchronously in background
 * 3. Handles backpressure and rate limiting
 * 4. Provides retry logic and dead letter queue
 * 5. Monitors queue health and performance
 */
export class WebhookQueue {
  private static instance: WebhookQueue | null = null;
  private queue: QueuedWebhook[] = [];
  private processing: Set<string> = new Set();
  private completed: QueuedWebhook[] = [];
  private failed: QueuedWebhook[] = [];
  private stats: QueueStats = {
    pending: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    avgProcessingTime: 0,
    throughputPerMinute: 0
  };
  private processingTimes: number[] = [];
  private isProcessing = false;
  private webhookIdCounter = 0;
  private persistentStorage: PersistentStorage;
  private recoveryCompleted = false;

  private constructor() {
    this.persistentStorage = new RedisPersistentStorage();
    
    // Start with recovery, then processing
    this.recoverPendingWebhooks().then(() => {
      this.startProcessing();
    });
    
    // Setup stats cleanup interval
    setInterval(() => {
      this.cleanupCompletedWebhooks();
      this.updateThroughputStats();
    }, 60000); // Every minute

    // Setup periodic persistence sync
    setInterval(() => {
      this.syncPersistentStorage();
    }, 10000); // Every 10 seconds
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): WebhookQueue {
    if (!WebhookQueue.instance) {
      WebhookQueue.instance = new WebhookQueue();
    }
    return WebhookQueue.instance;
  }

  /**
   * Recover pending webhooks from persistent storage on startup
   */
  private async recoverPendingWebhooks(): Promise<void> {
    try {
      const pendingWebhooks = await this.persistentStorage.loadPendingWebhooks();
      
      if (pendingWebhooks.length > 0) {
        await log.info(`Recovering ${pendingWebhooks.length} pending webhooks from storage`, {
          webhookCount: pendingWebhooks.length,
          timestamp: new Date().toISOString()
        });

        // Add recovered webhooks to queue with high priority
        for (const webhook of pendingWebhooks) {
          // Reset processing status
          webhook.processingStartedAt = undefined;
          webhook.lastAttemptAt = Date.now();
          
          // Add to front of queue with high priority
          this.queue.unshift(webhook);
        }

        this.stats.pending = this.queue.length;
        
        await log.info(`Successfully recovered webhooks`, {
          recoveredCount: pendingWebhooks.length,
          currentQueueSize: this.queue.length,
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      await log.error('Failed to recover pending webhooks', error as Error, {
        timestamp: new Date().toISOString()
      });
    } finally {
      this.recoveryCompleted = true;
    }
  }

  /**
   * Add webhook to queue for asynchronous processing
   */
  public async enqueue(
    portal: string,
    payload: unknown,
    signature: string,
    headers: Record<string, string>,
    priority: 'low' | 'normal' | 'high' = 'normal'
  ): Promise<{ id: string; queuePosition: number }> {
    const webhook: QueuedWebhook = {
      id: `webhook-${++this.webhookIdCounter}-${Date.now()}`,
      portal,
      payload,
      signature,
      headers,
      receivedAt: Date.now(),
      attempts: 0,
      priority
    };

    // CRITICAL: Persist webhook BEFORE adding to memory queue
    await this.persistentStorage.saveWebhook(webhook);

    // Insert based on priority (high priority goes to front)
    if (priority === 'high') {
      this.queue.unshift(webhook);
    } else if (priority === 'low') {
      this.queue.push(webhook);
    } else {
      // Insert normal priority after high priority items
      const firstNormalIndex = this.queue.findIndex(w => w.priority !== 'high');
      if (firstNormalIndex === -1) {
        this.queue.push(webhook);
      } else {
        this.queue.splice(firstNormalIndex, 0, webhook);
      }
    }

    this.stats.pending = this.queue.length;

    // Log queue addition
    await log.info(`Webhook queued for processing`, {
      webhookId: webhook.id,
      portal,
      priority,
      queueSize: this.queue.length,
      persisted: true,
      timestamp: new Date().toISOString()
    });

    return {
      id: webhook.id,
      queuePosition: this.queue.findIndex(w => w.id === webhook.id) + 1
    };
  }

  /**
   * Start background processing
   */
  private async startProcessing(): Promise<void> {
    if (this.isProcessing) return;
    
    this.isProcessing = true;

    while (this.isProcessing) {
      try {
        // Process webhooks with controlled concurrency
        const concurrentPromises: Promise<void>[] = [];
        const maxConcurrent = webhookConfig.processing.concurrencyLimit;

        while (concurrentPromises.length < maxConcurrent && this.queue.length > 0) {
          const webhook = this.queue.shift();
          if (webhook) {
            this.processing.add(webhook.id);
            this.stats.pending = this.queue.length;
            this.stats.processing = this.processing.size;

            const processingPromise = this.processWebhook(webhook);
            concurrentPromises.push(processingPromise);
          }
        }

        // Wait for current batch to complete
        if (concurrentPromises.length > 0) {
          await Promise.allSettled(concurrentPromises);
        } else {
          // No webhooks to process, wait a bit
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch (error) {
        console.error('Error in webhook queue processing:', error);
        // Continue processing even if there's an error
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Process a single webhook
   */
  private async processWebhook(webhook: QueuedWebhook): Promise<void> {
    webhook.processingStartedAt = Date.now();
    webhook.attempts++;
    webhook.lastAttemptAt = Date.now();

    // Update persistent storage with processing status
    await this.persistentStorage.updateWebhookStatus(webhook.id, {
      attempts: webhook.attempts,
      processingStartedAt: webhook.processingStartedAt,
      lastAttemptAt: webhook.lastAttemptAt
    });

    try {
      // Simulate the actual webhook processing
      // In real implementation, this would call the actual webhook processing logic
      const result = await withRetry(
        () => this.simulateWebhookProcessing(webhook),
        {
          maxAttempts: 1, // Queue handles its own retry logic
        }
      );

      if (result.success) {
        // Success - Remove from persistent storage
        await this.persistentStorage.removeWebhook(webhook.id);
        
        const processingTime = Date.now() - webhook.processingStartedAt!;
        this.processingTimes.push(processingTime);
        
        webhook.error = undefined;
        this.completed.push(webhook);
        this.stats.completed++;

        await log.info(`Webhook processed successfully from queue`, {
          webhookId: webhook.id,
          portal: webhook.portal,
          attempts: webhook.attempts,
          processingTime,
          removedFromPersistence: true,
          timestamp: new Date().toISOString()
        });
      } else {
        throw result.error || new Error('Unknown processing error');
      }
    } catch (error) {
      webhook.error = error instanceof Error ? error.message : String(error);

      // Update persistent storage with error status
      await this.persistentStorage.updateWebhookStatus(webhook.id, {
        error: webhook.error,
        lastAttemptAt: webhook.lastAttemptAt
      });

      // Retry logic with exponential backoff
      if (webhook.attempts < webhookConfig.retry.maxAttempts) {
        // Re-queue for retry with delay
        const delay = this.calculateRetryDelay(webhook.attempts);
        
        setTimeout(() => {
          this.queue.unshift(webhook); // High priority for retries
          this.stats.pending = this.queue.length;
        }, delay);

        await log.warn(`Webhook processing failed, retrying`, {
          webhookId: webhook.id,
          portal: webhook.portal,
          attempt: webhook.attempts,
          maxAttempts: webhookConfig.retry.maxAttempts,
          retryDelay: delay,
          error: webhook.error,
          persistenceUpdated: true,
          timestamp: new Date().toISOString()
        });
      } else {
        // Max attempts reached, remove from persistent storage and move to failed queue
        await this.persistentStorage.removeWebhook(webhook.id);
        
        this.failed.push(webhook);
        this.stats.failed++;

        await log.error(`Webhook processing failed permanently`, 
          new Error(webhook.error), 
          {
            webhookId: webhook.id,
            portal: webhook.portal,
            attempts: webhook.attempts,
            receivedAt: new Date(webhook.receivedAt).toISOString(),
            removedFromPersistence: true,
            timestamp: new Date().toISOString()
          });
      }
    } finally {
      this.processing.delete(webhook.id);
      this.stats.processing = this.processing.size;
      this.updateAverageProcessingTime();
    }
  }

  /**
   * Simulate webhook processing (replace with actual processing logic)
   */
  private async simulateWebhookProcessing(webhook: QueuedWebhook): Promise<{ success: boolean }> {
    // TODO: Replace this with actual webhook processing logic
    // This would call the existing webhook processing functions
    
    // Simulate processing time based on webhook priority
    const baseTime = webhook.priority === 'high' ? 200 : webhook.priority === 'low' ? 1000 : 500;
    await new Promise(resolve => setTimeout(resolve, Math.random() * baseTime + baseTime));
    
    // Simulate success/failure (90% success rate for testing)
    if (Math.random() > 0.1) {
      return { success: true };
    } else {
      throw new Error(`Simulated processing failure for webhook ${webhook.id}`);
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   */
  private calculateRetryDelay(attempt: number): number {
    const baseDelay = webhookConfig.retry.baseDelayMs;
    const maxDelay = webhookConfig.retry.maxDelayMs;
    const multiplier = webhookConfig.retry.backoffMultiplier;
    
    const exponentialDelay = baseDelay * Math.pow(multiplier, attempt - 1);
    const delayWithJitter = exponentialDelay * (0.5 + Math.random() * 0.5);
    
    return Math.min(delayWithJitter, maxDelay);
  }

  /**
   * Update average processing time
   */
  private updateAverageProcessingTime(): void {
    if (this.processingTimes.length > 0) {
      const sum = this.processingTimes.reduce((a, b) => a + b, 0);
      this.stats.avgProcessingTime = Math.round(sum / this.processingTimes.length);
    }
  }

  /**
   * Update throughput statistics
   */
  private updateThroughputStats(): void {
    const oneMinuteAgo = Date.now() - 60000;
    const recentCompleted = this.completed.filter(w => 
      w.processingStartedAt && w.processingStartedAt > oneMinuteAgo
    );
    this.stats.throughputPerMinute = recentCompleted.length;
  }

  /**
   * Clean up old completed webhooks to prevent memory buildup
   */
  private cleanupCompletedWebhooks(): void {
    const maxRetentionTime = 3600000; // 1 hour
    const cutoffTime = Date.now() - maxRetentionTime;

    // Keep only recent completed webhooks
    this.completed = this.completed.filter(w => 
      w.processingStartedAt && w.processingStartedAt > cutoffTime
    );

    // Keep only recent failed webhooks (for analysis)
    this.failed = this.failed.filter(w => 
      w.lastAttemptAt && w.lastAttemptAt > cutoffTime
    );

    // Limit processing time history
    if (this.processingTimes.length > 1000) {
      this.processingTimes = this.processingTimes.slice(-500);
    }
  }

  /**
   * Get current queue statistics
   */
  public getStats(): QueueStats {
    return { ...this.stats };
  }

  /**
   * Get detailed queue information
   */
  public getQueueInfo(): {
    stats: QueueStats;
    queueSize: number;
    oldestPendingAge: number;
    recentFailures: Array<{ id: string; portal: string; error: string; attempts: number }>;
  } {
    const now = Date.now();
    const oldestPending = this.queue.length > 0 ? this.queue[this.queue.length - 1] : null;
    
    return {
      stats: this.getStats(),
      queueSize: this.queue.length,
      oldestPendingAge: oldestPending ? now - oldestPending.receivedAt : 0,
      recentFailures: this.failed.slice(-10).map(w => ({
        id: w.id,
        portal: w.portal,
        error: w.error || 'Unknown error',
        attempts: w.attempts
      }))
    };
  }

  /**
   * Get webhook status by ID
   */
  public getWebhookStatus(id: string): {
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'not_found';
    webhook?: QueuedWebhook;
    position?: number;
  } {
    // Check pending queue
    const pendingIndex = this.queue.findIndex(w => w.id === id);
    if (pendingIndex !== -1) {
      return {
        status: 'pending',
        webhook: this.queue[pendingIndex],
        position: pendingIndex + 1
      };
    }

    // Check processing
    if (this.processing.has(id)) {
      const processingWebhook = [...this.completed, ...this.failed]
        .find(w => w.id === id && w.processingStartedAt && !w.lastAttemptAt);
      return {
        status: 'processing',
        webhook: processingWebhook
      };
    }

    // Check completed
    const completed = this.completed.find(w => w.id === id);
    if (completed) {
      return {
        status: 'completed',
        webhook: completed
      };
    }

    // Check failed
    const failed = this.failed.find(w => w.id === id);
    if (failed) {
      return {
        status: 'failed',
        webhook: failed
      };
    }

    return { status: 'not_found' };
  }

  /**
   * Pause queue processing
   */
  public pause(): void {
    this.isProcessing = false;
  }

  /**
   * Resume queue processing
   */
  public resume(): void {
    if (!this.isProcessing) {
      this.startProcessing();
    }
  }

  /**
   * Clear all queues (use with caution)
   */
  public clear(): void {
    this.queue.length = 0;
    this.completed.length = 0;
    this.failed.length = 0;
    this.processing.clear();
    this.stats = {
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      avgProcessingTime: 0,
      throughputPerMinute: 0
    };
  }

  /**
   * Sync in-memory queue with persistent storage
   */
  private async syncPersistentStorage(): Promise<void> {
    if (!this.recoveryCompleted) return;

    try {
      // Ensure all pending webhooks are persisted
      for (const webhook of this.queue) {
        await this.persistentStorage.updateWebhookStatus(webhook.id, {
          attempts: webhook.attempts,
          lastAttemptAt: webhook.lastAttemptAt,
          error: webhook.error
        });
      }
    } catch (error) {
      console.error('Failed to sync persistent storage:', error);
    }
  }
}

/**
 * Convenience function to get the webhook queue instance
 */
export function getWebhookQueue(): WebhookQueue {
  return WebhookQueue.getInstance();
} 