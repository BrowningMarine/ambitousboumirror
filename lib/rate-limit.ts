import { Redis } from '@upstash/redis';
import { UAParser } from 'ua-parser-js';
import { LRUCache } from 'lru-cache';

// Initialize Upstash Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
});

interface RateLimitInfo {
  count: number;
  firstAttempt: number;
}

// Add memory cache for rate limit info
const ratelimitCache = new LRUCache<string, RateLimitInfo>({
  max: 10000, // Maximum items in cache
  ttl: 60000, // Default TTL of 1 minute
});

// Add parser cache to avoid creating new instances
const parserCache = new LRUCache<string, string>({
  max: 1000, // Cache up to 1000 parsed user agents
  ttl: 3600000, // Cache for 1 hour
});

type RateLimitKey = {
  ip: string;
  userAgent: string;
  userId?: string;
  path: string;
}

export class RateLimiter {
  private readonly limits = {
    auth: {
      authenticated: { requests: 50, windowMs: 60000 },
      anonymous: { requests: 10, windowMs: 60000 }
    },
    api: {
      authenticated: { requests: 100, windowMs: 60000 },
      anonymous: { requests: 50, windowMs: 60000 }
    },
    default: {
      authenticated: { requests: 200, windowMs: 60000 },
      anonymous: { requests: 10, windowMs: 60000 }
    }
  };

  private getDeviceFingerprint(userAgent: string): string {
    // Check cache first
    const cachedResult = parserCache.get(userAgent);
    if (cachedResult) {
      return cachedResult;
    }

    // Only parse if not in cache
    const parser = new UAParser(userAgent);
    const result = parser.getResult();

    // Combine relevant device information  
    const parts = [
      result.browser.name,
      result.browser.version,
      result.os.name,
      result.os.version,
      result.device.vendor,
      result.device.model,
      result.device.type
    ].filter(Boolean);

    const fingerprint = parts.join('|');

    // Cache the result
    parserCache.set(userAgent, fingerprint);
    return fingerprint;
  }

  private getKey(info: RateLimitKey): string {
    const parts = ['ratelimit'];

    if (info.userId) {
      // For authenticated users: combine userId and IP  
      parts.push(`user:${info.userId}`);
      parts.push(`ip:${info.ip}`);
    } else {
      // For anonymous users: combine IP and device fingerprint  
      parts.push(`ip:${info.ip}`);
      parts.push(`device:${this.getDeviceFingerprint(info.userAgent)}`);
    }

    parts.push(`path:${info.path}`);
    return parts.join(':');
  }

  private getLimits(path: string, isAuthenticated: boolean) {
    if (path.startsWith('/api')) {
      return this.limits.api[isAuthenticated ? 'authenticated' : 'anonymous'];
    }
    if (path.startsWith('/sign-in') || path.startsWith('/sign-up')) {
      return this.limits.auth[isAuthenticated ? 'authenticated' : 'anonymous'];
    }
    return this.limits.default[isAuthenticated ? 'authenticated' : 'anonymous'];
  }

  async check(info: RateLimitKey): Promise<{
    limited: boolean;
    remaining: number;
    reset: number;
    limit: number;
  }> {
    const key = this.getKey(info);
    const now = Date.now();
    const isAuthenticated = Boolean(info.userId);
    const limits = this.getLimits(info.path, isAuthenticated);

    try {
      // Try memory cache first
      const cachedInfo = ratelimitCache.get(key);

      // Use cached info if available and not expired
      if (cachedInfo && now - cachedInfo.firstAttempt <= limits.windowMs) {
        const updatedInfo: RateLimitInfo = {
          count: cachedInfo.count + 1,
          firstAttempt: cachedInfo.firstAttempt
        };

        const remaining = Math.max(0, limits.requests - updatedInfo.count);
        const reset = cachedInfo.firstAttempt + limits.windowMs;
        const limited = updatedInfo.count > limits.requests;

        // Only update Redis if approaching limit or if limited
        // This reduces Redis writes for most requests
        if (limited || remaining < limits.requests * 0.2) {
          // Update Redis asynchronously without awaiting
          const remainingMs = cachedInfo.firstAttempt + limits.windowMs - now;
          redis.set(key, updatedInfo, { ex: Math.ceil(remainingMs / 1000) })
            .catch(err => console.error('Redis update failed:', err));
        }

        // Update cache
        ratelimitCache.set(key, updatedInfo, {
          ttl: reset - now
        });

        return { limited, remaining, reset, limit: limits.requests };
      }

      // If not in cache or expired, check Redis
      const currentInfo = await redis.get<RateLimitInfo>(key);

      if (!currentInfo || now - currentInfo.firstAttempt > limits.windowMs) {
        const newInfo: RateLimitInfo = { count: 1, firstAttempt: now };

        // Set with expiration in milliseconds
        await redis.set(key, newInfo, { ex: Math.ceil(limits.windowMs / 1000) });

        // Update cache
        ratelimitCache.set(key, newInfo, {
          ttl: limits.windowMs
        });

        return {
          limited: false,
          remaining: limits.requests - 1,
          reset: now + limits.windowMs,
          limit: limits.requests
        };
      }

      const updatedInfo: RateLimitInfo = {
        count: currentInfo.count + 1,
        firstAttempt: currentInfo.firstAttempt
      };

      const remainingMs = currentInfo.firstAttempt + limits.windowMs - now;
      await redis.set(key, updatedInfo, { ex: Math.ceil(remainingMs / 1000) });

      // Update cache
      ratelimitCache.set(key, updatedInfo, {
        ttl: remainingMs
      });

      const remaining = Math.max(0, limits.requests - updatedInfo.count);
      const reset = currentInfo.firstAttempt + limits.windowMs;

      return {
        limited: updatedInfo.count > limits.requests,
        remaining,
        reset,
        limit: limits.requests
      };
    } catch (error) {
      console.error('Rate limit check failed:', error);
      return {
        limited: false,
        remaining: limits.requests,
        reset: now + limits.windowMs,
        limit: limits.requests
      };
    }
  }
}

