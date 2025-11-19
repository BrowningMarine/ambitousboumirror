/**
 * API endpoint to provide realtime database credentials to client
 * This allows keeping env vars without NEXT_PUBLIC_ prefix
 * Uses async config loading to ensure fresh data from blob storage
 */

import { NextResponse } from 'next/server';
import { loadAppConfigAsync } from '@/lib/json/config-loader';

export async function GET() {
  try {
    // Use cached config (24-hour cache, near-zero Redis cost)
    const appConfig = await loadAppConfigAsync();
    const runningMode = appConfig.databaseSettings?.coreRunningMode || 'auto';
    
    // Only return credentials based on active mode
    const responseConfig: {
      mode: 'auto' | 'appwrite' | 'supabase' | 'fallback';
      supabase?: { url: string; anonKey: string };
      appwrite?: { endpoint: string; projectId: string; databaseId: string; ordersCollectionId: string };
    } = {
      mode: runningMode
    };

    // Add Supabase config if needed
    if (runningMode === 'supabase' || runningMode === 'auto') {
      const supabaseUrl = process.env.SUPABASE_BK_URL;
      const supabaseAnonKey = process.env.SUPABASE_BK_ANON_KEY;
      
      if (supabaseUrl && supabaseAnonKey) {
        responseConfig.supabase = {
          url: supabaseUrl,
          anonKey: supabaseAnonKey
        };
      }
    }

    // Add Appwrite config if needed
    if (runningMode === 'appwrite' || runningMode === 'auto') {
      const appwriteEndpoint = process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT;
      const appwriteProjectId = process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID;
      const appwriteDatabaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID;
      const appwriteOrdersCollectionId = process.env.NEXT_PUBLIC_APPWRITE_ODRTRANS_COLLECTION_ID; // Fixed: ODRTRANS not ORDERS
      
      if (appwriteEndpoint && appwriteProjectId && appwriteDatabaseId && appwriteOrdersCollectionId) {
        responseConfig.appwrite = {
          endpoint: appwriteEndpoint,
          projectId: appwriteProjectId,
          databaseId: appwriteDatabaseId,
          ordersCollectionId: appwriteOrdersCollectionId
        };
      }
    }

    return NextResponse.json(responseConfig);
  } catch (error) {
    console.error('❌ [Realtime Config API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load realtime config' },
      { status: 500 }
    );
  }
}
