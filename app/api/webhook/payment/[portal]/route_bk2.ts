import { NextRequest, NextResponse } from "next/server";
import { updateBankBalance } from "@/lib/actions/bank.actions";
import { proccessTransactionPayment, getTransactionByOrderId } from "@/lib/actions/transaction.actions";
import {
  createBankTransactionEntry,
  checkDuplicateTransaction,
  findBankByAccountNumber,
  updateBankTransactionEntryStatus,
  TransactionStatus,
  TransactionType,
  BankTransactionEntryData
} from "@/lib/actions/bankTransacionEntry.action";
import { log } from "@/lib/logger";
import { LRUCache } from 'lru-cache';
import crypto from 'crypto';
import { extractOrderIdFromPaymentDescription } from "@/lib/utils";

// OPTIMIZATION: Add caching for bank lookups to reduce database queries
const bankLookupCache = new LRUCache<string, Awaited<ReturnType<typeof findBankByAccountNumber>>>({
  max: 500, // Cache up to 500 bank lookups
  ttl: 300000, // 5 minutes TTL
});

// OPTIMIZATION: Add caching for duplicate transaction checks
const duplicateCheckCache = new LRUCache<string, boolean>({
  max: 1000, // Cache up to 1000 duplicate checks
  ttl: 600000, // 10 minutes TTL (longer since duplicates are permanent)
});

// OPTIMIZATION: Enhanced order ID extraction with caching
const orderIdCache = new LRUCache<string, string>({
  max: 1000,
  ttl: 3600000, // 1 hour TTL
});

// Cache for null results (when no order ID is found)
const nullOrderIdCache = new Set<string>();

// Function to sort object data by key (A -> Z)
function sortObjDataByKey(obj: unknown): unknown {
  if (Array.isArray(obj)) {
    return obj.map(item => sortObjDataByKey(item));
  } else if (obj !== null && typeof obj === 'object') {
    const sortedObj: Record<string, unknown> = {};
    const sortedKeys = Object.keys(obj as Record<string, unknown>).sort();
    for (const key of sortedKeys) {
      sortedObj[key] = sortObjDataByKey((obj as Record<string, unknown>)[key]);
    }
    return sortedObj;
  }
  return obj;
}

