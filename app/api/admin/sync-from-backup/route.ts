/**
 * Sync API - Restore data from Supabase backup to Appwrite
 * 
 * This endpoint syncs backup data from Supabase back to Appwrite after database recovery.
 * It handles:
 * - Bank transaction entries
 * - Orders (backup_orders)
 * - Merchant account cache updates
 * 
 * Usage: POST /api/admin/sync-from-backup
 * Headers: 
 *   - x-api-key: INTERNAL_API_SECRET (for security)
 *   - Content-Type: application/json
 * 
 * Body:
 * {
 *   "syncType": "all" | "bank_entries" | "orders" | "test",
 *   "limit": 100,  // Optional, default 100
 *   "dryRun": false  // Optional, default false (set true to test without syncing)
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { 
  BankTransactionEntryService, 
  BackupOrderService,
  SyncLogService 
} from '@/lib/supabase-backup';
import {
  createBankTransactionEntry,
  BankTransactionEntryData
} from '@/lib/actions/bankTransacionEntry.action';
import { createAdminClient } from '@/lib/appwrite/appwrite.actions';
import { appwriteConfig } from '@/lib/appwrite/appwrite-config';
import { ID } from 'appwrite';
import { log } from '@/lib/logger';

// Security check
function verifyAdminAccess(request: NextRequest): boolean {
  const apiKey = request.headers.get('x-api-key');
  const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET;
  
  if (!INTERNAL_API_SECRET) {
    console.error('INTERNAL_API_SECRET not configured');
    return false;
  }
  
  return apiKey === INTERNAL_API_SECRET;
}

interface SyncRequest {
  syncType: 'all' | 'bank_entries' | 'orders' | 'test';
  limit?: number;
  dryRun?: boolean;
  filters?: {
    orderIds?: string[];
    merchantOrderIds?: string[];
    orderType?: 'deposit' | 'withdraw';
    orderStatus?: 'pending' | 'processing' | 'completed' | 'failed';
    merchantId?: string;
    createdAfter?: string;
    createdBefore?: string;
  };
}

interface SyncResult {
  success: boolean;
  syncType: string;
  summary: {
    totalProcessed: number;
    synced: number;
    failed: number;
    skipped: number;
  };
  details: {
    bankEntries?: {
      processed: number;
      synced: number;
      failed: number;
      errors: string[];
    };
    orders?: {
      processed: number;
      synced: number;
      failed: number;
      errors: string[];
    };
  };
  filters?: {
    orderIds?: string[];
    merchantOrderIds?: string[];
    orderType?: 'deposit' | 'withdraw';
    orderStatus?: string;
    merchantId?: string;
    createdAfter?: string;
    createdBefore?: string;
  };
  dryRun: boolean;
  duration: number;
  timestamp: string;
}

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // 1. Security check
    if (!verifyAdminAccess(request)) {
      await log.warn('Unauthorized sync attempt', {
        ip: request.headers.get('x-forwarded-for') || 'unknown',
        userAgent: request.headers.get('user-agent')
      });
      
      return NextResponse.json(
        { success: false, message: 'Unauthorized. Valid x-api-key required.' },
        { status: 401 }
      );
    }

    // 2. Parse request
    const body = await request.json() as SyncRequest;
    const { syncType = 'all', limit = 100, dryRun = false, filters } = body;

    if (!['all', 'bank_entries', 'orders', 'test'].includes(syncType)) {
      return NextResponse.json(
        { success: false, message: 'Invalid syncType. Must be: all, bank_entries, orders, or test' },
        { status: 400 }
      );
    }

    await log.info('Sync operation started', {
      syncType,
      limit,
      dryRun,
      filters: filters || {},
      timestamp: new Date().toISOString()
    });

    // 3. Initialize services
    const bankEntryService = new BankTransactionEntryService();
    const backupOrderService = new BackupOrderService();
    const syncLogService = new SyncLogService();

    // 4. Create sync log
    const syncLogResult = await syncLogService.createSyncLog({
      sync_type: syncType === 'all' ? 'full_sync' : 'order_sync',
      status: 'started',
      details: { dryRun, limit }
    });

    const syncLogId = syncLogResult.logId || '';

    // 5. Initialize result
    const result: SyncResult = {
      success: true,
      syncType,
      summary: {
        totalProcessed: 0,
        synced: 0,
        failed: 0,
        skipped: 0
      },
      details: {},
      filters: filters || undefined,
      dryRun,
      duration: 0,
      timestamp: new Date().toISOString()
    };

    // 6. Test mode - just check connectivity
    if (syncType === 'test') {
      try {
        const { database } = await createAdminClient();
        
        // Test Appwrite connection
        const testDoc = await database.listDocuments(
          appwriteConfig.databaseId,
          appwriteConfig.accountsCollectionId,
          []
        );
        
        // Test Supabase connection
        const testEntries = await bankEntryService.getUnsyncedEntries(1);
        
        result.details = {
          bankEntries: {
            processed: 0,
            synced: 0,
            failed: 0,
            errors: []
          }
        };
        
        await log.info('Sync test completed successfully', {
          appwriteConnected: !!testDoc,
          supabaseConnected: Array.isArray(testEntries)
        });
        
        return NextResponse.json({
          ...result,
          message: 'Test successful. Both Appwrite and Supabase are accessible.',
          appwriteStatus: 'connected',
          supabaseStatus: 'connected',
          duration: Date.now() - startTime
        });
        
      } catch (error) {
        await log.error('Sync test failed', error instanceof Error ? error : new Error(String(error)));
        
        return NextResponse.json({
          success: false,
          message: 'Test failed. Check database connections.',
          error: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
      }
    }

    // 7. Sync bank transaction entries
    if (syncType === 'all' || syncType === 'bank_entries') {
      const bankEntriesResult = await syncBankEntries(
        bankEntryService,
        limit,
        dryRun
      );
      
      result.details.bankEntries = bankEntriesResult;
      result.summary.totalProcessed += bankEntriesResult.processed;
      result.summary.synced += bankEntriesResult.synced;
      result.summary.failed += bankEntriesResult.failed;
    }

    // 8. Sync orders
    if (syncType === 'all' || syncType === 'orders') {
      const ordersResult = await syncOrders(
        backupOrderService,
        limit,
        dryRun,
        filters
      );
      
      result.details.orders = ordersResult;
      result.summary.totalProcessed += ordersResult.processed;
      result.summary.synced += ordersResult.synced;
      result.summary.failed += ordersResult.failed;

      // If orders were synced, also sync their related bank entries
      if (ordersResult.syncedOrderIds && ordersResult.syncedOrderIds.length > 0) {
        await log.info('Syncing related bank entries for orders', {
          orderCount: ordersResult.syncedOrderIds.length
        });

        const relatedEntriesResult = await syncBankEntriesByOrderIds(
          bankEntryService,
          ordersResult.syncedOrderIds,
          dryRun
        );

        // Add to bank entries result or create if doesn't exist
        if (result.details.bankEntries) {
          result.details.bankEntries.processed += relatedEntriesResult.processed;
          result.details.bankEntries.synced += relatedEntriesResult.synced;
          result.details.bankEntries.failed += relatedEntriesResult.failed;
          result.details.bankEntries.errors.push(...relatedEntriesResult.errors);
        } else {
          result.details.bankEntries = relatedEntriesResult;
        }

        result.summary.totalProcessed += relatedEntriesResult.processed;
        result.summary.synced += relatedEntriesResult.synced;
        result.summary.failed += relatedEntriesResult.failed;

        await log.info('Related bank entries synced', {
          processed: relatedEntriesResult.processed,
          synced: relatedEntriesResult.synced,
          failed: relatedEntriesResult.failed
        });
      }
    }

    // 9. Update sync log
    result.duration = Date.now() - startTime;
    result.success = result.summary.failed === 0;

    if (syncLogId) {
      await syncLogService.updateSyncLog(syncLogId, {
        status: result.success ? 'completed' : 'partial',
        synced_records: result.summary.synced,
        failed_records: result.summary.failed,
        skipped_records: result.summary.skipped,
        duration_ms: result.duration,
        details: result.details
      });
    }

    await log.info('Sync operation completed', {
      syncType: result.syncType,
      totalProcessed: result.summary.totalProcessed,
      synced: result.summary.synced,
      failed: result.summary.failed,
      duration: result.duration
    });

    return NextResponse.json(result);

  } catch (error) {
    const duration = Date.now() - startTime;
    
    await log.error('Sync operation failed', error instanceof Error ? error : new Error(String(error)), {
      duration,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: false,
      message: 'Sync operation failed',
      error: error instanceof Error ? error.message : String(error),
      duration
    }, { status: 500 });
  }
}

/**
 * Sync bank transaction entries from Supabase to Appwrite - FAST BATCH PROCESSING
 */
