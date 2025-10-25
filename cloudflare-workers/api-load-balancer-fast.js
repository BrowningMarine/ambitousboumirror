/**
 * Cloudflare Worker: Fast API Load Balancer
 * 
 * Optimized for speed - minimal overhead for webhook and order creation
 * - No health checks blocking requests
 * - Fast timeouts
 * - Simple round-robin
 * - No KV dependencies
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const SERVERS = [
  'https://apivn.mydomain.com',    // Vietnam
  'https://apiv2.mydomain.com'     // Singapore
];

// Routes that should be load balanced
const LOAD_BALANCED_ROUTES = [
  '/api/orders',
  '/api/webhook/payment'
];

// FAST timeouts for webhooks
const REQUEST_TIMEOUT = 5000;  // 5 seconds max (instead of 10)

// Simple counter for round-robin
let currentIndex = 0;

// ============================================================================
// MAIN HANDLER
// ============================================================================

const worker = {
  async fetch(request) {
    const url = new URL(request.url);
    
    // Check if this route should be load balanced
    const shouldBalance = LOAD_BALANCED_ROUTES.some(route => 
      url.pathname.startsWith(route)
    );
    
    if (!shouldBalance) {
      // Non-balanced routes go to Vietnam (primary)
      return proxyToServer(request, SERVERS[0]);
    }
    
    // Load balance using round-robin
    const serverUrl = SERVERS[currentIndex];
    currentIndex = (currentIndex + 1) % SERVERS.length;
    
    // Try primary server
    const result = await proxyToServer(request, serverUrl);
    
    // If failed (timeout or error), try other server
    if (result.error) {
      const fallbackUrl = SERVERS[currentIndex];
      currentIndex = (currentIndex + 1) % SERVERS.length;
      
      const fallbackResult = await proxyToServer(request.clone(), fallbackUrl);
      
      // Return fallback result (even if it also fails)
      return fallbackResult.response || fallbackResult.errorResponse;
    }
    
    return result.response;
  }
};

export default worker;

// ============================================================================
// PROXY FUNCTION WITH FAILOVER
// ============================================================================

async function proxyToServer(request, serverUrl) {
  const url = new URL(request.url);
  const targetUrl = `${serverUrl}${url.pathname}${url.search}`;
  
  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);
  
  try {
    // Forward the request
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    // Return success response
    return {
      response: response,
      error: false
    };
    
  } catch {
    clearTimeout(timeoutId);
    
    // Return error flag so we can try fallback
    return {
      error: true,
      errorResponse: new Response(JSON.stringify({
        success: false,
        error: 'SERVER_TIMEOUT',
        message: 'Server took too long to respond'
      }), {
        status: 504,
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      })
    };
  }
}
