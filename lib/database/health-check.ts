/**
 * Database Health Check Utilities
 * 
 * Provides health check functions for Appwrite and Supabase databases
 * to enable automatic failover and resilient operations.
 */

import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { createClient } from '@supabase/supabase-js';

// Health check cache to prevent hammering databases
interface HealthStatus {
  isHealthy: boolean;
  lastChecked: number;
  consecutiveFailures: number;
  backgroundCheckInProgress?: boolean;
}

const healthCache = new Map<string, HealthStatus>();
const HEALTH_CHECK_CACHE_MS = 30000; // Cache health status for 30 seconds (increased from 5s)
const HEALTH_CHECK_SOFT_CACHE_MS = 10000; // Trigger background refresh after 10 seconds
const MAX_CONSECUTIVE_FAILURES = 1; // Mark as unhealthy immediately (changed from 3)
const HEALTH_CHECK_TIMEOUT_MS = 3000; // 3 second timeout for health checks

/**
 * Check if Appwrite database is healthy
 * Uses aggressive caching and background refresh to minimize request blocking
 */
export async function checkAppwriteHealth(): Promise<boolean> {
  const cacheKey = 'appwrite';
  const cached = healthCache.get(cacheKey);
  const now = Date.now();
  
  // OPTIMIZATION: Use cached result if recent (hard cache - 30 seconds)
  if (cached && now - cached.lastChecked < HEALTH_CHECK_CACHE_MS) {
    // Trigger background refresh if cache is getting stale (soft cache - 10 seconds)
    if (!cached.backgroundCheckInProgress && now - cached.lastChecked > HEALTH_CHECK_SOFT_CACHE_MS) {
      // Background refresh - don't await
      cached.backgroundCheckInProgress = true;
      performAppwriteHealthCheck(cacheKey).finally(() => {
        const current = healthCache.get(cacheKey);
        if (current) {
          current.backgroundCheckInProgress = false;
        }
      });
    }
    return cached.isHealthy;
  }

  // Cache miss or expired - perform health check (blocking)
  return await performAppwriteHealthCheck(cacheKey);
}

/**
 * Internal function to perform actual Appwrite health check
 */
async function performAppwriteHealthCheck(cacheKey: string): Promise<boolean> {
  try {
    // Quick health check: try to list documents with limit 1
    const { database } = await createAdminClient();
    
    // Race between health check and timeout
    const healthCheckPromise = database.listDocuments(
      appwriteConfig.databaseId,
      appwriteConfig.odrtransCollectionId,
      []
    );

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Health check timeout')), HEALTH_CHECK_TIMEOUT_MS);
    });

    await Promise.race([healthCheckPromise, timeoutPromise]);

    // Success - update cache
    healthCache.set(cacheKey, {
      isHealthy: true,
      lastChecked: Date.now(),
      consecutiveFailures: 0,
      backgroundCheckInProgress: false
    });

    return true;
  } catch (error) {
    // Special handling for specific error codes
    let forceUnhealthy = false;
    
    // Check for critical errors that should immediately mark as unhealthy
    if (error && typeof error === 'object' && 'code' in error) {
      const errorCode = (error as { code: number }).code;
      // 522 = Connection timeout, 503 = Service unavailable, 502 = Bad gateway
      if (errorCode === 522 || errorCode === 503 || errorCode === 502) {
        forceUnhealthy = true;
        console.error(`❌ [Appwrite Health] Critical error ${errorCode} - marking as unhealthy immediately`);
      }
    }
    
    // Update failure count
    const current = healthCache.get(cacheKey) || { isHealthy: true, lastChecked: 0, consecutiveFailures: 0 };
    const consecutiveFailures = forceUnhealthy ? MAX_CONSECUTIVE_FAILURES : current.consecutiveFailures + 1;
    const isHealthy = consecutiveFailures < MAX_CONSECUTIVE_FAILURES;

    healthCache.set(cacheKey, {
      isHealthy,
      lastChecked: Date.now(),
      consecutiveFailures,
      backgroundCheckInProgress: false
    });

    console.warn('Appwrite health check failed:', {
      error: error instanceof Error ? error.message : String(error),
      errorCode: error && typeof error === 'object' && 'code' in error ? (error as { code: number }).code : undefined,
      consecutiveFailures,
      markedUnhealthy: !isHealthy,
      forcedUnhealthy: forceUnhealthy
    });

    return isHealthy;
  }
}

/**
 * Check if Supabase database is healthy
 * Uses aggressive caching and background refresh to minimize request blocking
 */
export async function checkSupabaseHealth(): Promise<boolean> {
  const cacheKey = 'supabase';
  const cached = healthCache.get(cacheKey);
  const now = Date.now();
  
  // OPTIMIZATION: Use cached result if recent (hard cache - 30 seconds)
  if (cached && now - cached.lastChecked < HEALTH_CHECK_CACHE_MS) {
    // Trigger background refresh if cache is getting stale (soft cache - 10 seconds)
    if (!cached.backgroundCheckInProgress && now - cached.lastChecked > HEALTH_CHECK_SOFT_CACHE_MS) {
      // Background refresh - don't await
      cached.backgroundCheckInProgress = true;
      performSupabaseHealthCheck(cacheKey).finally(() => {
        const current = healthCache.get(cacheKey);
        if (current) {
          current.backgroundCheckInProgress = false;
        }
      });
    }
    return cached.isHealthy;
  }

  // Cache miss or expired - perform health check (blocking)
  return await performSupabaseHealthCheck(cacheKey);
}

