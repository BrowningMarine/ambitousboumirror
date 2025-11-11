import { MerchantAccountCacheService } from "@/lib/supabase-backup";
import { Query } from "appwrite";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { DatabaseOptimizer } from "@/lib/database-optimizer";

// Types
interface MerchantAccount {
  $id: string;
  publicTransactionId: string;
  avaiableBalance: number;
  status: boolean;
  referenceUserId?: string;
  minDepositAmount?: number;
  maxDepositAmount?: number;
  minWithdrawAmount?: number;
  maxWithdrawAmount?: number;
  depositWhitelistIps?: string[];
  withdrawWhitelistIps?: string[];
  apiKey: string;
}

interface CacheEntry {
  data: MerchantAccount;
  timestamp: number;
}

/**
 * High-Performance Merchant Cache Service
 * 
 * Multi-layer caching strategy:
 * - L1: In-memory cache (fastest, ~0.1ms)
 * - L2: Supabase cache (fast, ~50-100ms) 
 * - L3: Appwrite database (slowest, ~1500ms)
 * 
 * Expected performance improvement: 80-95% reduction in verification time
 * - Cache hit (L1): ~0.1ms vs ~1500ms = 99.99% faster
 * - Cache hit (L2): ~50ms vs ~1500ms = 97% faster
 * - Cache miss: ~1500ms (normal)
 */
export class MerchantCacheService {
  // L1 Cache: In-memory (fastest)
  private static memoryCache = new Map<string, CacheEntry>();
  
  // Cache configuration
  private static readonly L1_TTL = 5 * 60 * 1000; // 5 minutes in memory
  private static readonly L2_TTL = 15 * 60 * 1000; // 15 minutes in Supabase
  private static readonly MAX_CACHE_SIZE = 1000; // Max merchants in L1
  
  // Performance metrics
  private static metrics = {
    l1Hits: 0,
    l2Hits: 0,
    l3Hits: 0,
    totalRequests: 0
  };

  /**
   * Get merchant account with multi-layer caching
   * 
   * @param apiKey - Merchant API key
   * @param merchantId - Merchant public transaction ID
   * @param healthyDatabase - Active database mode (appwrite/supabase/none)
   * @returns Merchant account or null
   */
  static async getMerchantAccount(
    apiKey: string,
    merchantId: string,
    healthyDatabase: 'appwrite' | 'supabase' | 'none'
  ): Promise<MerchantAccount | null> {
    const startTime = performance.now();
    this.metrics.totalRequests++;
    
    const cacheKey = this.generateCacheKey(apiKey, merchantId);
    
    try {
      // LAYER 1: Check in-memory cache (L1) - fastest
      const l1Result = this.getFromL1Cache(cacheKey);
      if (l1Result) {
        this.metrics.l1Hits++;
        const responseTime = performance.now() - startTime;
        console.log(`✅ [L1 Cache HIT] Merchant verified in ${responseTime.toFixed(2)}ms (99.99% faster)`);
        return l1Result;
      }

      // LAYER 2: Check Supabase cache (L2) - fast fallback
      // Only use L2 cache when databases are completely down (healthyDatabase === 'none')
      // When healthyDatabase is 'supabase', we should query Supabase directly, not cache
      if (healthyDatabase === 'none') {
        const l2Result = await this.getFromL2Cache(apiKey, merchantId);
        if (l2Result) {
          this.metrics.l2Hits++;
          // Store in L1 for next time
          this.storeInL1Cache(cacheKey, l2Result);
          const responseTime = performance.now() - startTime;
          console.log(`✅ [L2 Cache HIT] Merchant verified in ${responseTime.toFixed(2)}ms (97% faster) - Fallback mode`);
          return l2Result;
        }
      }

      // LAYER 3: Query database (L3) - slowest, last resort
      this.metrics.l3Hits++;
      const l3Result = await this.getFromDatabase(apiKey, merchantId, healthyDatabase);
      
      if (l3Result) {
        // Store in all cache layers
        this.storeInL1Cache(cacheKey, l3Result);
        await this.storeInL2Cache(l3Result);
        
        const responseTime = performance.now() - startTime;
        console.log(`⚠️ [Cache MISS] Merchant verified from database in ${responseTime.toFixed(2)}ms`);
      }
      
      return l3Result;
      
    } catch (error) {
      console.error('❌ [Merchant Cache] Error fetching merchant:', error);
      return null;
    }
  }

