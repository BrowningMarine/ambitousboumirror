import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { dbManager } from '@/lib/database/connection-manager';
import { appwriteConfig } from '@/lib/appwrite/appwrite-config';
import { sendWebhookNotification } from '@/utils/webhook';
import { Query } from 'appwrite';
import { createAdminClient } from '@/lib/appwrite/appwrite.actions';

const DATABASE_ID = appwriteConfig.databaseId;
const ODRTRANS_COLLECTION_ID = appwriteConfig.odrtransCollectionId;

interface TransactionWithCallback {
  $id: string;
  odrId: string;
  merchantOrdId: string;
  odrType: 'deposit' | 'withdraw';
  odrStatus: string;
  amount: number;
  paidAmount: number;
  urlCallBack: string;
  bankReceiveNumber?: string;
  bankReceiveOwnerName?: string;
  account?: {
    apiKey?: string;
  };
  isSentCallbackNotification?: boolean;
}

/**
 * Internal API: Retry Failed Callback Notifications
 * 
 * This endpoint is designed to run as a cron job every 1 minute.
 * It finds transactions with unsent callback notifications and retries once WITHOUT retry logic
 * (since the job runs frequently, failed attempts will be picked up in the next run).
 * 
 * Uses DatabaseConnectionManager for:
 * - Non-blocking reads (doesn't interfere with transaction writes)
 * - Request deduplication (prevents duplicate processing if cron triggers overlap)
 * - Circuit breaker protection (backs off if database is struggling)
 * 
 * POST /api/cron/retry-failed-callbacks
 * Authorization: Bearer {INTERNAL_API_SECRET}
 */
