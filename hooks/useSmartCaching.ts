import { useCallback, useRef, useState, useEffect } from "react";
import { getUserDocumentId } from "@/lib/actions/user.actions";

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

interface CacheStats {
  hits: number;
  misses: number;
  entries: number;
  memoryUsage: number;
}

export function useSmartCaching() {
  const cacheRef = useRef<Map<string, CacheEntry<unknown>>>(new Map());
  const [stats, setStats] = useState<CacheStats>({
    hits: 0,
    misses: 0,
    entries: 0,
    memoryUsage: 0,
  });

  // Update cache statistics
  const updateStats = useCallback(() => {
    const cache = cacheRef.current;
    const memoryUsage = JSON.stringify([...cache.entries()]).length;
    
    setStats(prev => ({
      ...prev,
      entries: cache.size,
      memoryUsage,
    }));
  }, []);

  // Generic cache getter with TTL support
  const getCached = useCallback(<T>(
    key: string
  ): T | null => {
    const cached = cacheRef.current.get(key);
    
    if (!cached) {
      setStats(prev => ({ ...prev, misses: prev.misses + 1 }));
      return null;
    }

    // Check if cache entry has expired
    const now = Date.now();
    if (now - cached.timestamp > cached.ttl) {
      cacheRef.current.delete(key);
      setStats(prev => ({ ...prev, misses: prev.misses + 1 }));
      updateStats();
      console.log(`[Cache] Expired entry removed: ${key}`);
      return null;
    }

    setStats(prev => ({ ...prev, hits: prev.hits + 1 }));
    console.log(`[Cache] Hit: ${key}`);
    return cached.data as T;
  }, [updateStats]);

  // Generic cache setter
  const setCached = useCallback(<T>(
    key: string,
    data: T,
    ttl: number = 300000 // Default 5 minutes
  ): void => {
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
    };

    cacheRef.current.set(key, entry);
    updateStats();
    console.log(`[Cache] Set: ${key} (TTL: ${ttl}ms)`);
  }, [updateStats]);

  // Invalidate specific cache entry
  const invalidate = useCallback((key: string): boolean => {
    const deleted = cacheRef.current.delete(key);
    if (deleted) {
      updateStats();
      console.log(`[Cache] Invalidated: ${key}`);
    }
    return deleted;
  }, [updateStats]);

  // Invalidate cache entries by pattern
  const invalidatePattern = useCallback((pattern: string): number => {
    let count = 0;
    const regex = new RegExp(pattern);
    
    for (const [key] of cacheRef.current) {
      if (regex.test(key)) {
        cacheRef.current.delete(key);
        count++;
      }
    }

    if (count > 0) {
      updateStats();
      console.log(`[Cache] Invalidated ${count} entries matching pattern: ${pattern}`);
    }

    return count;
  }, [updateStats]);

  // Clear all cache
  const clearAll = useCallback((): void => {
    const size = cacheRef.current.size;
    cacheRef.current.clear();
    updateStats();
    console.log(`[Cache] Cleared all ${size} entries`);
  }, [updateStats]);

  // Cleanup expired entries
  const cleanup = useCallback((): number => {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of cacheRef.current) {
      if (now - entry.timestamp > entry.ttl) {
        cacheRef.current.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      updateStats();
      console.log(`[Cache] Cleanup removed ${removed} expired entries`);
    }

    return removed;
  }, [updateStats]);

  // Cached user document ID getter
  const getUserDocIdCached = useCallback(async (userId: string): Promise<string | null> => {
    const cacheKey = `user_doc_id_${userId}`;
    
    // Try cache first
    const cached = getCached<string>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      console.log(`[Cache] Fetching user document ID for: ${userId}`);
      const docId = await getUserDocumentId(userId);
      
      if (docId) {
        setCached(cacheKey, docId, 600000); // Cache for 10 minutes
        return docId;
      }
      
      return null;
    } catch (error) {
      console.error(`[Cache] Error fetching user document ID for ${userId}:`, error);
      return null;
    }
  }, [getCached, setCached]);

  // Cached transaction counts (shorter TTL for real-time data)
  const getTransactionCountsCached = useCallback(async <T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 30000 // 30 seconds for counts
  ): Promise<T | null> => {
    const cacheKey = `counts_${key}`;
    
    // Try cache first
    const cached = getCached<T>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      console.log(`[Cache] Fetching counts for: ${key}`);
      const data = await fetcher();
      setCached(cacheKey, data, ttl);
      return data;
    } catch (error) {
      console.error(`[Cache] Error fetching counts for ${key}:`, error);
      return null;
    }
  }, [getCached, setCached]);

  // Cache transaction details (medium TTL)
  const getTransactionCached = useCallback(async <T>(
    transactionId: string,
    fetcher: () => Promise<T>,
    ttl: number = 120000 // 2 minutes
  ): Promise<T | null> => {
    const cacheKey = `transaction_${transactionId}`;
    
    const cached = getCached<T>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      console.log(`[Cache] Fetching transaction: ${transactionId}`);
      const data = await fetcher();
      setCached(cacheKey, data, ttl);
      return data;
    } catch (error) {
      console.error(`[Cache] Error fetching transaction ${transactionId}:`, error);
      return null;
    }
  }, [getCached, setCached]);

  // Cache bank information (long TTL)
  const getBankInfoCached = useCallback(async <T>(
    bankCode: string,
    fetcher: () => Promise<T>,
    ttl: number = 3600000 // 1 hour
  ): Promise<T | null> => {
    const cacheKey = `bank_info_${bankCode}`;
    
    const cached = getCached<T>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      console.log(`[Cache] Fetching bank info: ${bankCode}`);
      const data = await fetcher();
      setCached(cacheKey, data, ttl);
      return data;
    } catch (error) {
      console.error(`[Cache] Error fetching bank info ${bankCode}:`, error);
      return null;
    }
  }, [getCached, setCached]);

  // Cache QR code data (medium TTL)
  const getQRCodeCached = useCallback(async <T>(
    qrKey: string,
    fetcher: () => Promise<T>,
    ttl: number = 300000 // 5 minutes
  ): Promise<T | null> => {
    const cacheKey = `qr_code_${qrKey}`;
    
    const cached = getCached<T>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      console.log(`[Cache] Fetching QR code: ${qrKey}`);
      const data = await fetcher();
      setCached(cacheKey, data, ttl);
      return data;
    } catch (error) {
      console.error(`[Cache] Error fetching QR code ${qrKey}:`, error);
      return null;
    }
  }, [getCached, setCached]);

  // Automatic cleanup interval
  useEffect(() => {
    const interval = setInterval(() => {
      cleanup();
    }, 60000); // Cleanup every minute

    return () => clearInterval(interval);
  }, [cleanup]);

  // Automatic stats update
  useEffect(() => {
    updateStats();
  }, [updateStats]);

  // Cache warming functions
  const warmUserCache = useCallback(async (userIds: string[]): Promise<void> => {
    console.log(`[Cache] Warming user cache for ${userIds.length} users`);
    
    const promises = userIds.map(userId => getUserDocIdCached(userId));
    await Promise.allSettled(promises);
    
    console.log(`[Cache] User cache warming completed`);
  }, [getUserDocIdCached]);

  return {
    // Generic cache operations
    getCached,
    setCached,
    invalidate,
    invalidatePattern,
    clearAll,
    cleanup,
    
    // Specific cached operations
    getUserDocIdCached,
    getTransactionCountsCached,
    getTransactionCached,
    getBankInfoCached,
    getQRCodeCached,
    
    // Cache management
    warmUserCache,
    stats,
    
    // Cache information
    getCacheSize: () => cacheRef.current.size,
    getCacheKeys: () => Array.from(cacheRef.current.keys()),
    getCacheHitRatio: () => {
      const total = stats.hits + stats.misses;
      return total > 0 ? (stats.hits / total) * 100 : 0;
    },
  };
} 