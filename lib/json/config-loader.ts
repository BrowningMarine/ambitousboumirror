/**
 * Centralized Configuration Loader - ZERO RUNTIME COST
 * 
 * Reading Strategy (ZERO COST):
 * - Always uses static JSON import (loaded once at build/startup)
 * - Optional override via APPCONFIG_JSON environment variable
 * - No blob storage reads during runtime = ZERO operations cost
 * 
 * Writing Strategy (ONLY WHEN YOU UPDATE):
 * - Admin updates save to Blob Storage (one-time cost per update)
 * - Then you manually update APPCONFIG_JSON env var in Vercel/Render
 * - Redeploy to pick up new config (free operation)
 * 
 * Result: 10k orders = 0 blob operations, 1 config update = 1 blob write
 * 
 * IMPORTANT: This file works in both Node.js and Edge Runtime
 * - Edge Runtime (middleware): Uses static JSON import or ENV
 * - Node.js (API routes): Uses static JSON import or ENV, saves to Blob
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

// Singleton instance - loaded ONCE at startup (zero ongoing cost)
let configCache: AppConfigJson | null = null;
let configInitialized = false;

// Storage mode detection for WRITES only
function getWriteMode(): 'local' | 'blob' {
  const mode = process.env.CONFIG_STORAGE_MODE;
  if (mode === 'local') return 'local';
  
  // Auto-detect: use blob in production (Vercel/Render), local in development
  if (process.env.VERCEL || process.env.RENDER) {
    return process.env.BLOB_READ_WRITE_TOKEN ? 'blob' : 'local';
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
 * Load configuration - ZERO COST OPERATION
 * 
 * Strategy:
 * 1. First call: Initialize from ENV variable (if exists) or static JSON
 * 2. Subsequent calls: Return cached config (loaded once at startup)
 * 3. Force reload: Re-check ENV variable, fallback to static JSON
 * 
 * This means: NO blob storage reads, NO file system reads per request
 * Result: Zero runtime cost for reading config
 */
export function loadAppConfig(forceReload = false): AppConfigJson {
  // If already initialized and not forcing reload, return cache immediately
  if (configInitialized && !forceReload && configCache) {
    return configCache;
  }

  // Initialize configuration (happens once per deployment)
  try {
    // Priority 1: Environment variable (set manually after blob update)
    const envConfig = process.env.APPCONFIG_JSON;
    if (envConfig) {
      try {
        configCache = JSON.parse(envConfig) as AppConfigJson;
        configInitialized = true;
        if (!forceReload) {
          console.log('[Config] ✓ Loaded from APPCONFIG_JSON environment variable (zero cost)');
        }
        return configCache;
      } catch (parseError) {
        console.error('[Config] Failed to parse APPCONFIG_JSON env var:', parseError);
        // Fall through to static import
      }
    }

    // Priority 2: Local file (development only)
    if (isNodeEnvironment() && !process.env.VERCEL && !process.env.RENDER) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        const fs = require('fs');
        // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
        const path = require('path');
        const configPath = path.join(process.cwd(), 'lib', 'json', 'appconfig.json');
        
        if (fs.existsSync(configPath)) {
          const fileContent = fs.readFileSync(configPath, 'utf-8');
          configCache = JSON.parse(fileContent) as AppConfigJson;
          configInitialized = true;
          if (!forceReload) {
            console.log('[Config] ✓ Loaded from local file (development mode)');
          }
          return configCache;
        }
      } catch (fsError) {
        console.error('[Config] Failed to read local file:', fsError);
        // Fall through to static import
      }
    }

    // Priority 3: Static JSON import (build-time, always available, zero cost)
    configCache = configData as AppConfigJson;
    configInitialized = true;
    if (!forceReload) {
      console.log('[Config] ✓ Loaded from static JSON import (zero cost)');
    }
    return configCache;

  } catch (error) {
    console.error('[Config] Critical error loading config:', error);
    
    // Emergency fallback: always return static import
    configCache = configData as AppConfigJson;
    configInitialized = true;
    return configCache;
  }
}

/**
 * Save configuration to storage
 * 
 * Production workflow (costs 1 blob write operation):
 * 1. Save to Blob Storage (this function)
 * 2. Copy the JSON output from the response
 * 3. Manually update APPCONFIG_JSON environment variable in Vercel/Render
 * 4. Redeploy (or config reloads automatically on next cold start)
 * 
 * Development workflow:
 * - Writes directly to lib/json/appconfig.json file
 * 
 * Result: Only costs when YOU update config, not when users create orders
 */
