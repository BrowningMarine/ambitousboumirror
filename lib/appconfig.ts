/**
 * LEGACY CONFIGURATION - Now depends on lib/json/appconfig.json
 * This file maintained for backward compatibility
 * All configuration now centralized in appconfig.json
 */

import { loadAppConfig } from './json/config-loader';

// Load configuration from JSON file
const jsonConfig = loadAppConfig();
const settings = jsonConfig.baseSettings;
const security = jsonConfig.security;
const qrService = jsonConfig.qrService;
const fallbackBank = jsonConfig.fallbackBank;
const databaseSettings = jsonConfig.databaseSettings || {};

export const appConfig = {
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
    
    // Domain management - kept for backward compatibility
    allowedDomains: [] as string[],
    domainMapping: {} as Record<string, string>,
} as const;

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

/**
 * Get the configured database priority order for auto mode
 * @returns Array of database priorities (default: ['appwrite', 'supabase', 'fallback'])
 */
export function getDatabasePriority(): ('appwrite' | 'supabase' | 'fallback')[] {
    const jsonConfig = loadAppConfig();
    const dbSettings = jsonConfig.databaseSettings || {};
    return dbSettings.databasePriority || ['appwrite', 'supabase', 'fallback'];
}

/**
 * Get the configured core running mode
 * @returns 'auto' | 'appwrite' | 'supabase' | 'fallback'
 */
export function getCoreRunningMode(): 'auto' | 'appwrite' | 'supabase' | 'fallback' {
    const jsonConfig = loadAppConfig();
    const dbSettings = jsonConfig.databaseSettings || {};
    return dbSettings.coreRunningMode || 'auto';
}

/**
 * Get webhook callback batching configuration
 * @returns true to batch callbacks with same URL into arrays, false for parallel individual requests
 */
export function isWebhookCallbackBatchingEnabled(): boolean {
    const jsonConfig = loadAppConfig();
    const webhookSettings = jsonConfig.webhookSettings || {};
    return webhookSettings.enableCallbackBatching ?? true; // Default to true (batching enabled)
}