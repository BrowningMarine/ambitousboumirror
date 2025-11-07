/**
 * Unified Realtime Subscription with Appwrite→Supabase Failover
 * 
 * This module provides realtime subscriptions with automatic failover:
 * Respects coreRunningMode configuration setting
 * Priority 1: Configured database (Appwrite or Supabase)
 * Priority 2: Fallback database (in auto mode)
 * Fallback: Polling if both unavailable
 */

'use client';

import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { BackupOrder } from '../supabase-backup';

// Type for order update callback
export type OrderUpdateCallback = (order: {
  odr_id: string;
  odr_status: string;
  updated_at?: string;
}) => void;

// Type for subscription modes
export type SubscriptionMode = 'appwrite' | 'supabase' | 'polling';

// Runtime configuration (fetched from API)
let runtimeConfig: {
  mode: 'auto' | 'appwrite' | 'supabase' | 'fallback';
  supabase?: { url: string; anonKey: string };
  appwrite?: { endpoint: string; projectId: string; databaseId: string; ordersCollectionId: string };
} | null = null;

let configPromise: Promise<void> | null = null;

// Fetch config from API endpoint
async function loadRuntimeConfig() {
  if (runtimeConfig) return;
  if (configPromise) return configPromise;

  configPromise = (async () => {
    try {
      const response = await fetch('/api/realtime-config');
      if (!response.ok) throw new Error('Failed to fetch config');
      runtimeConfig = await response.json();
      console.log('🔧 [Realtime] Config loaded:', runtimeConfig?.mode);
    } catch (error) {
      console.error('❌ [Realtime] Failed to load config:', error);
      // Fallback to Appwrite using NEXT_PUBLIC_ vars
      runtimeConfig = {
        mode: 'auto',
        appwrite: {
          endpoint: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT || '',
          projectId: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID || '',
          databaseId: process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID || '',
          ordersCollectionId: process.env.NEXT_PUBLIC_APPWRITE_ORDERS_COLLECTION_ID || ''
        }
      };
    }
  })();

  return configPromise;
}

// Singleton clients
let supabaseClient: SupabaseClient | null = null;
let appwriteClient: { client: unknown; databases: unknown } | null = null; // Appwrite client (imported dynamically)

/**
 * Get Supabase client
 */
function getSupabaseClient(): SupabaseClient | null {
  const config = runtimeConfig?.supabase;
  if (!config?.url || !config?.anonKey) {
    return null;
  }

  if (!supabaseClient) {
    try {
      supabaseClient = createClient(config.url, config.anonKey, {
        auth: { persistSession: false },
        realtime: { params: { eventsPerSecond: 10 } }
      });
    } catch {
      return null;
    }
  }

  return supabaseClient;
}

/**
 * Get Appwrite client (lazy loaded)
 */
async function getAppwriteClient(): Promise<{ client: unknown; databases: unknown } | null> {
  const config = runtimeConfig?.appwrite;
  if (!config?.endpoint || !config?.projectId || !config?.databaseId || !config?.ordersCollectionId) {
    return null;
  }

  if (!appwriteClient) {
    try {
      const { Client, Databases } = await import('appwrite');
      const client = new Client();
      client
        .setEndpoint(config.endpoint)
        .setProject(config.projectId);
      
      const databases = new Databases(client);
      appwriteClient = { client, databases };
    } catch {
      return null;
    }
  }

  return appwriteClient;
}

/**
 * Fetch order status from Appwrite
 */
async function fetchFromAppwrite(odrId: string): Promise<{ odr_id: string; odr_status: string; updated_at?: string } | null> {
  try {
    console.log('📡 [Realtime] Fetching from Appwrite:', odrId);
    const appwrite = await getAppwriteClient();
    if (!appwrite) {
      console.log('⚠️ [Realtime] Appwrite client not available');
      return null;
    }

    const config = runtimeConfig?.appwrite;
    if (!config) return null;

    const { databases } = appwrite as { databases: { listDocuments: (db: string, col: string, queries: unknown[]) => Promise<{ documents: unknown[] }> } };
    const { Query } = await import('appwrite');

    const response = await databases.listDocuments(
      config.databaseId,
      config.ordersCollectionId,
      [Query.equal('odrId', [odrId]), Query.limit(1)]
    );

    if (response.documents.length > 0) {
      const doc = response.documents[0] as { odrId: string; odrStatus: string; $updatedAt: string };
      console.log('✅ [Realtime] Found order in Appwrite:', { odrId: doc.odrId, status: doc.odrStatus });
      return {
        odr_id: doc.odrId,
        odr_status: doc.odrStatus,
        updated_at: doc.$updatedAt
      };
    }

    console.log('⚠️ [Realtime] Order not found in Appwrite');
    return null;
  } catch (error) {
    console.error('❌ [Realtime] Failed to fetch from Appwrite:', error);
    return null;
  }
}

/**
 * Fetch order status from Supabase
 */
