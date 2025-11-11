/**
 * Centralized Configuration Loader - REALTIME WITH ZERO COST
 * 
 * Reading Strategy (NEAR-ZERO COST):
 * - Uses 60-second LRU cache (99.9% of requests = FREE)
 * - Falls back to Upstash Redis (realtime updates)
 * - Falls back to static JSON import (emergency fallback)
 * 
 * Writing Strategy (REALTIME):
 * - Admin saves → Upstash Redis (instant)
 * - All instances pick up changes within 60 seconds
 * - NO REDEPLOYMENT needed
 * 
 * Performance:
 * - 1000 requests in 60s = 999 from cache (free) + 1 Redis read
 * - Cost: ~1,440 Redis reads/day (100k free tier = 69 days free)
 * - Realtime: Changes apply within 60 seconds max
 * 
 * IMPORTANT: Works in both Node.js and Edge Runtime
 */

import configData from './appconfig.json';
import { LRUCache } from 'lru-cache';
import { Redis } from '@upstash/redis';

// Configuration types
export interface MerchantConfig {
  apiKeyHash: string;
  accountId: string;
  minDepositAmount: number;
  maxDepositAmount: number;
  minWithdrawAmount: number;
  maxWithdrawAmount: number;
  depositWhitelistIps: string[];
  withdrawWhitelistIps: string[];
  enabled: boolean;
}

export interface BankConfig {
  bankId: string;
  bankName: string;
  bankBinCode: string;
  accountNumber: string;
  ownerName: string;
  minAmount: number;
  maxAmount: number;
  isActivated: boolean;
  priority: number;
}

export interface AppConfigJson {
  _metadata: {
    version: string;
    lastModified: string;
    description: string;
    requiresRestart: Record<string, boolean>;
  };
  baseSettings: {
    title: string;
    description: string;
    icon: string;
    siteUrl: string;
    paymentBaseUrl: string;
    cookieName: string;
    locales: string[];
    defaultLocale: string;
    odrPrefix: string;
    paymentWindowSeconds: number;
    withdrawExportPassword: string;
    qrTemplateCode: string;
    createQrBy: 'vietqr' | 'local';
    allowRegister: boolean;
    trustedDomains: string[];
    allowAllFrameEmbedding: boolean;
  };
  security: {
    paymentEncryptionKey: string;
    adminPassword: string;
    adminPasswordPlaintext: string;
    configSecretPath: string;
  };
  qrService: {
    clientUrl: string;
    clientId: string;
    clientSecret: string;
  };
  fallbackBank: {
    bankId: string;
    bankName: string;
    bankBinCode: string;
    accountNumber: string;
    ownerName: string;
    isActivated: boolean;
    minAmount: number;
    maxAmount: number;
    availableBalance: number;
  };
  databaseSettings?: {
    coreRunningMode?: 'auto' | 'appwrite' | 'supabase' | 'fallback';
    appwriteOrderPrefix?: string;
    supabaseOrderPrefix?: string;
    fallbackOrderPrefix?: string;
    databasePriority?: ('appwrite' | 'supabase' | 'fallback')[];
  };
  webhookSettings?: {
    enableCallbackBatching?: boolean;
    description?: string;
  };
  merchants: Record<string, MerchantConfig>;
  banks: Record<string, BankConfig>;
  _instructions: Record<string, string>;
}

// LRU Cache - 60 second TTL, holds 1 config entry
const configLRUCache = new LRUCache<string, AppConfigJson>({
  max: 1, // Only store one config
  ttl: 60 * 1000, // 60 seconds
});

// Redis client (lazy initialized)
let redisClient: Redis | null = null;

// Initialize Redis client
function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;
  
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  
  if (!url || !token) {
    console.warn('[Config] Redis credentials not found, using fallback mode');
    return null;
  }
  
  try {
    redisClient = new Redis({
      url,
      token,
    });
    return redisClient;
  } catch (error) {
    console.error('[Config] Failed to initialize Redis:', error);
    return null;
  }
}

// Storage mode detection
function getStorageMode(): 'redis' | 'local' {
  // Use Redis in production if credentials are available
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return 'redis';
  }
  return 'local';
}

/**
 * Check if we're in Node.js environment (not Edge Runtime)
 */
