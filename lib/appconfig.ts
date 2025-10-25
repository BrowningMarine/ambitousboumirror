export const appConfig = {
    title: 'Ambitousboy',
    description: 'API transactions management system',
    icon: "/icons/logonew.svg",
    baseurl: process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000',
    cookie_name: 'ambitousboy-session',
    locales: ['en', 'zh', 'vn'] as string[],
    defaultLocale: 'en',
    odrPrefix: 'EMO',
    paymentWindowSeconds: 15 * 60, // 30 minutes in seconds
    withdrawExportPw: 'FOux9fCv91mQaBx',
    qrClientUrl: process.env.NEXT_PUBLIC_QR_CLIENT_URL,
    qrClientId: process.env.NEXT_PUBLIC_QR_CLIENT_ID,
    qrClientSecret: process.env.NEXT_PUBLIC_QR_CLIENT_SECRET,
    qrTemplateCode: 'VE7bsvs', //'qr_only',
    create_qr_by: (process.env.NEXT_PUBLIC_CREATE_QR_BY as 'vietqr' | 'local') || 'vietqr', // 'vietqr' or 'local'
    allowRegister: 'false' as 'false' | 'true',
    // Database-resilient payment pages: When true, payment data is encoded in URL and payment pages work without DB queries
    // This allows users to make payments even when database is unavailable
    // Webhooks will create orders on payment completion if they don't exist yet
    useClientOnlyPayment: (process.env.USE_CLIENT_ONLY_PAYMENT || 'false') === 'true',
    // Secret key for encrypting payment data in URLs (must be 32 characters for AES-256)
    paymentEncryptionKey: process.env.PAYMENT_ENCRYPTION_KEY || 'default-key-change-in-production!',
    // Fallback bank data for client-only mode when database is unavailable
    fallbackBankData: {
        bankId: process.env.FALLBACK_BANK_ID || 'default-bank',
        bankName: process.env.FALLBACK_BANK_NAME || 'Default Bank',
        bankBinCode: process.env.FALLBACK_BANK_BIN || '970422', // Vietcombank default
        accountNumber: process.env.FALLBACK_BANK_ACCOUNT || '0000000000',
        ownerName: process.env.FALLBACK_BANK_OWNER || 'Default Account',
        isActivated: true,
        minAmount: 50000,
        maxAmount: 500000000,
        availableBalance: 49454429238
    },
    // Allowed domains for dynamic baseurl (add your domains here)
    // allowedDomains: [
    //     'localhost:3000',
    //     'your-domain.com',
    //     'another-domain.com',
    //     'subdomain.example.com'
    // ] as string[],
    allowedDomains: [
        'localhost:3000',
        'admin.thedreamforlife.online',
        'api.thedreamforlife.online',
        'apiv2.thedreamforlife.online',
        'apiv3.steamempower.site',
        'app.asosvn.online',
        'api.asosvn.online',
    ] as string[],
    // Domain mapping: API domain -> UI domain for payment links
    // IMPORTANT: This controls where payment URLs point to when creating orders
    // Key = incoming request domain, Value = payment page domain
    domainMapping: {
        // Example: api.mydomain.com receives order creation request
        // Payment URL returned will be: https://admin.mydomain.com/payment/{orderId}
        // 'api.mydomain.com': 'admin.mydomain.com',
        
        // If your domains serve both API and UI on the same domain, map to itself:
        // 'apiv2.mydomain.com': 'apiv2.mydomain.com',
        
        'api.thedreamforlife.online': 'admin.thedreamforlife.online',
        'apiv2.thedreamforlife.online': 'apiv2.thedreamforlife.online',
        'apiv3.steamempower.site': 'apiv3.steamempower.site',
        'api.asosvn.online': 'app.asosvn.online',
        'localhost:3000': 'localhost:3000', // For development
        
        // Add your new domains here - example format:
        // 'api.mydomain.com': 'admin.mydomain.com',     // API -> Admin UI
        // 'admin.mydomain.com': 'admin.mydomain.com',   // Self-mapping
        // 'apiv2.mydomain.com': 'apiv2.mydomain.com',   // Self-mapping (client-only mode)
    } as Record<string, string>,
    //others
} as const;

/**
 * Get the dynamic base URL based on the current request
 * @param request - The NextRequest object or headers
 * @returns The appropriate base URL for the current domain
 */
