/**
 * LEGACY CONFIGURATION - Now depends on lib/json/appconfig.json
 * This file maintained for backward compatibility
 * All configuration now centralized in appconfig.json
 * 
 * Uses lazy loading with caching to avoid multiple Redis calls across different Next.js contexts
 * (middleware, server components, API routes each load modules separately)
 */

import { loadAppConfig } from './json/config-loader';

// Lazy-loaded cached config (loads once per context, then reuses)
let cachedAppConfig: ReturnType<typeof buildAppConfig> | null = null;

function buildAppConfig() {
    const jsonConfig = loadAppConfig();
    const settings = jsonConfig.baseSettings;
    const security = jsonConfig.security;
    const qrService = jsonConfig.qrService;
    const fallbackBank = jsonConfig.fallbackBank;
    const databaseSettings = jsonConfig.databaseSettings || {};

    return {
        // Base settings from JSON
        title: settings.title,
        description: settings.description,
        icon: settings.icon,
        baseurl: process.env.NEXT_PUBLIC_SITE_URL || settings.siteUrl,
        paymentBaseUrl: settings.paymentBaseUrl,
        cookie_name: settings.cookieName,
        locales: settings.locales as string[],
        defaultLocale: settings.defaultLocale,
        odrPrefix: settings.odrPrefix, // DEPRECATED: Use getDynamicOrderPrefix() instead
        paymentWindowSeconds: settings.paymentWindowSeconds,
        withdrawExportPw: settings.withdrawExportPassword,
        trustedDomains: settings.trustedDomains as string[],
        allowAllFrameEmbedding: settings.allowAllFrameEmbedding,
        allowedDomains: (settings.allowedDomains || []) as string[],
        
        // Database settings
        coreRunningMode: (databaseSettings.coreRunningMode || 'auto') as 'auto' | 'appwrite' | 'supabase' | 'fallback',
        appwriteOrderPrefix: databaseSettings.appwriteOrderPrefix || settings.odrPrefix || 'ABO',
        supabaseOrderPrefix: databaseSettings.supabaseOrderPrefix || settings.odrPrefix || 'SBO',
        fallbackOrderPrefix: databaseSettings.fallbackOrderPrefix || settings.odrPrefix || 'FBO',
        databasePriority: databaseSettings.databasePriority || ['appwrite', 'supabase', 'fallback'],
        
        // QR Service settings
        qrClientUrl: process.env.NEXT_PUBLIC_QR_CLIENT_URL || qrService.clientUrl,
        qrClientId: process.env.NEXT_PUBLIC_QR_CLIENT_ID || qrService.clientId,
        qrClientSecret: process.env.NEXT_PUBLIC_QR_CLIENT_SECRET || qrService.clientSecret,
        qrTemplateCode: settings.qrTemplateCode,
        create_qr_by: settings.createQrBy,
        
        // Registration
        allowRegister: (settings.allowRegister ? 'true' : 'false') as 'false' | 'true',
        
        // Security settings
        paymentEncryptionKey: process.env.PAYMENT_ENCRYPTION_KEY || security.paymentEncryptionKey,
        configSecretPath: process.env.CONFIG_SECRET_PATH || security.configSecretPath,
        
        // Fallback bank data
        fallbackBankData: fallbackBank,
        
        // Domain mapping - kept for backward compatibility
        domainMapping: {} as Record<string, string>,
    } as const;
}

// Proxy to lazy-load config on first property access
export const appConfig = new Proxy({} as ReturnType<typeof buildAppConfig>, {
    get(target, prop) {
        if (!cachedAppConfig) {
            cachedAppConfig = buildAppConfig();
        }
        return cachedAppConfig[prop as keyof typeof cachedAppConfig];
    }
});

/**
 * Get the payment base URL (always from JSON config)
 * Payment URLs use format: {paymentBaseUrl}/payment-direct/{encodedData}
 */
export function getPaymentBaseUrl(): string {
    const jsonConfig = loadAppConfig();
    return jsonConfig.baseSettings.paymentBaseUrl;
}

/**
 * Get the dynamic order prefix based on which database is being used
 * @param activeDatabase - The currently active database ('appwrite' or 'supabase' or 'none')
 * @returns The appropriate order prefix for the active database
 */