/**
 * Internal function to perform actual Supabase health check
 */
async function performSupabaseHealthCheck(cacheKey: string): Promise<boolean> {
  try {
    const supabaseUrl = process.env.SUPABASE_BK_URL;
    const supabaseKey = process.env.SUPABASE_BK_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      console.warn('Supabase credentials not configured');
      healthCache.set(cacheKey, {
        isHealthy: false,
        lastChecked: Date.now(),
        consecutiveFailures: MAX_CONSECUTIVE_FAILURES,
        backgroundCheckInProgress: false
      });
      return false;
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Quick health check: try to query with limit 1
    const healthCheckPromise = supabase
      .from('backup_orders')
      .select('odr_id')
      .limit(1);

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Health check timeout')), HEALTH_CHECK_TIMEOUT_MS);
    });

    const result = await Promise.race([healthCheckPromise, timeoutPromise]) as { error?: Error };

    if (result.error) {
      throw result.error;
    }

    // Success - update cache
    healthCache.set(cacheKey, {
      isHealthy: true,
      lastChecked: Date.now(),
      consecutiveFailures: 0,
      backgroundCheckInProgress: false
    });

    return true;
  } catch (error) {
    // Update failure count
    const current = healthCache.get(cacheKey) || { isHealthy: true, lastChecked: 0, consecutiveFailures: 0 };
    const consecutiveFailures = current.consecutiveFailures + 1;
    const isHealthy = consecutiveFailures < MAX_CONSECUTIVE_FAILURES;

    healthCache.set(cacheKey, {
      isHealthy,
      lastChecked: Date.now(),
      consecutiveFailures,
      backgroundCheckInProgress: false
    });

    console.warn('Supabase health check failed:', {
      error: error instanceof Error ? error.message : String(error),
      errorDetails: error,
      consecutiveFailures,
      markedUnhealthy: !isHealthy
    });

    return isHealthy;
  }
}

/**
 * Determine which database to use based on health status and configuration
 * Returns 'appwrite' | 'supabase' | 'none'
 * Uses fresh config data to ensure mode changes take effect immediately
 */
export async function selectHealthyDatabase(): Promise<'appwrite' | 'supabase' | 'none'> {
  // Import dynamically to avoid circular dependency
  const { getDatabasePriority } = await import('@/lib/appconfig');
  const { loadAppConfigAsync } = await import('@/lib/json/config-loader');
  
  // Force fresh config load to ensure mode changes are reflected immediately
  const config = await loadAppConfigAsync(true);
  const runningMode = config.databaseSettings?.coreRunningMode || 'auto';

  // Mode 0: Fallback Only - no database writes, use config only
  if (runningMode === 'fallback') {
    console.log('🟡 [Database Mode] Fallback mode - no health check needed');
    return 'none';
  }

  // Mode 1: Appwrite Only - SKIP health check, use directly (trust configuration)
  if (runningMode === 'appwrite') {
    console.log('✅ [Database Mode] Appwrite mode - using directly (no health check)');
    return 'appwrite';
  }

  // Mode 2: Supabase Only - SKIP health check, use directly (trust configuration)
  if (runningMode === 'supabase') {
    console.log('✅ [Database Mode] Supabase mode - using directly (no health check)');
    return 'supabase';
  }

  // Mode 3: Auto - Use health checks to determine best database from priority order
  console.log('🔍 [Auto Mode] Running health checks to select database...');
  const priority = getDatabasePriority();
  
  for (const db of priority) {
    if (db === 'appwrite') {
      const appwriteHealthy = await checkAppwriteHealth();
      if (appwriteHealthy) {
        console.log('✅ [Auto Mode] Selected Appwrite (healthy, priority order)');
        return 'appwrite';
      }
      console.warn('⚠️ [Auto Mode] Appwrite unhealthy, trying next in priority...');
    } else if (db === 'supabase') {
      const supabaseHealthy = await checkSupabaseHealth();
      if (supabaseHealthy) {
        console.log('✅ [Auto Mode] Selected Supabase (healthy, priority order)');
        return 'supabase';
      }
      console.warn('⚠️ [Auto Mode] Supabase unhealthy, trying next in priority...');
    } else if (db === 'fallback') {
      // Fallback is always "available" as last resort
      console.log('🟡 [Auto Mode] Selected Fallback mode (last resort)');
      return 'none';
    }
  }

  // All databases in priority list failed
  console.warn('⚠️ [Auto Mode] All databases in priority list are unhealthy, using none');
  return 'none';
}

/**
 * Reset health check cache (useful for testing or manual recovery)
 */
export function resetHealthCache(): void {
  healthCache.clear();
}

/**
 * Get current health status for monitoring
 */
export function getHealthStatus(): Record<string, HealthStatus | undefined> {
  return {
    appwrite: healthCache.get('appwrite'),
    supabase: healthCache.get('supabase')
  };
}