export async function saveAppConfig(config: AppConfigJson): Promise<{ 
  success: boolean; 
  mode: string; 
  blobUrl?: string;
  configJson?: string;
  instructions?: string;
}> {
  // Only works in Node.js environment
  if (!isNodeEnvironment()) {
    throw new Error('saveAppConfig is only available in Node.js environment');
  }

  const mode = getWriteMode();
  
  // Update metadata
  config._metadata.lastModified = new Date().toISOString();
  const configJson = JSON.stringify(config, null, 2);

  try {
    if (mode === 'blob') {
      // Use Vercel Blob Storage (1 write operation cost)
      const { put } = await import('@vercel/blob');
      const blob = await put('appconfig.json', configJson, {
        access: 'public',
        addRandomSuffix: false,
        contentType: 'application/json',
        allowOverwrite: true,
      });
      
      console.log('[Config] ✓ Saved to Blob Storage:', blob.url);
      console.log('[Config] ⚠ IMPORTANT: To apply changes, update APPCONFIG_JSON environment variable');
      
      // Update local cache immediately for current instance
      configCache = config;
      configInitialized = true;
      
      return {
        success: true,
        mode: 'blob',
        blobUrl: blob.url,
        configJson,
        instructions: [
          '✓ Config saved to Blob Storage',
          '',
          '📋 Next Steps (to apply changes):',
          '1. Copy the "configJson" field from this response',
          '2. In Vercel/Render dashboard:',
          '   - Go to Environment Variables',
          '   - Update APPCONFIG_JSON with the copied JSON',
          '   - Save changes',
          '3. Redeploy or wait for next cold start',
          '',
          '💡 This workflow ensures ZERO blob read costs during order creation',
          `📊 Blob URL (for reference): ${blob.url}`
        ].join('\n')
      };
      
    } else {
      // Local file mode (development)
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const path = require('path');
      const configPath = path.join(process.cwd(), 'lib', 'json', 'appconfig.json');
      
      // Write to file with pretty formatting
      fs.writeFileSync(configPath, configJson, 'utf-8');
      
      console.log('[Config] ✓ Saved to local file:', configPath);
      
      // Update cache
      configCache = config;
      configInitialized = true;
      
      return {
        success: true,
        mode: 'local',
        configJson,
        instructions: '✓ Config saved to local file. Changes applied immediately in development mode.'
      };
    }
  } catch (error) {
    console.error('[Config] Failed to save:', error);
    throw new Error(`Cannot save config: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Load configuration asynchronously - DEPRECATED
 * 
 * This function is kept for backward compatibility but now just calls loadAppConfig().
 * We no longer read from Blob Storage to avoid runtime costs.
 * 
 * @deprecated Use loadAppConfig() instead. This function no longer reads from blob storage.
 */
export async function loadAppConfigAsync(forceReload = false): Promise<AppConfigJson> {
  console.warn('[Config] loadAppConfigAsync is deprecated - using loadAppConfig (zero cost mode)');
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
  configInitialized = false;
  console.log('[Config] Cache cleared - will reload on next access');
}

/**
 * Manually load configuration from Blob Storage (costs 1-2 read operations)
 * Use this ONLY when you want to fetch the latest config from blob storage.
 * Normal operations should use loadAppConfig() which costs nothing.
 * 
 * Use case: Admin panel "Reload from Blob" button
 */
export async function loadFromBlobStorage(): Promise<{
  success: boolean;
  config?: AppConfigJson;
  blobUrl?: string;
  error?: string;
}> {
  if (!isNodeEnvironment()) {
    return { success: false, error: 'Only available in Node.js environment' };
  }

  try {
    const { list } = await import('@vercel/blob');
    const { blobs } = await list({ prefix: 'appconfig.json', limit: 1 });
    
    if (blobs.length === 0) {
      return { 
        success: false, 
        error: 'No config found in blob storage. Save config first.' 
      };
    }

    const response = await fetch(blobs[0].url);
    if (!response.ok) {
      return { 
        success: false, 
        error: `Failed to fetch blob: ${response.status} ${response.statusText}` 
      };
    }
    
    const config = await response.json() as AppConfigJson;
    
    console.log('[Config] ✓ Loaded from Blob Storage (manual fetch):', blobs[0].url);
    
    return {
      success: true,
      config,
      blobUrl: blobs[0].url
    };
  } catch (error) {
    console.error('[Config] Error loading from blob storage:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}