export function getDynamicOrderPrefix(activeDatabase: 'appwrite' | 'supabase' | 'none'): string {
    const jsonConfig = loadAppConfig();
    const dbSettings = jsonConfig.databaseSettings || {};
    const baseSettings = jsonConfig.baseSettings;
    
    // If database settings don't exist, use legacy odrPrefix
    if (!dbSettings.appwriteOrderPrefix && !dbSettings.supabaseOrderPrefix) {
        return baseSettings.odrPrefix || 'ODR';
    }
    
    // Return prefix based on active database
    if (activeDatabase === 'appwrite') {
        return dbSettings.appwriteOrderPrefix || baseSettings.odrPrefix || 'ABO';
    } else if (activeDatabase === 'supabase') {
        return dbSettings.supabaseOrderPrefix || baseSettings.odrPrefix || 'SBO';
    } else {
        // Fallback mode (no database) - use dedicated fallback prefix
        return dbSettings.fallbackOrderPrefix || baseSettings.odrPrefix || 'FBO';
    }
}

// Module-level cache for core running mode (loaded once per server instance)
// Cache with timestamp to allow periodic refresh
let cachedCoreRunningMode: { value: 'auto' | 'appwrite' | 'supabase' | 'fallback'; timestamp: number } | null = null;
let cachedWebhookBatching: { value: boolean; timestamp: number } | null = null;
let cachedDatabasePriority: { value: ('appwrite' | 'supabase' | 'fallback')[]; timestamp: number } | null = null;

// Long cache TTL - 24 hours (config rarely changes)
// When admin saves config, cache is cleared via API endpoint
const MODULE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Clear all module-level config caches
 * Called when config is saved via admin page to force immediate reload
 */
export function clearModuleCache(): void {
    cachedCoreRunningMode = null;
    cachedWebhookBatching = null;
    cachedDatabasePriority = null;
    cachedAppConfig = null;
    console.log('[AppConfig] Module cache cleared - next request will reload from Redis');
}

/**
 * Get the configured database priority order for auto mode (cached for 60 seconds)
 * @returns Array of database priorities (default: ['appwrite', 'supabase', 'fallback'])
 */
export function getDatabasePriority(): ('appwrite' | 'supabase' | 'fallback')[] {
    const now = Date.now();
    
    // Return cached value if still valid (within 60 seconds)
    if (cachedDatabasePriority && (now - cachedDatabasePriority.timestamp) < MODULE_CACHE_TTL) {
        return cachedDatabasePriority.value;
    }
    
    // Cache expired or doesn't exist - reload
    if (!cachedAppConfig) {
        cachedAppConfig = buildAppConfig();
    }
    const jsonConfig = loadAppConfig();
    const dbSettings = jsonConfig.databaseSettings || {};
    const value = dbSettings.databasePriority || ['appwrite', 'supabase', 'fallback'];
    
    cachedDatabasePriority = { value, timestamp: now };
    return value;
}

/**
 * Get the configured core running mode (cached for 60 seconds)
 * @returns 'auto' | 'appwrite' | 'supabase' | 'fallback'
 */
export function getCoreRunningMode(): 'auto' | 'appwrite' | 'supabase' | 'fallback' {
    const now = Date.now();
    
    // Return cached value if still valid (within 60 seconds)
    if (cachedCoreRunningMode && (now - cachedCoreRunningMode.timestamp) < MODULE_CACHE_TTL) {
        return cachedCoreRunningMode.value;
    }
    
    // Cache expired or doesn't exist - reload
    const jsonConfig = loadAppConfig();
    const dbSettings = jsonConfig.databaseSettings || {};
    const value = dbSettings.coreRunningMode || 'auto';
    
    cachedCoreRunningMode = { value, timestamp: now };
    return value;
}

/**
 * Get webhook callback batching configuration (cached for 60 seconds)
 * @returns true to batch callbacks with same URL into arrays, false for parallel individual requests
 */
export function isWebhookCallbackBatchingEnabled(): boolean {
    const now = Date.now();
    
    // Return cached value if still valid (within 60 seconds)
    if (cachedWebhookBatching && (now - cachedWebhookBatching.timestamp) < MODULE_CACHE_TTL) {
        return cachedWebhookBatching.value;
    }
    
    // Cache expired or doesn't exist - reload
    const jsonConfig = loadAppConfig();
    const webhookSettings = jsonConfig.webhookSettings || {};
    const value = webhookSettings.enableCallbackBatching ?? true;
    
    cachedWebhookBatching = { value, timestamp: now };
    return value;
}

/**
 * Get allowRegister setting dynamically (async version for server-side)
 * Use this in middleware and server components to get real-time value from Redis
 * @returns Promise<'true' | 'false'>
 */
export async function getAllowRegister(): Promise<'true' | 'false'> {
    const { loadAppConfigAsync } = await import('./json/config-loader');
    const jsonConfig = await loadAppConfigAsync();
    return jsonConfig.baseSettings.allowRegister ? 'true' : 'false';
}