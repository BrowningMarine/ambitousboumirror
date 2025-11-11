/**
 * Test Config Endpoint - Verify Redis + LRU Cache Working
 * 
 * Access: GET /api/test-config
 */

import { NextResponse } from 'next/server';
import { loadAppConfig, loadAppConfigAsync } from '@/lib/json/config-loader';

export async function GET() {
  const startTime = Date.now();
  
  try {
    // Test synchronous load (uses LRU cache or fallback)
    const configSync = loadAppConfig();
    const syncTime = Date.now() - startTime;
    
    // Test async load (tries Redis first)
    const asyncStartTime = Date.now();
    const configAsync = await loadAppConfigAsync();
    const asyncTime = Date.now() - asyncStartTime;
    
    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      performance: {
        synchronousLoad: `${syncTime}ms`,
        asynchronousLoad: `${asyncTime}ms`,
        note: syncTime < 5 
          ? '⚡ Lightning fast! LRU cache hit (zero cost)' 
          : '🔄 Loading from Redis or static import'
      },
      config: {
        version: configSync._metadata.version,
        lastModified: configSync._metadata.lastModified,
        merchantCount: Object.keys(configSync.merchants).length,
        bankCount: Object.keys(configSync.banks).length,
        baseUrl: configSync.baseSettings.siteUrl
      },
      verification: {
        syncMatchesAsync: JSON.stringify(configSync) === JSON.stringify(configAsync),
        redisAvailable: !!process.env.UPSTASH_REDIS_REST_URL,
        mode: process.env.UPSTASH_REDIS_REST_URL ? 'redis' : 'local'
      },
      tips: [
        'First request: May load from Redis (~15-30ms)',
        'Subsequent requests: Served from LRU cache (~0.1ms)',
        'Cache TTL: 60 seconds',
        'Config updates: Applied within 60 seconds max'
      ]
    });
  } catch (error) {
    console.error('[TestConfig] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
