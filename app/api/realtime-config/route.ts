/**
 * API endpoint to provide realtime database credentials to client
 * This allows keeping env vars without NEXT_PUBLIC_ prefix
 */

import { NextResponse } from 'next/server';
import { getCoreRunningMode } from '@/lib/appconfig';

export async function GET() {
  try {
    const runningMode = getCoreRunningMode();
    
    // Only return credentials based on active mode
    const config: {
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
        config.supabase = {
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
        config.appwrite = {
          endpoint: appwriteEndpoint,
          projectId: appwriteProjectId,
          databaseId: appwriteDatabaseId,
          ordersCollectionId: appwriteOrdersCollectionId
        };
      }
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error('❌ [Realtime Config API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load realtime config' },
      { status: 500 }
    );
  }
}
