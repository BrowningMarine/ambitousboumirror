import { NextRequest, NextResponse } from 'next/server';
import { activateSecretAgent } from '@/lib/actions/secretAgentActions';
import { getLoggedInUser } from '@/lib/actions/user.actions';
import { appConfig } from '@/lib/appconfig';

// Security function to validate the request
async function validateInternalRequest(request: NextRequest): Promise<{ valid: boolean; error?: string }> {
  try {
    // 1. Check if user is authenticated and has proper role
    const user = await getLoggedInUser();
    if (!user || !['admin', 'transactor'].includes(user.role)) {
      return { valid: false, error: 'Unauthorized: Admin or transactor role required' };
    }
    
    // 2. Check Referer header (should come from your app)
    const referer = request.headers.get('referer');
    const origin = request.headers.get('origin');
    
    if (!referer && !origin) {
      return { valid: false, error: 'Missing referer/origin headers' };
    }
    
    // 3. Validate that request comes from allowed domains
    const allowedDomains = appConfig.allowedDomains;
    
    const requestDomain = referer ? new URL(referer).host : (origin ? new URL(origin).host : null);
    const requestHostname = referer ? new URL(referer).hostname : (origin ? new URL(origin).hostname : null);
    
    console.log('Active SA Request domain:', requestDomain);
    console.log('Active SA Request hostname:', requestHostname);
    console.log('Active SA Allowed domains:', allowedDomains);
    
    // Check if domain matches (with or without port)
    const isDomainAllowed = requestDomain && (
      allowedDomains.includes(requestDomain) || // Full match (with port)
      allowedDomains.includes(requestHostname!) // Hostname match (without port)
    );
    
    if (!isDomainAllowed) {
      return { valid: false, error: `Unauthorized domain: ${requestDomain}` };
    }
    
    // 4. Check Content-Type header
    const contentType = request.headers.get('content-type');
    if (contentType !== 'application/json') {
      return { valid: false, error: 'Invalid content type' };
    }
    
    return { valid: true };
  } catch {
    return { valid: false, error: 'Authentication verification failed' };
  }
}

export async function POST(request: NextRequest) {
  try {
    // Security validation
    const validation = await validateInternalRequest(request);
    if (!validation.valid) {
      return NextResponse.json({
        success: false,
        status: 'alert',
        message: validation.error || 'Unauthorized access'
      }, { status: 403 });
    }
    
    const result = await activateSecretAgent();
    
    return NextResponse.json(result, { 
      status: result.success ? 200 : 400 
    });
    
  } catch (error) {
    return NextResponse.json({
      success: false,
      status: 'alert',
      message: `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`
    }, { status: 500 });
  }
}

// Disable other HTTP methods
export async function GET() {
  return NextResponse.json({ message: 'Method not allowed' }, { status: 405 });
}

export async function PUT() {
  return NextResponse.json({ message: 'Method not allowed' }, { status: 405 });
}

export async function DELETE() {
  return NextResponse.json({ message: 'Method not allowed' }, { status: 405 });
}