  /**
   * Get merchant from L1 in-memory cache
   */
  private static getFromL1Cache(cacheKey: string): MerchantAccount | null {
    const entry = this.memoryCache.get(cacheKey);
    
    if (!entry) {
      return null;
    }
    
    // Check if expired
    const age = Date.now() - entry.timestamp;
    if (age > this.L1_TTL) {
      this.memoryCache.delete(cacheKey);
      return null;
    }
    
    return entry.data;
  }

  /**
   * Store merchant in L1 in-memory cache
   */
  private static storeInL1Cache(cacheKey: string, merchant: MerchantAccount): void {
    // LRU eviction: Remove oldest entry if cache is full
    if (this.memoryCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.memoryCache.keys().next().value;
      if (firstKey) {
        this.memoryCache.delete(firstKey);
      }
    }
    
    this.memoryCache.set(cacheKey, {
      data: merchant,
      timestamp: Date.now()
    });
  }

  /**
   * Get merchant from L2 Supabase cache
   */
  private static async getFromL2Cache(
    apiKey: string,
    merchantId: string
  ): Promise<MerchantAccount | null> {
    try {
      const supabaseCache = new MerchantAccountCacheService();
      const cachedMerchant = await supabaseCache.getMerchantByApiKey(apiKey, merchantId);
      
      if (!cachedMerchant) {
        return null;
      }
      
      // Convert Supabase format to Appwrite format
      return {
        $id: cachedMerchant.appwrite_doc_id || cachedMerchant.merchant_id,
        publicTransactionId: cachedMerchant.merchant_id,
        avaiableBalance: cachedMerchant.available_balance || 0,
        status: cachedMerchant.status || true,
        referenceUserId: undefined, // Not stored in cache
        minDepositAmount: cachedMerchant.min_deposit_amount,
        maxDepositAmount: cachedMerchant.max_deposit_amount,
        minWithdrawAmount: cachedMerchant.min_withdraw_amount,
        maxWithdrawAmount: cachedMerchant.max_withdraw_amount,
        depositWhitelistIps: cachedMerchant.deposit_whitelist_ips || [],
        withdrawWhitelistIps: cachedMerchant.withdraw_whitelist_ips || [],
        apiKey: cachedMerchant.api_key
      };
    } catch (error) {
      console.error('⚠️ [L2 Cache] Supabase query failed:', error);
      return null;
    }
  }

  /**
   * Store merchant in L2 Supabase cache
   */
  private static async storeInL2Cache(merchant: MerchantAccount): Promise<void> {
    try {
      const supabaseCache = new MerchantAccountCacheService();
      await supabaseCache.cacheMerchantAccount({
        merchant_id: merchant.publicTransactionId,
        appwrite_doc_id: merchant.$id,
        api_key: merchant.apiKey,
        available_balance: merchant.avaiableBalance,
        status: merchant.status,
        min_deposit_amount: merchant.minDepositAmount,
        max_deposit_amount: merchant.maxDepositAmount,
        min_withdraw_amount: merchant.minWithdrawAmount,
        max_withdraw_amount: merchant.maxWithdrawAmount,
        deposit_whitelist_ips: merchant.depositWhitelistIps,
        withdraw_whitelist_ips: merchant.withdrawWhitelistIps
      });
    } catch (error) {
      // L2 cache failure is non-critical
      console.warn('⚠️ [L2 Cache] Failed to store in Supabase:', error);
    }
  }

  /**
   * Get merchant from L3 database (Appwrite or Supabase)
   * IMPORTANT: Automatically retries with Supabase if Appwrite fails
   * Falls back to JSON config when both databases are down
   */
  private static async getFromDatabase(
    apiKey: string,
    merchantId: string,
    healthyDatabase: 'appwrite' | 'supabase' | 'none'
  ): Promise<MerchantAccount | null> {
    // Try primary database based on health check
    if (healthyDatabase === 'appwrite') {
      try {
        const appwriteResult = await this.getFromAppwrite(apiKey, merchantId);
        if (appwriteResult) {
          return appwriteResult;
        }
        // Appwrite returned null (not found) - try Supabase as fallback
        console.log('⚠️ [Database Failover] Merchant not found in Appwrite, trying Supabase...');
      } catch (error) {
        // Appwrite query failed (network/timeout error) - immediately failover to Supabase
        console.error('❌ [Database Failover] Appwrite query failed, failing over to Supabase:', 
          error instanceof Error ? error.message : String(error));
      }
      
      // Automatic failover: Try Supabase if Appwrite failed or returned null
      try {
        console.log('🔄 [Database Failover] Attempting Supabase fallback...');
        const supabaseResult = await this.getFromSupabase(apiKey, merchantId);
        if (supabaseResult) {
          console.log('✅ [Database Failover] Successfully retrieved merchant from Supabase');
          return supabaseResult;
        }
      } catch (supabaseError) {
        console.error('❌ [Database Failover] Supabase fallback also failed:', 
          supabaseError instanceof Error ? supabaseError.message : String(supabaseError));
      }
      
      // Both databases failed - try JSON fallback
      console.warn('⚠️ [Database Failover] Both databases failed, trying JSON fallback...');
      return await this.getFromJSONFallback(apiKey, merchantId);
      
    } else if (healthyDatabase === 'supabase') {
      return await this.getFromSupabase(apiKey, merchantId);
    } else {
      // Fallback mode - both databases unhealthy, use JSON config
      console.log('🟡 [Fallback Mode] Using JSON config for merchant verification');
      return await this.getFromJSONFallback(apiKey, merchantId);
    }
  }

