/**
 * Supabase Client-Side Realtime Subscriptions
 * 
 * This module provides client-side realtime subscriptions using the anon key
 * IMPORTANT: Only use for realtime subscriptions, NOT for data mutations
 */

'use client';

import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { BackupOrder } from './supabase-backup';

// Type for simplified order status
export type OrderStatus = {
  odr_id: string;
  odr_status: string;
  updated_at: string;
};

// Environment variables - these are prefixed with NEXT_PUBLIC_ to be available on client
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SB_ANON_KEY || '';

// Singleton client
let supabaseClient: SupabaseClient | null = null;

/**
 * Get or create client-side Supabase client for realtime subscriptions
 */
export function getSupabaseRealtimeClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error('Supabase client configuration missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SB_ANON_KEY environment variables.');
  }

  if (!supabaseClient) {
    try {
      supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: false,
        },
        realtime: {
          params: {
            eventsPerSecond: 10
          }
        }
      });
    } catch (error) {
      throw error;
    }
  }

  return supabaseClient;
}

/**
 * Subscribe to Supabase realtime changes for a specific order (CLIENT-SIDE)
 * Returns unsubscribe function
 */
export function subscribeToOrderChanges(
  odrId: string,
  callback: (order: BackupOrder) => void,
  onError?: (error: Error) => void
): () => void {
  try {
    const supabase = getSupabaseRealtimeClient();
    
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
            callback(payload.new as BackupOrder);
          }
        }
      )
      .subscribe((status, err) => {
        if (status === 'CHANNEL_ERROR') {
          if (onError && err) {
            onError(err);
          }
        } else if (status === 'TIMED_OUT') {
          if (onError) {
            onError(new Error('Subscription timed out'));
          }
        }
      });

    // Return unsubscribe function
    return () => {
      supabase.removeChannel(channel);
    };
  } catch (error) {
    if (onError && error instanceof Error) {
      onError(error);
    }
    // Return no-op unsubscribe function
    return () => {};
  }
}

/**
 * Fetch current order status from Supabase (CLIENT-SIDE)
 * Used to get the latest status when payment page loads
 */
export async function fetchOrderStatus(odrId: string): Promise<OrderStatus | null> {
  try {
    const supabase = getSupabaseRealtimeClient();
    
    const { data, error } = await supabase
      .from('backup_orders')
      .select('odr_id, odr_status, updated_at')
      .eq('odr_id', odrId)
      .single();

    if (error) {
      return null;
    }

    if (data) {
      return data as OrderStatus;
    }

    return null;
  } catch {
    return null;
  }
}
