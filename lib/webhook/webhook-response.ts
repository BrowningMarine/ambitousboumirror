/**
 * Centralized Webhook Response Utility
 * 
 * This module ensures ALL webhook responses follow the unified structure.
 * DO NOT manually create NextResponse.json() in webhook routes - use these functions instead.
 */

import { NextResponse } from 'next/server';
import { log } from '@/lib/logger';
import { TransactionStatus } from '@/lib/actions/bankTransacionEntry.action';

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
    // Include url_callback for successful transactions
    ...(results.some(r => r.url_callback) && {
      callbacks: results
        .filter(r => r.url_callback && (r.status === 'processed' || r.status === 'available'))
        .map(r => ({
          odrId: r.odrId,
          merchantOrdId: r.merchantOrdId,
          orderType: r.orderType,
          odrStatus: r.odrStatus,
          bankReceiveNumber: r.bankReceiveNumber,
          bankReceiveOwnerName: r.bankReceiveOwnerName,
          amount: r.paidAmount,
          url_callback: r.url_callback
        }))
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

      // Performance breakdown
      timing: {
        setup: Math.round(performanceMetrics.setupAndValidation),
        parse: Math.round(performanceMetrics.payloadParsing),
        process: Math.round(performanceMetrics.transactionProcessing),
        total: Math.round(performanceMetrics.total)
      },

      // Detailed processing breakdown
      processing: aggregatedTxMetrics ? {
        validation: aggregatedTxMetrics.avgDataValidation,
        lookup: aggregatedTxMetrics.avgLookupOperations,
        createEntry: aggregatedTxMetrics.avgEntryCreation,
        bankPayment: aggregatedTxMetrics.avgBankAndPayment,
        updateStatus: aggregatedTxMetrics.avgStatusUpdate
      } : undefined
    });
  } else {
    // Bulk operations: summary logging
    await log.performance(`Webhook ${portal} bulk processed`, performanceMetrics.total, {
      // Summary
      count: transactionCount,
      summary: `${successCount} success, ${failureCount} failed, ${duplicateCount} duplicates`,

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
        setup: Math.round(performanceMetrics.setupAndValidation),
        parse: Math.round(performanceMetrics.payloadParsing),
        process: Math.round(performanceMetrics.transactionProcessing),
        total: Math.round(performanceMetrics.total),
        perTx: Math.round(performanceMetrics.transactionProcessing / transactionCount),
        txPerSec: Math.round(transactionCount / (performanceMetrics.total / 1000))
      },

      // Detailed breakdown - average and slowest
      processing: aggregatedTxMetrics ? {
        avg: {
          lookup: aggregatedTxMetrics.avgLookupOperations,
          createEntry: aggregatedTxMetrics.avgEntryCreation,
          bankPayment: aggregatedTxMetrics.avgBankAndPayment
        },
        slowest: {
          lookup: Math.round(aggregatedTxMetrics.maxLookupOperations),
          createEntry: Math.round(aggregatedTxMetrics.maxEntryCreation),
          bankPayment: Math.round(aggregatedTxMetrics.maxBankAndPayment),
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