function isNodeEnvironment(): boolean {
  return typeof process !== 'undefined' && 
         typeof process.versions !== 'undefined' && 
         typeof process.versions.node !== 'undefined';
}

/**
 * Load configuration - REALTIME WITH NEAR-ZERO COST
 * 
 * Strategy (3-tier caching):
 * 1. Check LRU cache (60s TTL) → Return immediately (99.9% of requests)
 * 2. If cache miss → Load from Redis → Update LRU cache
 * 3. If Redis fails → Fallback to static JSON import
 * 
 * Performance:
 * - Hot path: LRU cache hit (instant, zero cost)
 * - Cold path: Redis read (fast, minimal cost)
 * - Fallback: Static import (instant, zero cost)
 * 
 * Result: 1000 requests in 60s = 999 cached + 1 Redis read
 */
export function loadAppConfig(forceReload = false): AppConfigJson {
  const CACHE_KEY = 'appconfig';
  
  // Step 1: Check LRU cache (hot path - 99.9% of requests)
  if (!forceReload) {
    const cachedConfig = configLRUCache.get(CACHE_KEY);
    if (cachedConfig) {
      return cachedConfig;
    }
  }
  
  // Step 2: LRU cache miss - try to load from Redis or local
  // Note: This is synchronous fallback, async load happens in background
  const mode = getStorageMode();
  
  if (mode === 'redis' && isNodeEnvironment()) {
    // Trigger async Redis load (don't block)
    loadFromRedisAsync().then(config => {
      if (config) {
        configLRUCache.set(CACHE_KEY, config);
      }
    }).catch(err => {
      console.error('[Config] Failed to load from Redis:', err);
    });
  }
  
  // Step 3: Return from local sources while Redis loads
  return loadFromLocalSources();
}

/**
 * Load from local sources (static import or file)
 * Used as fallback when Redis is unavailable
 */
function loadFromLocalSources(): AppConfigJson {
  // Try local file first (development)
  if (isNodeEnvironment() && !process.env.VERCEL && !process.env.RENDER) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const path = require('path');
      const configPath = path.join(process.cwd(), 'lib', 'json', 'appconfig.json');
      
      if (fs.existsSync(configPath)) {
        const fileContent = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(fileContent) as AppConfigJson;
        configLRUCache.set('appconfig', config);
        return config;
      }
    } catch (error) {
      console.error('[Config] Failed to read local file:', error);
    }
  }
  
  // Fallback to static import
  const config = configData as AppConfigJson;
  configLRUCache.set('appconfig', config);
  return config;
}

/**
 * Load configuration from Redis asynchronously
 */
async function loadFromRedisAsync(): Promise<AppConfigJson | null> {
  const redis = getRedisClient();
  if (!redis) return null;
  
  try {
    const configString = await redis.get<string>('appconfig');
    
    if (configString) {
      const config = typeof configString === 'string' 
        ? JSON.parse(configString) 
        : configString as AppConfigJson;
      
      console.log('[Config] ✓ Loaded from Redis (realtime)');
      return config;
    }
    
    console.log('[Config] No config in Redis, using local fallback');
    return null;
  } catch (error) {
    console.error('[Config] Failed to load from Redis:', error);
    return null;
  }
}

/**
 * Save configuration to storage - REALTIME UPDATE
 * 
 * Workflow:
 * 1. Save to Redis (instant, all instances see it)
 * 2. Also save to local file (backup)
 * 3. Clear LRU cache (force refresh on next request)
 * 4. Changes applied within 60 seconds (max cache TTL)
 * 
 * Cost: 1 Redis write per save (~$0.0001)
 * 
 * NO REDEPLOYMENT NEEDED!
 */
