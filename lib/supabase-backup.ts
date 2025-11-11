/**
 * Supabase Backup Database Client
 * 
 * This module provides database backup functionality using Supabase PostgreSQL
 * When the main Appwrite database is unavailable, orders are stored in Supabase
 * and synced back when the main database recovers.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Environment variables
const SUPABASE_URL = process.env.SUPABASE_BK_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_BK_SERVICE_KEY || '';

// Singleton client
let supabaseClient: SupabaseClient | null = null;

/**
 * Get or create Supabase client
 */
export function getSupabaseClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Configuration missing. Set BK_URL and BK_KEY environment variables.');
  }

  // Validate that we're using service_role key, not anon key
  if (SUPABASE_SERVICE_KEY.includes('eyJ') && SUPABASE_SERVICE_KEY.length > 100) {
    try {
      // Decode JWT to check role
      const parts = SUPABASE_SERVICE_KEY.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
        if (payload.role === 'anon') {
          console.error('❌ CRITICAL: Using anon key instead of service_role key!');
          console.error('Get the service_role key from: Supabase Dashboard → Settings → API');
          throw new Error('Invalid bk key: BK_KEY must be service_role key, not anon key. Check your .env file.');
        }
      }
    } catch (parseError) {
      console.warn('Could not validate BK_KEY format:', parseError);
    }
  }

  if (!supabaseClient) {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
  }

  return supabaseClient;
}

// Database types
export interface MerchantAccountCache {
  id?: string;
  merchant_id: string;
  api_key: string;
  account_name?: string;
  available_balance?: number;
  min_deposit_amount?: number;
  max_deposit_amount?: number;
  min_withdraw_amount?: number;
  max_withdraw_amount?: number;
  deposit_whitelist_ips?: string[];
  withdraw_whitelist_ips?: string[];
  status?: boolean;
  appwrite_doc_id?: string;
  cached_at?: string;
  updated_at?: string;
}

export interface BackupOrder {
  id?: string;
  odr_id: string;
  merchant_odr_id?: string;
  odr_type: 'deposit' | 'withdraw';
  odr_status: string;
  amount: number;
  paid_amount?: number;
  unpaid_amount: number;
  merchant_id: string;
  merchant_account_id?: string;
  
  // Deposit fields
  bank_id?: string;
  bank_name?: string;
  bank_bin_code?: string;
  account_number?: string;
  account_name?: string;
  qr_code?: string;
  
  // Withdraw fields
  bank_code?: string;
  bank_receive_number?: string;
  bank_receive_owner_name?: string;
  bank_receive_name?: string;
  
  // URLs
  url_success?: string;
  url_failed?: string;
  url_canceled?: string;
  url_callback: string;
  
  // Metadata
  created_ip?: string;
  is_suspicious?: boolean;
  last_payment_date?: string;
  created_at?: string;  // Order creation timestamp
  updated_at?: string;  // Last update timestamp
  
  // Sync tracking
  synced_to_appwrite?: boolean;
  appwrite_doc_id?: string;
  sync_attempts?: number;
  last_sync_attempt?: string;
  sync_error?: string;
}

export interface WebhookEventBackup {
  id?: string;
  portal: string;
  odr_id: string;
  amount: number;
  paid_amount: number;
  payment_reference?: string;
  payment_description?: string;
  bank_account_number?: string;
  bank_info?: string;
  webhook_payload: Record<string, unknown>;
  processed?: boolean;
  processing_error?: string;
  processed_at?: string;
}