async function syncBankEntries(
  service: BankTransactionEntryService,
  limit: number,
  dryRun: boolean
) {
  const result = {
    processed: 0,
    synced: 0,
    failed: 0,
    errors: [] as string[]
  };

  try {
    // Get unsynced entries
    const entries = await service.getUnsyncedEntries(limit);
    result.processed = entries.length;

    if (entries.length === 0) {
      await log.info('No unsynced bank entries found');
      return result;
    }

    await log.info(`Found ${entries.length} unsynced bank entries`);

    // Process entries in batches of 10 (parallel processing)
    const BATCH_SIZE = 10;
    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);
      
      await Promise.all(
        batch.map(async (entry) => {
          try {
            if (dryRun) {
              await log.info('DRY RUN: Would sync bank entry', {
                id: entry.id,
                portalTransactionId: entry.portal_transaction_id,
                odrId: entry.odr_id,
                amount: entry.amount
              });
              result.synced++;
              return;
            }

            // Create entry in Appwrite
            const bankTransactionData: BankTransactionEntryData = {
              portalId: entry.portal_id,
              portalTransactionId: entry.portal_transaction_id,
              odrId: entry.odr_id || 'UNKNOWN',
              bankId: entry.bank_id,
              bankName: entry.bank_name || '',
              bankAccountNumber: entry.bank_account_number || '',
              amount: entry.amount,
              transactionType: entry.transaction_type || 'credit',
              balanceAfter: entry.balance_after || 0,
              transactionDate: entry.created_at || new Date().toISOString(),
              rawPayload: '',
              status: entry.status || 'pending',
              notes: `${entry.notes || ''} | Synced from Supabase backup on ${new Date().toISOString()}`
            };

            const createResult = await createBankTransactionEntry(bankTransactionData);

            if (createResult.success && createResult.entry) {
              // Mark as synced in Supabase
              await service.markEntrySynced(entry.id!, createResult.entry.$id);
              result.synced++;
            } else {
              throw new Error(createResult.message || 'Failed to create entry in Appwrite');
            }

          } catch (error) {
            const errorMsg = `Entry ${entry.id}: ${error instanceof Error ? error.message : String(error)}`;
            result.errors.push(errorMsg);
            result.failed++;
            
            // Record sync failure in Supabase
            await service.recordEntrySyncFailure(
              entry.id!,
              error instanceof Error ? error.message : String(error)
            );
          }
        })
      );

      // Log progress every 50 entries
      if ((i + BATCH_SIZE) % 50 === 0 || (i + BATCH_SIZE) >= entries.length) {
        await log.info('Bank entries sync progress', {
          processed: Math.min(i + BATCH_SIZE, entries.length),
          total: entries.length,
          synced: result.synced,
          failed: result.failed
        });
      }
    }

    await log.info('All bank entries processed', {
      total: result.processed,
      synced: result.synced,
      failed: result.failed
    });

  } catch (error) {
    result.errors.push(`Failed to fetch entries: ${error instanceof Error ? error.message : String(error)}`);
    await log.error('Failed to fetch unsynced entries', error instanceof Error ? error : new Error(String(error)));
  }

  return result;
}

