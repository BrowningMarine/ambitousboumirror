/**
 * Client-Side Realtime Subscriptions - UNIFIED
 * 
 * This module provides client-side realtime subscriptions with automatic database selection
 * Respects the coreRunningMode configuration
 * IMPORTANT: Only use for realtime subscriptions, NOT for data mutations
 */

'use client';

import { subscribeToOrder as unifiedSubscribe, fetchOrderStatus as unifiedFetch } from './realtime-subscription';
import { BackupOrder } from '../supabase-backup';

// Type for simplified order status
export type OrderStatus = {
  odr_id: string;
  odr_status: string;
  updated_at: string;
};

/**
 * Subscribe to realtime changes for a specific order (CLIENT-SIDE)
 * Uses unified subscription that respects coreRunningMode config
 * Returns unsubscribe function
 */
export function subscribeToOrderChanges(
  odrId: string,
  callback: (order: BackupOrder) => void,
  onError?: (error: Error) => void
): () => void {
  console.log('🎯 [Client] Subscribing to order:', odrId);
  
  let unsubscribeFn: (() => void) | null = null;
  
  // Use unified subscription (async)
  unifiedSubscribe(odrId, (orderUpdate) => {
    console.log('📬 [Client] Received order update:', orderUpdate);
    // Convert to BackupOrder format for backward compatibility
    callback({
      odr_id: orderUpdate.odr_id,
      odr_status: orderUpdate.odr_status,
      updated_at: orderUpdate.updated_at,
    } as BackupOrder);
  }, (mode) => {
    console.log('🔄 [Client] Subscription mode changed to:', mode);
  }).then((subscription) => {
    console.log('✅ [Client] Subscription established, mode:', subscription.mode);
    unsubscribeFn = subscription.unsubscribe;
  }).catch((error) => {
    console.error('❌ [Client] Subscription failed:', error);
    if (onError && error instanceof Error) {
      onError(error);
    }
  });

  // Return unsubscribe function
  return () => {
    console.log('🔌 [Client] Unsubscribing from order:', odrId);
    if (unsubscribeFn) {
      unsubscribeFn();
    }
  };
}

/**
 * Fetch current order status (CLIENT-SIDE)
 * Uses unified fetch that respects coreRunningMode config
 * Used to get the latest status when payment page loads
 */
export async function fetchOrderStatus(odrId: string): Promise<OrderStatus | null> {
  console.log('🔍 [Client] Fetching order status:', odrId);
  
  try {
    const result = await unifiedFetch(odrId);
    
    if (result) {
      console.log('✅ [Client] Order status fetched:', { odrId: result.odr_id, status: result.odr_status });
      return result as OrderStatus;
    }
    
    console.log('⚠️ [Client] Order not found:', odrId);
    return null;
  } catch (error) {
    console.error('❌ [Client] Failed to fetch order status:', error);
    return null;
  }
}
