import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/appwrite/appwrite.actions';
import { appConfig } from '@/lib/appconfig';

/**
 * Health Check Endpoint
 * 
 * Used by Cloudflare Workers load balancer to determine if this instance is healthy.
 * Returns 200 OK if the app can handle requests, 503 if not.
 */
export async function GET() {
  try {
    const startTime = performance.now();
    
    // Basic health check - server is responding
    const healthStatus: {
      status: 'healthy' | 'degraded' | 'unhealthy';
      timestamp: string;
      mode: 'client-only' | 'full';
      version: string;
      checks: {
        server: boolean;
        database: boolean;
        responseTime: string;
      };
      degraded?: boolean;
    } = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      mode: appConfig.useClientOnlyPayment ? 'client-only' : 'full',
      version: '1.0.0',
      checks: {
        server: true,
        database: true,
        responseTime: '0ms'
      }
    };

    // Database check - only for non-client-only mode
    // In client-only mode, database failures are expected and handled gracefully
    if (!appConfig.useClientOnlyPayment) {
      try {
        // Quick database ping to verify connectivity
        const { database } = await createAdminClient();
        await database.listDocuments(
          process.env.APPWRITE_DATABASE_ID!,
          process.env.APPWRITE_ACCOUNT_COLLECTION_ID!,
          []
        );
        healthStatus.checks.database = true;
      } catch (dbError) {
        console.error('Health check: Database connection failed', dbError);
        healthStatus.checks.database = false;
        healthStatus.status = 'unhealthy';
        
        const responseTime = performance.now() - startTime;
        healthStatus.checks.responseTime = `${Math.round(responseTime)}ms`;
        
        // Return 503 if database is required but unavailable
        return NextResponse.json(healthStatus, { status: 503 });
      }
    } else {
      // Client-only mode doesn't require database for health check
      // Database failures are handled gracefully, so mark as healthy
      healthStatus.checks.database = true; // N/A in client-only mode
      healthStatus.degraded = false; // Normal operation for this mode
    }

    const responseTime = performance.now() - startTime;
    healthStatus.checks.responseTime = `${Math.round(responseTime)}ms`;

    // If response time is very high, mark as degraded
    if (responseTime > 5000) {
      healthStatus.status = 'degraded';
      healthStatus.degraded = true;
    }

    return NextResponse.json(healthStatus, { 
      status: healthStatus.status === 'unhealthy' ? 503 : 200 
    });

  } catch (error) {
    console.error('Health check failed:', error);
    
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error instanceof Error ? error.message : 'Unknown error',
      mode: appConfig.useClientOnlyPayment ? 'client-only' : 'full',
      version: '1.0.0'
    }, { status: 503 });
  }
}