async function fetchFromSupabase(odrId: string): Promise<{ odr_id: string; odr_status: string; updated_at?: string } | null> {
  try {
    console.log('📡 [Realtime] Fetching from Supabase:', odrId);
    const supabase = getSupabaseClient();
    if (!supabase) {
      console.log('⚠️ [Realtime] Supabase client not available');
      return null;
    }

    const { data, error } = await supabase
      .from('backup_orders')
      .select('odr_id, odr_status, updated_at')
      .eq('odr_id', odrId)
      .single();

    if (error) {
      console.error('❌ [Realtime] Supabase query error:', error.message);
      return null;
    }

    if (!data) {
      console.log('⚠️ [Realtime] Order not found in Supabase');
      return null;
    }

    // Trim whitespace from status (fix for \r\n in database)
    const cleanStatus = data.odr_status?.trim() || data.odr_status;
    console.log('✅ [Realtime] Found order in Supabase:', { odrId: data.odr_id, status: cleanStatus });
    return {
      odr_id: data.odr_id,
      odr_status: cleanStatus,
      updated_at: data.updated_at
    };
  } catch (error) {
    console.error('❌ [Realtime] Failed to fetch from Supabase:', error);
    return null;
  }
}

/**
 * Subscribe to Appwrite realtime
 */
async function subscribeAppwrite(
  odrId: string,
  callback: OrderUpdateCallback
): Promise<(() => void) | null> {
  try {
    const appwrite = await getAppwriteClient();
    if (!appwrite) return null;

    const config = runtimeConfig?.appwrite;
    if (!config) return null;

    const { client } = appwrite as { client: { subscribe: (channel: string, cb: (response: { payload?: { odrId: string; odrStatus: string; $updatedAt: string } }) => void) => () => void } };
    
    const unsubscribe = client.subscribe(
      `databases.${config.databaseId}.collections.${config.ordersCollectionId}.documents`,
      (response: { payload?: { odrId: string; odrStatus: string; $updatedAt: string } }) => {
        if (response.payload && response.payload.odrId === odrId) {
          callback({
            odr_id: response.payload.odrId,
            odr_status: response.payload.odrStatus,
            updated_at: response.payload.$updatedAt
          });
        }
      }
    );

    return unsubscribe;
  } catch {
    return null;
  }
}

/**
 * Subscribe to Supabase realtime
 */
