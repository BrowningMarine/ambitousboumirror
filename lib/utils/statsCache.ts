// Client-side cache utility for transaction stats
interface CachedStatsEntry {
  data: unknown;
  timestamp: number;
  expiresAt: number;
}

interface TransactionStats {
  totalOrders: number;
  totalDeposits: number;
  totalWithdraws: number;
  totalDepositAmount: number;
  totalWithdrawAmount: number;
  averageProcessingTime: number;
  successRate: number;
  statusBreakdown: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    canceled: number;
  };
}

// Cache durations
const HISTORICAL_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours for historical data
const TODAY_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes for today

// Helper function to check if a date is today
function isToday(dateString: string): boolean {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  const todayString = `${year}-${month}-${day}`;
  return dateString === todayString;
}

// Generate cache key for a date
function generateCacheKey(dateString: string): string {
  return `transaction_stats_${dateString}`;
}

// Check if localStorage is available
function isLocalStorageAvailable(): boolean {
  try {
    const test = '__localStorage_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

// Get cached stats for a specific date
export function getCachedStats(dateString: string): TransactionStats | null {
  if (!isLocalStorageAvailable()) return null;

  try {
    const cacheKey = generateCacheKey(dateString);
    const cached = localStorage.getItem(cacheKey);
    
    if (!cached) return null;

    const entry: CachedStatsEntry = JSON.parse(cached);
    
    // Check if cache is expired
    if (entry.expiresAt < Date.now()) {
      localStorage.removeItem(cacheKey);
      return null;
    }

    return entry.data as TransactionStats;
  } catch (error) {
    console.warn('Error reading from stats cache:', error);
    return null;
  }
}

// Cache stats for a specific date
export function setCachedStats(dateString: string, stats: TransactionStats): void {
  if (!isLocalStorageAvailable()) return;

  try {
    const cacheKey = generateCacheKey(dateString);
    const isTodayData = isToday(dateString);
    const cacheDuration = isTodayData ? TODAY_CACHE_DURATION : HISTORICAL_CACHE_DURATION;
    
    const entry: CachedStatsEntry = {
      data: stats,
      timestamp: Date.now(),
      expiresAt: Date.now() + cacheDuration
    };

    localStorage.setItem(cacheKey, JSON.stringify(entry));
  } catch (error) {
    console.warn('Error writing to stats cache:', error);
  }
}

// Clear expired cache entries
export function cleanExpiredStatsCache(): void {
  if (!isLocalStorageAvailable()) return;

  try {
    const now = Date.now();
    const keysToRemove: string[] = [];

    // Check all localStorage keys for expired stats
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('transaction_stats_')) {
        try {
          const cached = localStorage.getItem(key);
          if (cached) {
            const entry: CachedStatsEntry = JSON.parse(cached);
            if (entry.expiresAt < now) {
              keysToRemove.push(key);
            }
          }
        } catch {
          // If we can't parse it, remove it
          keysToRemove.push(key);
        }
      }
    }

    // Remove expired entries
    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch (error) {
    console.warn('Error cleaning stats cache:', error);
  }
}

// Clear all cached stats (useful for debugging or manual refresh)
export function clearAllStatsCache(): void {
  if (!isLocalStorageAvailable()) return;

  try {
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('transaction_stats_')) {
        keysToRemove.push(key);
      }
    }

    keysToRemove.forEach(key => localStorage.removeItem(key));
  } catch (error) {
    console.warn('Error clearing stats cache:', error);
  }
}

// Get cache info for debugging
export function getStatsCache(): Record<string, CachedStatsEntry> {
  if (!isLocalStorageAvailable()) return {};

  const cache: Record<string, CachedStatsEntry> = {};

  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('transaction_stats_')) {
        const cached = localStorage.getItem(key);
        if (cached) {
          try {
            cache[key] = JSON.parse(cached);
          } catch {
            // Skip invalid entries
          }
        }
      }
    }
  } catch (error) {
    console.warn('Error reading stats cache:', error);
  }

  return cache;
} 