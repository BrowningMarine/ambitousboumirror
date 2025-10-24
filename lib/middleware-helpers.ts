import { NextResponse } from 'next/server';

/**
 * Adds headers to allow frame embedding for specific trusted domains
 */
export function allowFrameEmbedding(response: NextResponse) {
  // Get trusted domains from environment variables
  // Format in .env file: TRUSTED_DOMAINS=domain1.com,domain2.com,domain3.com
  const trustedDomainsEnv = process.env.TRUSTED_DOMAINS || '';
  
  // Parse the comma-separated list into an array
  const trustedDomains = trustedDomainsEnv
    .split(',')
    .map(domain => domain.trim())
    .filter(domain => domain.length > 0) // Remove empty entries
    .map(domain => domain.startsWith('https://') ? domain : `https://${domain}`); // Ensure https://
    
  // Add self to the list of allowed domains
  let frameAncestors = `'self'`;
  
  // Determine if we should allow all domains
  const allowAllDomains = process.env.ALLOW_ALL_FRAME_EMBEDDING === 'true';
  
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