/**
 * Sync bank transaction entries for specific order IDs
 */
async function syncBankEntriesByOrderIds(
  service: BankTransactionEntryService,
  orderIds: string[],
  dryRun: boolean
) {
  const result = {
    processed: 0,
    synced: 0,
    failed: 0,
    errors: [] as string[]
  };

  try {
    // Get unsynced entries for these order IDs
    const entries = await service.getUnsyncedEntriesByOrderIds(orderIds);
    result.processed = entries.length;

    if (entries.length === 0) {
      await log.info('No unsynced bank entries found for orders', { orderIds });
      return result;
    }

    await log.info(`Found ${entries.length} unsynced bank entries for orders`, { orderCount: orderIds.length });

    // Process each entry
    for (const entry of entries) {
      try {
        if (dryRun) {
          // Just log what would be synced
          await log.info('DRY RUN: Would sync bank entry', {
            id: entry.id,
            portalTransactionId: entry.portal_transaction_id,
            odrId: entry.odr_id,
            amount: entry.amount
          });
          result.synced++;
          continue;
        }

        // Create entry in Appwrite
        const bankTransactionData: BankTransactionEntryData = {
          portalId: entry.portal_id,
          portalTransactionId: entry.portal_transaction_id,
          odrId: entry.odr_id || 'UNKNOWN',
          bankId: entry.bank_id,
          bankName: entry.bank_name || '',
          bankAccountNumber: entry.bank_account_number || '',
          amount: entry.amount,
          transactionType: entry.transaction_type || 'credit',
          balanceAfter: entry.balance_after || 0,
          transactionDate: entry.created_at || new Date().toISOString(),
          rawPayload: '',
          status: entry.status || 'pending',
          notes: `${entry.notes || ''} | Synced from Supabase backup on ${new Date().toISOString()}`
        };

        const createResult = await createBankTransactionEntry(bankTransactionData);

        if (createResult.success && createResult.entry) {
          // Mark as synced in Supabase
          await service.markEntrySynced(entry.id!, createResult.entry.$id);
          
          await log.info('Bank entry synced successfully', {
            supabaseId: entry.id,
            appwriteId: createResult.entry.$id
          });
          result.synced++;
        } else {
          throw new Error(createResult.message || 'Failed to create entry in Appwrite');
        }

      } catch (error) {
        const errorMsg = `Entry ${entry.id}: ${error instanceof Error ? error.message : String(error)}`;
        result.errors.push(errorMsg);
        result.failed++;
        
        // Record sync failure in Supabase
        await service.recordEntrySyncFailure(
          entry.id!,
          error instanceof Error ? error.message : String(error)
        );
        
        await log.error('Failed to sync bank entry', error instanceof Error ? error : new Error(String(error)), {
          entryId: entry.id,
          portalTransactionId: entry.portal_transaction_id
        });
      }
    }

  } catch (error) {
    result.errors.push(`Failed to fetch entries: ${error instanceof Error ? error.message : String(error)}`);
    await log.error('Failed to fetch unsynced entries', error instanceof Error ? error : new Error(String(error)));
  }

  return result;
}

