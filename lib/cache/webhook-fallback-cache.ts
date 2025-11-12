/**
 * Fallback Mode Webhook Cache (Hybrid L1+L2)
 * 
 * PURPOSE:
 * In fallback mode, we cannot query the database to get order details (url_callback, merchant info).
 * This cache stores essential webhook information so we can still send merchant notifications
 * even when databases are completely unavailable.
 * 
 * ARCHITECTURE:
 * - L1 Cache: In-memory LRU (fast, lost on restart)
 * - L2 Cache: Upstash Redis (persistent, survives restarts)
 * 
 * COST OPTIMIZATION (Vercel Free Tier):
 * - LRU Cache: ~2MB RAM (reduced from 10K to 1K entries)
 * - Upstash Free: 10,000 commands/day (write+read = 2 ops per order)
 * - Can handle ~5,000 orders/day within free limits
 * 
 * HOW IT WORKS:
 * 1. Write: Cache to LRU (L1) + Upstash (L2) simultaneously
 * 2. Read: Check LRU first → if miss, check Upstash → populate LRU
 * 3. TTL: 24 hours (covers typical payment window)
 */

import { LRUCache } from 'lru-cache';
import { Redis } from '@upstash/redis';

interface FallbackWebhookData {
  odrId: string;
  merchantOrdId?: string;
  orderType: 'deposit' | 'withdraw';
  urlCallback: string;
  apiKey?: string;
  bankReceiveNumber?: string;
  bankReceiveOwnerName?: string;
  accountName?: string;
  accountNumber?: string;
  merchantId: string;
  cachedAt: number;
}

// L1 CACHE: In-memory LRU (hot cache, fast lookups)
// Reduced to 1,000 entries to minimize RAM usage on Vercel (~500KB)
const fallbackWebhookCache = new LRUCache<string, FallbackWebhookData>({
  max: 1000, // Reduced from 10K to save RAM
  ttl: 86400000, // 24 hours in milliseconds
  updateAgeOnGet: true, // Refresh TTL on access
});

// L2 CACHE: Upstash Redis (persistent, survives restarts)
// Lazy initialization to avoid errors if env vars not set
let upstashRedis: Redis | null = null;
let redisInitialized = false;

function getRedisClient(): Redis | null {
  if (!redisInitialized) {
    redisInitialized = true;
    if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
      try {
        upstashRedis = new Redis({
          url: process.env.UPSTASH_REDIS_REST_URL,
          token: process.env.UPSTASH_REDIS_REST_TOKEN,
        });
        console.log('✅ [Hybrid Cache] Upstash Redis initialized');
      } catch (error) {
        console.warn('⚠️ [Hybrid Cache] Upstash Redis not available, using LRU only:', error);
        upstashRedis = null;
      }
    } else {
      console.warn('⚠️ [Hybrid Cache] Redis env vars not set, using LRU only');
    }
  }
  return upstashRedis;
}

/**
 * Cache webhook data when order is created (L1 + L2)
 * Call this in the order creation API
 */
export async function cacheFallbackWebhookData(data: FallbackWebhookData): Promise<void> {
  try {
    const key = data.odrId;
    
    // L1: Always cache in memory (instant)
    fallbackWebhookCache.set(key, data);
    
    // L2: Try to cache in Redis (persistent, async)
    const redis = getRedisClient();
    if (redis) {
      try {
        // Store in Redis with 24-hour expiration
        // Upstash Redis auto-serializes objects, so pass data directly (no JSON.stringify)
        await redis.set(
          `webhook:${key}`,
          data, // Pass object directly, Upstash will serialize
          { ex: 86400 } // 24 hours in seconds
        );
        console.log(`✅ [Hybrid Cache] Cached webhook data (L1+L2) for order ${data.odrId}`);
      } catch (redisError) {
        console.warn(`⚠️ [Hybrid Cache] Redis write failed (L1 only) for order ${data.odrId}:`, redisError);
      }
    } else {
      console.log(`✅ [LRU Cache] Cached webhook data (L1 only) for order ${data.odrId}`);
    }
  } catch (error) {
    console.error('❌ [Hybrid Cache] Failed to cache webhook data:', error);
    // Don't throw - caching failure shouldn't block order creation
  }
}

/**
 * Get cached webhook data for fallback mode (L1 → L2 fallback)
 * Call this in portal webhook processing when in fallback mode
 */