export interface BankTransactionEntryBackup {
  id?: string;
  portal_id: string;
  portal_transaction_id: string;
  odr_id?: string;
  bank_id?: string;
  amount: number;
  transaction_type?: 'credit' | 'debit';
  balance_after?: number;
  bank_account_number?: string;
  bank_name?: string;
  status?: 'pending' | 'processed' | 'available' | 'failed' | 'unlinked';
  notes?: string;
  processed_at?: string;
  synced_to_appwrite?: boolean;
  appwrite_doc_id?: string;
  sync_attempts?: number;
  last_sync_attempt?: string;
  sync_error?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SyncLog {
  id?: string;
  sync_type: 'order_sync' | 'merchant_cache_update' | 'full_sync';
  status: 'started' | 'completed' | 'failed' | 'partial';
  total_records?: number;
  synced_records?: number;
  failed_records?: number;
  skipped_records?: number;
  error_message?: string;
  details?: Record<string, unknown>;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
}

/**
 * Merchant Account Cache Operations
 */
export class MerchantAccountCacheService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = getSupabaseClient();
  }

  /**
   * Cache merchant account data
   */
  async cacheMerchantAccount(data: MerchantAccountCache): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await this.supabase
        .from('merchant_accounts_cache')
        .upsert({
          merchant_id: data.merchant_id,
          api_key: data.api_key,
          account_name: data.account_name,
          available_balance: data.available_balance || 0,
          min_deposit_amount: data.min_deposit_amount || 0,
          max_deposit_amount: data.max_deposit_amount || 0,
          min_withdraw_amount: data.min_withdraw_amount || 0,
          max_withdraw_amount: data.max_withdraw_amount || 0,
          deposit_whitelist_ips: data.deposit_whitelist_ips || [],
          withdraw_whitelist_ips: data.withdraw_whitelist_ips || [],
          status: data.status !== false,
          appwrite_doc_id: data.appwrite_doc_id,
          cached_at: new Date().toISOString()
        }, {
          onConflict: 'merchant_id'
        });

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Failed to cache merchant account:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get merchant account by API key
   * Supports both plain API key and hash comparison
   */
  async getMerchantByApiKey(apiKey: string, merchantId: string): Promise<MerchantAccountCache | null> {
    try {
      // First try exact match (for backward compatibility with plain keys)
      let { data, error } = await this.supabase
        .from('merchant_accounts_cache')
        .select('*')
        .eq('api_key', apiKey)
        .eq('merchant_id', merchantId)
        .eq('status', true)
        .single();

      // If not found, try hash comparison
      if (error || !data) {
        const crypto = await import('crypto');
        const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
        const hashResult = await this.supabase
          .from('merchant_accounts_cache')
          .select('*')
          .eq('api_key', apiKeyHash)
          .eq('merchant_id', merchantId)
          .eq('status', true)
          .single();
        
        data = hashResult.data;
        error = hashResult.error;
      }

      if (error || !data) {
        console.log('❌ Merchant not found in cache');
        return null;
      }
      
      return data as MerchantAccountCache;
    } catch (error) {
      console.error('❌ Failed to get merchant from cache:', error);
      return null;
    }
  }

  /**
   * Update merchant balance in cache
   */
  async updateBalance(merchantId: string, newBalance: number): Promise<{ success: boolean }> {
    try {
      const { error } = await this.supabase
        .from('merchant_accounts_cache')
        .update({ available_balance: newBalance })
        .eq('merchant_id', merchantId);

      return { success: !error };
    } catch (error) {
      console.error('Failed to update merchant balance in cache:', error);
      return { success: false };
    }
  }
}

/**
 * Backup Orders Operations
 */
