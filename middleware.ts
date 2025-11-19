// Configure middleware to work with Next.js stable
// The middleware will run in the default environment provided by Next.js
export const config = {
  // Skip middleware for static assets and API routes that don't need it
  matcher: [
    // Match all pathnames except for static files
    '/((?!_next/static|_next/image|favicon.ico|public|assets|.png|.jpg|.jpeg|.gif|.svg|.ico).*)',
    // Explicitly match admin routes
    '/settings',
    // Explicitly match blocked paths
    '/add-banks',
    '/marketprice',
    '/add-bank'
  ],
};

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { RateLimiter } from './lib/rate-limit'
// Import the server actions instead of direct imports to node-appwrite dependent functions
import { checkUserRole, getUserInfoFromCookie, refreshSession } from './lib/middleware-auth'
import { appConfig } from './lib/appconfig'
import { allowFrameEmbedding } from './lib/middleware-helpers'
import { getCookieDomain } from './lib/utils'
import createIntlMiddleware from 'next-intl/middleware'
import { loadAppConfigAsync } from './lib/json/config-loader'

const limiter = new RateLimiter()
const COOKIE_NAME = appConfig.cookie_name

// Supported locales - ensure these match with available message files in /messages directory
//export const locales = ['en', 'zh', 'vn']
// export const defaultLocale = 'en'

export const locales = appConfig.locales
export const defaultLocale = appConfig.defaultLocale

// Cache for paths with 24-hour TTL (config rarely changes)
// When admin saves config, this cache is cleared automatically
let pathsCache: {
  blockedPaths: string[];
  publicPaths: string[];
  timestamp: number;
} | null = null;

const PATHS_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Clear middleware paths cache
 * Called when config is saved to force immediate reload of allowRegister setting
 */
export function clearMiddlewarePathsCache(): void {
  pathsCache = null;
  console.log('[Middleware] Paths cache cleared - next request will reload from config');
}

// Helper to get blocked and public paths with caching (loads from Redis once per day)
async function getCachedPaths(): Promise<{ blockedPaths: string[]; publicPaths: string[] }> {
  const now = Date.now();
  
  // Return cached paths if still valid
  if (pathsCache && (now - pathsCache.timestamp) < PATHS_CACHE_TTL) {
    // Cache hit - no Redis call needed (99.9% of requests)
    return {
      blockedPaths: pathsCache.blockedPaths,
      publicPaths: pathsCache.publicPaths
    };
  }
  
  // Cache expired or doesn't exist - load from Redis
  console.log('[Middleware] Cache expired, loading paths from Redis...');
  const config = await loadAppConfigAsync();
  const allowRegister = config.baseSettings.allowRegister;
  
  const blockedPaths = [
    '/transaction-history',
    ...(allowRegister === false ? [
      '/sign-up',
      ...locales.map(locale => `/${locale}/sign-up`)
    ] : []),
  ];
  
  const publicPaths = [
    '/sign-in',
    ...(allowRegister === true ? ['/sign-up'] : []),
    '/api',
    '/icons',
    '/payment',
    '/payment-direct/',
    '/webhook',
    '/public',
    '/transbot',
    '/darkveil'
  ];
  
  // Update cache
  pathsCache = {
    blockedPaths,
    publicPaths,
    timestamp: now
  };
  
  return { blockedPaths, publicPaths };
}

// Static paths that don't need authentication checks  
const staticPaths = [
  '_next/static',
  '_next/image',
  'favicon.ico',
  'public',
  'assets',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico'
] as const

// Add paths that don't require authentication
// NOTE: This is static for initial load, but getPublicPaths() loads from Redis
export const publicPaths = [
  '/sign-in',
  '/api',
  '/icons',
  '/payment',
  '/payment-direct/',
  '/webhook',
  '/public',
  '/transbot',
  '/darkveil'
] as const

