/**
 * API Endpoint: Initialize Redis Config
 * 
 * Use this ONCE to seed Redis with your current appconfig.json
 * 
 * Access: GET /api/admin/init-redis-config?secret=YOUR_SECRET
 */

import { NextRequest, NextResponse } from 'next/server';
import { initializeRedisConfig } from '@/lib/json/config-loader';

export async function GET(request: NextRequest) {
  try {
    // Simple authentication (use your admin secret)
    const secret = request.nextUrl.searchParams.get('secret');
    const expectedSecret = process.env.INTERNAL_API_SECRET || 'your-secret-here';
    
    if (secret !== expectedSecret) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Initialize Redis with local config
    const result = await initializeRedisConfig();
    
    return NextResponse.json({
      ...result,
      timestamp: new Date().toISOString(),
      nextSteps: [
        'Redis config initialized successfully!',
        'All future config saves will go to Redis',
        'All instances will pick up changes within 60 seconds',
        'No redeployment needed for config updates'
      ]
    });
  } catch (error) {
    console.error('[InitRedisConfig] Error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