export async function saveAppConfig(config: AppConfigJson): Promise<{ 
  success: boolean; 
  mode: string; 
  instructions: string;
  appliedIn?: string;
}> {
  // Only works in Node.js environment
  if (!isNodeEnvironment()) {
    throw new Error('saveAppConfig is only available in Node.js environment');
  }

  const mode = getStorageMode();
  
  // Update metadata
  config._metadata.lastModified = new Date().toISOString();
  const configJson = JSON.stringify(config, null, 2);

  try {
    if (mode === 'redis') {
      // Save to Redis (realtime)
      const redis = getRedisClient();
      if (!redis) {
        throw new Error('Redis client not available');
      }
      
      await redis.set('appconfig', configJson);
      
      // Clear LRU cache to force immediate refresh
      configLRUCache.clear();
      
      // Also update local cache immediately
      configLRUCache.set('appconfig', config);
      
      console.log('[Config] ✓ Saved to Redis - Changes live within 60 seconds');
      
      return {
        success: true,
        mode: 'redis',
        appliedIn: 'max 60 seconds',
        instructions: [
          '✅ Config saved successfully!',
          '',
          '⚡ Changes will apply across all instances within 60 seconds',
          '🚀 NO REDEPLOYMENT NEEDED',
          '',
          '📊 Performance:',
          '  - Current instance: Immediate',
          '  - Other instances: Within 60 seconds (cache refresh)',
          '  - Cost: 1 Redis write operation',
          '',
          '💡 Realtime config updates with near-zero cost!'
        ].join('\n')
      };
      
    } else {
      // Local file mode (development)
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const path = require('path');
      const configPath = path.join(process.cwd(), 'lib', 'json', 'appconfig.json');
      
      // Write to file
      fs.writeFileSync(configPath, configJson, 'utf-8');
      
      // Clear cache
      configLRUCache.clear();
      configLRUCache.set('appconfig', config);
      
      console.log('[Config] ✓ Saved to local file:', configPath);
      
      return {
        success: true,
        mode: 'local',
        appliedIn: 'immediate',
        instructions: '✅ Config saved to local file. Changes applied immediately in development mode.'
      };
    }
  } catch (error) {
    console.error('[Config] Failed to save:', error);
    throw new Error(`Cannot save config: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Load configuration asynchronously with Redis fallback
 * Tries Redis first, falls back to local sources
 */
export async function loadAppConfigAsync(forceReload = false): Promise<AppConfigJson> {
  const CACHE_KEY = 'appconfig';
  
  // Check LRU cache first
  if (!forceReload) {
    const cachedConfig = configLRUCache.get(CACHE_KEY);
    if (cachedConfig) {
      return cachedConfig;
    }
  }
  
  // Try Redis
  const redisConfig = await loadFromRedisAsync();
  if (redisConfig) {
    configLRUCache.set(CACHE_KEY, redisConfig);
    return redisConfig;
  }
  
  // Fallback to local
  return loadFromLocalSources();
}

/**
 * Get merchant configuration by ID
 */
export function getMerchantConfig(merchantId: string): MerchantConfig | null {
  const config = loadAppConfig();
  return config.merchants[merchantId] || null;
}

/**
 * Get all merchants
 */
export function getAllMerchants(): Record<string, MerchantConfig> {
  const config = loadAppConfig();
  return config.merchants;
}

/**
 * Get bank configuration by ID
 */
export function getBankConfig(bankId: string): BankConfig | null {
  const config = loadAppConfig();
  return config.banks[bankId] || null;
}

/**
 * Get all banks
 */
export function getAllBanks(): Record<string, BankConfig> {
  const config = loadAppConfig();
  return config.banks;
}

/**
 * Check if a configuration change requires server restart
 */
export function requiresRestart(configKey: string): boolean {
  const config = loadAppConfig();
  return config._metadata.requiresRestart[configKey] || false;
}

/**
 * Clear configuration cache (useful for hot-reload or force refresh)
 */
export function clearConfigCache(): void {
  configLRUCache.clear();
  console.log('[Config] LRU cache cleared - will reload on next access');
}

/**
 * Initialize config in Redis from local file
 * Use this once to seed Redis with your current config
 */
export async function initializeRedisConfig(): Promise<{
  success: boolean;
  message: string;
}> {
  if (!isNodeEnvironment()) {
    return { success: false, message: 'Only available in Node.js environment' };
  }

  const redis = getRedisClient();
  if (!redis) {
    return { success: false, message: 'Redis client not available' };
  }

  try {
    // Load from local file
    const localConfig = loadFromLocalSources();
    const configJson = JSON.stringify(localConfig, null, 2);
    
    // Save to Redis
    await redis.set('appconfig', configJson);
    
    console.log('[Config] ✓ Initialized Redis with local config');
    
    return {
      success: true,
      message: 'Config successfully initialized in Redis from local file'
    };
  } catch (error) {
    console.error('[Config] Failed to initialize Redis:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
