export interface WebhookConfig {
  cache: {
    bankLookup: {
      maxSize: number;
      ttlMs: number;
    };
    duplicateCheck: {
      maxSize: number;
      ttlMs: number;
    };
    orderIdExtraction: {
      maxSize: number;
      ttlMs: number;
    };
  };
  processing: {
    concurrencyLimit: number;
    batchSizeThreshold: number;
    timeoutMs: number;
  };
  retry: {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
  };
  circuitBreaker: {
    failureThreshold: number;
    resetTimeoutMs: number;
    monitoringPeriodMs: number;
  };
  database: {
    connectionPoolSize: number;
    queryTimeoutMs: number;
    connectionTimeoutMs: number;
  };
}

/**
 * Default webhook configuration with environment variable overrides
 */
export const webhookConfig: WebhookConfig = {
  cache: {
    bankLookup: {
      maxSize: parseInt(process.env.WEBHOOK_CACHE_BANK_LOOKUP_SIZE || '500'),
      ttlMs: parseInt(process.env.WEBHOOK_CACHE_BANK_LOOKUP_TTL || '300000'), // 5 minutes
    },
    duplicateCheck: {
      maxSize: parseInt(process.env.WEBHOOK_CACHE_DUPLICATE_CHECK_SIZE || '1000'),
      ttlMs: parseInt(process.env.WEBHOOK_CACHE_DUPLICATE_CHECK_TTL || '600000'), // 10 minutes
    },
    orderIdExtraction: {
      maxSize: parseInt(process.env.WEBHOOK_CACHE_ORDER_ID_SIZE || '1000'),
      ttlMs: parseInt(process.env.WEBHOOK_CACHE_ORDER_ID_TTL || '3600000'), // 1 hour
    },
  },
  processing: {
    concurrencyLimit: parseInt(process.env.WEBHOOK_CONCURRENCY_LIMIT || '12'),
    batchSizeThreshold: parseInt(process.env.WEBHOOK_BATCH_SIZE_THRESHOLD || '15'),
    timeoutMs: parseInt(process.env.WEBHOOK_PROCESSING_TIMEOUT || '30000'), // 30 seconds
  },
  retry: {
    maxAttempts: parseInt(process.env.WEBHOOK_RETRY_MAX_ATTEMPTS || '3'),
    baseDelayMs: parseInt(process.env.WEBHOOK_RETRY_BASE_DELAY || '1000'), // 1 second
    maxDelayMs: parseInt(process.env.WEBHOOK_RETRY_MAX_DELAY || '10000'), // 10 seconds
    backoffMultiplier: parseFloat(process.env.WEBHOOK_RETRY_BACKOFF_MULTIPLIER || '2'),
  },
  circuitBreaker: {
    failureThreshold: parseInt(process.env.WEBHOOK_CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5'),
    resetTimeoutMs: parseInt(process.env.WEBHOOK_CIRCUIT_BREAKER_RESET_TIMEOUT || '60000'), // 1 minute
    monitoringPeriodMs: parseInt(process.env.WEBHOOK_CIRCUIT_BREAKER_MONITORING_PERIOD || '300000'), // 5 minutes
  },
  database: {
    connectionPoolSize: parseInt(process.env.WEBHOOK_DB_CONNECTION_POOL_SIZE || '10'),
    queryTimeoutMs: parseInt(process.env.WEBHOOK_DB_QUERY_TIMEOUT || '15000'), // 15 seconds
    connectionTimeoutMs: parseInt(process.env.WEBHOOK_DB_CONNECTION_TIMEOUT || '5000'), // 5 seconds
  },
};

/**
 * Validate webhook configuration on startup
 */
export function validateWebhookConfig(): void {
  const errors: string[] = [];

  // Validate cache settings
  if (webhookConfig.cache.bankLookup.maxSize <= 0) {
    errors.push('Bank lookup cache size must be positive');
  }
  if (webhookConfig.cache.duplicateCheck.maxSize <= 0) {
    errors.push('Duplicate check cache size must be positive');
  }
  if (webhookConfig.cache.orderIdExtraction.maxSize <= 0) {
    errors.push('Order ID extraction cache size must be positive');
  }

  // Validate processing settings
  if (webhookConfig.processing.concurrencyLimit <= 0) {
    errors.push('Concurrency limit must be positive');
  }
  if (webhookConfig.processing.batchSizeThreshold <= 0) {
    errors.push('Batch size threshold must be positive');
  }
  if (webhookConfig.processing.timeoutMs <= 0) {
    errors.push('Processing timeout must be positive');
  }

  // Validate retry settings
  if (webhookConfig.retry.maxAttempts <= 0) {
    errors.push('Max retry attempts must be positive');
  }
  if (webhookConfig.retry.baseDelayMs <= 0) {
    errors.push('Retry base delay must be positive');
  }
  if (webhookConfig.retry.backoffMultiplier <= 1) {
    errors.push('Retry backoff multiplier must be greater than 1');
  }

  // Validate circuit breaker settings
  if (webhookConfig.circuitBreaker.failureThreshold <= 0) {
    errors.push('Circuit breaker failure threshold must be positive');
  }
  if (webhookConfig.circuitBreaker.resetTimeoutMs <= 0) {
    errors.push('Circuit breaker reset timeout must be positive');
  }

  // Validate database settings
  if (webhookConfig.database.connectionPoolSize <= 0) {
    errors.push('Database connection pool size must be positive');
  }
  if (webhookConfig.database.queryTimeoutMs <= 0) {
    errors.push('Database query timeout must be positive');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid webhook configuration: ${errors.join(', ')}`);
  }
}

/**
 * Get memory usage estimation for caches
 */
export function estimateCacheMemoryUsage(): {
  bankLookupMB: number;
  duplicateCheckMB: number;
  orderIdExtractionMB: number;
  totalMB: number;
} {
  // Rough estimates in MB (average object sizes)
  const bankLookupSizeMB = (webhookConfig.cache.bankLookup.maxSize * 2) / 1024; // ~2KB per entry
  const duplicateCheckSizeMB = (webhookConfig.cache.duplicateCheck.maxSize * 0.1) / 1024; // ~100B per entry
  const orderIdExtractionSizeMB = (webhookConfig.cache.orderIdExtraction.maxSize * 0.5) / 1024; // ~500B per entry

  return {
    bankLookupMB: Math.round(bankLookupSizeMB * 100) / 100,
    duplicateCheckMB: Math.round(duplicateCheckSizeMB * 100) / 100,
    orderIdExtractionMB: Math.round(orderIdExtractionSizeMB * 100) / 100,
    totalMB: Math.round((bankLookupSizeMB + duplicateCheckSizeMB + orderIdExtractionSizeMB) * 100) / 100,
  };
} 