// Function to verify Cassoflow webhook signature according to V2 guide
function verifyCassoflowSignature(webhookData: unknown, signature: string, checksumKey: string): boolean {
  try {
    // Step 1: Extract timestamp and signature from X-Casso-Signature header
    // Format: t=timestamp,v1=signature
    const signatureParts = signature.split(',');
    let timestamp = '';
    let v1Signature = '';
    
    for (const part of signatureParts) {
      const [key, value] = part.split('=');
      if (key === 't') {
        timestamp = value;
      } else if (key === 'v1') {
        v1Signature = value;
      }
    }
    
    if (!timestamp || !v1Signature) {
      return false;
    }
    
    // Step 2: Sort webhook data by key (A -> Z)
    const sortedData = sortObjDataByKey(webhookData);
    
    // Step 3: Convert sorted data to JSON string
    const jsonString = JSON.stringify(sortedData);
    
    // Step 4: Create data for signing: timestamp + "." + JSON string
    const dataToSign = timestamp + '.' + jsonString;
    
    // Step 5: Create signature with SHA-512 and hex encoding
    const calculatedSignature = crypto
      .createHmac('sha512', checksumKey)
      .update(dataToSign)
      .digest('hex');
    
    // Step 6: Compare calculated signature with received signature
    return calculatedSignature === v1Signature;
    
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

interface Props {
  params: {
    portal: string
  }
}

interface CassoflowTransaction {
  // Common fields
  id: number;
  description: string;
  amount: number;
  bankName: string;
  bankAbbreviation: string;
  
  // Old format fields
  tid?: string;
  cusum_balance?: number;
  when?: string;
  bank_sub_acc_id?: string;
  subAccId?: string;
  virtualAccount?: string;
  virtualAccountName?: string;
  corresponsiveName?: string;
  corresponsiveAccount?: string;
  corresponsiveBankId?: string;
  corresponsiveBankName?: string;
  
  // New format fields
  reference?: string;
  runningBalance?: number;
  transactionDateTime?: string;
  accountNumber?: string;
  virtualAccountNumber?: string;
  counterAccountName?: string;
  counterAccountNumber?: string;
  counterAccountBankId?: string;
  counterAccountBankName?: string;
}

interface CassoflowPayload {
  error: number;
  data: CassoflowTransaction[] | CassoflowTransaction; // Support both single object and array
}

interface WebhookResult {
  id: number | string;
  status: TransactionStatus;
  message: string;
  bankId?: string;
  odrId?: string | null;
  amount?: number;
}

// OPTIMIZATION: Optimized bank lookup with caching
async function findBankByAccountNumberOptimized(accountNumber: string) {
  const cacheKey = `bank:${accountNumber}`;
  const cached = bankLookupCache.get(cacheKey);
  
  if (cached) {
    // Cache hit - no logging needed for performance
    return cached;
  }

  const result = await findBankByAccountNumber(accountNumber);
  
  // Cache successful lookups for longer
  if (result.success) {
    bankLookupCache.set(cacheKey, result);
  }
  
  // Bank lookup completed - details will be in final transaction log
  
  return result;
}

// OPTIMIZATION: Optimized duplicate check with caching
async function checkDuplicateTransactionOptimized(portal: string, transactionId: string): Promise<boolean> {
  const cacheKey = `duplicate:${portal}:${transactionId}`;
  const cached = duplicateCheckCache.get(cacheKey);
  
  if (cached !== undefined) {
    // Cache hit - no logging needed for performance
    return cached;
  }

  const isDuplicate = await checkDuplicateTransaction(portal, transactionId);
  
  // Cache the result
  duplicateCheckCache.set(cacheKey, isDuplicate);
  
  return isDuplicate;
}

// Process transactions with optimized handling for single transaction webhooks
async function processTransactionsBatch(
  transactions: CassoflowTransaction[]
): Promise<WebhookResult[]> {
  const results: WebhookResult[] = [];
  
  // Most webhooks contain just 1 transaction - handle this efficiently
  if (transactions.length === 1) {
    const result = await processTransaction(transactions[0]);
    return [result];
  }
  
  // For small batches (2-15), process all in parallel
  if (transactions.length <= 15) {
    const allPromises = transactions.map(transaction => processTransaction(transaction));
    const allResults = await Promise.allSettled(allPromises);
    
    // Collect results
    for (let index = 0; index < allResults.length; index++) {
      const result = allResults[index];
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        const transaction = transactions[index];
        console.error('Transaction processing error:', transaction.id, result.reason);
        
        results.push({
          id: transaction.id,
          status: 'failed',
          message: `Processing error: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
        });
      }
    }
    
    return results;
  }
  
  // For larger batches (>15), use controlled concurrency to prevent database overload
  const CONCURRENCY_LIMIT = 12; // Process max 12 transactions simultaneously
  
  for (let i = 0; i < transactions.length; i += CONCURRENCY_LIMIT) {
    const chunk = transactions.slice(i, i + CONCURRENCY_LIMIT);
    
    const chunkPromises = chunk.map(transaction => processTransaction(transaction));
    const chunkResults = await Promise.allSettled(chunkPromises);
    
    // Collect results
    for (let index = 0; index < chunkResults.length; index++) {
      const result = chunkResults[index];
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        const transaction = chunk[index];
        console.error('Transaction processing error:', transaction.id, result.reason);
        
        results.push({
          id: transaction.id,
          status: 'failed',
          message: `Processing error: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
        });
      }
    }
  }
  
  return results;
}

// Helper functions to handle both old and new transaction formats
function getAccountNumber(transaction: CassoflowTransaction): string | undefined {
  return transaction.accountNumber || transaction.bank_sub_acc_id || transaction.subAccId;
}

function getBalance(transaction: CassoflowTransaction): number {
  return transaction.runningBalance || transaction.cusum_balance || 0;
}

function getTransactionDate(transaction: CassoflowTransaction): string {
  return transaction.transactionDateTime || transaction.when || new Date().toISOString();
}

function getPortalTransactionId(transaction: CassoflowTransaction): string {
  // VALIDATION: Must use CassoflowTransaction ID only - no fallbacks to prevent duplicates
  if (!transaction.id || transaction.id <= 0) {
    throw new Error(`Invalid CassoflowTransaction ID: ${transaction.id}. Transaction must have valid ID.`);
  }
  
  // Convert to string and validate it's a proper number
  const transactionId = transaction.id.toString();
  
  // Additional validation: ensure it's a valid numeric string
  if (!/^\d+$/.test(transactionId)) {
    throw new Error(`Invalid CassoflowTransaction ID format: ${transactionId}. Must be numeric.`);
  }
  
  return transactionId;
}

// OPTIMIZATION: Individual transaction processing 
async function processTransaction(transaction: CassoflowTransaction): Promise<WebhookResult> {
  
  try {
    // VALIDATION: Validate transaction ID first before any processing
    let portalTransactionId: string;
    try {
      portalTransactionId = getPortalTransactionId(transaction);
    } catch (validationError) {
      return {
        id: transaction.id || 'INVALID',
        status: 'failed',
        message: `Transaction ID validation failed: ${validationError instanceof Error ? validationError.message : 'Unknown validation error'}`
      };
    }
    
    // OPTIMIZATION: Parallel independent operations
    const [isDuplicate, odrId, bankResult] = await Promise.all([
      // 1. Check for duplicates (independent) - use validated ID
      checkDuplicateTransactionOptimized('cassoflow', portalTransactionId),
      
      // 2. Extract order ID (independent, cached)
      Promise.resolve(extractOrderIdFromPaymentDescription(transaction.description)),
      
      // 3. Find bank by account number (independent, cached)
      (() => {
        const transBankAccountNumber = getAccountNumber(transaction);
        return transBankAccountNumber 
          ? findBankByAccountNumberOptimized(transBankAccountNumber)
          : Promise.resolve({ success: false, bank: null, message: 'No account number provided' });
      })()
    ]);

    // Handle duplicate transactions
    if (isDuplicate) {
      return {
        id: transaction.id,
        status: 'duplicated',
        message: 'Transaction already processed'
      };
    }

    // Handle missing account number
    if (!bankResult.success || !bankResult.bank) {
      return {
        id: transaction.id,
        status: 'failed',
        message: bankResult.message || 'Bank account not found in Cassoflow transfer'
      };
    }

    // Determine transaction type
    const transactionType: TransactionType = transaction.amount < 0 ? 'debit' : 'credit';
    const transBankAccountNumber = getAccountNumber(transaction);

    // Create bank transaction entry
    const bankTransactionData: BankTransactionEntryData = {
      portalId: 'cassoflow',
      portalTransactionId: portalTransactionId, // Use validated ID
      odrId: odrId || 'UNKNOWN',
      bankId: bankResult.bank?.$id,
      bankName: transaction.bankName || bankResult.bank?.bankName || '',
      bankAccountNumber: transBankAccountNumber || '',
      amount: Math.floor(transaction.amount),
      transactionType: transactionType,
      balanceAfter: Math.floor(getBalance(transaction)),
      transactionDate: getTransactionDate(transaction),
      rawPayload: JSON.stringify(transaction),
      status: 'pending',
      notes: !odrId
        ? 'Order ID not found in transaction description, recording transaction only'
        : 'Bank found, processing transaction'
    };

    const entryResult = await createBankTransactionEntry(bankTransactionData);

    if (!entryResult.success || !entryResult.entry) {
      return {
        id: transaction.id,
        status: 'failed',
        message: entryResult.message || 'Failed to create transaction entry'
      };
    }

    let finalStatus: TransactionStatus = 'pending';
    let finalNotes = '';

    // Handle transactions without order ID
    if (!odrId) {
      finalStatus = 'unlinked' as TransactionStatus;
      finalNotes = 'Transaction recorded without order ID';

      // Update status immediately for transactions without order ID
      try {
        await updateBankTransactionEntryStatus(entryResult.entry!.$id, finalStatus, finalNotes);
      } catch (updateError) {
        // Log status update errors silently to console
        console.error('Status update error for transaction:', transaction.id, updateError);
      }

      return {
        id: transaction.id,
        status: finalStatus,
        bankId: bankResult.bank.bankId,
        odrId: null,
        amount: Math.floor(transaction.amount),
        message: 'Transaction recorded without order ID'
      };
    }

    // OPTIMIZATION: Parallel processing of bank update and payment processing
    const [bankUpdateResult, paymentResult] = await Promise.all([
      // 1. Update bank balance
      updateBankBalance(
        bankResult.bank.bankId,
        Math.abs(transaction.amount),
        true,
        true,
        transaction.amount > 0
      ),
      
      // 2. Process payment if valid order ID exists
      odrId && Math.abs(transaction.amount) > 0
        ? proccessTransactionPayment(odrId, Math.abs(transaction.amount))
        : Promise.resolve({ success: false, message: 'No valid order ID or amount' })
    ]);

    // Determine final status based on results
    finalStatus = bankUpdateResult.success ? 'processed' : 'failed';
    finalNotes = bankUpdateResult.success
      ? `Bank balance updated successfully. Previous: ${bankUpdateResult.previousBalance?.current}, New: ${bankUpdateResult.newBalance?.current}`
      : `Failed to update bank balance: ${bankUpdateResult.message || "Unknown error"}`;

    // Handle payment processing results
    if (bankUpdateResult.success && paymentResult.success) {
      if ('isOverpayment' in paymentResult && paymentResult.isOverpayment) {
        // Handle overpayment immediately to ensure proper status update
        try {
          const orderDetails = await getTransactionByOrderId(odrId);
          finalStatus = orderDetails && orderDetails.odrType === 'deposit' 
            ? 'available' as TransactionStatus
            : 'duplicated' as TransactionStatus;
          
          finalNotes += ` | Order payment processing: ${
            orderDetails && orderDetails.odrType === 'deposit' 
              ? 'Deposit transaction already fully paid, marked as available for redemption'
              : 'Transaction already fully paid (withdraw order - not marked as available)'
          }`;
        } catch (orderError) {
          // Log overpayment errors silently to console
          console.error('Overpayment processing error:', transaction.id, orderError);
          
          // Fallback to available status if we can't determine order type
          finalStatus = 'available' as TransactionStatus;
          finalNotes += ` | Order payment processing: Transaction already fully paid, marked as available for redemption (order type check failed)`;
        }
      } else {
        finalNotes += ` | Order payment processed: Success`;
      }
    } else if (paymentResult.message) {
      finalNotes += ` | Order payment processed: Failed error: ${paymentResult.message}`;
    }

    // Update status immediately to ensure it's persisted
    try {
      await updateBankTransactionEntryStatus(entryResult.entry!.$id, finalStatus, finalNotes);
    } catch (updateError) {
      // Log status update errors silently to console
      console.error('Status update error for transaction:', transaction.id, updateError);
    }

    return {
      id: transaction.id,
      status: finalStatus,
      bankId: bankResult.bank.bankId,
      odrId: odrId || null,
      amount: transaction.amount,
      message: `Transaction ${finalStatus === 'processed' ? 'processed successfully' : 
                finalStatus === 'available' ? 'recorded as available for redemption' : 'failed'}`
    };

  } catch (error) {
    // Log individual transaction errors silently to console for debugging
    console.error('Transaction processing error:', transaction.id, error);

    return {
      id: transaction.id,
      status: 'failed',
      message: `Error processing transaction: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// POST /api/webhook/payment - Receive payment updates from third-party  
export async function POST(
  request: NextRequest,
  context: Props
) {
  // OPTIMIZATION: Add comprehensive performance monitoring
  const requestStartTime = performance.now();
  const performanceMetrics = {
    validation: 0,
    parsing: 0,
    batchProcessing: 0,
    total: 0
  };

  let respondMessage = "";

  try {
    const params = await context.params;
    const portal = params.portal.toLowerCase();
    
    // Webhook request received - details will be in final summary

    // OPTIMIZATION: Parallel payload reading and validation
    const validationStart = performance.now();
    const [payload, CASSOFLOW_API_KEY] = await Promise.all([
      request.text(),
      Promise.resolve(process.env.CASSOFLOW_API_KEY)
    ]);
    
    const cassoSignature = request.headers.get('X-Casso-Signature');
    performanceMetrics.validation = performance.now() - validationStart;

    switch (portal) {
      case 'cassoflow':
        // Validate webhook secret exists
        if (!CASSOFLOW_API_KEY) {
          await log.error(`Webhook secret not configured for ${portal}`, 
            new Error('CASSOFLOW_API_KEY environment variable not set'), 
            { 
              portal, 
              timestamp: new Date().toISOString()
            });
          respondMessage = "Webhook configuration error";
          return NextResponse.json({ success: false, message: 'Webhook configuration error' }, { status: 500 });
        }

        // Validate signature header exists
        if (!cassoSignature) {
          await log.warn(`Webhook signature missing for ${portal}`, { 
            portal, 
            timestamp: new Date().toISOString(),
            requestData: {
              headers: Object.fromEntries(request.headers.entries()),
              body: payload,
              method: request.method,
              url: request.url,
              userAgent: request.headers.get('user-agent') || 'unknown',
              contentType: request.headers.get('content-type') || 'unknown',
              missingHeader: 'X-Casso-Signature'
            }
          });
          respondMessage = "Missing signature";
          return NextResponse.json({ success: false, message: 'Missing X-Casso-Signature header' }, { status: 401 });
        }

        // Valid payload check
        if (!payload || payload.length === 0) {
          await log.warn(`Webhook empty payload received for ${portal}`, { 
            portal, 
            timestamp: new Date().toISOString(),
            requestData: {
              headers: Object.fromEntries(request.headers.entries()),
              body: payload,
              method: request.method,
              url: request.url,
              userAgent: request.headers.get('user-agent') || 'unknown',
              contentType: request.headers.get('content-type') || 'unknown',
              bodyLength: payload?.length || 0
            }
          });
          respondMessage = "Body required!";
          return NextResponse.json({ success: false, message: 'body required!' }, { status: 401 });
        }

        // Parse the payload  
        const parsingStart = performance.now();
        const payloadParsed = JSON.parse(payload) as CassoflowPayload;
        performanceMetrics.parsing = performance.now() - parsingStart;

        // Verify webhook signature using Cassoflow V2 guide
        const isSignatureValid = verifyCassoflowSignature(payloadParsed, cassoSignature, CASSOFLOW_API_KEY);
        
        if (!isSignatureValid) {
          await log.warn(`Webhook signature verification failed for ${portal}`, { 
            portal, 
            timestamp: new Date().toISOString(),
            requestData: {
              headers: Object.fromEntries(request.headers.entries()),
              body: payload,
              parsedBody: payloadParsed,
              method: request.method,
              url: request.url,
              userAgent: request.headers.get('user-agent') || 'unknown',
              contentType: request.headers.get('content-type') || 'unknown',
              signatureHeader: cassoSignature,
              verificationFailed: true
            }
          });
          respondMessage = "Invalid signature";
          return NextResponse.json({ success: false, message: 'Invalid webhook signature' }, { status: 401 });
        }

        // Handle both single transaction and bulk transaction formats
        let transactionsToProcess: CassoflowTransaction[] = [];
        let processingMode: 'single' | 'bulk' = 'single';
        
        if (!payloadParsed || !payloadParsed.data) {
          await log.warn(`Webhook invalid payload structure for ${portal}`, { 
            portal, 
            timestamp: new Date().toISOString(),
            requestData: {
              headers: Object.fromEntries(request.headers.entries()),
              body: payload,
              parsedBody: payloadParsed,
              method: request.method,
              url: request.url,
              userAgent: request.headers.get('user-agent') || 'unknown',
              contentType: request.headers.get('content-type') || 'unknown',
              bodyLength: payload?.length || 0,
              parseError: !payloadParsed ? 'Failed to parse JSON' : 'Missing data property'
            }
          });
          respondMessage = "Invalid payload structure";
          return NextResponse.json({ success: false, message: 'Invalid payload structure' }, { status: 400 });
        }

        // Detect and handle both single and bulk transaction formats
        if (Array.isArray(payloadParsed.data)) {
          // Bulk transactions (array format)
          if (payloadParsed.data.length === 0) {
            await log.warn(`Webhook empty data array for ${portal}`, { 
              portal, 
              timestamp: new Date().toISOString(),
              requestData: {
                headers: Object.fromEntries(request.headers.entries()),
                body: payload,
                parsedBody: payloadParsed,
                method: request.method,
                url: request.url,
                userAgent: request.headers.get('user-agent') || 'unknown',
                contentType: request.headers.get('content-type') || 'unknown',
                bodyLength: payload?.length || 0,
                parseError: 'Empty data array'
              }
            });
            respondMessage = "Empty data array";
            return NextResponse.json({ success: false, message: 'Empty data array' }, { status: 400 });
          }
          transactionsToProcess = payloadParsed.data;
          processingMode = payloadParsed.data.length > 1 ? 'bulk' : 'single';
        } else if (typeof payloadParsed.data === 'object' && payloadParsed.data !== null) {
          // Single transaction object - convert to array format for uniform processing
          transactionsToProcess = [payloadParsed.data as CassoflowTransaction];
          processingMode = 'single';
        } else {
          await log.warn(`Webhook invalid data format for ${portal}`, { 
            portal, 
            timestamp: new Date().toISOString(),
            requestData: {
              headers: Object.fromEntries(request.headers.entries()),
              body: payload,
              parsedBody: payloadParsed,
              method: request.method,
              url: request.url,
              userAgent: request.headers.get('user-agent') || 'unknown',
              contentType: request.headers.get('content-type') || 'unknown',
              bodyLength: payload?.length || 0,
              parseError: 'Data is neither array nor object'
            }
          });
          respondMessage = "Invalid data format";
          return NextResponse.json({ success: false, message: 'Invalid data format' }, { status: 400 });
        }

        // Payload parsed successfully - details will be in final summary

        // Process transactions (typically 1 transaction per webhook)
        const batchProcessingStart = performance.now();
        
        const results = await processTransactionsBatch(transactionsToProcess);
        performanceMetrics.batchProcessing = performance.now() - batchProcessingStart;

        // Calculate final metrics
        const successCount = results.filter(r => r.status === 'processed' || r.status === 'available').length;
        const failureCount = results.filter(r => r.status === 'failed').length;
        const duplicateCount = results.filter(r => r.status === 'duplicated').length;
        const unlinkedCount = results.filter(r => r.status === 'unlinked').length;

        performanceMetrics.total = performance.now() - requestStartTime;

        // Create the log summary  
        respondMessage = `Processed ${transactionsToProcess.length} ${processingMode} transaction${transactionsToProcess.length > 1 ? 's' : ''}: ${successCount} successful, ${failureCount} failed, ${duplicateCount} duplicates, ${unlinkedCount} unlinked`;

        // Create comprehensive webhook processing summary log
        const processedOrderIds = results
          .filter(r => r.odrId && r.odrId !== 'UNKNOWN' && r.odrId !== null)
          .map(r => r.odrId)
          .filter((orderId, index, array) => array.indexOf(orderId) === index); // Remove duplicates
        
        const orderListMessage = processedOrderIds.length > 0 
          ? `Orders: ${processedOrderIds.join(', ')}`
          : 'No orders processed (unlinked transactions)';
        
        await log.info(`Webhook ${portal} - ${orderListMessage}`, {
          // Request Details
          portal,
          timestamp: new Date().toISOString(),
          
          // Processing Summary
          processing: {
            mode: processingMode,
            transactionCount: transactionsToProcess.length,
            dataFormat: Array.isArray(payloadParsed.data) ? 'array' : 'object',
            successCount,
            failureCount,
            duplicateCount,
            unlinkedCount,
            successRate: Math.round((successCount / transactionsToProcess.length) * 100)
          },
          
          // Transaction Details (for single transactions or summary for bulk)
          transactions: processingMode === 'single' && transactionsToProcess.length === 1 ? {
            id: transactionsToProcess[0].id,
            orderId: extractOrderIdFromPaymentDescription(transactionsToProcess[0].description),
            amount: transactionsToProcess[0].amount,
            description: transactionsToProcess[0].description,
            bankAccount: getAccountNumber(transactionsToProcess[0]),
            status: results[0]?.status,
            message: results[0]?.message
          } : {
            totalAmount: transactionsToProcess.reduce((sum, t) => sum + t.amount, 0),
            orderIds: results.filter(r => r.odrId && r.odrId !== 'UNKNOWN').map(r => r.odrId),
                         bankAccounts: Array.from(new Set(transactionsToProcess.map(t => getAccountNumber(t)).filter(Boolean))),
            statuses: results.map(r => ({ id: r.id, status: r.status }))
          },
          
          // Performance Metrics
          performance: {
            total: Math.round(performanceMetrics.total * 100) / 100,
            validation: Math.round(performanceMetrics.validation * 100) / 100,
            parsing: Math.round(performanceMetrics.parsing * 100) / 100,
            processing: Math.round(performanceMetrics.batchProcessing * 100) / 100,
            transactionsPerSecond: Math.round(transactionsToProcess.length / (performanceMetrics.total / 1000))
          },
          
          // Cache Performance
          cache: {
            bankLookups: bankLookupCache.size,
            duplicateChecks: duplicateCheckCache.size,
            orderIdExtractions: orderIdCache.size
          },
          
          // Summary
          summary: {
            success: failureCount === 0,
            message: respondMessage
          }
        });

        // Return the processing results  
        return NextResponse.json({
          success: true,
          message: respondMessage,
          processingMode: {
            mode: processingMode,
            transactionCount: transactionsToProcess.length,
            dataFormat: Array.isArray(payloadParsed.data) ? 'array' : 'object',
            supportsBoth: true
          },
          results,
          performance: {
            totalTime: performanceMetrics.total,
            transactionsPerSecond: Math.round(transactionsToProcess.length / (performanceMetrics.total / 1000)),
            optimizationsApplied: ['parallel-processing', 'caching', 'background-tasks', 'batch-operations', 'dual-format-support']
          }
        });

      default:
        await log.warn(`Webhook invalid portal name: ${portal}`, { 
          portal, 
          timestamp: new Date().toISOString(),
          requestData: {
            headers: Object.fromEntries(request.headers.entries()),
            body: payload,
            method: request.method,
            url: request.url,
            userAgent: request.headers.get('user-agent') || 'unknown',
            contentType: request.headers.get('content-type') || 'unknown',
            requestedPortal: portal
          }
        });
        return NextResponse.json({ success: false, message: 'Invalid portal name' }, { status: 400 });
    }

  } catch (error) {
    performanceMetrics.total = performance.now() - requestStartTime;
    
    const params = await context.params;
    const portal = params.portal.toLowerCase();
    
    await log.error(`Webhook Processing Failed for ${portal}`, 
      error instanceof Error ? error : new Error(String(error)), 
      {
        portal,
        performanceMetrics: {
          validation: Math.round(performanceMetrics.validation * 100) / 100,
          parsing: Math.round(performanceMetrics.parsing * 100) / 100,
          batchProcessing: Math.round(performanceMetrics.batchProcessing * 100) / 100,
          total: Math.round(performanceMetrics.total * 100) / 100
        },
        timestamp: new Date().toISOString(),
        userAgent: request.headers.get('user-agent') || 'unknown'
      });
    
    return NextResponse.json(
      { 
        success: false, 
        message: 'Internal server error',
        performance: {
          totalTime: performanceMetrics.total,
          failedAt: 'webhook-processing'
        }
      },
      { status: 500 }
    );
  }
}