function subscribeSupabase(
  odrId: string,
  callback: OrderUpdateCallback
): (() => void) | null {
  try {
    const supabase = getSupabaseClient();
    if (!supabase) return null;

    const channel: RealtimeChannel = supabase
      .channel(`order_${odrId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'backup_orders',
          filter: `odr_id=eq.${odrId}`
        },
        (payload) => {
          if (payload.new) {
            const order = payload.new as BackupOrder;
            // Trim whitespace from status (fix for \r\n in database)
            callback({
              odr_id: order.odr_id,
              odr_status: order.odr_status?.trim() || order.odr_status,
              updated_at: order.updated_at
            });
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  } catch {
    return null;
  }
}

/**
 * Unified subscription with automatic failover
 * Returns: { unsubscribe, mode, fetchStatus }
 */
export async function subscribeToOrder(
  odrId: string,
  callback: OrderUpdateCallback,
  onModeChange?: (mode: SubscriptionMode) => void
): Promise<{
  unsubscribe: () => void;
  mode: SubscriptionMode;
  fetchStatus: () => Promise<{ odr_id: string; odr_status: string; updated_at?: string } | null>;
}> {
  // Load runtime config first
  await loadRuntimeConfig();

  let currentMode: SubscriptionMode = 'polling';
  let unsubscribeFn: (() => void) | null = null;
  let pollingInterval: NodeJS.Timeout | null = null;

  // Get core running mode from loaded config
  const runningMode = runtimeConfig?.mode || 'auto';
  console.log('🎯 [Realtime] Subscribing to order:', odrId, 'with mode:', runningMode);

  if (runningMode === 'fallback') {
    // Fallback mode: No database, no realtime, no polling
    // Payment status is controlled via encrypted URL data only
    console.log('🟡 [Realtime] Fallback mode - no database subscription (URL-based only)');
    currentMode = 'polling'; // Use 'polling' mode but don't actually poll
    onModeChange?.('polling');
    
    // Return empty subscription (no-op)
    const unsubscribe = () => {
      console.log('🟡 [Realtime] Fallback mode unsubscribe (no-op)');
    };
    
    const fetchStatus = async () => {
      console.log('🟡 [Realtime] Fallback mode - no database fetch available');
      return null;
    };
    
    return {
      unsubscribe,
      mode: currentMode,
      fetchStatus
    };
  } else if (runningMode === 'supabase') {
    // Supabase-only mode: Only use Supabase, no fallback
    console.log('🔵 [Realtime] Attempting Supabase subscription...');
    const supabaseUnsub = subscribeSupabase(odrId, callback);
    if (supabaseUnsub) {
      currentMode = 'supabase';
      unsubscribeFn = supabaseUnsub;
      console.log('✅ [Realtime] Supabase subscription active');
      onModeChange?.('supabase');
    } else {
      // Fallback to polling if Supabase realtime unavailable
      console.log('⚠️ [Realtime] Supabase realtime unavailable, using polling');
      currentMode = 'polling';
      onModeChange?.('polling');
      
      pollingInterval = setInterval(async () => {
        const status = await fetchOrderStatus(odrId);
        if (status) {
          callback(status);
        }
      }, 10000);
    }
  } else if (runningMode === 'appwrite') {
    // Appwrite-only mode: Only use Appwrite, no fallback
    console.log('🟢 [Realtime] Attempting Appwrite subscription...');
    const appwriteUnsub = await subscribeAppwrite(odrId, callback);
    if (appwriteUnsub) {
      currentMode = 'appwrite';
      unsubscribeFn = appwriteUnsub;
      console.log('✅ [Realtime] Appwrite subscription active');
      onModeChange?.('appwrite');
    } else {
      // Fallback to polling if Appwrite realtime unavailable
      console.log('⚠️ [Realtime] Appwrite realtime unavailable, using polling');
      currentMode = 'polling';
      onModeChange?.('polling');
      
      pollingInterval = setInterval(async () => {
        const status = await fetchOrderStatus(odrId);
        if (status) {
          callback(status);
        }
      }, 10000);
    }
  } else {
    // Auto mode: Try Appwrite first, then Supabase
    console.log('🔄 [Realtime] Auto mode: Trying Appwrite first...');
    const appwriteUnsub = await subscribeAppwrite(odrId, callback);
    if (appwriteUnsub) {
      currentMode = 'appwrite';
      unsubscribeFn = appwriteUnsub;
      console.log('✅ [Realtime] Appwrite subscription active');
      onModeChange?.('appwrite');
    } else {
      // Fallback to Supabase
      console.log('⚠️ [Realtime] Appwrite unavailable, trying Supabase...');
      const supabaseUnsub = subscribeSupabase(odrId, callback);
      if (supabaseUnsub) {
        currentMode = 'supabase';
        unsubscribeFn = supabaseUnsub;
        console.log('✅ [Realtime] Supabase subscription active');
        onModeChange?.('supabase');
      } else {
        // Fallback to polling (both databases unavailable for realtime)
        console.log('⚠️ [Realtime] Both databases unavailable, using polling');
        currentMode = 'polling';
        onModeChange?.('polling');
        
        // Poll every 10 seconds
        pollingInterval = setInterval(async () => {
          const status = await fetchOrderStatus(odrId);
          if (status) {
            callback(status);
          }
        }, 10000);
      }
    }
  }

  // Unified unsubscribe function
  const unsubscribe = () => {
    if (unsubscribeFn) {
      unsubscribeFn();
    }
    if (pollingInterval) {
      clearInterval(pollingInterval);
    }
  };

  // Unified fetch function
  const fetchStatus = async () => {
    return await fetchOrderStatus(odrId);
  };

  return {
    unsubscribe,
    mode: currentMode,
    fetchStatus
  };
}

/**
 * Fetch order status with automatic failover
 * Respects coreRunningMode configuration
 */
export async function fetchOrderStatus(
  odrId: string
): Promise<{ odr_id: string; odr_status: string; updated_at?: string } | null> {
  // Load runtime config first
  await loadRuntimeConfig();
  
  const runningMode = runtimeConfig?.mode || 'auto';
  console.log('🔍 [Realtime] Fetching order status for:', odrId, 'mode:', runningMode);

  if (runningMode === 'fallback') {
    // Fallback mode: No database fetch - status is in encrypted URL only
    console.log('🟡 [Realtime] Fallback mode - no database fetch available');
    return null;
  } else if (runningMode === 'supabase') {
    // Supabase-only mode
    console.log('🔵 [Realtime] Using Supabase-only mode');
    return await fetchFromSupabase(odrId);
  } else if (runningMode === 'appwrite') {
    // Appwrite-only mode
    console.log('🟢 [Realtime] Using Appwrite-only mode');
    return await fetchFromAppwrite(odrId);
  } else {
    // Auto mode: Try Appwrite first, then Supabase
    console.log('🔄 [Realtime] Auto mode: Trying Appwrite first...');
    const appwriteStatus = await fetchFromAppwrite(odrId);
    if (appwriteStatus) {
      return appwriteStatus;
    }

    // Fallback to Supabase
    console.log('🔄 [Realtime] Appwrite failed, trying Supabase...');
    const supabaseStatus = await fetchFromSupabase(odrId);
    if (supabaseStatus) {
      return supabaseStatus;
    }

    // Both failed
    console.error('❌ [Realtime] Both databases failed to fetch order');
    return null;
  }
}
