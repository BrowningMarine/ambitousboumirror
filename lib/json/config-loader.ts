/**
 * Centralized Configuration Loader
 * Loads configuration from lib/json/appconfig.json
 * Legacy appconfig.ts now depends on this file
 * 
 * IMPORTANT: This file works in both Node.js and Edge Runtime
 * - Edge Runtime (middleware): Uses static JSON import
 * - Node.js (API routes): Can dynamically reload from disk
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
let lastLoadTime = Date.now(); // Initialize as if just loaded
const CACHE_TTL = 5000; // 5 seconds cache to reduce file reads

/**
 * Check if we're in Node.js environment (not Edge Runtime)
 */
function isNodeEnvironment(): boolean {
  return typeof process !== 'undefined' && 
         typeof process.versions !== 'undefined' && 
         typeof process.versions.node !== 'undefined';
}

/**
 * Load configuration from JSON file
 * Cached for 5 seconds to reduce file I/O
 * Works in both Edge Runtime (static) and Node.js (dynamic reload)
 */
export function loadAppConfig(forceReload = false): AppConfigJson {
  const now = Date.now();
  
  // Return cached config if still valid
  if (!forceReload && configCache && (now - lastLoadTime) < CACHE_TTL) {
    return configCache;
  }

  // Try to dynamically reload (only works in Node.js, not Edge Runtime)
  if (isNodeEnvironment() && typeof window === 'undefined') {
    try {
      // Dynamic import to avoid webpack bundling for client
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const path = require('path');
      const configPath = path.join(process.cwd(), 'lib', 'json', 'appconfig.json');
      const fileContent = fs.readFileSync(configPath, 'utf-8');
      const config = JSON.parse(fileContent) as AppConfigJson;
      
      // Update cache
      configCache = config;
      lastLoadTime = now;
      
      return config;
    } catch (error) {
      console.error('Failed to dynamically load appconfig.json:', error);
      
      // Fall back to cached config if available
      if (configCache) {
        console.warn('Using cached config due to load error');
        return configCache;
      }
    }
  }

  // Edge Runtime or cache available: return cached/static config
  if (configCache) {
    return configCache;
  }

  // Should never reach here since configCache is initialized with static data
  throw new Error('Cannot load appconfig.json and no cache available');
}

/**
 * Save configuration to JSON file
 * Updates cache and writes to disk (Node.js only)
 */
export function saveAppConfig(config: AppConfigJson): void {
  // Only works in Node.js environment
  if (!isNodeEnvironment()) {
    throw new Error('saveAppConfig is only available in Node.js environment');
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
    const path = require('path');
    const configPath = path.join(process.cwd(), 'lib', 'json', 'appconfig.json');
    
    // Update metadata
    config._metadata.lastModified = new Date().toISOString();
    
    // Write to file with pretty formatting
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    
    // Update cache
    configCache = config;
    lastLoadTime = Date.now();
    
    console.log('Configuration saved successfully');
  } catch (error) {
    console.error('Failed to save appconfig.json:', error);
    throw new Error('Cannot save appconfig.json');
  }
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