export function getDynamicBaseUrl(request?: Request | { headers: Headers }): string {
    // Fallback to static config if no request provided
    if (!request) {
        return appConfig.baseurl;
    }

    try {
        // Extract host from request headers
        const host = request.headers.get('host');
        const protocol = request.headers.get('x-forwarded-proto') || 
                        request.headers.get('x-forwarded-protocol') || 
                        'https';

        if (host) {
            // Check if the host is in our allowed domains list
            const isAllowedDomain = appConfig.allowedDomains.some(domain => {
                // Handle exact matches and wildcard subdomains
                if (domain === host) return true;
                // Support wildcard patterns like *.example.com
                if (domain.startsWith('*.')) {
                    const baseDomain = domain.slice(2);
                    return host.endsWith(`.${baseDomain}`) || host === baseDomain;
                }
                return false;
            });

            if (isAllowedDomain) {
                // Use https by default for production, but respect forwarded protocol
                const finalProtocol = host.includes('localhost') ? 'http' : protocol;
                return `${finalProtocol}://${host}`;
            }
        }
    } catch (error) {
        console.error('Error extracting dynamic base URL:', error);
    }

    // Fallback to static configuration
    return appConfig.baseurl;
}

/**
 * Get the payment UI domain based on the API request domain
 * @param request - The NextRequest object or headers
 * @returns The appropriate UI base URL for payment links
 */
export function getPaymentBaseUrl(request?: Request | { headers: Headers }): string {
    // Fallback to static config if no request provided
    if (!request) {
        return appConfig.baseurl;
    }

    try {
        // Extract host from request headers
        const host = request.headers.get('host');
        const protocol = request.headers.get('x-forwarded-proto') || 
                        request.headers.get('x-forwarded-protocol') || 
                        'https';

        if (host) {
            // Check if there's a mapping for this domain
            const mappedDomain = appConfig.domainMapping[host];
            
            if (mappedDomain) {
                // Use mapped domain for payment UI
                const finalProtocol = mappedDomain.includes('localhost') ? 'http' : protocol;
                return `${finalProtocol}://${mappedDomain}`;
            }

            // If no mapping found, check if it's an allowed domain and use it directly
            const isAllowedDomain = appConfig.allowedDomains.some(domain => {
                // Handle exact matches and wildcard subdomains
                if (domain === host) return true;
                // Support wildcard patterns like *.example.com
                if (domain.startsWith('*.')) {
                    const baseDomain = domain.slice(2);
                    return host.endsWith(`.${baseDomain}`) || host === baseDomain;
                }
                return false;
            });

            if (isAllowedDomain) {
                // Use https by default for production, but respect forwarded protocol
                const finalProtocol = host.includes('localhost') ? 'http' : protocol;
                return `${finalProtocol}://${host}`;
            }
        }
    } catch (error) {
        console.error('Error extracting payment base URL:', error);
    }

    // Fallback to static configuration
    return appConfig.baseurl;
}

/**
 * Get the dynamic base URL for client-side usage
 * @returns The appropriate base URL for the current domain
 */
export function getClientBaseUrl(): string {
    // Client-side: use window.location
    if (typeof window !== 'undefined') {
        const host = window.location.host;
        const protocol = window.location.protocol;
        
        // Check if the host is in our allowed domains list
        const isAllowedDomain = appConfig.allowedDomains.some(domain => {
            // Handle exact matches and wildcard subdomains
            if (domain === host) return true;
            // Support wildcard patterns like *.example.com
            if (domain.startsWith('*.')) {
                const baseDomain = domain.slice(2);
                return host.endsWith(`.${baseDomain}`) || host === baseDomain;
            }
            return false;
        });

        if (isAllowedDomain) {
            return `${protocol}//${host}`;
        }
    }

    // Fallback to static configuration
    return appConfig.baseurl;
}

/**
 * Check if a domain is allowed in the configuration
 * @param domain - Domain to check (with or without port)
 * @returns Whether the domain is allowed
 */
export function isDomainAllowed(domain: string): boolean {
    return appConfig.allowedDomains.some(allowedDomain => {
        // Handle exact matches
        if (allowedDomain === domain) return true;
        // Support wildcard patterns like *.example.com
        if (allowedDomain.startsWith('*.')) {
            const baseDomain = allowedDomain.slice(2);
            return domain.endsWith(`.${baseDomain}`) || domain === baseDomain;
        }
        return false;
    });
}