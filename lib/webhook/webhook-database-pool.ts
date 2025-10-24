import { webhookConfig } from './webhook-config';
import { withDatabaseRetry } from './webhook-retry';
import { createAdminClient } from '../appwrite/appwrite.actions';

// Type for AdminClient based on createAdminClient return type
type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;

interface PoolConnection {
  client: AdminClient;
  id: string;
  createdAt: number;
  lastUsed: number;
  inUse: boolean;
  queryCount: number;
}

interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  totalQueries: number;
  averageQueryTime: number;
  connectionWaitTime: number;
}

/**
 * Enhanced database connection pool for webhook operations
 */
export class WebhookDatabasePool {
  private static instance: WebhookDatabasePool | null = null;
  private pool: PoolConnection[] = [];
  private waitingQueue: Array<(connection: PoolConnection) => void> = [];
  private stats: PoolStats = {
    totalConnections: 0,
    activeConnections: 0,
    idleConnections: 0,
    totalQueries: 0,
    averageQueryTime: 0,
    connectionWaitTime: 0
  };
  private totalQueryTime = 0;
  private connectionId = 0;

  private constructor() {
    // Initialize pool with minimum connections
    this.initializePool();
    
    // Setup cleanup interval
    setInterval(() => {
      this.cleanupIdleConnections();
    }, 60000); // Cleanup every minute
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): WebhookDatabasePool {
    if (!WebhookDatabasePool.instance) {
      WebhookDatabasePool.instance = new WebhookDatabasePool();
    }
    return WebhookDatabasePool.instance;
  }

  /**
   * Initialize pool with minimum connections
   */
  private async initializePool(): Promise<void> {
    const minConnections = Math.min(3, webhookConfig.database.connectionPoolSize);
    
    for (let i = 0; i < minConnections; i++) {
      try {
        await this.createConnection();
      } catch (error) {
        console.error('Failed to create initial database connection:', error);
      }
    }
  }

  /**
   * Create a new connection
   */
  private async createConnection(): Promise<PoolConnection> {
    const client = await withDatabaseRetry(
      () => createAdminClient(),
      'create database connection'
    );

    const connection: PoolConnection = {
      client,
      id: `webhook-pool-${++this.connectionId}`,
      createdAt: Date.now(),
      lastUsed: Date.now(),
      inUse: false,
      queryCount: 0
    };

    this.pool.push(connection);
    this.stats.totalConnections++;
    this.stats.idleConnections++;

    return connection;
  }

  /**
   * Get an available connection from the pool
   */
  public async getConnection(): Promise<PoolConnection> {
    const startTime = Date.now();

    // Try to find an idle connection
    let connection = this.pool.find(conn => !conn.inUse);

    // If no idle connection available, create a new one if under limit
    if (!connection && this.pool.length < webhookConfig.database.connectionPoolSize) {
      try {
        connection = await this.createConnection();
      } catch (error) {
        console.error('Failed to create new database connection:', error);
      }
    }

    // If still no connection, wait for one to become available
    if (!connection) {
      connection = await this.waitForConnection();
    }

    // Mark connection as in use
    connection.inUse = true;
    connection.lastUsed = Date.now();
    this.stats.activeConnections++;
    this.stats.idleConnections--;
    this.stats.connectionWaitTime = Date.now() - startTime;

    return connection;
  }

