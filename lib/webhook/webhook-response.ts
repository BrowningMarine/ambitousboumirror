/**
 * Centralized Webhook Response Utility
 * 
 * This module ensures ALL webhook responses follow the unified structure.
 * DO NOT manually create NextResponse.json() in webhook routes - use these functions instead.
 */

import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { TransactionStatus } from '@/lib/actions/bankTransacionEntry.action';
import { sendWebhookNotification } from '@/utils/webhook';

/**
 * Interface for transaction results from processing
 */
export interface WebhookResult {
  id: number | string;
  status: TransactionStatus;
  message: string;
  bankId?: string;
  odrId?: string | null;
  amount?: number;
  url_callback?: string;
  merchantOrdId?: string;
  orderType?: 'deposit' | 'withdraw';
  odrStatus?: string;
  bankReceiveNumber?: string;
  bankReceiveOwnerName?: string;
  paidAmount?: number;
  apiKey?: string; // Merchant API key for webhook authentication
  metrics?: TransactionProcessingMetrics;
}

/**
 * Interface for detailed transaction processing metrics
 */
export interface TransactionProcessingMetrics {
  dataValidation: number;
  lookupOperations: number;
  entryCreation: number;
  bankAndPayment: number;
  statusUpdate: number;
  total: number;
}

/**
 * Interface for request-level performance metrics
 */
export interface RequestPerformanceMetrics {
  setupAndValidation: number;
  payloadParsing: number;
  transactionProcessing: number;
  total: number;
}

/**
 * Configuration for webhook response
 */
interface WebhookResponseConfig {
  portal: string;
  processingMode: 'single' | 'bulk';
  transactionCount: number;
  dataFormat: 'array' | 'object';
  supportsBoth: boolean;
  results: WebhookResult[];
  performanceMetrics: RequestPerformanceMetrics;
  cacheHitRate: number;
  optimalConcurrency: number;
  optimizationsApplied: string[];
}

/**
 * OPTIMIZATION: Send merchant webhook notifications
 * Two modes based on config:
 * 1. BATCHING MODE (default): Groups orders by callback URL, sends as array in single request
 * 2. PARALLEL MODE (legacy): Sends each order in separate parallel requests
 */
