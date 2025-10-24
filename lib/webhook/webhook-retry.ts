import { webhookConfig } from './webhook-config';

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  retryableErrors?: (error: unknown) => boolean;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempt: number;
  totalTimeMs: number;
}

/**
 * Default function to determine if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  // Network and timeout errors are retryable
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    
    // Common retryable patterns
    const retryablePatterns = [
      'timeout',
      'connection reset',
      'network',
      'econnreset',
      'enotfound',
      'econnrefused',
      'etimedout',
      'socket hang up',
      'request timeout',
      'service unavailable',
      'internal server error',
      'bad gateway',
      'gateway timeout',
      'temporary failure',
      'rate limit',
      'too many requests'
    ];

    return retryablePatterns.some(pattern => message.includes(pattern));
  }

  // HTTP status codes that are retryable
  if (typeof error === 'object' && error !== null && 'status' in error) {
    const status = (error as { status: number }).status;
    // 5xx server errors and 429 rate limit are retryable
    return status >= 500 || status === 429 || status === 408; // 408 = Request Timeout
  }

  return false;
}

/**
 * Calculate delay with exponential backoff and jitter
 */
function calculateDelay(attempt: number, baseDelayMs: number, maxDelayMs: number, backoffMultiplier: number): number {
  const exponentialDelay = baseDelayMs * Math.pow(backoffMultiplier, attempt - 1);
  const delayWithJitter = exponentialDelay * (0.5 + Math.random() * 0.5); // Add 0-50% jitter
  return Math.min(delayWithJitter, maxDelayMs);
}

/**
 * Sleep function for delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute a function with retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<RetryResult<T>> {
  const {
    maxAttempts = webhookConfig.retry.maxAttempts,
    baseDelayMs = webhookConfig.retry.baseDelayMs,
    maxDelayMs = webhookConfig.retry.maxDelayMs,
    backoffMultiplier = webhookConfig.retry.backoffMultiplier,
    retryableErrors = isRetryableError
  } = options;

  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await operation();
      return {
        success: true,
        result,
        attempt,
        totalTimeMs: Date.now() - startTime
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry if it's the last attempt or the error is not retryable
      if (attempt === maxAttempts || !retryableErrors(error)) {
        break;
      }

      // Calculate and apply delay before retry
      const delay = calculateDelay(attempt, baseDelayMs, maxDelayMs, backoffMultiplier);
      
      // Log retry attempt (only in development or with debug flag)
      if (process.env.NODE_ENV === 'development' || process.env.WEBHOOK_DEBUG === 'true') {
        console.warn(`Retry attempt ${attempt}/${maxAttempts} after ${delay}ms delay. Error: ${lastError.message}`);
      }

      await sleep(delay);
    }
  }

  return {
    success: false,
    error: lastError || new Error('Unknown error during retry operation'),
    attempt: maxAttempts,
    totalTimeMs: Date.now() - startTime
  };
}

/**
 * Retry wrapper specifically for database operations
 */
export async function withDatabaseRetry<T>(
  operation: () => Promise<T>,
  operationName: string = 'database operation'
): Promise<T> {
  const result = await withRetry(operation, {
    retryableErrors: (error) => {
      // Database-specific retryable errors
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        return message.includes('connection') ||
               message.includes('timeout') ||
               message.includes('network') ||
               message.includes('temporary') ||
               message.includes('retry') ||
               message.includes('lock') ||
               message.includes('deadlock');
      }
      return isRetryableError(error);
    }
  });

  if (!result.success) {
    throw new Error(`${operationName} failed after ${result.attempt} attempts: ${result.error?.message}`);
  }

  return result.result!;
}

/**
 * Retry wrapper specifically for external API calls
 */
export async function withApiRetry<T>(
  operation: () => Promise<T>,
  operationName: string = 'API call'
): Promise<T> {
  const result = await withRetry(operation, {
    retryableErrors: (error) => {
      // API-specific retryable errors
      if (error instanceof Error) {
        const message = error.message.toLowerCase();
        return message.includes('fetch') ||
               message.includes('network') ||
               message.includes('timeout') ||
               message.includes('rate limit') ||
               message.includes('service unavailable');
      }
      return isRetryableError(error);
    }
  });

  if (!result.success) {
    throw new Error(`${operationName} failed after ${result.attempt} attempts: ${result.error?.message}`);
  }

  return result.result!;
}

/**
 * Batch retry function for processing multiple items with individual retry logic
 */
export async function withBatchRetry<T, R>(
  items: T[],
  operation: (item: T) => Promise<R>,
  options: RetryOptions & { concurrency?: number } = {}
): Promise<Array<{ item: T; success: boolean; result?: R; error?: Error }>> {
  const { concurrency = webhookConfig.processing.concurrencyLimit, ...retryOptions } = options;
  
  const results: Array<{ item: T; success: boolean; result?: R; error?: Error }> = [];
  
  // Process items in chunks to respect concurrency limits
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    
    const chunkPromises = chunk.map(async (item) => {
      const retryResult = await withRetry(() => operation(item), retryOptions);
      return {
        item,
        success: retryResult.success,
        result: retryResult.result,
        error: retryResult.error
      };
    });
    
    const chunkResults = await Promise.allSettled(chunkPromises);
    
    // Collect results
    for (const promiseResult of chunkResults) {
      if (promiseResult.status === 'fulfilled') {
        results.push(promiseResult.value);
      } else {
        // This shouldn't happen since we're handling errors in withRetry
        results.push({
          item: chunk[results.length % chunk.length], // Get corresponding item
          success: false,
          error: new Error(`Unexpected promise rejection: ${promiseResult.reason}`)
        });
      }
    }
  }
  
  return results;
} 