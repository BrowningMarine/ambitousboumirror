import { webhookConfig } from './webhook-config';
import { log } from '../logger';

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStats {
  state: CircuitState;
  failureCount: number;
  successCount: number;
  totalRequests: number;
  failureRate: number;
  lastFailureTime?: number;
  nextRetryTime?: number;
  circuitOpenTime?: number;
}

/**
 * Circuit Breaker implementation for webhook operations
 * 
 * WHAT THIS DOES:
 * 1. Monitors operation success/failure rates
 * 2. Opens circuit when failure threshold is reached
 * 3. Allows limited testing when half-open
 * 4. Provides fast-fail for known problematic operations
 * 5. Automatically recovers when operations succeed
 */
export class WebhookCircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private successCount = 0;
  private totalRequests = 0;
  private lastFailureTime?: number;
  private circuitOpenTime?: number;
  private halfOpenAttempts = 0;
  private readonly name: string;
  
  constructor(name: string = 'webhook-circuit-breaker') {
    this.name = name;
  }

  /**
   * Execute an operation with circuit breaker protection
   */
  public async execute<T>(
    operation: () => Promise<T>,
    operationName: string = 'operation'
  ): Promise<T> {
    // Check if circuit is open
    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        this.state = 'HALF_OPEN';
        this.halfOpenAttempts = 0;
        await log.info(`Circuit breaker transitioning to HALF_OPEN`, {
          name: this.name,
          operationName,
          stats: this.getStats(),
          timestamp: new Date().toISOString()
        });
      } else {
        const error = new Error(`Circuit breaker is OPEN for ${this.name}. Operation rejected.`);
        await log.warn(`Circuit breaker rejected operation`, {
          name: this.name,
          operationName,
          state: this.state,
          nextRetryTime: this.getNextRetryTime(),
          timestamp: new Date().toISOString()
        });
        throw error;
      }
    }

    // Limit attempts in half-open state
    if (this.state === 'HALF_OPEN' && this.halfOpenAttempts >= 3) {
      const error = new Error(`Circuit breaker is HALF_OPEN with too many attempts for ${this.name}. Operation rejected.`);
      throw error;
    }

    this.totalRequests++;
    if (this.state === 'HALF_OPEN') {
      this.halfOpenAttempts++;
    }

    try {
      const result = await operation();
      this.onSuccess(operationName);
      return result;
    } catch (error) {
      this.onFailure(error, operationName);
      throw error;
    }
  }

  /**
   * Handle successful operation
   */
  private async onSuccess(operationName: string): Promise<void> {
    this.successCount++;

    if (this.state === 'HALF_OPEN') {
      // Successful operation in half-open state - close the circuit
      this.state = 'CLOSED';
      this.failureCount = 0;
      this.halfOpenAttempts = 0;
      this.circuitOpenTime = undefined;
      
      await log.info(`Circuit breaker closed after successful operation`, {
        name: this.name,
        operationName,
        stats: this.getStats(),
        timestamp: new Date().toISOString()
      });
    } else if (this.state === 'CLOSED') {
      // Reset failure count on success in closed state
      this.failureCount = 0;
    }
  }

  /**
   * Handle failed operation
   */
  private async onFailure(error: unknown, operationName: string): Promise<void> {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      // Failure in half-open state - reopen the circuit
      this.state = 'OPEN';
      this.circuitOpenTime = Date.now();
      
      await log.warn(`Circuit breaker reopened after failure in HALF_OPEN state`, {
        name: this.name,
        operationName,
        error: error instanceof Error ? error.message : String(error),
        stats: this.getStats(),
        timestamp: new Date().toISOString()
      });
    } else if (this.state === 'CLOSED' && this.shouldOpenCircuit()) {
      // Too many failures in closed state - open the circuit
      this.state = 'OPEN';
      this.circuitOpenTime = Date.now();
      
      await log.error(`Circuit breaker opened due to failure threshold`, 
        error instanceof Error ? error : new Error(String(error)), 
        {
          name: this.name,
          operationName,
          failureThreshold: webhookConfig.circuitBreaker.failureThreshold,
          stats: this.getStats(),
          timestamp: new Date().toISOString()
        });
    }
  }

  /**
   * Check if circuit should be opened
   */
  private shouldOpenCircuit(): boolean {
    // Need minimum number of requests to consider opening
    const minRequests = 5;
    if (this.totalRequests < minRequests) {
      return false;
    }

    // Check if failure count exceeds threshold
    return this.failureCount >= webhookConfig.circuitBreaker.failureThreshold;
  }

  /**
   * Check if we should attempt to reset the circuit
   */
  private shouldAttemptReset(): boolean {
    if (!this.circuitOpenTime) {
      return false;
    }

    const timeSinceOpen = Date.now() - this.circuitOpenTime;
    return timeSinceOpen >= webhookConfig.circuitBreaker.resetTimeoutMs;
  }

  /**
   * Get next retry time
   */
  private getNextRetryTime(): number | undefined {
    if (this.circuitOpenTime) {
      return this.circuitOpenTime + webhookConfig.circuitBreaker.resetTimeoutMs;
    }
    return undefined;
  }

  /**
   * Get current circuit breaker statistics
   */
  public getStats(): CircuitBreakerStats {
    const failureRate = this.totalRequests > 0 ? 
      Math.round((this.failureCount / this.totalRequests) * 100) : 0;

    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      totalRequests: this.totalRequests,
      failureRate,
      lastFailureTime: this.lastFailureTime,
      nextRetryTime: this.getNextRetryTime(),
      circuitOpenTime: this.circuitOpenTime
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  public async reset(): Promise<void> {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.totalRequests = 0;
    this.lastFailureTime = undefined;
    this.circuitOpenTime = undefined;
    this.halfOpenAttempts = 0;

    await log.info(`Circuit breaker manually reset`, {
      name: this.name,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Force open the circuit breaker
   */
  public async forceOpen(): Promise<void> {
    this.state = 'OPEN';
    this.circuitOpenTime = Date.now();

    await log.warn(`Circuit breaker manually opened`, {
      name: this.name,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Check if circuit is healthy
   */
  public isHealthy(): boolean {
    return this.state === 'CLOSED' || 
           (this.state === 'HALF_OPEN' && this.halfOpenAttempts < 3);
  }

  /**
   * Get circuit name
   */
  public getName(): string {
    return this.name;
  }
}

/**
 * Circuit breaker manager for multiple operations
 */
export class CircuitBreakerManager {
  private static instance: CircuitBreakerManager | null = null;
  private circuitBreakers: Map<string, WebhookCircuitBreaker> = new Map();

  private constructor() {
    // Setup monitoring interval
    setInterval(() => {
      this.monitorCircuits();
    }, webhookConfig.circuitBreaker.monitoringPeriodMs);
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): CircuitBreakerManager {
    if (!CircuitBreakerManager.instance) {
      CircuitBreakerManager.instance = new CircuitBreakerManager();
    }
    return CircuitBreakerManager.instance;
  }

  /**
   * Get or create a circuit breaker
   */
  public getCircuitBreaker(name: string): WebhookCircuitBreaker {
    if (!this.circuitBreakers.has(name)) {
      this.circuitBreakers.set(name, new WebhookCircuitBreaker(name));
    }
    return this.circuitBreakers.get(name)!;
  }

  /**
   * Execute operation with circuit breaker protection
   */
  public async executeWithCircuitBreaker<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const circuitBreaker = this.getCircuitBreaker(operationName);
    return circuitBreaker.execute(operation, operationName);
  }

  /**
   * Get all circuit breaker statistics
   */
  public getAllStats(): Array<{ name: string; stats: CircuitBreakerStats }> {
    return Array.from(this.circuitBreakers.entries()).map(([name, breaker]) => ({
      name,
      stats: breaker.getStats()
    }));
  }

  /**
   * Get health status of all circuits
   */
  public getHealthStatus(): {
    healthy: number;
    unhealthy: number;
    total: number;
    details: Array<{ name: string; healthy: boolean; state: CircuitState }>;
  } {
    const details = Array.from(this.circuitBreakers.entries()).map(([name, breaker]) => {
      const healthy = breaker.isHealthy();
      return {
        name,
        healthy,
        state: breaker.getStats().state
      };
    });

    const healthy = details.filter(d => d.healthy).length;
    const unhealthy = details.filter(d => !d.healthy).length;

    return {
      healthy,
      unhealthy,
      total: details.length,
      details
    };
  }

  /**
   * Reset all circuit breakers
   */
  public async resetAll(): Promise<void> {
    const resetPromises = Array.from(this.circuitBreakers.values()).map(breaker => 
      breaker.reset()
    );
    await Promise.all(resetPromises);

    await log.info(`All circuit breakers reset`, {
      count: this.circuitBreakers.size,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Monitor circuits and log status
   */
  private async monitorCircuits(): Promise<void> {
    const healthStatus = this.getHealthStatus();
    
    if (healthStatus.unhealthy > 0) {
      await log.warn(`Circuit breaker health check - unhealthy circuits detected`, {
        healthy: healthStatus.healthy,
        unhealthy: healthStatus.unhealthy,
        total: healthStatus.total,
        unhealthyCircuits: healthStatus.details
          .filter(d => !d.healthy)
          .map(d => ({ name: d.name, state: d.state })),
        timestamp: new Date().toISOString()
      });
    }
  }
}

/**
 * Convenience functions
 */
export function getCircuitBreakerManager(): CircuitBreakerManager {
  return CircuitBreakerManager.getInstance();
}

export function withCircuitBreaker<T>(
  operationName: string,
  operation: () => Promise<T>
): Promise<T> {
  return getCircuitBreakerManager().executeWithCircuitBreaker(operationName, operation);
} 