/**
 * Sync orders from Supabase to Appwrite - FAST BATCH PROCESSING
 */
async function syncOrders(
  service: BackupOrderService,
  limit: number,
  dryRun: boolean,
  filters?: {
    orderIds?: string[];
    merchantOrderIds?: string[];
    orderType?: 'deposit' | 'withdraw';
    orderStatus?: string;
    merchantId?: string;
    createdAfter?: string;
    createdBefore?: string;
  }
) {
  const result = {
    processed: 0,
    synced: 0,
    failed: 0,
    errors: [] as string[],
    syncedOrderIds: [] as string[]
  };

  try {
    // Get unsynced orders with filters
    const orders = await service.getUnsyncedOrders(limit, filters);
    result.processed = orders.length;

    if (orders.length === 0) {
      await log.info('No unsynced orders found', { filters });
      return result;
    }

    await log.info(`Found ${orders.length} unsynced orders`, { filters });

    // Get database connection once
    const { database } = await createAdminClient();

    // Build merchant ID to account document ID cache
    const merchantIds = [...new Set(orders.map(o => o.merchant_id))];
    const accountCache = new Map<string, string>();

    await log.info('Building account cache', { merchantCount: merchantIds.length });

    // Fetch all merchant accounts in parallel (batch of 10)
    const BATCH_SIZE = 10;
    for (let i = 0; i < merchantIds.length; i += BATCH_SIZE) {
      const batch = merchantIds.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (merchantId) => {
          try {
            const accounts = await database.listDocuments(
              appwriteConfig.databaseId,
              appwriteConfig.accountsCollectionId,
              [`equal("accountId", "${merchantId}")`]
            );
            if (accounts.documents.length > 0) {
              accountCache.set(merchantId, accounts.documents[0].$id);
            }
          } catch (error) {
            await log.error('Failed to fetch account', error instanceof Error ? error : new Error(String(error)), {
              merchantId
            });
          }
        })
      );
    }

    await log.info('Account cache built', { cached: accountCache.size });

    // Process orders in batches of 5 (parallel processing)
    const PROCESS_BATCH_SIZE = 5;
    for (let i = 0; i < orders.length; i += PROCESS_BATCH_SIZE) {
      const batch = orders.slice(i, i + PROCESS_BATCH_SIZE);
      
      await Promise.all(
        batch.map(async (order) => {
          try {
            if (dryRun) {
              await log.info('DRY RUN: Would sync order', {
                odrId: order.odr_id,
                amount: order.amount,
                status: order.odr_status,
                merchantId: order.merchant_id
              });
              result.synced++;
              result.syncedOrderIds.push(order.odr_id);
              return;
            }

            // Get account document ID based on order type
            let accountDocumentId: string | undefined;
            
            if (order.odr_type === 'deposit') {
              // For deposit: use positiveAccount (merchant receives money)
              accountDocumentId = accountCache.get(order.merchant_id);
            } else if (order.odr_type === 'withdraw') {
              // For withdraw: use negativeAccount (merchant sends money)
              accountDocumentId = accountCache.get(order.merchant_id);
            }

            if (!accountDocumentId) {
              throw new Error(`Account document not found for merchant: ${order.merchant_id}`);
            }

            // Build order data with correct account relationship
            const orderData = {
              odrId: order.odr_id,
              merchantOrdId: order.merchant_odr_id || '',
              odrType: order.odr_type,
              odrStatus: order.odr_status,
              amount: order.amount,
              paidAmount: order.paid_amount || 0,
              unPaidAmount: order.unpaid_amount,
              positiveAccount: order.odr_type === 'deposit' ? order.merchant_id : '',
              negativeAccount: order.odr_type === 'withdraw' ? order.merchant_id : '',
              bankId: order.bank_id || '',
              qrCode: order.qr_code || null,
              bankCode: order.bank_code || '',
              bankReceiveNumber: order.bank_receive_number || '',
              bankReceiveOwnerName: order.bank_receive_owner_name || '',
              bankReceiveName: order.bank_receive_name || '',
              urlSuccess: order.url_success || '',
              urlFailed: order.url_failed || '',
              urlCanceled: order.url_canceled || '',
              urlCallBack: order.url_callback,
              createdIp: order.created_ip || 'sync-from-backup',
              isSuspicious: order.is_suspicious || false,
              lastPaymentDate: order.last_payment_date || new Date().toISOString(),
              account: accountDocumentId // Correct account document ID
            };

            const createdOrder = await database.createDocument(
              appwriteConfig.databaseId,
              appwriteConfig.odrtransCollectionId,
              ID.unique(),
              orderData
            );

            // Mark as synced
            await service.markOrderSynced(order.odr_id, createdOrder.$id);
            
            result.synced++;
            result.syncedOrderIds.push(order.odr_id);

          } catch (error) {
            const errorMsg = `Order ${order.odr_id}: ${error instanceof Error ? error.message : String(error)}`;
            result.errors.push(errorMsg);
            result.failed++;
            
            // Record sync failure
            await service.recordSyncFailure(
              order.odr_id,
              error instanceof Error ? error.message : String(error)
            );
          }
        })
      );

      // Log progress every batch
      if ((i + PROCESS_BATCH_SIZE) % 50 === 0 || (i + PROCESS_BATCH_SIZE) >= orders.length) {
        await log.info('Sync progress', {
          processed: Math.min(i + PROCESS_BATCH_SIZE, orders.length),
          total: orders.length,
          synced: result.synced,
          failed: result.failed
        });
      }
    }

    await log.info('All orders processed', {
      total: result.processed,
      synced: result.synced,
      failed: result.failed
    });

  } catch (error) {
    result.errors.push(`Failed to fetch orders: ${error instanceof Error ? error.message : String(error)}`);
    await log.error('Failed to fetch unsynced orders', error instanceof Error ? error : new Error(String(error)));
  }

  return result;
}

// GET method for checking sync status
export async function GET(request: NextRequest) {
  try {
    // Security check
    if (!verifyAdminAccess(request)) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      );
    }

    const bankEntryService = new BankTransactionEntryService();
    const backupOrderService = new BackupOrderService();

    // Get counts
    const [unsyncedEntries, unsyncedOrders] = await Promise.all([
      bankEntryService.getUnsyncedEntries(1000),
      backupOrderService.getUnsyncedOrders(1000)
    ]);

    return NextResponse.json({
      success: true,
      status: {
        unsyncedBankEntries: unsyncedEntries.length,
        unsyncedOrders: unsyncedOrders.length,
        needsSync: unsyncedEntries.length > 0 || unsyncedOrders.length > 0
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      message: 'Failed to check sync status',
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