async function sendMerchantWebhooks(results: WebhookResult[]): Promise<void> {
  // Filter successful transactions with callback URLs
  const callbackResults = results.filter(
    r => r.url_callback && 
    r.odrId && 
    r.odrId !== 'UNKNOWN' &&
    (r.status === 'processed' || r.status === 'available')
  );

  if (callbackResults.length === 0) {
    return; // No webhooks to send
  }

  // Get batching config
  const { isWebhookCallbackBatchingEnabled } = await import('@/lib/appconfig');
  const batchingEnabled = isWebhookCallbackBatchingEnabled();

  // BATCHING MODE: Group by callback URL and send as arrays (regardless of incoming mode)
  if (batchingEnabled) {
    console.log(`🔄 [Batching Mode] Grouping ${callbackResults.length} orders by callback URL`);
    
    // Group by url_callback (multiple orders can have same callback URL)
    const groupedByCallback = new Map<string, WebhookResult[]>();
    
    for (const result of callbackResults) {
      const callbackUrl = result.url_callback!;
      if (!groupedByCallback.has(callbackUrl)) {
        groupedByCallback.set(callbackUrl, []);
      }
      groupedByCallback.get(callbackUrl)!.push(result);
    }

    console.log(`📊 [Batching Mode] Found ${groupedByCallback.size} unique callback URLs`);

    // Send one webhook per unique callback URL
    const webhookPromises = Array.from(groupedByCallback.entries()).map(
      async ([url, orders]) => {
        try {
          // Get API key from first order (all orders with same URL should have same merchant/key)
          const apiKey = orders[0].apiKey;
          
          if (orders.length === 1) {
            // SINGLE ORDER: Send as object (backward compatible)
            const order = orders[0];
            const webhookData = {
              odrId: order.odrId!,
              merchantOrdId: order.merchantOrdId || '',
              orderType: order.orderType!,
              odrStatus: order.odrStatus!,
              bankReceiveNumber: order.bankReceiveNumber || '',
              bankReceiveOwnerName: order.bankReceiveOwnerName || '',
              amount: order.paidAmount || 0,
            };
            
            await sendWebhookNotification(
              url,
              webhookData,
              apiKey,
              true,
              'webhook-payment-single'
            );
            
            console.log(`📤 [Batching Mode] Sent single webhook to ${url} for order ${order.odrId}`);
          } else {
            // BULK ORDERS: Send as array in ONE request
            const webhookData = orders.map(order => ({
              odrId: order.odrId!,
              merchantOrdId: order.merchantOrdId || '',
              orderType: order.orderType!,
              odrStatus: order.odrStatus!,
              bankReceiveNumber: order.bankReceiveNumber || '',
              bankReceiveOwnerName: order.bankReceiveOwnerName || '',
              amount: order.paidAmount || 0,
            }));
            
            await sendWebhookNotification(
              url,
              webhookData as unknown as Record<string, unknown>, // Bulk array format
              apiKey,
              true,
              'webhook-payment-bulk'
            );
            
            console.log(`📦 [Batching Mode] Sent bulk webhook to ${url} with ${orders.length} orders in ONE request`);
          }
        } catch (error) {
          console.error(`❌ Failed to send webhook to ${url}:`, error);
          // Don't throw - webhook failures shouldn't block response
        }
      }
    );

    // Wait for all webhooks to complete (in parallel)
    await Promise.allSettled(webhookPromises);
    
  } else {
    // PARALLEL MODE: Send each order separately (legacy behavior)
    console.log(`🔀 [Parallel Mode] Sending ${callbackResults.length} webhooks separately`);
    
    const webhookPromises = callbackResults.map(async (result) => {
      try {
        const webhookData = {
          odrId: result.odrId!,
          merchantOrdId: result.merchantOrdId || '',
          orderType: result.orderType!,
          odrStatus: result.odrStatus!,
          bankReceiveNumber: result.bankReceiveNumber || '',
          bankReceiveOwnerName: result.bankReceiveOwnerName || '',
          amount: result.paidAmount || 0,
        };
        
        await sendWebhookNotification(
          result.url_callback!,
          webhookData,
          result.apiKey,
          true,
          'webhook-payment-single'
        );
        
        console.log(`📤 [Parallel Mode] Sent webhook for order ${result.odrId} to ${result.url_callback}`);
      } catch (error) {
        console.error(`❌ Failed to send webhook for order ${result.odrId}:`, error);
        // Don't throw - webhook failures shouldn't block response
      }
    });

    // Wait for all webhooks to complete (in parallel)
    await Promise.allSettled(webhookPromises);
  }
}

/**
 * Get summary of webhook notifications sent
 */
async function getWebhookSummary(results: WebhookResult[]): Promise<{
  totalCallbacks: number;
  uniqueUrls: number;
  singleOrders: number;
  bulkOrders: number;
  batchingMode: 'enabled' | 'disabled';
}> {
  const callbackResults = results.filter(
    r => r.url_callback && 
    r.odrId && 
    r.odrId !== 'UNKNOWN' &&
    (r.status === 'processed' || r.status === 'available')
  );

  // Get batching config
  const { isWebhookCallbackBatchingEnabled } = await import('@/lib/appconfig');
  const batchingEnabled = isWebhookCallbackBatchingEnabled();

  if (callbackResults.length === 0) {
    return {
      totalCallbacks: 0,
      uniqueUrls: 0,
      singleOrders: 0,
      bulkOrders: 0,
      batchingMode: batchingEnabled ? 'enabled' : 'disabled'
    };
  }

  // Group by url_callback
  const groupedByCallback = new Map<string, number>();
  
  for (const result of callbackResults) {
    const callbackUrl = result.url_callback!;
    groupedByCallback.set(callbackUrl, (groupedByCallback.get(callbackUrl) || 0) + 1);
  }

  // Count single vs bulk
  let singleOrders = 0;
  let bulkOrders = 0;
  
  for (const count of groupedByCallback.values()) {
    if (count === 1) {
      singleOrders++;
    } else {
      bulkOrders += count;
    }
  }

  return {
    totalCallbacks: callbackResults.length,
    uniqueUrls: groupedByCallback.size,
    singleOrders,
    bulkOrders,
    batchingMode: batchingEnabled ? 'enabled' : 'disabled'
  };
}

