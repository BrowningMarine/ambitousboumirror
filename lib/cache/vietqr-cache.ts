import axios from 'axios';

// VietQR API Configuration
const VIETQR_BANKS_URL = 'https://api.vietqr.io/v2/banks';

// Define response types
export interface VietQRBankResponse {
  code: string;
  desc: string;
  data: Array<{
    id: number;
    name: string;
    code: string;
    bin: string;
    shortName: string;
    logo: string;
    transferSupported: number;
    lookupSupported: number;
    short_name: string;
    support: number;
    isTransfer: number;
    swift_code: string;
  }>;
}

/**
 * VietQR API Caching System
 * 
 * Provides in-memory caching for VietQR bank data with:
 * - 1-hour TTL (Time To Live)
 * - Fallback to stale cache on API failures
 * - Performance monitoring
 * - Automatic cache invalidation
 * 
 * Expected performance improvement: 20-30%
 * - Cache HIT: ~1-5ms (vs 500-1500ms API call)
 * - Cache MISS: API call time + caching overhead
 * - Fallback: Stale cache (better than failure)
 */
export class VietQRCache {
  private static cache = new Map<string, {
    data: VietQRBankResponse;
    timestamp: number;
    ttl: number;
  }>();
  
  private static readonly CACHE_TTL = 3600000; // 1 hour in milliseconds
  private static readonly CACHE_KEY = 'vietqr_banks';
  private static readonly API_TIMEOUT = 5000; // 5 seconds
  
  /**
   * Get cached bank data or fetch from VietQR API
   * @returns VietQRBankResponse or null if unavailable
   */
  static async getBankList(): Promise<VietQRBankResponse | null> {
    const cacheStart = performance.now();
    
    try {
      // Check cache first
      const cached = this.cache.get(this.CACHE_KEY);
      const now = Date.now();
      
      if (cached && (now - cached.timestamp) < cached.ttl) {
        const cacheTime = performance.now() - cacheStart;
        console.log(`✅ VietQR Cache HIT: ${cacheTime.toFixed(2)}ms (${Math.round((now - cached.timestamp) / 60000)}min old)`);
        return cached.data;
      }
      
      // Cache miss or expired - fetch from API
      console.warn(`🔄 VietQR Cache MISS: Fetching from API...`);
      const apiStart = performance.now();
      
      const response = await axios.get<VietQRBankResponse>(VIETQR_BANKS_URL, {
        timeout: this.API_TIMEOUT,
        headers: {
          'User-Agent': 'VietQR-Cache/1.0',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache'
        }
      });
      
      const apiTime = performance.now() - apiStart;
      
      if (response.data && response.data.code === "00") {
        // Store in cache
        this.cache.set(this.CACHE_KEY, {
          data: response.data,
          timestamp: now,
          ttl: this.CACHE_TTL
        });
        
        console.log(`✅ VietQR API Success: ${apiTime.toFixed(2)}ms, cached for 1 hour (${response.data.data.length} banks)`);
        return response.data;
      } else {
        console.error('VietQR API returned error:', response.data);
        return this.handleApiFallback();
      }
      
    } catch (error) {
      console.error('VietQR API Error:', error);
      return this.handleApiFallback();
    }
  }
  
  /**
   * Handle API failures with fallback to stale cache
   * @returns Stale cache data or null
   */
  private static handleApiFallback(): VietQRBankResponse | null {
    const staleCache = this.cache.get(this.CACHE_KEY);
    if (staleCache) {
      const ageMinutes = Math.round((Date.now() - staleCache.timestamp) / 60000);
      console.log(`⚠️ VietQR Fallback: Using stale cache (${ageMinutes} minutes old)`);
      return staleCache.data;
    }
    
    console.error('❌ VietQR Complete Failure: No cache available');
    return null;
  }
  
  /**
   * Validate bank code using cached data
   * @param bankCode Bank BIN code to validate
   * @returns Validation result with bank details
   */
  static async validateBankCode(bankCode: string): Promise<{
    valid: boolean;
    message: string;
    bankReceiveName?: string;
    bankName?: string;
  }> {
    const validationStart = performance.now();
    
    try {
      const bankData = await this.getBankList();
      
      if (!bankData) {
        return {
          valid: false,
          message: 'Could not validate bank code - VietQR API unavailable and no cached data'
        };
      }
      
      const validBank = bankData.data.find(bank => bank.bin === bankCode);
      
      if (!validBank) {
        return {
          valid: false,
          message: `Invalid bankCode: ${bankCode} not found in VietQR bank list`
        };
      }
      
      const validationTime = performance.now() - validationStart;
      console.log(`🏦 Bank Validation Success: ${validationTime.toFixed(2)}ms (${validBank.shortName})`);
      
      return {
        valid: true,
        message: '',
        bankReceiveName: validBank.shortName,
        bankName: validBank.name
      };
      
    } catch (error) {
      console.error('Bank validation error:', error);
      return {
        valid: false,
        message: 'Error during bank code validation'
      };
    }
  }
  
  /**
   * Get filtered bank list for public API responses
   * @returns Filtered bank data for client consumption
   */
  static async getPublicBankList(): Promise<{
    success: boolean;
    data?: Array<{
      name: string;
      shortName: string;
      bankCode: string;
      logo: string;
    }>;
    message?: string;
  }> {
    try {
      const bankData = await this.getBankList();
      
      if (!bankData) {
        return {
          success: false,
          message: 'Failed to get bank codes - VietQR API unavailable'
        };
      }
      
      // Map to only include the fields we want for public consumption
      const filteredBanks = bankData.data.map(bank => ({
        name: bank.name,
        shortName: bank.shortName,
        bankCode: bank.bin,
        logo: bank.logo
      }));
      
      return {
        success: true,
        data: filteredBanks
      };
      
    } catch (error) {
      console.error('Error getting public bank list:', error);
      return {
        success: false,
        message: 'Error getting bank codes'
      };
    }
  }
  
  /**
   * Clear cache manually (for testing or forced refresh)
   */
  static clearCache(): void {
    this.cache.clear();
    console.log('🗑️ VietQR Cache cleared manually');
  }
  
  /**
   * Get cache statistics for monitoring
   * @returns Cache status and performance metrics
   */
  static getCacheStats(): {
    hasCache: boolean;
    cacheAge: number;
    cacheAgeMinutes: number;
    cacheSize: number;
    isExpired: boolean;
    nextRefresh: number;
  } {
    const cached = this.cache.get(this.CACHE_KEY);
    const now = Date.now();
    
    if (!cached) {
      return {
        hasCache: false,
        cacheAge: 0,
        cacheAgeMinutes: 0,
        cacheSize: this.cache.size,
        isExpired: true,
        nextRefresh: 0
      };
    }
    
    const cacheAge = now - cached.timestamp;
    const isExpired = cacheAge >= cached.ttl;
    const nextRefresh = cached.timestamp + cached.ttl - now;
    
    return {
      hasCache: true,
      cacheAge,
      cacheAgeMinutes: Math.round(cacheAge / 60000),
      cacheSize: this.cache.size,
      isExpired,
      nextRefresh: Math.max(0, nextRefresh)
    };
  }
  
  /**
   * Warm up the cache (useful for application startup)
   */
  static async warmUpCache(): Promise<boolean> {
    console.log('🔥 Warming up VietQR cache...');
    const result = await this.getBankList();
    return result !== null;
  }
} 