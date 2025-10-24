# Dynamic Domain Configuration

This guide explains how to configure and use the dynamic domain system that allows your application to work with multiple hostnames and separate API domains from payment UI domains.

## Overview

The dynamic domain system automatically detects the current domain from incoming requests and generates appropriate URLs. The system now supports **domain mapping** to separate API domains from UI domains - allowing you to use `api.mydomain.com` for API calls while generating payment URLs that point to `app.mydomain.com` or `admin.mydomain.com`.

## Configuration

### 1. Update Allowed Domains

Edit `lib/appconfig.ts` and update the `allowedDomains` array with your actual domains:

```typescript
allowedDomains: [
    'localhost:3000',              // Development
    'yourdomain.com',              // Production
    'api.yourdomain.com',          // API subdomain
    'app.yourdomain.com',          // App subdomain
    'admin.yourdomain.com',        // Admin subdomain
    '*.yourdomain.com',            // Wildcard for all subdomains
    'anotherdomain.com',           // Additional domain
] as string[],
```

### 2. Configure Domain Mapping for Payment URLs

Add the `domainMapping` configuration to map API domains to their corresponding UI domains:

```typescript
// Domain mapping: API domain -> UI domain for payment links
domainMapping: {
    'api.yourdomain.com': 'app.yourdomain.com',        // API calls -> App UI
    'api.anotherdomain.com': 'admin.anotherdomain.com', // API calls -> Admin UI
    'localhost:3000': 'localhost:3000',                 // Development
} as Record<string, string>,
```

**How it works:**
- When someone calls the API from `api.yourdomain.com`, payment URLs will be generated as `app.yourdomain.com/payment/orderId`
- If no mapping is found, it falls back to using the same domain
- If the domain is not in `allowedDomains`, it falls back to the static `baseurl`

### 3. Environment Variables

You can still use `NEXT_PUBLIC_SITE_URL` as a fallback:

```bash
NEXT_PUBLIC_SITE_URL=https://yourdomain.com
```

## Usage

### Server-Side (API Routes, Server Components)

#### For General URLs (same domain)
```typescript
import { getDynamicBaseUrl } from '@/lib/appconfig';

// In API routes
export async function POST(request: NextRequest) {
    const baseUrl = getDynamicBaseUrl(request);
    const apiUrl = `${baseUrl}/api/some-endpoint`;
    // ...
}
```

#### For Payment URLs (mapped domains)
```typescript
import { getPaymentBaseUrl } from '@/lib/appconfig';

// In API routes that generate payment URLs
export async function POST(request: NextRequest) {
    const paymentBaseUrl = getPaymentBaseUrl(request);
    const paymentUrl = `${paymentBaseUrl}/payment/order123`;
    // This will use the mapped domain for UI, not the API domain
    // ...
}
```

#### In server components with headers
```typescript
import { headers } from 'next/headers';
import { getPaymentBaseUrl } from '@/lib/appconfig';

export default function ServerComponent() {
    const headersList = headers();
    const paymentBaseUrl = getPaymentBaseUrl({ headers: headersList });
    // ...
}
```

### Client-Side (React Components)

```typescript
import { useDynamicUrl, useDynamicPath } from '@/hooks/use-dynamic-url';

function MyComponent() {
    const baseUrl = useDynamicUrl();
    const paymentPath = useDynamicPath('/payment/order123');
    
    return (
        <div>
            <p>Base URL: {baseUrl}</p>
            <p>Payment URL: {paymentPath}</p>
        </div>
    );
}
```

## Real-World Example

### Your Current Setup
```typescript
// In lib/appconfig.ts
allowedDomains: [
    'localhost:3000',
    'admin.thedreamforlife.online',    // Admin UI
    'api.thedreamforlife.online',      // API only
    'app.asosvn.online'                // App UI
],
domainMapping: {
    'api.thedreamforlife.online': 'admin.thedreamforlife.online',
    'localhost:3000': 'localhost:3000',
},
```

### API Call Behavior
- **API Request:** `POST https://api.thedreamforlife.online/api/orders/merchant123`
- **Generated Payment URL:** `https://admin.thedreamforlife.online/payment/ABO20240315ABC1234`
- **Result:** Users click the payment link and go to the UI domain, not the API domain

### Without Domain Mapping (Old Behavior)
- **API Request:** `POST https://api.thedreamforlife.online/api/orders/merchant123`
- **Generated Payment URL:** `https://api.thedreamforlife.online/payment/ABO20240315ABC1234` ❌
- **Result:** Users get 404 because the API domain doesn't serve the payment UI

## Functions Available

### `getDynamicBaseUrl(request?)`
Returns the base URL of the current domain. Use for general API calls or when you want to stay on the same domain.

### `getPaymentBaseUrl(request?)` ⭐ **New**
Returns the mapped UI domain for payment URLs. Use when generating payment links that should redirect users to the UI domain instead of the API domain.

### `getClientBaseUrl()`
Client-side version of `getDynamicBaseUrl()` for React components.

### `isDomainAllowed(domain)`
Checks if a domain is in the allowed domains list.

## Best Practices

1. **Use `getPaymentBaseUrl`** for all payment-related URLs in API routes
2. **Use `getDynamicBaseUrl`** for same-domain API calls and general URLs
3. **Configure domain mapping** for each API domain that should redirect to a UI domain
4. **Test both mapped and unmapped domains** to ensure fallback behavior works
5. **Use environment variables** for fallback configuration

## Troubleshooting

### Payment URLs still using API domain
- Check that `domainMapping` includes your API domain
- Verify you're using `getPaymentBaseUrl` instead of `getDynamicBaseUrl`
- Check that the domain is in `allowedDomains`

### Fallback to static URL
- Verify the domain is in `allowedDomains`
- Check that headers contain the correct host information
- Ensure `NEXT_PUBLIC_SITE_URL` is set as fallback 