/**
 * Create a unified webhook response with logging
 * 
 * This function:
 * 1. Calculates summary statistics
 * 2. Logs performance metrics to BetterStack
 * 3. Returns consistent response structure
 * 
 * @param config - Webhook response configuration
 * @returns NextResponse with unified structure
 */
export async function createWebhookResponse(config: WebhookResponseConfig): Promise<NextResponse> {
  const {
    portal,
    processingMode,
    transactionCount,
    dataFormat,
    supportsBoth,
    results,
    performanceMetrics,
    cacheHitRate,
    optimalConcurrency,
    optimizationsApplied
  } = config;

  // Calculate summary statistics
  const successCount = results.filter(r => r.status === 'processed' || r.status === 'available').length;
  const failureCount = results.filter(r => r.status === 'failed').length;
  const duplicateCount = results.filter(r => r.status === 'duplicated').length;
  const unlinkedCount = results.filter(r => r.status === 'unlinked').length;

  // Filter results by status
  const failedResults = results.filter(r => r.status === 'failed');
  const duplicateResults = results.filter(r => r.status === 'duplicated');
  // Note: unlinkedResults only needed for logging, not in response

  // Create message
  const message = processingMode === 'single'
    ? `Processed 1 ${processingMode} transaction: ${successCount} successful, ${failureCount} failed, ${duplicateCount} duplicates, ${unlinkedCount} unlinked`
    : `Bulk processed: ${successCount} successful orders`;

  // Aggregate transaction metrics for logging
  const txMetrics = results
    .filter(r => r.metrics)
    .map(r => r.metrics!);

  const aggregatedTxMetrics = txMetrics.length > 0 ? {
    avgDataValidation: Math.round(txMetrics.reduce((sum, m) => sum + m.dataValidation, 0) / txMetrics.length),
    avgLookupOperations: Math.round(txMetrics.reduce((sum, m) => sum + m.lookupOperations, 0) / txMetrics.length),
    avgEntryCreation: Math.round(txMetrics.reduce((sum, m) => sum + m.entryCreation, 0) / txMetrics.length),
    avgBankAndPayment: Math.round(txMetrics.reduce((sum, m) => sum + m.bankAndPayment, 0) / txMetrics.length),
    avgStatusUpdate: Math.round(txMetrics.reduce((sum, m) => sum + m.statusUpdate, 0) / txMetrics.length),
    avgTotal: Math.round(txMetrics.reduce((sum, m) => sum + m.total, 0) / txMetrics.length),
    maxDataValidation: Math.max(...txMetrics.map(m => m.dataValidation)),
    maxLookupOperations: Math.max(...txMetrics.map(m => m.lookupOperations)),
    maxEntryCreation: Math.max(...txMetrics.map(m => m.entryCreation)),
    maxBankAndPayment: Math.max(...txMetrics.map(m => m.bankAndPayment)),
    maxStatusUpdate: Math.max(...txMetrics.map(m => m.statusUpdate)),
    maxTotal: Math.max(...txMetrics.map(m => m.total))
  } : null;

  // Log performance to BetterStack
  await logWebhookPerformance({
    portal,
    processingMode,
    transactionCount,
    successCount,
    failureCount,
    duplicateCount,
    unlinkedCount,
    performanceMetrics,
    aggregatedTxMetrics,
    failedResults,
    duplicateResults,
    results
  });

  // OPTIMIZATION: Send merchant webhook notifications (batched or parallel based on config)
  await sendMerchantWebhooks(results);

  // Create unified response structure
  const response = {
    success: true,
    message,
    processingMode: {
      mode: processingMode,
      transactionCount,
      dataFormat,
      supportsBoth
    },
    summary: {
      total: transactionCount,
      successful: successCount,
      failed: failureCount,
      duplicates: duplicateCount,
      unlinked: unlinkedCount
    },
    // Only include failed transactions (simple array of transaction IDs)
    // FIXED: Filter out null/undefined values from failedTransactions array
    ...(failedResults.length > 0 && {
      failedTransactions: failedResults
        .map(r => r.id)
        .filter((id): id is string | number => id !== null && id !== undefined && id !== 'UNKNOWN' && id !== '')
    }),
    // Include webhook notification summary
    ...(results.some(r => r.url_callback) && {
      webhooksSent: await getWebhookSummary(results)
    }),
    performance: {
      totalTime: Math.round(performanceMetrics.total),
      transactionsPerSecond: Math.round(transactionCount / (performanceMetrics.total / 1000) * 100) / 100,
      optimizationsApplied
    },
    systemOptimizations: {
      connectionPoolActive: true,
      adaptiveConcurrencyEnabled: true,
      crossPortalMetricsEnabled: true,
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      optimalConcurrency
    }
  };

  return NextResponse.json(response);
}