export const internalApiPaths = [
  '/api/transaction-stats',
  '/api/validate-payment',
  '/api/users/withdraw-status',
  '/api/resend-webhook',
  '/api/resend-webhook-bulk',
  'api/webhook/resend-all-notifications',
  'api/webhook/resend-progress',
  'api/webhook/update-all-notifications',
  'api/webhook/update-notification-status'
] as const

// Add admin paths that should be accessible  
const adminPaths = [
  '/settings'
] as const

// const authPaths = [
//   '/users-list',
//   '/my-banks',
//   '/my-banks',
//   '/transactions',
//   '/accounts',
//   '/unauthorized',
//   '/', 
// ] as const; 

// Paths that should have internationalization applied
const nextI18nPaths = [
  '/sign-in',
  '/sign-up',
  '/verify',
  '/users-list',
  '/my-banks',
  '/transactions',
  '/accounts',
  '/unauthorized',
  '/withdraw-list',
  '/settings',
  '/transbot'
] as const;

// Add type safety to path checks  
function isPathMatch(pathname: string, paths: readonly string[]): boolean {
  return paths.some(path => path === pathname || pathname.startsWith(path))
}

function getRateLimitHeaders(limit: number, remaining: number, reset: number) {
  return {
    'Retry-After': `${Math.ceil((reset - Date.now()) / 1000)}`,
    'X-RateLimit-Limit': `${limit}`,
    'X-RateLimit-Remaining': `${remaining}`,
    'X-RateLimit-Reset': `${Math.ceil(reset / 1000)}`
  }
}

function getRateLimitResponse(limit: number, remaining: number, reset: number) {
  return new NextResponse('Too Many Requests', {
    status: 429,
    headers: getRateLimitHeaders(limit, remaining, reset)
  })
}

function addRateLimitHeaders(response: NextResponse, limit: number, remaining: number, reset: number) {
  const headers = getRateLimitHeaders(limit, remaining, reset)
  Object.entries(headers).forEach(([key, value]) => {
    response.headers.set(key, value)
  })
  return response
}

// Helper function to extract locale from path
function extractLocaleFromPath(path: string): string | null {
  for (const locale of locales) {
    if (path.startsWith(`/${locale}/`) || path === `/${locale}`) {
      return locale
    }
  }
  return null
}

function hasLocalePrefix(pathname: string): boolean {
  return locales.some(locale =>
    pathname === `/${locale}` || pathname.startsWith(`/${locale}/`)
  );
}

