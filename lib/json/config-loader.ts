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
 * - In Node.js: Can dynamically reload from storage based on mode
 * - Uses 5-second cache to reduce reads
 */
export function loadAppConfig(forceReload = false): AppConfigJson {
  const now = Date.now();
  
  // Return cached config if still valid
  if (!forceReload && configCache && (now - lastLoadTime) < CACHE_TTL) {
    return configCache;
  }

  // Edge Runtime: can only use static import
  if (!isNodeEnvironment() || typeof window !== 'undefined') {
    configCache = configData as AppConfigJson;
    lastLoadTime = now;
    return configCache;
  }

  // Node.js: load from storage based on mode
  const mode = getStorageMode();
  
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
      // Local file mode (development and production)
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
 */
export async function loadAppConfigAsync(forceReload = false): Promise<AppConfigJson> {
  const now = Date.now();
  
  // Return cached config if still valid
  if (!forceReload && configCache && (now - lastLoadTime) < CACHE_TTL) {
    return configCache;
  }

  const mode = getStorageMode();

  try {
    if (mode === 'blob' && isNodeEnvironment()) {
      // Load from Vercel Blob Storage
      const { list } = await import('@vercel/blob');
      const { blobs } = await list({ prefix: 'appconfig.json' });
      
      if (blobs.length > 0) {
        const response = await fetch(blobs[0].url);
        const config = await response.json() as AppConfigJson;
        
        configCache = config;
        lastLoadTime = now;
        
        console.log('[Config] Loaded from Blob Storage');
        return config;
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