/**
 * Aggregated transaction metrics interface
 */
interface AggregatedTransactionMetrics {
  avgDataValidation: number;
  avgLookupOperations: number;
  avgEntryCreation: number;
  avgBankAndPayment: number;
  avgStatusUpdate: number;
  avgTotal: number;
  maxDataValidation: number;
  maxLookupOperations: number;
  maxEntryCreation: number;
  maxBankAndPayment: number;
  maxStatusUpdate: number;
  maxTotal: number;
}

/**
 * Log webhook performance metrics to BetterStack
 */
interface LogWebhookPerformanceConfig {
  portal: string;
  processingMode: 'single' | 'bulk';
  transactionCount: number;
  successCount: number;
  failureCount: number;
  duplicateCount: number;
  unlinkedCount: number;
  performanceMetrics: RequestPerformanceMetrics;
  aggregatedTxMetrics: AggregatedTransactionMetrics | null;
  failedResults: WebhookResult[];
  duplicateResults: WebhookResult[];
  results: WebhookResult[];
}

async function logWebhookPerformance(config: LogWebhookPerformanceConfig): Promise<void> {
  const {
    portal,
    processingMode,
    transactionCount,
    successCount,
    failureCount,
    duplicateCount,
    performanceMetrics,
    aggregatedTxMetrics,
    failedResults,
    duplicateResults
  } = config;

  // Get core database mode
  const { getCoreRunningMode } = await import('@/lib/appconfig');
  const databaseMode = getCoreRunningMode();

  if (processingMode === 'single') {
    // Single transaction: detailed logging with order ID
    const singleOrderId = config.results[0]?.odrId && 
                          config.results[0].odrId !== 'UNKNOWN' && 
                          config.results[0].odrId !== null 
                            ? config.results[0].odrId 
                            : 'none';
    
    await log.performance(`Webhook ${portal} processed`, performanceMetrics.total, {
      // Results summary
      order: singleOrderId,
      status: successCount > 0 ? 'success' : failureCount > 0 ? 'failed' : 'duplicate',
      amount: config.results[0]?.amount,

      // Request info
      request: {
        portal,
        mode: processingMode
      },

      // Database mode
      database: {
        mode: databaseMode
      },

      // Performance breakdown
      timing: {
        setupAndValidation: Math.round(performanceMetrics.setupAndValidation),
        payloadParsing: Math.round(performanceMetrics.payloadParsing),
        transactionProcessing: Math.round(performanceMetrics.transactionProcessing),
        total: Math.round(performanceMetrics.total)
      },

      // Detailed processing breakdown (individual steps)
      processing: aggregatedTxMetrics ? {
        dataValidation: Math.round(aggregatedTxMetrics.avgDataValidation),
        lookupOperations: Math.round(aggregatedTxMetrics.avgLookupOperations),
        entryCreation: Math.round(aggregatedTxMetrics.avgEntryCreation),
        bankAndPayment: Math.round(aggregatedTxMetrics.avgBankAndPayment),
        statusUpdate: Math.round(aggregatedTxMetrics.avgStatusUpdate)
      } : undefined
    });
  } else {
    // Bulk operations: summary logging
    // Note: processingMode=bulk means array format, but could be single item
    const logMessage = transactionCount === 1 
      ? `Webhook ${portal} processed (array format, 1 transaction)` 
      : `Webhook ${portal} bulk processed (array format, ${transactionCount} transactions)`;
    
    await log.performance(logMessage, performanceMetrics.total, {
      // Summary
      count: transactionCount,
      summary: `${successCount} success, ${failureCount} failed, ${duplicateCount} duplicates`,
      
      // Clarify if this is a single-item array or true bulk
      note: transactionCount === 1 
        ? 'Provider sent single transaction in array format (separate webhook request)' 
        : `Provider sent ${transactionCount} transactions in one webhook request (true bulk)`,

      // Database mode
      database: {
        mode: databaseMode
      },

      // Issues (failed/duplicate orders only - same as response)
      issues: {
        failed: failureCount > 0 ? failedResults.map(r => ({ 
          orderId: r.odrId || null,
          msg: r.message 
        })) : undefined,
        duplicates: duplicateCount > 0 ? duplicateResults.map(r => r.odrId || null) : undefined
      },

      // Performance breakdown
      timing: {
        setupAndValidation: Math.round(performanceMetrics.setupAndValidation),
        payloadParsing: Math.round(performanceMetrics.payloadParsing),
        transactionProcessing: Math.round(performanceMetrics.transactionProcessing),
        total: Math.round(performanceMetrics.total),
        avgPerTransaction: Math.round(performanceMetrics.transactionProcessing / transactionCount),
        transactionsPerSecond: Math.round(transactionCount / (performanceMetrics.total / 1000))
      },

      // Detailed breakdown - average and slowest
      processing: aggregatedTxMetrics ? {
        average: {
          dataValidation: Math.round(aggregatedTxMetrics.avgDataValidation),
          lookupOperations: Math.round(aggregatedTxMetrics.avgLookupOperations),
          entryCreation: Math.round(aggregatedTxMetrics.avgEntryCreation),
          bankAndPayment: Math.round(aggregatedTxMetrics.avgBankAndPayment),
          statusUpdate: Math.round(aggregatedTxMetrics.avgStatusUpdate)
        },
        slowest: {
          dataValidation: Math.round(aggregatedTxMetrics.maxDataValidation),
          lookupOperations: Math.round(aggregatedTxMetrics.maxLookupOperations),
          entryCreation: Math.round(aggregatedTxMetrics.maxEntryCreation),
          bankAndPayment: Math.round(aggregatedTxMetrics.maxBankAndPayment),
          statusUpdate: Math.round(aggregatedTxMetrics.maxStatusUpdate),
          total: Math.round(aggregatedTxMetrics.maxTotal)
        }
      } : undefined
    });
  }
}

