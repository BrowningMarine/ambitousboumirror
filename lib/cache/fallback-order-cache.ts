/**
 * Fallback Mode Order Cache (Redis-based)
 * 
 * PURPOSE:
 * In fallback mode, orders are not saved to database. This cache provides
 * temporary order state storage so we can:
 * 1. Track payment completion when webhook arrives
 * 2. Show correct status when customer refreshes payment page
 * 3. Send merchant callbacks even without database
 * 
 * ARCHITECTURE:
 * - Redis Only: No in-memory cache (payment pages are stateless)
 * - 24-hour TTL: Matches payment window
 * - Minimal data: Just status and essential fields
 * 
 * DATA STORED:
 * - Order status (processing → completed)
 * - Payment amounts (paidAmount, unpaidAmount)
 * - Completion timestamp
 * - Callback sent flag
 */

import { Redis } from '@upstash/redis';

interface FallbackOrderState {
  odrId: string;
  odrStatus: 'processing' | 'completed' | 'expired';
  amount: number;
  paidAmount: number;
  unpaidAmount: number;
  odrType: 'deposit' | 'withdraw';
  merchantId: string;
  createdAt: number;
  completedAt?: number;
  lastPaymentDate?: string;
}

// Lazy initialization
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
        console.log('✅ [Fallback Order Cache] Redis initialized');
      } catch (error) {
        console.warn('⚠️ [Fallback Order Cache] Redis not available:', error);
        upstashRedis = null;
      }
    } else {
      console.warn('⚠️ [Fallback Order Cache] Redis env vars not set');
    }
  }
  return upstashRedis;
}

/**
 * Cache order state when created (fallback mode only)
 */
export async function cacheOrderState(data: FallbackOrderState): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      console.warn('⚠️ [Fallback Order] Redis not available - order state not cached');
      return;
    }

    const key = `fallback:order:${data.odrId}`;
    
    // Store in Redis with 24-hour expiration
    // Upstash Redis auto-serializes objects
    await redis.set(
      key,
      data, // Pass object directly
      { ex: 86400 } // 24 hours
    );
    
    console.log(`✅ [Fallback Order] Cached order state: ${data.odrId} (status: ${data.odrStatus})`);
  } catch (error) {
    console.error('❌ [Fallback Order] Failed to cache order state:', error);
    // Don't throw - caching failure shouldn't block order creation
  }
}

/**
 * Get order state from cache
 */
export async function getOrderState(odrId: string): Promise<FallbackOrderState | null> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      return null;
    }

    const key = `fallback:order:${odrId}`;
    const data = await redis.get<FallbackOrderState>(key); // Upstash returns deserialized
    
    if (data) {
      console.log(`✅ [Fallback Order] Retrieved order state: ${odrId} (status: ${data.odrStatus})`);
      return data;
    }
    
    console.log(`⚠️ [Fallback Order] Order state not found: ${odrId}`);
    return null;
  } catch (error) {
    console.error('❌ [Fallback Order] Failed to retrieve order state:', error);
    return null;
  }
}

/**
 * Update order status to completed when payment received
 */
export async function markOrderCompleted(
  odrId: string,
  paidAmount: number
): Promise<boolean> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      console.warn('⚠️ [Fallback Order] Redis not available - cannot mark completed');
      return false;
    }

    const key = `fallback:order:${odrId}`;
    
    // Get current state (Upstash returns deserialized)
    const orderState = await redis.get<FallbackOrderState>(key);
    if (!orderState) {
      console.warn(`⚠️ [Fallback Order] Order not found, cannot mark completed: ${odrId}`);
      return false;
    }
    
    // Update to completed
    const updatedState: FallbackOrderState = {
      ...orderState,
      odrStatus: 'completed',
      paidAmount: orderState.paidAmount + paidAmount,
      unpaidAmount: Math.max(0, orderState.amount - (orderState.paidAmount + paidAmount)),
      completedAt: Date.now(),
      lastPaymentDate: new Date().toISOString()
    };
    
    // Save back to Redis with 24-hour TTL (Upstash auto-serializes)
    await redis.set(
      key,
      updatedState, // Pass object directly
      { ex: 86400 }
    );
    
    console.log(`✅ [Fallback Order] Marked as completed: ${odrId} (paid: ${updatedState.paidAmount}/${updatedState.amount})`);
    return true;
  } catch (error) {
    console.error('❌ [Fallback Order] Failed to mark order completed:', error);
    return false;
  }
}

/**
 * Check if merchant callback has been sent
 */
export async function hasCallbackBeenSent(odrId: string): Promise<boolean> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      return false;
    }

    const key = `fallback:callback:sent:${odrId}`;
    const exists = await redis.exists(key);
    return exists === 1;
  } catch (error) {
    console.error('❌ [Fallback Order] Failed to check callback status:', error);
    return false;
  }
}

/**
 * Mark merchant callback as sent
 */
export async function markCallbackSent(odrId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      console.warn('⚠️ [Fallback Order] Redis not available - cannot mark callback sent');
      return;
    }

    const key = `fallback:callback:sent:${odrId}`;
    
    // Store flag with 24-hour expiration
    await redis.set(
      key,
      'sent',
      { ex: 86400 }
    );
    
    console.log(`✅ [Fallback Order] Marked callback as sent: ${odrId}`);
  } catch (error) {
    console.error('❌ [Fallback Order] Failed to mark callback sent:', error);
  }
}

/**
 * Clear order state (for testing or cleanup)
 */
export async function clearOrderState(odrId: string): Promise<void> {
  try {
    const redis = getRedisClient();
    if (!redis) {
      return;
    }

    await redis.del(
      `fallback:order:${odrId}`,
      `fallback:callback:sent:${odrId}`
    );
    
    console.log(`🗑️ [Fallback Order] Cleared order state: ${odrId}`);
  } catch (error) {
    console.error('❌ [Fallback Order] Failed to clear order state:', error);
  }
}