export async function getFallbackWebhookData(odrId: string): Promise<FallbackWebhookData | null> {
  try {
    // L1: Check in-memory cache first (instant)
    let data = fallbackWebhookCache.get(odrId);
    
    if (data) {
      const age = Date.now() - data.cachedAt;
      const ageMinutes = Math.floor(age / 60000);
      console.log(`✅ [L1 Hit] Retrieved webhook data for order ${odrId} (cached ${ageMinutes}m ago)`);
      return data;
    }
    
    // L2: Check Redis if L1 miss (slower but persistent)
    const redis = getRedisClient();
    if (redis) {
      try {
        // Upstash Redis returns deserialized objects directly
        const redisData = await redis.get<FallbackWebhookData>(`webhook:${odrId}`);
        if (redisData) {
          data = redisData; // Already deserialized by Upstash
          
          // Populate L1 cache for next access
          fallbackWebhookCache.set(odrId, data);
          
          const age = Date.now() - data.cachedAt;
          const ageMinutes = Math.floor(age / 60000);
          console.log(`✅ [L2 Hit] Retrieved webhook data from Redis for order ${odrId} (cached ${ageMinutes}m ago)`);
          return data;
        }
      } catch (redisError) {
        console.warn(`⚠️ [L2 Miss] Redis read failed for order ${odrId}:`, redisError);
      }
    }
    
    console.warn(`⚠️ [Cache Miss] No cached data found (L1+L2) for order ${odrId}`);
    return null;
  } catch (error) {
    console.error('❌ [Hybrid Cache] Failed to retrieve webhook data:', error);
    return null;
  }
}

/**
 * Check if order has cached webhook data
 */
export function hasFallbackWebhookData(odrId: string): boolean {
  return fallbackWebhookCache.has(odrId);
}

/**
 * Remove webhook data from cache (L1 + L2, after successful processing)
 */
export async function clearFallbackWebhookData(odrId: string): Promise<void> {
  try {
    // L1: Remove from memory
    fallbackWebhookCache.delete(odrId);
    
    // L2: Remove from Redis
    const redis = getRedisClient();
    if (redis) {
      try {
        await redis.del(`webhook:${odrId}`);
        console.log(`🗑️ [Hybrid Cache] Cleared webhook data (L1+L2) for order ${odrId}`);
      } catch (redisError) {
        console.warn(`⚠️ [Hybrid Cache] Redis delete failed for order ${odrId}:`, redisError);
      }
    } else {
      console.log(`🗑️ [LRU Cache] Cleared webhook data (L1 only) for order ${odrId}`);
    }
  } catch (error) {
    console.error('❌ [Hybrid Cache] Failed to clear webhook data:', error);
  }
}

/**
 * Get cache statistics (L1 + L2)
 */
export async function getFallbackCacheStats(): Promise<{
  l1: {
    size: number;
    max: number;
    usage: string;
  };
  l2: {
    connected: boolean;
    size?: number;
  };
}> {
  const stats = {
    l1: {
      size: fallbackWebhookCache.size,
      max: fallbackWebhookCache.max,
      usage: `${Math.round((fallbackWebhookCache.size / fallbackWebhookCache.max) * 100)}%`
    },
    l2: {
      connected: false as boolean,
      size: undefined as number | undefined
    }
  };
  
  // Try to get Redis stats
  const redis = getRedisClient();
  if (redis) {
    try {
      // Count webhook keys in Redis (can be slow, use cautiously)
      const keys = await redis.keys('webhook:*');
      stats.l2.connected = true;
      stats.l2.size = keys.length;
    } catch (error) {
      console.warn('⚠️ Failed to get Redis stats:', error);
    }
  }
  
  return stats;
}

/**
 * Clear entire cache (L1 + L2, for testing or emergency)
 */
export async function clearAllFallbackCache(): Promise<void> {
  // L1: Clear memory
  fallbackWebhookCache.clear();
  
  // L2: Clear Redis
  const redis = getRedisClient();
  if (redis) {
    try {
      const keys = await redis.keys('webhook:*');
      if (keys.length > 0) {
        await redis.del(...keys);
        console.log(`🗑️ [Hybrid Cache] Cleared all webhook data (L1+L2, ${keys.length} entries)`);
      } else {
        console.log('🗑️ [Hybrid Cache] Cleared L1 cache (L2 was empty)');
      }
    } catch (error) {
      console.warn('⚠️ [Hybrid Cache] Failed to clear Redis:', error);
      console.log('🗑️ [LRU Cache] Cleared L1 cache only');
    }
  } else {
    console.log('🗑️ [LRU Cache] Cleared all webhook data (L1 only)');
  }
}