/**
 * Create error response for webhook validation failures
 * 
 * CRITICAL: Always returns success:true to prevent banking system resends
 */
export async function createWebhookErrorResponse(
  portal: string,
  errorType: 'validation' | 'parsing' | 'invalid_structure',
  details: {
    message: string;
    issues?: string[];
    parseError?: string;
    performanceMetrics: RequestPerformanceMetrics;
  }
): Promise<NextResponse> {
  const { message, issues, parseError, performanceMetrics } = details;

  // Log the error
  await log.performance(`Webhook ${portal} ${errorType} failed`, performanceMetrics.total, {
    portal,
    phases: {
      setupAndValidation: Math.round(performanceMetrics.setupAndValidation),
      payloadParsing: Math.round(performanceMetrics.payloadParsing || 0),
      totalTime: Math.round(performanceMetrics.total)
    },
    result: `${errorType}_failed`
  });

  // Return error response (always success: true)
  return NextResponse.json({
    success: true, // CRITICAL: Always return success to prevent resend
    message,
    processed: 0,
    ...(issues && { issues }),
    ...(parseError && { parseError })
  });
}

/**
 * Create response for complete processing failure (catch block)
 */
export async function createWebhookCrashResponse(
  portal: string,
  error: unknown,
  performanceMetrics: RequestPerformanceMetrics
): Promise<NextResponse> {
  await log.performance(`Webhook ${portal} crashed`, performanceMetrics.total, {
    portal,
    error: error instanceof Error ? error.message : String(error),
    phases: {
      setupAndValidation: Math.round(performanceMetrics.setupAndValidation),
      payloadParsing: Math.round(performanceMetrics.payloadParsing || 0),
      transactionProcessing: Math.round(performanceMetrics.transactionProcessing || 0),
      total: Math.round(performanceMetrics.total)
    },
    result: 'error'
  });

  return NextResponse.json({
    success: true, // CRITICAL: Always return success to prevent resend
    message: 'Webhook received but processing failed',
    processed: 0,
    error: error instanceof Error ? error.message : 'Unknown error'
  });
}