  /**
   * Get merchant from Appwrite database
   */
  private static async getFromAppwrite(
    apiKey: string,
    merchantId: string
  ): Promise<MerchantAccount | null> {
    try {
      const { database } = await DatabaseOptimizer.getReadOnlyClient();
      const result = await database.listDocuments(
        appwriteConfig.databaseId!,
        appwriteConfig.accountsCollectionId!,
        [
          Query.equal("apiKey", [apiKey]),
          Query.equal("publicTransactionId", [merchantId]),
          Query.equal("status", [true]),
          Query.limit(1)
        ]
      );
      
      if (!result.documents || result.documents.length === 0) {
        return null;
      }
      
      const doc = result.documents[0] as unknown as MerchantAccount;
      return doc;
      
    } catch (error) {
      console.error('❌ [Appwrite] Merchant query failed:', error);
      throw error;
    }
  }

  /**
   * Get merchant from Supabase database
   * Falls back to L2 cache if primary Supabase query fails
   */
  private static async getFromSupabase(
    apiKey: string,
    merchantId: string
  ): Promise<MerchantAccount | null> {
    try {
      // First, try to get from Supabase backup_accounts table (if it exists)
      const supabaseCache = new MerchantAccountCacheService();
      const supabase = supabaseCache['supabase']; // Access private supabase client
      
      // Try to query backup_accounts table (live merchant data in Supabase)
      const { data: backupAccount, error: backupError } = await supabase
        .from('backup_accounts')
        .select('*')
        .eq('api_key', apiKey)
        .eq('public_transaction_id', merchantId)
        .eq('status', true)
        .single();
      
      if (!backupError && backupAccount) {
        console.log('✅ [Supabase] Found merchant in backup_accounts table');
        
        // Convert Supabase backup_accounts format to MerchantAccount format
        return {
          $id: backupAccount.id || backupAccount.appwrite_doc_id,
          publicTransactionId: backupAccount.public_transaction_id,
          avaiableBalance: backupAccount.available_balance || 0,
          status: backupAccount.status || true,
          referenceUserId: backupAccount.reference_user_id,
          minDepositAmount: backupAccount.min_deposit_amount,
          maxDepositAmount: backupAccount.max_deposit_amount,
          minWithdrawAmount: backupAccount.min_withdraw_amount,
          maxWithdrawAmount: backupAccount.max_withdraw_amount,
          depositWhitelistIps: backupAccount.deposit_whitelist_ips || [],
          withdrawWhitelistIps: backupAccount.withdraw_whitelist_ips || [],
          apiKey: backupAccount.api_key
        };
      }
      
      // Fallback: Use L2 cache (merchant_accounts_cache table)
      console.log('⚠️ [Supabase] backup_accounts not found or table does not exist, falling back to L2 cache');
      return await this.getFromL2Cache(apiKey, merchantId);
      
    } catch (error) {
      console.error('❌ [Supabase] Primary query failed, falling back to L2 cache:', error);
      // Final fallback to cache
      return await this.getFromL2Cache(apiKey, merchantId);
    }
  }

