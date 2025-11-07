import { NextRequest, NextResponse } from "next/server";
import { loadAppConfig, saveAppConfig } from "@/lib/json/config-loader";

// Simple in-memory rate limiter for authentication attempts
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION = 15 * 60 * 1000; // 15 minutes

// Validate secret path
async function validateSecretPath(secretpath: string): Promise<boolean> {
  const config = loadAppConfig();
  const expectedPath = config.security.configSecretPath;
  return secretpath === expectedPath;
}

// Check if IP is allowed (optional whitelist)
function isIpAllowed(ip: string): boolean {
  const whitelist = process.env.CONFIG_IP_WHITELIST;
  if (!whitelist) return true; // No whitelist = allow all
  
  const allowedIps = whitelist.split(',').map(ip => ip.trim());
  return allowedIps.some(allowed => {
    if (allowed.includes('*')) {
      // Support wildcard matching like 192.168.1.*
      const regex = new RegExp('^' + allowed.replace(/\*/g, '.*') + '$');
      return regex.test(ip);
    }
    return allowed === ip;
  });
}

// Check and update rate limit
function checkRateLimit(ip: string): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const attempt = authAttempts.get(ip);

  if (!attempt || now > attempt.resetAt) {
    // First attempt or lockout expired
    authAttempts.set(ip, { count: 1, resetAt: now + LOCKOUT_DURATION });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 };
  }

  if (attempt.count >= MAX_ATTEMPTS) {
    // Locked out
    return { allowed: false, remaining: 0 };
  }

  // Increment attempt
  attempt.count++;
  return { allowed: true, remaining: MAX_ATTEMPTS - attempt.count };
}

// Reset rate limit on successful auth
function resetRateLimit(ip: string): void {
  authAttempts.delete(ip);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ secretpath: string }> }
) {
  try {
    const { secretpath } = await params;
    
    // Validate secret path
    if (!await validateSecretPath(secretpath)) {
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404 }
      );
    }

    const config = loadAppConfig();
    
    // Encode the config data as Base64 for additional security
    const configString = JSON.stringify(config);
    const encodedConfig = Buffer.from(configString).toString('base64');
    
    return NextResponse.json({ 
      data: encodedConfig,
      encoded: true 
    });
  } catch (error) {
    console.error('Error loading config:', error);
    return NextResponse.json(
      { error: 'Failed to load configuration' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ secretpath: string }> }
) {
  try {
    const { secretpath } = await params;
    
    // Validate secret path
    if (!await validateSecretPath(secretpath)) {
      return NextResponse.json(
        { error: 'Not found' },
        { status: 404 }
      );
    }

    // Get client IP for rate limiting
    const ip = request.headers.get('cf-connecting-ip') ?? 
               request.headers.get('x-real-ip') ?? 
               request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 
               'unknown';

    // Check IP whitelist (if configured)
    if (!isIpAllowed(ip)) {
      console.warn(`Config admin access denied for IP: ${ip}`);
      return NextResponse.json(
        { error: 'Access denied' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action, password, config } = body;

    // Load current config for password validation
    const currentConfig = loadAppConfig();

    // Handle authentication check
    if (action === 'auth') {
      // Check rate limit
      const { allowed, remaining } = checkRateLimit(ip);
      
      if (!allowed) {
        const attempt = authAttempts.get(ip);
        const minutesLeft = attempt ? Math.ceil((attempt.resetAt - Date.now()) / 60000) : 0;
        console.warn(`Rate limit exceeded for IP ${ip}. Locked out for ${minutesLeft} minutes.`);
        return NextResponse.json(
          { error: `Too many attempts. Please try again in ${minutesLeft} minutes.` },
          { status: 429 }
        );
      }

      // Validate password
      if (password !== currentConfig.security.adminPasswordPlaintext) {
        console.warn(`Failed auth attempt for IP ${ip}. Remaining attempts: ${remaining}`);
        return NextResponse.json(
          { error: `Invalid password. ${remaining} attempts remaining before lockout.` },
          { status: 401 }
        );
      }

      // Success - reset rate limit
      resetRateLimit(ip);
      console.log(`Successful config admin auth from IP: ${ip}`);
      return NextResponse.json({ success: true });
    }

    // Handle save action
    if (action === 'save') {
      // Validate password (no rate limit for saves, only auth)
      if (password !== currentConfig.security.adminPasswordPlaintext) {
        return NextResponse.json(
          { error: 'Invalid password' },
          { status: 401 }
        );
      }

      // Save config
      try {
        saveAppConfig(config);
        console.log(`Config saved by IP: ${ip}`);
        
        // Check if restart is required
        const changedFields: string[] = [];
        const requiresRestart = Object.keys(config._metadata.requiresRestart).some((key) => {
          if (config._metadata.requiresRestart[key]) {
            changedFields.push(key);
            return true;
          }
          return false;
        });

        return NextResponse.json({ 
          success: true,
          requiresRestart,
          changedFields
        });
      } catch (saveError) {
        console.error('Error saving config:', saveError);
        return NextResponse.json(
          { error: 'Failed to save configuration' },
          { status: 500 }
        );
      }
    }

    // Invalid action
    return NextResponse.json(
      { error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error in config API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