// Create the internationalization middleware function
const intlMiddleware = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always'
})

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Check if this is a request for a static file
  const isStaticFile = /\.(jpg|jpeg|png|gif|svg|ico|css|js)$/.test(pathname) ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    isPathMatch(pathname, staticPaths)

  // For static files, skip all middleware logic
  if (isStaticFile) {
    return NextResponse.next()
  }

  // Root path handling - redirect to default locale but keep auth requirement
  if (pathname === '/') {
    // Check if user is authenticated before redirecting
    const sessionCookie = request.cookies.get(COOKIE_NAME)?.value
    const sessionInfo = sessionCookie ? await getUserInfoFromCookie(sessionCookie) : null
    if (sessionCookie && sessionInfo) {
      const redirectUrl = new URL(`/${defaultLocale}`, request.url);
      return NextResponse.redirect(redirectUrl);
    } else {
      // If not authenticated, redirect directly to sign-in with locale
      const redirectUrl = new URL(`/${defaultLocale}/sign-in`, request.url);
      return NextResponse.redirect(redirectUrl);
    }
  }

  // Get IP address for rate limiting - Prioritize Cloudflare headers
  const ip = request.headers.get('cf-connecting-ip') ?? // Cloudflare's reliable IP header
    request.headers.get('x-real-ip') ?? // Next best option
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? // Less reliable, can be spoofed
    'unknown'

  const userAgent = request.headers.get('user-agent') ?? 'unknown'
  if (ip === 'unknown') {
    return NextResponse.json({ error: 'Forbidden: Violation of rule requests policy' }, { status: 403 });
  }

  let userId: string | undefined
  const sessionCookie = request.cookies.get(COOKIE_NAME)?.value
  let sessionInfo = null
  if (sessionCookie) {
    try {
      sessionInfo = await getUserInfoFromCookie(sessionCookie)
      if (sessionInfo) {
        userId = sessionInfo.userId
      }
    } catch (error) {
      console.error('Failed to get user info from cookie (database may be down):', error)
      // Continue without user info - important for API access when DB is down
    }
  }

  try {
    const { limited, remaining, reset, limit } = await limiter.check({
      ip,
      userAgent,
      userId,
      path: pathname
    })

    if (limited) {
      return getRateLimitResponse(limit, remaining, reset)
    }

    // Get dynamic paths from Redis (real-time config, cached for 60s)
    const { blockedPaths, publicPaths: dynamicPublicPaths } = await getCachedPaths();

    // Check blocked paths first - return 404  
    if (isPathMatch(pathname, blockedPaths)) {
      const response = NextResponse.rewrite(new URL('/404', request.url))
      return addRateLimitHeaders(response, limit, remaining, reset)
    }

    // Special handling for payment pages - allow frame embedding
    if (pathname.startsWith('/payment/') || pathname.startsWith('/payment-direct/')) {
      const response = NextResponse.next()
      allowFrameEmbedding(response)
      return addRateLimitHeaders(response, limit, remaining, reset)
    }

    // Check if the path should have internationalization applied
    const shouldApplyI18n = isPathMatch(pathname, nextI18nPaths) || hasLocalePrefix(pathname);
    // console.log('shouldApplyI18n', shouldApplyI18n)
    // console.log('pathname', pathname)

    // Check if this is an internal API that requires special permissions
    const isInternalApi = isPathMatch(pathname, internalApiPaths);
    if (isInternalApi) {
      // For other internal APIs, check user role
      try {
        const userRole = await checkUserRole();

        if (!userId || !sessionInfo) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        if (userRole === 'user' || userRole === 'guest') {
          return NextResponse.json({ error: 'Forbidden: Insufficient permissions' }, { status: 403 });
        }

        // If user is authorized, let the request proceed
        return addRateLimitHeaders(NextResponse.next(), limit, remaining, reset);
      } catch (authError: unknown) {
        // Handle authentication errors
        const appwriteError = authError as { code?: number; type?: string; message?: string };

        // Check if this is a database connectivity issue
        if (authError instanceof Error && 
            (authError.message?.includes('fetch failed') || 
             authError.message?.includes('ECONNREFUSED') ||
             authError.message?.includes('network') ||
             authError.message?.includes('timeout'))) {
          console.error('Database connection error in internal API check:', authError);
          // Allow the request to proceed to the API route, which should handle DB errors
          return addRateLimitHeaders(NextResponse.next(), limit, remaining, reset);
        }

        if (appwriteError?.code === 401 ||
          appwriteError?.type === 'general_unauthorized_scope' ||
          appwriteError?.message?.includes('missing scope') ||
          appwriteError?.message?.includes('User (role: guests)')) {

          console.log('Authentication error in internal API check, clearing session:', appwriteError);

          // Get the appropriate cookie domain for cross-subdomain support
          const cookieDomain = getCookieDomain();

          // Clear the invalid session cookie and redirect to sign-in
          const response = NextResponse.json({ error: 'Session expired, please login again' }, { status: 401 });
          response.cookies.delete({
            name: COOKIE_NAME,
            path: "/",
            domain: cookieDomain
          });
          return response;
        }

        // For other errors, return generic error
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
      }
    }

    // Check if it's a public path  
    const pathWithoutLocale = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '');
    const isPublicPath = isPathMatch(pathWithoutLocale, dynamicPublicPaths);

    if (isPublicPath) {
      // Public paths don't need authentication
      // For API routes, always allow them to proceed (they handle their own errors)
      if (pathname.startsWith('/api/')) {
        return addRateLimitHeaders(NextResponse.next(), limit, remaining, reset);
      }
      
      if (shouldApplyI18n) {
        const response = await intlMiddleware(request);
        return addRateLimitHeaders(response, limit, remaining, reset);
      }
      return addRateLimitHeaders(NextResponse.next(), limit, remaining, reset);
    }

    // For protected and auth paths, verify session
    if (!userId || !sessionInfo) {
      // Extract the locale from the request URL if present
      const locale = extractLocaleFromPath(pathname) || defaultLocale

      // Create redirect URL with locale
      const redirectUrl = new URL('/sign-in', request.url)
      if (!redirectUrl.pathname.startsWith(`/${locale}`)) {
        redirectUrl.pathname = `/${locale}${redirectUrl.pathname}`
      }

      return NextResponse.redirect(redirectUrl)
    }

    // Apply i18n if needed
    let response = NextResponse.next();
    if (shouldApplyI18n) {
      response = await intlMiddleware(request)
    }

    // Check if session is about to expire
    const oneHour = 60 * 60 * 1000
    const shouldRefreshSession = sessionInfo.expires - Date.now() < oneHour &&
      sessionInfo.expires - Date.now() > 5 * 60 * 1000

    if (shouldRefreshSession) {
      try {
        const { account, isAuthenticated } = await refreshSession(sessionInfo)
        if (isAuthenticated && account) {
          // Refresh the current session
          const newSession = await account.updateSession('current')

          // Get the appropriate cookie domain for cross-subdomain support
          const cookieDomain = getCookieDomain();

          // Update the cookie with new expiration
          response.cookies.set(COOKIE_NAME, newSession.secret, {
            path: "/",
            httpOnly: true,
            sameSite: "lax",
            secure: true,
            expires: new Date(newSession.expire),
            domain: cookieDomain,
          })
        }
      } catch (refreshError) {
        console.warn("Failed to refresh session:", refreshError)
      }
    }

    // Check admin paths
    const pathWithoutLocaleForAdmin = pathname.replace(/^\/[a-z]{2}(?=\/|$)/, '');
    const isAdminPath = isPathMatch(pathWithoutLocaleForAdmin, adminPaths)
    if (isAdminPath) {
      try {
        const userRole = await checkUserRole()
        if (userRole !== 'admin') {
          // Extract the locale from the request URL if present
          const locale = extractLocaleFromPath(pathname) || defaultLocale

          // Create redirect URL with locale
          const redirectUrl = new URL('/', request.url)
          if (!redirectUrl.pathname.startsWith(`/${locale}`)) {
            redirectUrl.pathname = `/${locale}${redirectUrl.pathname}`
          }

          return NextResponse.redirect(redirectUrl)
        }
      } catch (authError: unknown) {
        // Handle authentication errors
        const appwriteError = authError as { code?: number; type?: string; message?: string };

        // Check if this is a database connectivity issue
        if (authError instanceof Error && 
            (authError.message?.includes('fetch failed') || 
             authError.message?.includes('ECONNREFUSED') ||
             authError.message?.includes('network') ||
             authError.message?.includes('timeout'))) {
          console.error('Database connection error in admin check, allowing access:', authError);
          // During DB outage, allow admin access to proceed (better than blocking)
          return addRateLimitHeaders(response, limit, remaining, reset);
        }

        if (appwriteError?.code === 401 ||
          appwriteError?.type === 'general_unauthorized_scope' ||
          appwriteError?.message?.includes('missing scope') ||
          appwriteError?.message?.includes('User (role: guests)')) {

          console.log('Authentication error in admin path check, clearing session:', appwriteError);

          // Get the appropriate cookie domain for cross-subdomain support
          const cookieDomain = getCookieDomain();

          // Extract the locale from the request URL if present
          const locale = extractLocaleFromPath(pathname) || defaultLocale

          // Create redirect URL with locale and clear cookie
          const redirectUrl = new URL('/sign-in', request.url)
          if (!redirectUrl.pathname.startsWith(`/${locale}`)) {
            redirectUrl.pathname = `/${locale}${redirectUrl.pathname}`
          }

          const response = NextResponse.redirect(redirectUrl)
          response.cookies.delete({
            name: COOKIE_NAME,
            path: "/",
            domain: cookieDomain
          });
          return response;
        }

        // For other errors, redirect to home
        const locale = extractLocaleFromPath(pathname) || defaultLocale
        const redirectUrl = new URL('/', request.url)
        if (!redirectUrl.pathname.startsWith(`/${locale}`)) {
          redirectUrl.pathname = `/${locale}${redirectUrl.pathname}`
        }
        return NextResponse.redirect(redirectUrl)
      }
    }

    // Get more information when calling the API  
    try {
      const role = await checkUserRole();
      response.headers.set('x-user-role', role || 'guest');
    } catch (e: unknown) {
      // Handle authentication errors
      const appwriteError = e as { code?: number; type?: string; message?: string };

      // Check if this is a database connectivity issue
      if (e instanceof Error && 
          (e.message?.includes('fetch failed') || 
           e.message?.includes('ECONNREFUSED') ||
           e.message?.includes('network') ||
           e.message?.includes('timeout'))) {
        console.error('Database connection error in role check (setting guest):', e);
        // Set guest role and continue - API routes will handle DB errors
        response.headers.set('x-user-role', 'guest');
        return addRateLimitHeaders(response, limit, remaining, reset);
      }

      if (appwriteError?.code === 401 ||
        appwriteError?.type === 'general_unauthorized_scope' ||
        appwriteError?.message?.includes('missing scope') ||
        appwriteError?.message?.includes('User (role: guests)')) {

        console.log('Authentication error in role header check, clearing session:', appwriteError);

        // Get the appropriate cookie domain for cross-subdomain support
        const cookieDomain = getCookieDomain();

        // Extract the locale from the request URL if present
        const locale = extractLocaleFromPath(pathname) || defaultLocale

        // Create redirect URL with locale and clear cookie
        const redirectUrl = new URL('/sign-in', request.url)
        if (!redirectUrl.pathname.startsWith(`/${locale}`)) {
          redirectUrl.pathname = `/${locale}${redirectUrl.pathname}`
        }

        const redirectResponse = NextResponse.redirect(redirectUrl)
        redirectResponse.cookies.delete({
          name: COOKIE_NAME,
          path: "/",
          domain: cookieDomain
        });
        return redirectResponse;
      }

      console.error('Error getting user role:', e)
      // For other errors, this is just additional info, set guest role
      response.headers.set('x-user-role', 'guest');
    }

    return addRateLimitHeaders(response, limit, remaining, reset)
  } catch (error) {
    console.error('Middleware error:', error)

    // Get the appropriate cookie domain for cross-subdomain support
    const cookieDomain = getCookieDomain();

    // On error, redirect to sign-in and clear session
    const shouldApplyI18n = isPathMatch(pathname, nextI18nPaths) || hasLocalePrefix(pathname)

    if (shouldApplyI18n) {
      const locale = extractLocaleFromPath(pathname) || defaultLocale
      const redirectUrl = new URL('/sign-in', request.url)
      if (!redirectUrl.pathname.startsWith(`/${locale}`)) {
        redirectUrl.pathname = `/${locale}${redirectUrl.pathname}`
      }

      const response = NextResponse.redirect(redirectUrl)
      response.cookies.delete({
        name: COOKIE_NAME,
        path: "/",
        domain: cookieDomain
      })
      return response
    } else {
      const response = NextResponse.redirect(new URL('/sign-in', request.url))
      response.cookies.delete({
        name: COOKIE_NAME,
        path: "/",
        domain: cookieDomain
      })
      return response
    }
  }
}