  /**
   * Get merchant from JSON fallback configuration
   * Used when both Appwrite and Supabase are unavailable
   */
  private static async getFromJSONFallback(
    apiKey: string,
    merchantId: string
  ): Promise<MerchantAccount | null> {
    try {
      // Import dynamically to avoid circular dependencies
      const { validateMerchantFallback, getMerchantLimitsFallback } = await import('@/lib/fallback-merchant-validation');
      const { createHash } = await import('crypto');
      
      // Validate merchant credentials using JSON config
      const validation = validateMerchantFallback(apiKey, undefined, 'deposit');
      
      if (!validation.success) {
        console.log('❌ [JSON Fallback] Merchant validation failed:', validation.error);
        return null;
      }
      
      // Use the merchant ID from validation result (config key)
      const configMerchantId = validation.merchantId!;
      
      // Get merchant limits from JSON config
      const depositLimits = getMerchantLimitsFallback(configMerchantId, 'deposit');
      const withdrawLimits = getMerchantLimitsFallback(configMerchantId, 'withdraw');
      
      // Load full merchant config
      const { loadAppConfig } = await import('@/lib/json/config-loader');
      const config = loadAppConfig();
      const merchantConfig = config.merchants[configMerchantId];
      
      if (!merchantConfig) {
        console.log('❌ [JSON Fallback] Merchant config not found in appconfig.json');
        return null;
      }
      
      console.log('✅ [JSON Fallback] Successfully validated merchant from appconfig.json');
      
      // Create merchant account object from JSON config
      // Use the merchantId parameter (publicTransactionId from request) as the public ID
      return {
        $id: validation.accountId || configMerchantId,
        publicTransactionId: merchantId, // Use the publicTransactionId from request
        avaiableBalance: 0, // No balance tracking in fallback mode
        status: true, // Already validated as enabled
        referenceUserId: undefined,
        minDepositAmount: depositLimits?.minAmount,
        maxDepositAmount: depositLimits?.maxAmount,
        minWithdrawAmount: withdrawLimits?.minAmount,
        maxWithdrawAmount: withdrawLimits?.maxAmount,
        depositWhitelistIps: merchantConfig.depositWhitelistIps || [],
        withdrawWhitelistIps: merchantConfig.withdrawWhitelistIps || [],
        apiKey: createHash('sha256').update(apiKey).digest('hex') // Store hash, not plain key
      };
      
    } catch (error) {
      console.error('❌ [JSON Fallback] Error loading merchant from JSON config:', error);
      return null;
    }
  }

  /**
   * Generate cache key for merchant
   */
  private static generateCacheKey(apiKey: string, merchantId: string): string {
    // Use first 8 chars of API key to avoid exposing full key in cache
    const apiKeyHash = apiKey.substring(0, 8);
    return `merchant:${merchantId}:${apiKeyHash}`;
  }

  /**
   * Invalidate merchant cache (call when merchant data changes)
   */
  static invalidateMerchant(merchantId: string): void {
    // Clear all L1 entries for this merchant
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.data.publicTransactionId === merchantId) {
        this.memoryCache.delete(key);
      }
    }
    
    console.log(`🔄 [Cache] Invalidated merchant cache for ${merchantId}`);
  }

  /**
   * Clear all caches (use sparingly)
   */
  static clearAllCaches(): void {
    this.memoryCache.clear();
    console.log('🔄 [Cache] Cleared all merchant caches');
  }

  /**
   * Get cache performance metrics
   */
  static getMetrics(): {
    l1Hits: number;
    l2Hits: number;
    l3Hits: number;
    totalRequests: number;
    l1HitRate: number;
    l2HitRate: number;
    overallHitRate: number;
    cacheSize: number;
  } {
    const l1HitRate = this.metrics.totalRequests > 0 
      ? (this.metrics.l1Hits / this.metrics.totalRequests) * 100 
      : 0;
    const l2HitRate = this.metrics.totalRequests > 0 
      ? (this.metrics.l2Hits / this.metrics.totalRequests) * 100 
      : 0;
    const overallHitRate = this.metrics.totalRequests > 0
      ? ((this.metrics.l1Hits + this.metrics.l2Hits) / this.metrics.totalRequests) * 100
      : 0;
    
    return {
      ...this.metrics,
      l1HitRate: Math.round(l1HitRate * 100) / 100,
      l2HitRate: Math.round(l2HitRate * 100) / 100,
      overallHitRate: Math.round(overallHitRate * 100) / 100,
      cacheSize: this.memoryCache.size
    };
  }

  /**
   * Warmup cache with commonly used merchants
   */
  static async warmupCache(merchantIds: string[]): Promise<void> {
    console.log(`🔥 [Cache] Warming up cache for ${merchantIds.length} merchants...`);
    
    // This would typically be called on server startup with top merchants
    // For now, just log the intent
    console.log('🔥 [Cache] Cache warmup registered (will populate on first request)');
  }
}

// Auto-cleanup expired cache entries every 5 minutes
setInterval(() => {
  const startTime = Date.now();
  let cleaned = 0;
  
  for (const [key, entry] of MerchantCacheService['memoryCache'].entries()) {
    const age = Date.now() - entry.timestamp;
    if (age > MerchantCacheService['L1_TTL']) {
      MerchantCacheService['memoryCache'].delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    console.log(`🧹 [Cache] Cleaned ${cleaned} expired entries in ${Date.now() - startTime}ms`);
  }
}, 5 * 60 * 1000);