/**
 * Specialized rate limiter for bulk order operations
 * Prevents merchants from overwhelming the system with bulk requests
 */
export class BulkRateLimiter {
  private readonly limits = {
    requests: 10,     // Maximum 10 bulk requests per minute per merchant
    windowMs: 60000,  // 1 minute window
  };

  private getKey(merchantId: string): string {
    return `bulk_rate_limit:${merchantId}`;
  }

  async check(merchantId: string): Promise<{
    limited: boolean;
    remaining: number;
    reset: number;
    limit: number;
    nextAllowedTime?: number;
  }> {
    const key = this.getKey(merchantId);
    const now = Date.now();

    try {
      // Try memory cache first for better performance
      const cachedInfo = ratelimitCache.get(key);

      // Use cached info if available and not expired
      if (cachedInfo && now - cachedInfo.firstAttempt <= this.limits.windowMs) {
        const updatedInfo: RateLimitInfo = {
          count: cachedInfo.count + 1,
          firstAttempt: cachedInfo.firstAttempt
        };

        const remaining = Math.max(0, this.limits.requests - updatedInfo.count);
        const reset = cachedInfo.firstAttempt + this.limits.windowMs;
        const limited = updatedInfo.count > this.limits.requests;

        // Update both cache and Redis
        const remainingMs = cachedInfo.firstAttempt + this.limits.windowMs - now;
        
        // Update Redis asynchronously
        redis.set(key, updatedInfo, { ex: Math.ceil(remainingMs / 1000) })
          .catch(err => console.error('Bulk rate limit Redis update failed:', err));

        // Update cache
        ratelimitCache.set(key, updatedInfo, {
          ttl: reset - now
        });

        return { 
          limited, 
          remaining, 
          reset, 
          limit: this.limits.requests,
          nextAllowedTime: limited ? reset : undefined
        };
      }

      // If not in cache or expired, check Redis
      const currentInfo = await redis.get<RateLimitInfo>(key);

      if (!currentInfo || now - currentInfo.firstAttempt > this.limits.windowMs) {
        // First request in the window
        const newInfo: RateLimitInfo = { count: 1, firstAttempt: now };

        // Set with expiration
        await redis.set(key, newInfo, { ex: Math.ceil(this.limits.windowMs / 1000) });

        // Update cache
        ratelimitCache.set(key, newInfo, {
          ttl: this.limits.windowMs
        });

        return {
          limited: false,
          remaining: this.limits.requests - 1,
          reset: now + this.limits.windowMs,
          limit: this.limits.requests
        };
      }

      // Increment count
      const updatedInfo: RateLimitInfo = {
        count: currentInfo.count + 1,
        firstAttempt: currentInfo.firstAttempt
      };

      const remainingMs = currentInfo.firstAttempt + this.limits.windowMs - now;
      await redis.set(key, updatedInfo, { ex: Math.ceil(remainingMs / 1000) });

      // Update cache
      ratelimitCache.set(key, updatedInfo, {
        ttl: remainingMs
      });

      const remaining = Math.max(0, this.limits.requests - updatedInfo.count);
      const reset = currentInfo.firstAttempt + this.limits.windowMs;
      const limited = updatedInfo.count > this.limits.requests;

      return {
        limited,
        remaining,
        reset,
        limit: this.limits.requests,
        nextAllowedTime: limited ? reset : undefined
      };
    } catch (error) {
      console.error('Bulk rate limit check failed:', error);
      // On error, allow the request but log it
      return {
        limited: false,
        remaining: this.limits.requests,
        reset: now + this.limits.windowMs,
        limit: this.limits.requests
      };
    }
  }

  /**
   * Get current bulk rate limit status without incrementing
   * Useful for checking status before processing
   */
  async getStatus(merchantId: string): Promise<{
    remaining: number;
    reset: number;
    limit: number;
    nextAllowedTime?: number;
  }> {
    const key = this.getKey(merchantId);
    const now = Date.now();

    try {
      // Check cache first
      const cachedInfo = ratelimitCache.get(key);
      
      if (cachedInfo && now - cachedInfo.firstAttempt <= this.limits.windowMs) {
        const remaining = Math.max(0, this.limits.requests - cachedInfo.count);
        const reset = cachedInfo.firstAttempt + this.limits.windowMs;
        const nextAllowedTime = cachedInfo.count >= this.limits.requests ? reset : undefined;
        
        return { remaining, reset, limit: this.limits.requests, nextAllowedTime };
      }

      // Check Redis
      const currentInfo = await redis.get<RateLimitInfo>(key);

      if (!currentInfo || now - currentInfo.firstAttempt > this.limits.windowMs) {
        return {
          remaining: this.limits.requests,
          reset: now + this.limits.windowMs,
          limit: this.limits.requests
        };
      }

      const remaining = Math.max(0, this.limits.requests - currentInfo.count);
      const reset = currentInfo.firstAttempt + this.limits.windowMs;
      const nextAllowedTime = currentInfo.count >= this.limits.requests ? reset : undefined;

      return { remaining, reset, limit: this.limits.requests, nextAllowedTime };
    } catch (error) {
      console.error('Bulk rate limit status check failed:', error);
      return {
        remaining: this.limits.requests,
        reset: now + this.limits.windowMs,
        limit: this.limits.requests
      };
    }
  }
}