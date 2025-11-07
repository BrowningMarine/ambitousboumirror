import { NextResponse } from 'next/server';
import { appConfig } from './appconfig';

/**
 * Adds headers to allow frame embedding for specific trusted domains
 */
export function allowFrameEmbedding(response: NextResponse) {
  // Get trusted domains from appconfig (fallback to env if needed)
  const trustedDomains = appConfig.trustedDomains || [];
  
  // Add self to the list of allowed domains
  let frameAncestors = `'self'`;
  
  // Determine if we should allow all domains
  const allowAllDomains = appConfig.allowAllFrameEmbedding;
  
  if (allowAllDomains) {
    // Allow all domains to embed
    frameAncestors = '*';
  } else if (trustedDomains.length > 0) {
    // Only allow specific domains
    frameAncestors = `'self' ${trustedDomains.join(' ')}`;
  }
  
  // Set Content-Security-Policy header
  response.headers.set(
    'Content-Security-Policy',
    `frame-ancestors ${frameAncestors}`
  );
  
  // Remove X-Frame-Options if present (it's more restrictive than CSP)
  response.headers.delete('X-Frame-Options');
  
  return response;
}