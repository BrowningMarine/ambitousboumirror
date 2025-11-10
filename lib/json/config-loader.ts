/**
 * Centralized Configuration Loader with Cloud Storage Support
 * 
 * Storage Modes:
 * - LOCAL: Read/write to lib/json/appconfig.json (development only)
 * - BLOB: Use Vercel Blob Storage (production - works on Vercel & Render)
 * - ENV: Read from APPCONFIG_JSON environment variable (read-only fallback)
 * 
 * IMPORTANT: This file works in both Node.js and Edge Runtime
 * - Edge Runtime (middleware): Uses static JSON import or ENV
 * - Node.js (API routes): Can use Blob Storage or local file
 */

import configData from './appconfig.json';

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

// Singleton instance - starts with static JSON data
let configCache: AppConfigJson | null = configData as AppConfigJson;
let lastLoadTime = Date.now();
const CACHE_TTL = 5000; // 5 seconds cache

// Track if we've attempted initial blob load
let initialBlobLoadAttempted = false;

// Storage mode detection
function getStorageMode(): 'local' | 'blob' | 'env' {
  const mode = process.env.CONFIG_STORAGE_MODE;
  if (mode === 'blob') return 'blob';
  if (mode === 'env') return 'env';
  
  // Auto-detect: use blob in production (Vercel/Render), local in development
  if (process.env.VERCEL || process.env.RENDER) {
    return process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'env';
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
 * Load configuration with smart caching
 * - In Edge Runtime: Always uses static JSON import (cannot reload)
 * - In Node.js Blob mode: Triggers async refresh, returns cache
 * - In Node.js Local/Env mode: Loads synchronously
 * - Uses 5-second cache to reduce reads
 */
export function loadAppConfig(forceReload = false): AppConfigJson {
  const now = Date.now();
  
  // Return cached config if still valid (unless force reload)
  if (!forceReload && configCache && (now - lastLoadTime) < CACHE_TTL) {
    return configCache;
  }

  // Edge Runtime or Browser: can only use static import
  if (!isNodeEnvironment() || typeof window !== 'undefined') {
    configCache = configData as AppConfigJson;
    lastLoadTime = now;
    return configCache;
  }

  // Node.js: load from storage based on mode
  const mode = getStorageMode();
  
  if (mode === 'blob') {
    // BLOB MODE: Trigger background refresh on first call or cache expiry
    // This prevents blocking the main thread with async blob reads
    if (forceReload || !configCache || (now - lastLoadTime) >= CACHE_TTL) {
      // On first load attempt, mark as attempted to prevent multiple simultaneous loads
      if (!initialBlobLoadAttempted) {
        initialBlobLoadAttempted = true;
        console.log('[Config] Triggering initial blob load...');
      }
      
      // Trigger async refresh in background (don't wait)
      loadAppConfigAsync(true).catch(err => {
        console.error('[Config Loader] Background blob refresh failed:', err);
      });
      
      // If we have cache, return it immediately (don't block)
      if (configCache) {
        return configCache;
      }
    }
    
    // If no cache exists, return static config as fallback
    return configCache || (configData as AppConfigJson);
  }
  
  // ENV or LOCAL mode: Load synchronously
  try {
    if (mode === 'env') {
      // Load from environment variable
      const envConfig = process.env.APPCONFIG_JSON;
      if (envConfig) {
        configCache = JSON.parse(envConfig) as AppConfigJson;
        lastLoadTime = now;
        return configCache;
      }
    } else {
      // Local file mode (development)
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const path = require('path');
      const configPath = path.join(process.cwd(), 'lib', 'json', 'appconfig.json');
      
      if (fs.existsSync(configPath)) {
        const fileContent = fs.readFileSync(configPath, 'utf-8');
        configCache = JSON.parse(fileContent) as AppConfigJson;
        lastLoadTime = now;
        return configCache;
      }
    }
  } catch (error) {
    console.error('[Config Loader] Error loading config:', error);
  }

  // Fallback to cached config or static import
  if (configCache) {
    return configCache;
  }

  configCache = configData as AppConfigJson;
  lastLoadTime = now;
  return configCache;
}

/**
 * Save configuration to storage
 * - BLOB mode: Use Vercel Blob Storage API (async)
 * - LOCAL mode: Write to file system
 * - ENV mode: Cannot save (read-only)
 */
export async function saveAppConfig(config: AppConfigJson): Promise<void> {
  // Only works in Node.js environment
  if (!isNodeEnvironment()) {
    throw new Error('saveAppConfig is only available in Node.js environment');
  }

  const mode = getStorageMode();
  
  // Update metadata
  config._metadata.lastModified = new Date().toISOString();

  try {
    if (mode === 'blob') {
      // Use Vercel Blob Storage
      const { put } = await import('@vercel/blob');
      const blob = await put('appconfig.json', JSON.stringify(config, null, 2), {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json',
        allowOverwrite: true, // Allow updating existing config
      });
      
      console.log('[Config] Saved to Blob Storage:', blob.url);
      
      // Update cache immediately
      configCache = config;
      lastLoadTime = Date.now();
      
    } else if (mode === 'env') {
      throw new Error('Cannot save config in ENV mode - environment variables are read-only');
      
    } else {
      // Local file mode
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const path = require('path');
      const configPath = path.join(process.cwd(), 'lib', 'json', 'appconfig.json');
      
      // Write to file with pretty formatting
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
      
      console.log('[Config] Saved to local file');
      
      // Update cache
      configCache = config;
      lastLoadTime = Date.now();
    }
  } catch (error) {
    console.error('[Config] Failed to save:', error);
    throw new Error(`Cannot save config: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Load configuration asynchronously from Blob Storage
 * Use this in API routes for live config updates
 * IMPORTANT: On Vercel with blob storage, always use this for fresh data
 */
export async function loadAppConfigAsync(forceReload = false): Promise<AppConfigJson> {
  const now = Date.now();
  
  // Return cached config if still valid (unless force reload)
  if (!forceReload && configCache && (now - lastLoadTime) < CACHE_TTL) {
    return configCache;
  }

  const mode = getStorageMode();

  try {
    if (mode === 'blob' && isNodeEnvironment()) {
      // Load from Vercel Blob Storage
      const { list } = await import('@vercel/blob');
      const { blobs } = await list({ prefix: 'appconfig.json', limit: 1 });
      
      if (blobs.length > 0) {
        const response = await fetch(blobs[0].url);
        if (!response.ok) {
          throw new Error(`Failed to fetch blob: ${response.status} ${response.statusText}`);
        }
        
        const config = await response.json() as AppConfigJson;
        
        // Update cache
        configCache = config;
        lastLoadTime = now;
        
        console.log('[Config] Loaded from Blob Storage:', blobs[0].url);
        return config;
      } else {
        console.warn('[Config] No blob found for appconfig.json, using static config');
      }
    }
  } catch (error) {
    console.error('[Config] Error loading from blob, using fallback:', error);
  }

  // Fallback to sync load
  return loadAppConfig(forceReload);
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
 * Clear configuration cache (useful for hot-reload in development)
 */
export function clearConfigCache(): void {
  configCache = null;
  lastLoadTime = 0;
}