export class BackupOrderService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = getSupabaseClient();
  }

  /**
   * Create backup order
   */
  async createBackupOrder(order: BackupOrder): Promise<{ success: boolean; orderId?: string; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('backup_orders')
        .insert({
          odr_id: order.odr_id,
          merchant_odr_id: order.merchant_odr_id,
          odr_type: order.odr_type,
          odr_status: order.odr_status,
          amount: order.amount,
          paid_amount: order.paid_amount || 0,
          unpaid_amount: order.unpaid_amount,
          merchant_id: order.merchant_id,
          merchant_account_id: order.merchant_account_id,
          bank_id: order.bank_id,
          bank_name: order.bank_name,
          bank_bin_code: order.bank_bin_code,
          account_number: order.account_number,
          account_name: order.account_name,
          qr_code: order.qr_code,
          bank_code: order.bank_code,
          bank_receive_number: order.bank_receive_number,
          bank_receive_owner_name: order.bank_receive_owner_name,
          bank_receive_name: order.bank_receive_name,
          url_success: order.url_success,
          url_failed: order.url_failed,
          url_canceled: order.url_canceled,
          url_callback: order.url_callback,
          created_ip: order.created_ip,
          is_suspicious: order.is_suspicious || false,
          last_payment_date: order.last_payment_date || new Date().toISOString()
        })
        .select('id')
        .single();

      if (error) throw error;

      return {
        success: true,
        orderId: data?.id
      };
    } catch (error: unknown) {
      console.error('Failed to create backup order:', error);
      
      // Handle PostgreSQL duplicate key error
      const pgError = error as { code?: string; details?: string; message?: string };
      if (pgError?.code === '23505') {
        const match = pgError.details?.match(/Key \((.*?)\)=\((.*?)\) already exists/);
        if (match) {
          return {
            success: false,
            error: `Duplicate ${match[1]}: ${match[2]} already exists`
          };
        }
        return {
          success: false,
          error: 'Duplicate order: This order ID already exists'
        };
      }
      
      // Handle other errors
      return {
        success: false,
        error: pgError?.message || pgError?.details || (error instanceof Error ? error.message : 'Unknown error')
      };
    }
  }

  /**
   * Get backup order by odrId
   */
  async getBackupOrder(odrId: string): Promise<BackupOrder | null> {
    try {
      const { data, error } = await this.supabase
        .from('backup_orders')
        .select('*')
        .eq('odr_id', odrId)
        .single();

      if (error || !data) return null;

      // Trim whitespace from status
      if (data.odr_status) {
        data.odr_status = data.odr_status.trim();
      }

      return data as BackupOrder;
    } catch (error) {
      console.error('Failed to get backup order:', error);
      return null;
    }
  }

  /**
   * Get unsynced orders with optional filters
   */
  async getUnsyncedOrders(
    limit: number = 100,
    filters?: {
      orderIds?: string[];
      merchantOrderIds?: string[];
      orderType?: 'deposit' | 'withdraw';
      orderStatus?: string;
      merchantId?: string;
      createdAfter?: string;
      createdBefore?: string;
    }
  ): Promise<BackupOrder[]> {
    try {
      let query = this.supabase
        .from('backup_orders')
        .select('*')
        .eq('synced_to_appwrite', false);

      // Apply filters
      if (filters) {
        if (filters.orderIds && filters.orderIds.length > 0) {
          query = query.in('odr_id', filters.orderIds);
        }
        if (filters.merchantOrderIds && filters.merchantOrderIds.length > 0) {
          query = query.in('merchant_odr_id', filters.merchantOrderIds);
        }
        if (filters.orderType) {
          query = query.eq('odr_type', filters.orderType);
        }
        if (filters.orderStatus) {
          query = query.eq('odr_status', filters.orderStatus);
        }
        if (filters.merchantId) {
          query = query.eq('merchant_id', filters.merchantId);
        }
        if (filters.createdAfter) {
          query = query.gte('created_at', filters.createdAfter);
        }
        if (filters.createdBefore) {
          query = query.lte('created_at', filters.createdBefore);
        }
      }

      const { data, error } = await query
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) throw error;

      // Trim whitespace from status for all orders
      const orders = (data || []) as BackupOrder[];
      orders.forEach(order => {
        if (order.odr_status) {
          order.odr_status = order.odr_status.trim();
        }
      });

      return orders;
    } catch (error) {
      console.error('Failed to get unsynced orders:', error);
      return [];
    }
  }

  /**
   * Mark order as synced
   */
  async markOrderSynced(odrId: string, appwriteDocId: string): Promise<{ success: boolean }> {
    try {
      const { error } = await this.supabase
        .from('backup_orders')
        .update({
          synced_to_appwrite: true,
          appwrite_doc_id: appwriteDocId,
          last_sync_attempt: new Date().toISOString()
        })
        .eq('odr_id', odrId);

      return { success: !error };
    } catch (error) {
      console.error('Failed to mark order as synced:', error);
      return { success: false };
    }
  }

  /**
   * Update order status
   */
  async updateOrderStatus(odrId: string, status: string, paidAmount?: number): Promise<{ success: boolean }> {
    try {
      const updateData: Record<string, unknown> = {
        odr_status: status
      };

      if (paidAmount !== undefined) {
        updateData.paid_amount = paidAmount;
        updateData.unpaid_amount = 0;
      }

      const { error } = await this.supabase
        .from('backup_orders')
        .update(updateData)
        .eq('odr_id', odrId);

      return { success: !error };
    } catch (error) {
      console.error('Failed to update order status:', error);
      return { success: false };
    }
  }

  /**
   * Record sync failure
   */
  async recordSyncFailure(odrId: string, errorMessage: string): Promise<{ success: boolean }> {
    try {
      const { error } = await this.supabase
        .from('backup_orders')
        .update({
          sync_attempts: this.supabase.rpc('increment_sync_attempts', { odr_id: odrId }),
          last_sync_attempt: new Date().toISOString(),
          sync_error: errorMessage
        })
        .eq('odr_id', odrId);

      return { success: !error };
    } catch (error) {
      console.error('Failed to record sync failure:', error);
      return { success: false };
    }
  }
}

/**
 * Bank Transaction Entry Backup Operations
 */