export async function POST() {
  const startTime = Date.now();

  try {
    // Verify authorization
    const headersList = await headers();
    const authHeader = headersList.get('authorization') || '';
    const internalApiSecret = authHeader.replace('Bearer ', '');

    if (!internalApiSecret || (process.env.INTERNAL_API_SECRET && internalApiSecret !== process.env.INTERNAL_API_SECRET)) {
      console.log('❌ Unauthorized access attempt to retry-failed-callbacks');
      return NextResponse.json(
        { success: false, message: 'Unauthorized: Invalid or missing API secret' },
        { status: 401 }
      );
    }

    console.log('🔄 Starting failed callback notification retry job...');

    // Check database health before proceeding
    const healthStatus = dbManager.getHealthStatus();
    
    if (healthStatus.circuitBreakerState === 'open') {
      console.warn('⚠️ Database circuit breaker is open, skipping this run');
      return NextResponse.json({
        success: false,
        message: 'Database circuit breaker is open, will retry in next job run',
        skipped: true,
        healthStatus
      });
    }

    // Query for transactions with unsent callbacks using DatabaseConnectionManager
    // This uses request deduplication to prevent multiple concurrent queries
    const queries = [
      Query.equal('isSentCallbackNotification', false),
      Query.notEqual('urlCallBack', ''),
      Query.isNotNull('urlCallBack'),
      Query.or([
        Query.equal('odrStatus', 'completed'),
        Query.equal('odrStatus', 'failed'),
        Query.equal('odrStatus', 'canceled')
      ]),
      Query.orderDesc('$createdAt'),
      Query.limit(50) // Process max 50 per run to avoid timeouts
    ];

    console.log('📊 Querying transactions with failed callbacks...');
    
    const documents = await dbManager.listDocuments(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      queries,
      'retry-failed-callbacks-query'
    );

    const transactions = documents.documents as unknown as TransactionWithCallback[];
    
    if (transactions.length === 0) {
      console.log('✅ No failed callbacks to retry');
      return NextResponse.json({
        success: true,
        message: 'No failed callbacks found',
        processed: 0,
        failed: 0,
        skipped: 0,
        duration: Date.now() - startTime
      });
    }

    console.log(`📋 Found ${transactions.length} transactions with unsent callbacks`);

    // Process each transaction (no retry logic, single attempt)
    const results = {
      processed: 0,
      failed: 0,
      skipped: 0,
      details: [] as Array<{ odrId: string; success: boolean; message: string }>
    };

    // Process transactions sequentially to avoid overwhelming the target servers
    // and to manage database write operations properly
    for (const transaction of transactions) {
      try {
        // Validate callback URL
        if (!transaction.urlCallBack || transaction.urlCallBack.trim() === '') {
          console.log(`⏭️ Skipping ${transaction.odrId}: No callback URL`);
          results.skipped++;
          results.details.push({
            odrId: transaction.odrId,
            success: false,
            message: 'No callback URL configured'
          });
          continue;
        }

        // Validate final status
        const finalStatuses = ['completed', 'failed', 'canceled'];
        if (!finalStatuses.includes(transaction.odrStatus)) {
          console.log(`⏭️ Skipping ${transaction.odrId}: Status is ${transaction.odrStatus}, not final`);
          results.skipped++;
          results.details.push({
            odrId: transaction.odrId,
            success: false,
            message: `Status ${transaction.odrStatus} is not final`
          });
          continue;
        }

        console.log(`🔔 Attempting callback for ${transaction.odrId} (${transaction.odrStatus})`);

        // Prepare webhook data
        const webhookData = {
          odrId: transaction.odrId,
          merchantOrdId: transaction.merchantOrdId || '',
          orderType: transaction.odrType,
          odrStatus: transaction.odrStatus,
          bankReceiveNumber: transaction.bankReceiveNumber || '',
          bankReceiveOwnerName: transaction.bankReceiveOwnerName || '',
          amount: transaction.paidAmount || 0,
        };

        // Get merchant API key
        const merchantApiKey = transaction.account?.apiKey || '';

        // Send webhook notification (single attempt, no internal retry)
        // We pass 'cron-retry-no-retry' as source to prevent recursive retries
        const result = await sendWebhookNotification(
          transaction.urlCallBack,
          webhookData,
          merchantApiKey,
          true,
          'cron-retry-no-retry'
        );

        // Update notification status if successful
        if (result.success) {
          try {
            // Use direct admin client for write operations
            // We don't use DatabaseConnectionManager for writes to avoid blocking the read pool
            const { database } = await createAdminClient();
            await database.updateDocument(
              DATABASE_ID,
              ODRTRANS_COLLECTION_ID,
              transaction.$id,
              { isSentCallbackNotification: true }
            );

            console.log(`✅ Successfully sent callback for ${transaction.odrId}`);
            results.processed++;
            results.details.push({
              odrId: transaction.odrId,
              success: true,
              message: 'Callback sent and marked as completed'
            });
          } catch (updateError) {
            console.error(`⚠️ Callback sent for ${transaction.odrId} but failed to update flag:`, updateError);
            results.processed++;
            results.details.push({
              odrId: transaction.odrId,
              success: true,
              message: 'Callback sent but flag update failed (will retry next run)'
            });
          }
        } else {
          console.log(`❌ Failed to send callback for ${transaction.odrId}: ${result.message}`);
          results.failed++;
          results.details.push({
            odrId: transaction.odrId,
            success: false,
            message: result.message || 'Webhook send failed'
          });
        }

        // Small delay between requests to avoid rate limiting on target servers
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`❌ Error processing transaction ${transaction.odrId}:`, error);
        results.failed++;
        results.details.push({
          odrId: transaction.odrId,
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    const duration = Date.now() - startTime;
    console.log(`✅ Callback retry job completed in ${duration}ms: ${results.processed} processed, ${results.failed} failed, ${results.skipped} skipped`);

    return NextResponse.json({
      success: true,
      message: `Processed ${results.processed} callbacks, ${results.failed} failed, ${results.skipped} skipped`,
      processed: results.processed,
      failed: results.failed,
      skipped: results.skipped,
      total: transactions.length,
      duration,
      healthStatus: dbManager.getHealthStatus(),
      details: results.details
    });

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error('❌ Error in retry-failed-callbacks job:', error);
    
    return NextResponse.json(
      {
        success: false,
        message: `Job failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        duration,
        healthStatus: dbManager.getHealthStatus(),
        error: error instanceof Error ? {
          name: error.name,
          message: error.message
        } : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for monitoring failed callback status
 * Returns count and details of transactions with unsent callbacks
 * 
 * GET /api/cron/retry-failed-callbacks
 * Authorization: Bearer {INTERNAL_API_SECRET}
 */
export async function GET() {
  try {
    // Verify authorization
    const headersList = await headers();
    const authHeader = headersList.get('authorization') || '';
    const internalApiSecret = authHeader.replace('Bearer ', '');

    if (!internalApiSecret || (process.env.INTERNAL_API_SECRET && internalApiSecret !== process.env.INTERNAL_API_SECRET)) {
      console.log('❌ Unauthorized access attempt to monitoring endpoint');
      return NextResponse.json(
        { success: false, message: 'Unauthorized: Invalid or missing API secret' },
        { status: 401 }
      );
    }

    // Query for transactions with unsent callbacks
    const queries = [
      Query.equal('isSentCallbackNotification', false),
      Query.notEqual('urlCallBack', ''),
      Query.isNotNull('urlCallBack'),
      Query.or([
        Query.equal('odrStatus', 'completed'),
        Query.equal('odrStatus', 'failed'),
        Query.equal('odrStatus', 'canceled')
      ]),
      Query.orderDesc('$createdAt'),
      Query.limit(100) // Show more for monitoring
    ];

    const documents = await dbManager.listDocuments(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      queries,
      'monitor-failed-callbacks-query'
    );

    const transactions = documents.documents as unknown as TransactionWithCallback[];

    // Group by status for better visibility
    const byStatus = transactions.reduce((acc, tx) => {
      acc[tx.odrStatus] = (acc[tx.odrStatus] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Get oldest pending callback
    const oldestPending = transactions.length > 0 ? transactions[transactions.length - 1] : null;

    return NextResponse.json({
      success: true,
      totalPending: transactions.length,
      byStatus,
      oldestPending: oldestPending ? {
        odrId: oldestPending.odrId,
        status: oldestPending.odrStatus,
        createdAt: oldestPending.$id // Appwrite document ID contains creation timestamp
      } : null,
      healthStatus: dbManager.getHealthStatus(),
      recentTransactions: transactions.slice(0, 10).map(tx => ({
        odrId: tx.odrId,
        merchantOrdId: tx.merchantOrdId,
        status: tx.odrStatus,
        amount: tx.amount,
        paidAmount: tx.paidAmount,
        hasCallbackUrl: !!tx.urlCallBack
      }))
    });

  } catch (error) {
    console.error('❌ Error in monitoring endpoint:', error);
    return NextResponse.json(
      {
        success: false,
        message: `Monitoring failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        healthStatus: dbManager.getHealthStatus()
      },
      { status: 500 }
    );
  }
}
