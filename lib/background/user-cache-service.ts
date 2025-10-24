/**
 * Background User Cache Service
 * Maintains an always-fresh cache of ready withdraw users
 * Eliminates the need for expensive database queries during order creation
 */

import { getReadyWithdrawUsers } from '@/lib/actions/user.actions';

interface UserCacheService {
  readyUsers: string[];
  lastUpdate: number;
  isUpdating: boolean;
  updateInterval: NodeJS.Timeout | null;
}

class BackgroundUserCache {
  private cache: UserCacheService = {
    readyUsers: [],
    lastUpdate: 0,
    isUpdating: false,
    updateInterval: null
  };

  private readonly UPDATE_INTERVAL = 30000; // 30 seconds
  private readonly MAX_CACHE_AGE = 120000; // 2 minutes max age

  /**
   * Initialize the background cache service
   */
  public async initialize(): Promise<void> {
    //console.log('[UserCache] Initializing background user cache service...');
    
    // Initial load
    await this.refreshCache();
    
    // Set up periodic refresh
    this.cache.updateInterval = setInterval(async () => {
      await this.refreshCache();
    }, this.UPDATE_INTERVAL);
    
    //console.log(`[UserCache] Service initialized with ${this.cache.readyUsers.length} ready users`);
  }

  /**
   * Get ready users from cache (instant response)
   */
  public getReadyUsers(): string[] {
    const age = Date.now() - this.cache.lastUpdate;
    
    // If cache is too old and not currently updating, trigger refresh
    if (age > this.MAX_CACHE_AGE && !this.cache.isUpdating) {
      this.refreshCache().catch(error => {
        console.error('[UserCache] Background refresh failed:', error);
      });
    }
    
    return [...this.cache.readyUsers]; // Return copy to prevent mutations
  }

  /**
   * Force refresh the cache
   */
  public async forceRefresh(): Promise<void> {
    await this.refreshCache();
  }

  /**
   * Get cache statistics
   */
  public getStats() {
    return {
      userCount: this.cache.readyUsers.length,
      lastUpdate: this.cache.lastUpdate,
      age: Date.now() - this.cache.lastUpdate,
      isUpdating: this.cache.isUpdating
    };
  }

  /**
   * Shutdown the service
   */
  public shutdown(): void {
    if (this.cache.updateInterval) {
      clearInterval(this.cache.updateInterval);
      this.cache.updateInterval = null;
    }
    console.log('[UserCache] Background service shutdown');
  }

  /**
   * Internal method to refresh the cache
   */
  private async refreshCache(): Promise<void> {
    if (this.cache.isUpdating) {
      return; // Prevent concurrent updates
    }

    this.cache.isUpdating = true;
    
    try {
      const startTime = performance.now();
      const users = await getReadyWithdrawUsers();
      const duration = performance.now() - startTime;
      
      this.cache.readyUsers = users;
      this.cache.lastUpdate = Date.now();
      
      console.log(`[UserCache] Refreshed ${users.length} ready users in ${Math.round(duration)}ms`);
    } catch (error) {
      console.error('[UserCache] Failed to refresh cache:', error);
    } finally {
      this.cache.isUpdating = false;
    }
  }
}

// Global instance
const userCacheService = new BackgroundUserCache();

// Auto-initialize in production environments
if (process.env.NODE_ENV === 'production') {
  userCacheService.initialize().catch(error => {
    console.error('[UserCache] Auto-initialization failed:', error);
  });
}

export { userCacheService };

/**
 * Get ready withdraw users with ultra-fast response (0-5ms)
 * Uses background-maintained cache for instant results
 */
export async function getReadyWithdrawUsersUltraFast(): Promise<string[]> {
  return userCacheService.getReadyUsers();
}

/**
 * Initialize the user cache service manually (for development)
 */
export async function initializeUserCache(): Promise<void> {
  await userCacheService.initialize();
}

/**
 * Get cache service statistics
 */
export function getUserCacheStats() {
  return userCacheService.getStats();
} 