export class BankTransactionEntryService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = getSupabaseClient();
  }

  /**
   * Create bank transaction entry in Supabase
   */
  async createBankTransactionEntry(entry: BankTransactionEntryBackup): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('bank_transaction_entries_backup')
        .insert({
          portal_id: entry.portal_id,
          portal_transaction_id: entry.portal_transaction_id,
          odr_id: entry.odr_id,
          bank_id: entry.bank_id,
          amount: entry.amount,
          transaction_type: entry.transaction_type,
          balance_after: entry.balance_after,
          bank_account_number: entry.bank_account_number,
          bank_name: entry.bank_name,
          status: entry.status || 'pending',
          notes: entry.notes
        })
        .select('id')
        .single();

      if (error) {
        // Check if duplicate
        if (error.code === '23505') { // Unique constraint violation
          return { success: false, error: 'Duplicate transaction' };
        }
        throw error;
      }

      return { success: true, id: data?.id };
    } catch (error) {
      console.error('Failed to create bank transaction entry:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Update bank transaction entry status
   */
  async updateBankTransactionEntryStatus(
    entryId: string,
    status: 'pending' | 'processed' | 'available' | 'failed' | 'unlinked',
    notes?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const updateData: Record<string, unknown> = { status };
      if (notes) updateData.notes = notes;
      if (status === 'processed' || status === 'available') {
        updateData.processed_at = new Date().toISOString();
      }

      const { error } = await this.supabase
        .from('bank_transaction_entries_backup')
        .update(updateData)
        .eq('id', entryId);

      if (error) throw error;

      return { success: true };
    } catch (error) {
      console.error('Failed to update bank transaction entry status:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Check if transaction already exists (duplicate check)
   */
  async checkDuplicateTransaction(portalId: string, portalTransactionId: string): Promise<boolean> {
    try {
      const { data, error } = await this.supabase
        .from('bank_transaction_entries_backup')
        .select('id')
        .eq('portal_id', portalId)
        .eq('portal_transaction_id', portalTransactionId)
        .single();

      return !!data && !error;
    } catch {
      return false;
    }
  }

  /**
   * Get bank transaction entries by order ID
   */
  async getEntriesByOrderId(odrId: string): Promise<BankTransactionEntryBackup[]> {
    try {
      const { data, error } = await this.supabase
        .from('bank_transaction_entries_backup')
        .select('*')
        .eq('odr_id', odrId)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return (data || []) as BankTransactionEntryBackup[];
    } catch (error) {
      console.error('Failed to get bank transaction entries:', error);
      return [];
    }
  }

  /**
   * Get unsynced bank transaction entries
   */
  async getUnsyncedEntries(limit: number = 100): Promise<BankTransactionEntryBackup[]> {
    try {
      const { data, error } = await this.supabase
        .from('bank_transaction_entries_backup')
        .select('*')
        .eq('synced_to_appwrite', false)
        .order('created_at', { ascending: true })
        .limit(limit);

      if (error) throw error;

      return (data || []) as BankTransactionEntryBackup[];
    } catch (error) {
      console.error('Failed to get unsynced entries:', error);
      return [];
    }
  }

  /**
   * Get unsynced bank transaction entries by order IDs
   */
  async getUnsyncedEntriesByOrderIds(orderIds: string[]): Promise<BankTransactionEntryBackup[]> {
    try {
      if (orderIds.length === 0) return [];

      const { data, error } = await this.supabase
        .from('bank_transaction_entries_backup')
        .select('*')
        .in('odr_id', orderIds)
        .eq('synced_to_appwrite', false)
        .order('created_at', { ascending: true });

      if (error) throw error;

      return (data || []) as BankTransactionEntryBackup[];
    } catch (error) {
      console.error('Failed to get unsynced entries by order IDs:', error);
      return [];
    }
  }

  /**
   * Mark bank transaction entry as synced to Appwrite
   */
  async markEntrySynced(entryId: string, appwriteDocId: string): Promise<{ success: boolean }> {
    try {
      const { error } = await this.supabase
        .from('bank_transaction_entries_backup')
        .update({
          synced_to_appwrite: true,
          appwrite_doc_id: appwriteDocId,
          last_sync_attempt: new Date().toISOString()
        })
        .eq('id', entryId);

      return { success: !error };
    } catch (error) {
      console.error('Failed to mark entry as synced:', error);
      return { success: false };
    }
  }

  /**
   * Record sync failure for bank transaction entry
   */
  async recordEntrySyncFailure(entryId: string, errorMessage: string): Promise<{ success: boolean }> {
    try {
      const { error } = await this.supabase
        .from('bank_transaction_entries_backup')
        .update({
          last_sync_attempt: new Date().toISOString(),
          sync_error: errorMessage
        })
        .eq('id', entryId);

      return { success: !error };
    } catch (error) {
      console.error('Failed to record entry sync failure:', error);
      return { success: false };
    }
  }
}

/**
 * Webhook Event Backup Operations
 */
export class WebhookEventBackupService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = getSupabaseClient();
  }

  /**
   * Store webhook event
   */
  async storeWebhookEvent(event: WebhookEventBackup): Promise<{ success: boolean }> {
    try {
      const { error } = await this.supabase
        .from('webhook_events_backup')
        .insert({
          portal: event.portal,
          odr_id: event.odr_id,
          amount: event.amount,
          paid_amount: event.paid_amount,
          payment_reference: event.payment_reference,
          payment_description: event.payment_description,
          bank_account_number: event.bank_account_number,
          bank_info: event.bank_info,
          webhook_payload: event.webhook_payload
        });

      return { success: !error };
    } catch (error) {
      console.error('Failed to store webhook event:', error);
      return { success: false };
    }
  }

  /**
   * Get unprocessed webhook events
   */
  async getUnprocessedEvents(limit: number = 100): Promise<WebhookEventBackup[]> {
    try {
      const { data, error } = await this.supabase
        .from('webhook_events_backup')
        .select('*')
        .eq('processed', false)
        .order('received_at', { ascending: true })
        .limit(limit);

      if (error) throw error;

      return (data || []) as WebhookEventBackup[];
    } catch (error) {
      console.error('Failed to get unprocessed events:', error);
      return [];
    }
  }

  /**
   * Mark event as processed
   */
  async markEventProcessed(eventId: string): Promise<{ success: boolean }> {
    try {
      const { error } = await this.supabase
        .from('webhook_events_backup')
        .update({
          processed: true,
          processed_at: new Date().toISOString()
        })
        .eq('id', eventId);

      return { success: !error };
    } catch (error) {
      console.error('Failed to mark event as processed:', error);
      return { success: false };
    }
  }
}

/**
 * Sync Log Operations
 */
export class SyncLogService {
  private supabase: SupabaseClient;

  constructor() {
    this.supabase = getSupabaseClient();
  }

  /**
   * Create sync log
   */
  async createSyncLog(log: SyncLog): Promise<{ success: boolean; logId?: string }> {
    try {
      const { data, error } = await this.supabase
        .from('sync_logs')
        .insert({
          sync_type: log.sync_type,
          status: log.status,
          total_records: log.total_records || 0,
          synced_records: log.synced_records || 0,
          failed_records: log.failed_records || 0,
          skipped_records: log.skipped_records || 0,
          error_message: log.error_message,
          details: log.details,
          started_at: log.started_at || new Date().toISOString()
        })
        .select('id')
        .single();

      if (error) throw error;

      return {
        success: true,
        logId: data?.id
      };
    } catch (error) {
      console.error('Failed to create sync log:', error);
      return { success: false };
    }
  }

  /**
   * Update sync log
   */
  async updateSyncLog(logId: string, updates: Partial<SyncLog>): Promise<{ success: boolean }> {
    try {
      const updateData: Record<string, unknown> = {};

      if (updates.status) updateData.status = updates.status;
      if (updates.synced_records !== undefined) updateData.synced_records = updates.synced_records;
      if (updates.failed_records !== undefined) updateData.failed_records = updates.failed_records;
      if (updates.skipped_records !== undefined) updateData.skipped_records = updates.skipped_records;
      if (updates.error_message) updateData.error_message = updates.error_message;
      if (updates.details) updateData.details = updates.details;

      if (updates.status === 'completed' || updates.status === 'failed' || updates.status === 'partial') {
        updateData.completed_at = new Date().toISOString();
        if (updates.duration_ms) updateData.duration_ms = updates.duration_ms;
      }

      const { error } = await this.supabase
        .from('sync_logs')
        .update(updateData)
        .eq('id', logId);

      return { success: !error };
    } catch (error) {
      console.error('Failed to update sync log:', error);
      return { success: false };
    }
  }
}

// Export service instances
export const merchantCacheService = new MerchantAccountCacheService();
export const backupOrderService = new BackupOrderService();
export const webhookBackupService = new WebhookEventBackupService();
export const syncLogService = new SyncLogService();

/**
 * Subscribe to Supabase realtime changes for a specific order
 * Returns unsubscribe function
 */
export function subscribeToOrderChanges(
  odrId: string,
  callback: (order: BackupOrder) => void
): () => void {
  const supabase = getSupabaseClient();
  
  const channel = supabase
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
    .subscribe();

  // Return unsubscribe function
  return () => {
    supabase.removeChannel(channel);
  };
}