  /**
   * Wait for a connection to become available
   */
  private waitForConnection(): Promise<PoolConnection> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Remove from queue if timeout
        const index = this.waitingQueue.indexOf(resolve);
        if (index > -1) {
          this.waitingQueue.splice(index, 1);
        }
        // Return the least recently used connection even if in use
        const oldestConnection = this.pool.reduce((oldest, conn) => 
          conn.lastUsed < oldest.lastUsed ? conn : oldest
        );
        resolve(oldestConnection);
      }, webhookConfig.database.connectionTimeoutMs);

      this.waitingQueue.push((connection) => {
        clearTimeout(timeout);
        resolve(connection);
      });
    });
  }

  /**
   * Release a connection back to the pool
   */
  public releaseConnection(connection: PoolConnection): void {
    connection.inUse = false;
    connection.lastUsed = Date.now();
    this.stats.activeConnections--;
    this.stats.idleConnections++;

    // Notify waiting requests
    if (this.waitingQueue.length > 0) {
      const waiter = this.waitingQueue.shift();
      if (waiter) {
        connection.inUse = true;
        this.stats.activeConnections++;
        this.stats.idleConnections--;
        waiter(connection);
      }
    }
  }

  /**
   * Execute a query with automatic connection management
   */
  public async executeQuery<T>(
    operation: (client: AdminClient) => Promise<T>,
    operationName: string = 'database query'
  ): Promise<T> {
    const connection = await this.getConnection();
    const startTime = Date.now();

    try {
      const result = await withDatabaseRetry(
        () => operation(connection.client),
        operationName
      );

      // Update stats
      const queryTime = Date.now() - startTime;
      connection.queryCount++;
      this.stats.totalQueries++;
      this.totalQueryTime += queryTime;
      this.stats.averageQueryTime = this.totalQueryTime / this.stats.totalQueries;

      return result;
    } finally {
      this.releaseConnection(connection);
    }
  }

  /**
   * Execute multiple queries in parallel with connection pooling
   */
  public async executeParallelQueries<T>(
    operations: Array<(client: AdminClient) => Promise<T>>,
    operationName: string = 'parallel database queries'
  ): Promise<T[]> {
    const promises = operations.map(operation => 
      this.executeQuery(operation, operationName)
    );

    return Promise.all(promises);
  }

  /**
   * Clean up idle connections that exceed TTL
   */
  private cleanupIdleConnections(): void {
    const now = Date.now();
    const maxIdleTime = 300000; // 5 minutes
    const minConnections = 2;

    const connectionsToRemove = this.pool.filter(connection => 
      !connection.inUse && 
      (now - connection.lastUsed) > maxIdleTime &&
      this.pool.length > minConnections
    );

    for (const connection of connectionsToRemove) {
      const index = this.pool.indexOf(connection);
      if (index > -1) {
        this.pool.splice(index, 1);
        this.stats.totalConnections--;
        this.stats.idleConnections--;
        
        // Note: In a real implementation, you might want to close the connection
        console.debug(`Cleaned up idle database connection ${connection.id}`);
      }
    }
  }

  /**
   * Get current pool statistics
   */
  public getStats(): PoolStats {
    return { ...this.stats };
  }

  /**
   * Get detailed pool information
   */
  public getPoolInfo(): {
    stats: PoolStats;
    connections: Array<{
      id: string;
      inUse: boolean;
      queryCount: number;
      ageMs: number;
      idleTimeMs: number;
    }>;
    queueLength: number;
  } {
    const now = Date.now();
    
    return {
      stats: this.getStats(),
      connections: this.pool.map(conn => ({
        id: conn.id,
        inUse: conn.inUse,
        queryCount: conn.queryCount,
        ageMs: now - conn.createdAt,
        idleTimeMs: now - conn.lastUsed
      })),
      queueLength: this.waitingQueue.length
    };
  }

  /**
   * Warm up the pool by creating connections up to the configured size
   */
  public async warmUp(): Promise<void> {
    const connectionsToCreate = webhookConfig.database.connectionPoolSize - this.pool.length;
    
    if (connectionsToCreate > 0) {
      const promises = Array(connectionsToCreate).fill(null).map(() => 
        this.createConnection().catch(error => {
          console.error('Failed to warm up database connection:', error);
          return null;
        })
      );
      
      await Promise.allSettled(promises);
      console.info(`Database pool warmed up: ${this.pool.length} connections`);
    }
  }

  /**
   * Shutdown the pool gracefully
   */
  public async shutdown(): Promise<void> {
    // Wait for active connections to finish (with timeout)
    const shutdownTimeout = 30000; // 30 seconds
    const startTime = Date.now();

    while (this.stats.activeConnections > 0 && (Date.now() - startTime) < shutdownTimeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Clear the pool
    this.pool.length = 0;
    this.waitingQueue.length = 0;
    this.stats = {
      totalConnections: 0,
      activeConnections: 0,
      idleConnections: 0,
      totalQueries: 0,
      averageQueryTime: 0,
      connectionWaitTime: 0
    };

    console.info('Database pool shutdown completed');
  }
}

/**
 * Convenience function to get the database pool instance
 */
export function getWebhookDatabasePool(): WebhookDatabasePool {
  return WebhookDatabasePool.getInstance();
} 