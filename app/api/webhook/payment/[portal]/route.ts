import { NextRequest, NextResponse } from "next/server";
import { updateBankBalance } from "@/lib/actions/bank.actions";
import { getTransactionByOrderId } from "@/lib/actions/transaction.actions";
import {
  createBankTransactionEntry,
  checkDuplicateTransaction,
  findBankByAccountNumber,
  updateBankTransactionEntryStatus,
  TransactionStatus,
  TransactionType,
  BankTransactionEntryData
} from "@/lib/actions/bankTransacionEntry.action";
import { proccessTransactionPayment } from "@/lib/actions/transaction.actions";
import { updateAccountBalance } from "@/lib/actions/account.actions";
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { appConfig } from "@/lib/appconfig";
import { ID } from "appwrite";
import { log } from "@/lib/logger";
import { LRUCache } from 'lru-cache';
import crypto from 'crypto';
import { extractOrderIdFromPaymentDescription } from "@/lib/utils";
import { createWebhookResponse, WebhookResult } from '@/lib/webhook/webhook-response';
import { BackupOrderService, BankTransactionEntryService } from '@/lib/supabase-backup';

// OPTIMIZATION: Enhanced caching with larger capacity for high performance
const bankLookupCache = new LRUCache<string, Awaited<ReturnType<typeof findBankByAccountNumber>>>({
  max: 2000, // Increased cache size for better hit rate
  ttl: 600000, // 10 minutes TTL for frequently used banks
});

// OPTIMIZATION: Larger duplicate cache with shorter TTL for safety
const duplicateCheckCache = new LRUCache<string, boolean>({
  max: 5000, // Much larger cache for duplicates
  ttl: 1800000, // 30 minutes TTL (longer since duplicates are permanent)
});

// OPTIMIZATION: Order ID extraction cache with pattern matching
const orderIdCache = new LRUCache<string, string>({
  max: 2000, // Larger cache for order patterns
  ttl: 3600000, // 1 hour TTL
});

// OPTIMIZATION: Enhanced circuit breaker for bulk operations with high-traffic resilience
interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: 'closed' | 'open' | 'half-open';
  consecutiveSuccesses: number; // Track recovery
  bulkFailures: number; // Track bulk operation failures separately
  transientFailures: number; // Track transient failures (network, timeout) separately
  lastSuccessTime: number; // Track last successful operation
}

const circuitBreakers = new Map<string, CircuitBreakerState>();

function getCircuitBreaker(operation: string): CircuitBreakerState {
  if (!circuitBreakers.has(operation)) {
    circuitBreakers.set(operation, { 
      failures: 0, 
      lastFailure: 0, 
      state: 'closed',
      consecutiveSuccesses: 0,
      bulkFailures: 0,
      transientFailures: 0,
      lastSuccessTime: Date.now()
    });
  }
  return circuitBreakers.get(operation)!;
}

function isCircuitOpen(operation: string, isBulkOperation = false): boolean {
  const breaker = getCircuitBreaker(operation);
  const now = Date.now();
  
  // IMPROVEMENT: For bulk operations under high traffic, use much more lenient timeout (5 minutes instead of 2)
  // This prevents premature circuit opening during sustained high load
  const resetTimeout = isBulkOperation ? 300000 : 90000; // 5min for bulk, 1.5min for single
  
  // Auto-recover if system has been stable recently
  const timeSinceLastSuccess = now - breaker.lastSuccessTime;
  if (breaker.state === 'open' && timeSinceLastSuccess < 30000) {
    // If we had a success within last 30 seconds, be more forgiving
    breaker.state = 'half-open';
    breaker.consecutiveSuccesses = 0;
    breaker.transientFailures = 0;
  }
  
  // Reset after timeout
  if (breaker.state === 'open' && now - breaker.lastFailure > resetTimeout) {
    breaker.state = 'half-open';
    breaker.consecutiveSuccesses = 0;
    breaker.transientFailures = 0;
  }
  
  return breaker.state === 'open';
}

function recordSuccess(operation: string, isBulkOperation = false): void {
  const breaker = getCircuitBreaker(operation);
  breaker.consecutiveSuccesses++;
  breaker.lastSuccessTime = Date.now();
  
  // IMPROVEMENT: Gradually reset failure counts on success
  if (breaker.failures > 0) {
    breaker.failures = Math.max(0, breaker.failures - 1);
  }
  if (breaker.transientFailures > 0) {
    breaker.transientFailures = Math.max(0, breaker.transientFailures - 2); // Decay transient failures faster
  }
  
  // For bulk operations, require more successes to fully close circuit
  const requiredSuccesses = isBulkOperation ? 5 : 3; // Increased from 3 to 5 for bulk
  
  if (breaker.state === 'half-open' && breaker.consecutiveSuccesses >= requiredSuccesses) {
    breaker.failures = 0;
    breaker.bulkFailures = 0;
    breaker.transientFailures = 0;
    breaker.state = 'closed';
  }
}

function recordFailure(operation: string, isBulkOperation = false, isTransient = false): void {
  const breaker = getCircuitBreaker(operation);
  breaker.failures++;
  breaker.lastFailure = Date.now();
  breaker.consecutiveSuccesses = 0;
  
  if (isBulkOperation) {
    breaker.bulkFailures++;
  }
  
  if (isTransient) {
    breaker.transientFailures++;
  }
  
  // IMPROVEMENT: Much higher threshold for bulk operations during high traffic
  // Differentiate between transient (network/timeout) and permanent (validation) failures
  let failureThreshold: number;
  
  if (isBulkOperation) {
    // For bulk operations, be very lenient - only open circuit after many failures
    // This prevents circuit opening during temporary network hiccups
    failureThreshold = isTransient ? 15 : 8; // 15 for transient, 8 for permanent
  } else {
    // For single operations, use moderate threshold
    failureThreshold = isTransient ? 8 : 5; // 8 for transient, 5 for permanent
  }
  
  // Only open circuit if we exceed threshold
  const relevantFailures = isTransient ? breaker.transientFailures : breaker.failures;
  if (relevantFailures >= failureThreshold) {
    breaker.state = 'open';
  }
}

// OPTIMIZATION: Portal-agnostic performance metrics
interface PortalPerformanceMetrics {
  requestsProcessed: number;
  averageResponseTime: number;
  cacheHitRate: number;
  errorRate: number;
  lastUpdated: number;
}

// OPTIMIZATION: Cross-portal performance tracking
const portalMetrics = new Map<string, PortalPerformanceMetrics>();

// OPTIMIZATION: Universal transaction processing queue for load balancing (for future use)
export interface UniversalTransaction {
  portal: string;
  transactionId: string;
  payload: unknown;
  priority: 'high' | 'normal' | 'low';
  timestamp: number;
}

// Note: Removed fake DatabaseConnectionPool as Appwrite uses HTTP API calls
// Each operation creates its own HTTP connection automatically

// OPTIMIZATION: Universal performance tracking functions
function updatePortalMetrics(portal: string, responseTime: number, success: boolean): void {
  const current = portalMetrics.get(portal) || {
    requestsProcessed: 0,
    averageResponseTime: 0,
    cacheHitRate: 0,
    errorRate: 0,
    lastUpdated: Date.now()
  };
  
  current.requestsProcessed++;
  current.averageResponseTime = (current.averageResponseTime + responseTime) / 2;
  current.errorRate = success 
    ? current.errorRate * 0.95 // Decay error rate on success
    : (current.errorRate + 1) / current.requestsProcessed; // Update on error
  current.lastUpdated = Date.now();
  
  portalMetrics.set(portal, current);
}

function calculateCacheHitRate(): number {
  const bankHits = bankLookupCache.size;
  const duplicateHits = duplicateCheckCache.size;
  const orderHits = orderIdCache.size;
  const totalPossibleHits = bankLookupCache.max + duplicateCheckCache.max + orderIdCache.max;
  
  return ((bankHits + duplicateHits + orderHits) / totalPossibleHits) * 100;
}

// OPTIMIZATION: Fast-path for high-frequency transactions (for future use)
export async function fastTrackTransaction(portal: string, transactionId: string): Promise<boolean> {
  // Check if this is a frequent transaction pattern that can be fast-tracked
  const recentSimilar = duplicateCheckCache.get(`${portal}:${transactionId}`);
  return recentSimilar === false; // Fast-track if we know it's not a duplicate
}

// OPTIMIZATION: Adaptive concurrency based on portal performance and system load
function getOptimalConcurrency(portal: string, transactionCount: number): number {
  const metrics = portalMetrics.get(portal);
  let baseConcurrency = 12; // Default
  
  // Adjust based on batch size - larger batches need more careful concurrency
  if (transactionCount > 100) {
    baseConcurrency = Math.max(8, baseConcurrency - 4); // Reduce for very large batches
  } else if (transactionCount > 50) {
    baseConcurrency = Math.max(10, baseConcurrency - 2); // Moderate reduction
  }
  
  if (!metrics) return baseConcurrency;
  
  // Reduce concurrency if error rate is high or response time is slow
  if (metrics.errorRate > 0.05 || metrics.averageResponseTime > 1000) {
    return Math.max(4, baseConcurrency - Math.floor(metrics.errorRate * 100));
  }
  
  // Increase concurrency if performance is good and batch is small
  if (metrics.errorRate < 0.01 && metrics.averageResponseTime < 300 && transactionCount <= 50) {
    return Math.min(20, baseConcurrency + Math.floor((100 - metrics.averageResponseTime) / 50));
  }
  
  return baseConcurrency;
}

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

interface SepayTransaction {
  id: number;
  gateway: string;
  transactionDate: string;
  accountNumber: string;
  subAccount: string | null;
  code: string | null;
  content: string;
  transferType: string;
  description: string;
  transferAmount: number;
  referenceCode: string;
  accumulated: number;
}

interface SecretAgentTransaction {
  id: number;
  id_bank: string;
  transactiondate: string;
  bank_name: string;
  accountNumber: string;
  amount: number;
  content: string;
  odrId: string | null;
  odrType: string;
  refAccoutNumber: string;
  refAccountOwnerName: string;
  balance: number;
}

interface CassoflowPayload {
  error: number;
  data: CassoflowTransaction[] | CassoflowTransaction; // Support both single object and array
}

// UNIVERSAL: One interface for all portals
interface UniversalTransactionData {
  id: number;
  amount: number;
  accountNumber: string;
  description: string;
  balance: number;
  transactionDate: string;
  bankName?: string;
}

// IMPROVEMENT: Retry helper with exponential backoff for transient failures
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 100,
  operationName = 'operation'
): Promise<T> {
  let lastError: Error | unknown;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Check if error is transient (network, timeout, fetch failed)
      const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      const isTransient = errorMessage.includes('fetch failed') || 
                         errorMessage.includes('timeout') || 
                         errorMessage.includes('network') ||
                         errorMessage.includes('econnreset') ||
                         errorMessage.includes('econnrefused');
      
      // Only retry on transient errors
      if (!isTransient || attempt === maxRetries - 1) {
        throw error;
      }
      
      // Exponential backoff: 100ms, 200ms, 400ms
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
      
      console.log(`Retrying ${operationName} after ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
    }
  }
  
  throw lastError;
}

// OPTIMIZATION: High-performance bank lookup with circuit breaker, retry logic, and bulk support
async function findBankByAccountNumberOptimized(accountNumber: string, isBulkOperation = false) {
  const cacheKey = `bank:${accountNumber}`;
  const cached = bankLookupCache.get(cacheKey);
  
  if (cached) {
    recordSuccess('bank-lookup', isBulkOperation);
    return cached;
  }

  // Check circuit breaker before database operation
  if (isCircuitOpen('bank-lookup', isBulkOperation)) {
    // If client-only mode is enabled and circuit is open, use fallback bank data
    if (appConfig.useClientOnlyPayment && accountNumber === appConfig.fallbackBankData.accountNumber) {
      console.warn(`⚠️ Circuit breaker open for bank lookup - using fallback bank data: ${accountNumber}`);
      
      const fallbackBank = {
        $id: appConfig.fallbackBankData.bankId,
        $collectionId: 'fallback',
        $databaseId: 'fallback',
        $createdAt: new Date().toISOString(),
        $updatedAt: new Date().toISOString(),
        $permissions: [],
        bankId: appConfig.fallbackBankData.bankId,
        bankName: appConfig.fallbackBankData.bankName,
        bankBinCode: appConfig.fallbackBankData.bankBinCode,
        accountNumber: appConfig.fallbackBankData.accountNumber,
        ownerName: appConfig.fallbackBankData.ownerName,
        isActivated: appConfig.fallbackBankData.isActivated,
        minAmount: appConfig.fallbackBankData.minAmount,
        maxAmount: appConfig.fallbackBankData.maxAmount,
        availableBalance: appConfig.fallbackBankData.availableBalance,
        currentBalance: appConfig.fallbackBankData.availableBalance
      };
      
      const result = { success: true, bank: fallbackBank, message: '' };
      bankLookupCache.set(cacheKey, result);
      return result;
    }
    return { success: false, bank: null, message: 'Bank lookup service temporarily unavailable' };
  }

  try {
    // IMPROVEMENT: Add retry logic with exponential backoff for transient failures
    const result = await retryWithBackoff(
      () => findBankByAccountNumber(accountNumber),
      3,
      100,
      `bank-lookup-${accountNumber}`
    );
    
    // Cache successful lookups immediately
    if (result.success) {
      bankLookupCache.set(cacheKey, result);
      recordSuccess('bank-lookup', isBulkOperation);
    } else {
      // Non-transient failure (validation, not found, etc.)
      recordFailure('bank-lookup', isBulkOperation, false);
    }
    
    return result;
  } catch (error) {
    console.error('Error finding bank by account number:', error);
    
    // If client-only mode is enabled, use fallback bank data
    if (appConfig.useClientOnlyPayment) {
      console.warn(`⚠️ Appwrite bank lookup failed - using fallback bank data for account: ${accountNumber}`);
      
      // Check if the account number matches fallback bank configuration
      if (accountNumber === appConfig.fallbackBankData.accountNumber) {
        const fallbackBank = {
          $id: appConfig.fallbackBankData.bankId,
          $collectionId: 'fallback',
          $databaseId: 'fallback',
          $createdAt: new Date().toISOString(),
          $updatedAt: new Date().toISOString(),
          $permissions: [],
          bankId: appConfig.fallbackBankData.bankId,
          bankName: appConfig.fallbackBankData.bankName,
          bankBinCode: appConfig.fallbackBankData.bankBinCode,
          accountNumber: appConfig.fallbackBankData.accountNumber,
          ownerName: appConfig.fallbackBankData.ownerName,
          isActivated: appConfig.fallbackBankData.isActivated,
          minAmount: appConfig.fallbackBankData.minAmount,
          maxAmount: appConfig.fallbackBankData.maxAmount,
          availableBalance: appConfig.fallbackBankData.availableBalance,
          currentBalance: appConfig.fallbackBankData.availableBalance
        };
        
        const result = { success: true, bank: fallbackBank, message: '' };
        bankLookupCache.set(cacheKey, result);
        recordSuccess('bank-lookup', isBulkOperation);
        return result;
      } else {
        console.warn(`⚠️ Account ${accountNumber} does not match fallback bank account ${appConfig.fallbackBankData.accountNumber}`);
      }
    }
    
    // Determine if error is transient
    const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const isTransient = errorMessage.includes('fetch failed') || 
                       errorMessage.includes('timeout') || 
                       errorMessage.includes('network') ||
                       errorMessage.includes('route_not_found') ||
                       errorMessage.includes('route not found');
    
    recordFailure('bank-lookup', isBulkOperation, isTransient);
    return { success: false, bank: null, message: `Bank lookup failed: ${error instanceof Error ? error.message : 'Unknown error'}` };
  }
}

// OPTIMIZATION: High-performance duplicate check with circuit breaker, retry logic, and bulk support
async function checkDuplicateTransactionOptimized(portal: string, transactionId: string, isBulkOperation = false): Promise<boolean> {
  const cacheKey = `duplicate:${portal}:${transactionId}`;
  const cached = duplicateCheckCache.get(cacheKey);
  
  if (cached !== undefined) {
    recordSuccess('duplicate-check', isBulkOperation);
    return cached;
  }

  // Check circuit breaker before database operation
  if (isCircuitOpen('duplicate-check', isBulkOperation)) {
    // If circuit is open, assume not duplicate to be safe (allow processing)
    return false;
  }

  try {
    // IMPROVEMENT: Add retry logic with exponential backoff for transient failures
    const isDuplicate = await retryWithBackoff(
      () => checkDuplicateTransaction(portal, transactionId),
      3,
      100,
      `duplicate-check-${portal}-${transactionId}`
    );
    
    // Cache the result immediately
    duplicateCheckCache.set(cacheKey, isDuplicate);
    recordSuccess('duplicate-check', isBulkOperation);
    
    return isDuplicate;
  } catch (error) {
    // Determine if error is transient
    const errorMessage = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    const isTransient = errorMessage.includes('fetch failed') || 
                       errorMessage.includes('timeout') || 
                       errorMessage.includes('network');
    
    recordFailure('duplicate-check', isBulkOperation, isTransient);
    // On error, assume not duplicate to avoid blocking valid transactions
    return false;
  }
}

// OPTIMIZATION: Fast cached order ID extraction
function extractOrderIdOptimized(description: string): string | null {
  const cacheKey = `order:${description}`;
  const cached = orderIdCache.get(cacheKey);
  
  if (cached !== undefined) {
    return cached || null;
  }

  try {
    const orderId = extractOrderIdFromPaymentDescription(description);
    
    // Cache both successful and failed extractions
    orderIdCache.set(cacheKey, orderId || '');
    
    return orderId;
  } catch {
    // Cache failed extraction to avoid repeated processing
    orderIdCache.set(cacheKey, '');
    return null;
  }
}

// UNIVERSAL: Process transactions batch for any portal with background queue support
async function processTransactionsBatch(
  transactions: (CassoflowTransaction | SepayTransaction | SecretAgentTransaction)[],
  portal: string
): Promise<WebhookResult[]> {
  const results: WebhookResult[] = [];
  
  // For very large batches (>100), consider background processing
  if (transactions.length > 100) {
    // Check if we should queue this for background processing
    const metrics = portalMetrics.get(portal);
    const shouldUseBackgroundQueue = (
      (metrics && metrics.errorRate > 0.03) || // High error rate
      (metrics && metrics.averageResponseTime > 2000) || // Slow response times
      transactions.length > 150 // Very large batch
    );
    
    if (shouldUseBackgroundQueue) {
      // TODO: Implement Redis-based background queue here
      // For now, process with very conservative settings
      console.log(`Large batch (${transactions.length}) detected - using conservative processing`);
      
      // Process in smaller chunks with delays between chunks
      const CONSERVATIVE_CHUNK_SIZE = 5;
      const CHUNK_DELAY = 100; // 100ms between chunks
      
      for (let i = 0; i < transactions.length; i += CONSERVATIVE_CHUNK_SIZE) {
        const chunk = transactions.slice(i, i + CONSERVATIVE_CHUNK_SIZE);
        
        const chunkPromises = chunk.map(transaction => 
          processUniversalTransaction(transaction, portal)
        );
        const chunkResults = await Promise.allSettled(chunkPromises);
        
        // Collect results
        for (let index = 0; index < chunkResults.length; index++) {
          const result = chunkResults[index];
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            const transaction = chunk[index] as CassoflowTransaction | SepayTransaction;
            console.error('Transaction processing error:', transaction.id, result.reason);
            
            results.push({
              id: transaction.id,
              status: 'failed',
              message: `Processing error: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
            });
          }
        }
        
        // Add delay between chunks for large batches
        if (i + CONSERVATIVE_CHUNK_SIZE < transactions.length) {
          await new Promise(resolve => setTimeout(resolve, CHUNK_DELAY));
        }
      }
      
      return results;
    }
  }
  
  // Most webhooks contain just 1 transaction - handle this efficiently
  if (transactions.length === 1) {
    const result = await processUniversalTransaction(transactions[0], portal);
    return [result];
  }
  
  // For small batches (2-15), process all in parallel
  if (transactions.length <= 15) {
    const allPromises = transactions.map(transaction => processUniversalTransaction(transaction, portal));
    const allResults = await Promise.allSettled(allPromises);
    
    // Collect results
    for (let index = 0; index < allResults.length; index++) {
      const result = allResults[index];
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        const transaction = transactions[index] as CassoflowTransaction | SepayTransaction;
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
  
  // For medium to large batches (16-100), use adaptive concurrency
  const CONCURRENCY_LIMIT = getOptimalConcurrency(portal, transactions.length);
  
  for (let i = 0; i < transactions.length; i += CONCURRENCY_LIMIT) {
    const chunk = transactions.slice(i, i + CONCURRENCY_LIMIT);
    
    const chunkPromises = chunk.map(transaction => processUniversalTransaction(transaction, portal));
    const chunkResults = await Promise.allSettled(chunkPromises);
    
    // Collect results
    for (let index = 0; index < chunkResults.length; index++) {
      const result = chunkResults[index];
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        const transaction = chunk[index] as CassoflowTransaction | SepayTransaction;
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

// OPTIMIZATION: Enhanced race condition handling for webhook/order API timing issues
async function processPaymentWithRaceConditionHandling(
  odrId: string, 
  amount: number, 
  bankAccountNumber: string,
  bankInfo: Awaited<ReturnType<typeof findBankByAccountNumber>>['bank']
): Promise<{ success: boolean; message?: string; data?: unknown; isOverpayment?: boolean }> {
  
  // If client-only payment mode is enabled, check Supabase first
  if (appConfig.useClientOnlyPayment) {
    try {
      const backupService = new BackupOrderService();
      const backupOrder = await backupService.getBackupOrder(odrId);
      
      if (backupOrder) {
        // Order found in Supabase - update it directly
        const currentPaidAmount = backupOrder.paid_amount || 0;
        const newPaidAmount = currentPaidAmount + amount;
        const unpaidAmount = Math.max(0, backupOrder.amount - newPaidAmount);
        const isFullyPaid = unpaidAmount === 0;
        const isOverpayment = newPaidAmount > backupOrder.amount;
        
        const newStatus = isFullyPaid ? 'completed' : 'processing';
        await backupService.updateOrderStatus(odrId, newStatus, newPaidAmount);
        
        await log.info('Payment processed for Supabase order', {
          odrId,
          amount,
          previousPaid: currentPaidAmount,
          newPaid: newPaidAmount,
          unpaid: unpaidAmount,
          status: newStatus,
          mode: 'client-only'
        });
        
        // NOTE: Order only exists in Supabase, not in Appwrite
        // Client-only payment page will subscribe to Supabase realtime for updates
        
        return {
          success: true,
          message: 'Payment processed successfully in Supabase',
          isOverpayment,
          data: { odrId, paidAmount: newPaidAmount, status: newStatus }
        };
      }
      
      // Order not found in Supabase, fall through to Appwrite check
      await log.warn('Order not found in Supabase, checking Appwrite', {
        odrId,
        amount,
        mode: 'client-only'
      });
    } catch (error) {
      await log.error('Error checking Supabase for order', error instanceof Error ? error : new Error(String(error)), {
        odrId,
        amount
      });
      // Fall through to Appwrite check on error
    }
  }
  
  // Standard Appwrite processing (normal mode or fallback)
  let result = await proccessTransactionPayment(odrId, amount);
  
  // If order not found, implement retry logic for race condition with order creation API
  if (!result.success && result.message?.includes('not found')) {
    // Wait briefly and retry - order might be created milliseconds after webhook arrives
    await new Promise(resolve => setTimeout(resolve, 150)); // 150ms delay
    
    result = await proccessTransactionPayment(odrId, amount);
    
    // If still not found after first retry, try one more time with longer delay
    if (!result.success && result.message?.includes('not found')) {
      await new Promise(resolve => setTimeout(resolve, 350)); // 350ms delay  
      
      result = await proccessTransactionPayment(odrId, amount);
      
      // If STILL not found and client-only payment mode is enabled, create order retroactively
      if (!result.success && result.message?.includes('not found') && appConfig.useClientOnlyPayment && bankInfo) {
        await log.warn('Order not found after retries - creating retroactively', {
          odrId,
          amount,
          bankAccountNumber,
          feature: 'clientOnlyPayment'
        });
        
        try {
          // Create retroactive order
          const retroResult = await createRetroactiveOrder(odrId, amount, bankInfo);
          
          if (retroResult.success) {
            await log.info('Retroactive order created successfully', {
              odrId,
              amount,
              merchantId: retroResult.merchantId
            });
            
            // Try processing payment one more time
            result = await proccessTransactionPayment(odrId, amount);
          } else {
            await log.error('Failed to create retroactive order', new Error(retroResult.message || 'Unknown error'), {
              odrId,
              amount,
              bankAccountNumber
            });
          }
        } catch (error) {
          await log.error('Error creating retroactive order', error instanceof Error ? error : new Error(String(error)), {
            odrId,
            amount,
            bankAccountNumber
          });
        }
      }
    }
  }
  
  return result;
}

// NEW: Create retroactive order when payment arrives but order doesn't exist
async function createRetroactiveOrder(
  odrId: string,
  amount: number,
  bankInfo: NonNullable<Awaited<ReturnType<typeof findBankByAccountNumber>>['bank']>
): Promise<{ success: boolean; message?: string; merchantId?: string }> {
  try {
    const { database } = await createAdminClient();
    
    // Get merchant account ID from bank info
    if (!bankInfo.account || typeof bankInfo.account !== 'string') {
      return {
        success: false,
        message: 'Bank info missing merchant account reference'
      };
    }
    
    // Get full account details
    const merchantAccount = await database.getDocument(
      appwriteConfig.databaseId,
      appwriteConfig.accountsCollectionId,
      bankInfo.account
    );
    
    if (!merchantAccount) {
      return {
        success: false,
        message: 'Merchant account not found'
      };
    }
    
    // Create completed transaction
    const transactionData = {
      odrId,
      merchantOrdId: '', // Unknown - payment came before order creation
      odrType: 'deposit' as const,
      odrStatus: 'completed' as const,
      bankId: bankInfo.bankId,
      amount: Math.floor(amount),
      paidAmount: Math.floor(amount),
      unPaidAmount: 0,
      positiveAccount: merchantAccount.publicTransactionId,
      negativeAccount: '',
      urlSuccess: '',
      urlFailed: '',
      urlCanceled: '',
      urlCallBack: '',
      qrCode: null,
      lastPaymentDate: new Date().toISOString(),
      account: merchantAccount.$id,
      createdIp: 'webhook-retroactive',
      isSuspicious: false,
    };
    
    const createdOrder = await database.createDocument(
      appwriteConfig.databaseId,
      appwriteConfig.odrtransCollectionId,
      ID.unique(),
      transactionData
    );
    
    // Update merchant balance
    await updateAccountBalance(
      merchantAccount.publicTransactionId,
      amount,
      true,  // Update current balance
      true,  // Update available balance
      true   // Add the amount (positive)
    );
    
    await log.info('Retroactive order created and balance updated', {
      odrId: createdOrder.odrId,
      orderId: createdOrder.$id,
      merchantId: merchantAccount.publicTransactionId,
      amount: createdOrder.amount,
      timestamp: createdOrder.$createdAt
    });
    
    return {
      success: true,
      message: 'Order created retroactively',
      merchantId: merchantAccount.publicTransactionId
    };
    
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to create retroactive order'
    };
  }
}

// UNIVERSAL: Convert any portal transaction to standard format
function normalizeTransaction(transaction: CassoflowTransaction | SepayTransaction | SecretAgentTransaction, portal: string): UniversalTransactionData {
  if (portal === 'cassoflow') {
    const cassoTransaction = transaction as CassoflowTransaction;
    return {
      id: cassoTransaction.id,
      amount: cassoTransaction.amount,
      accountNumber: cassoTransaction.accountNumber || cassoTransaction.bank_sub_acc_id || cassoTransaction.subAccId || '',
      description: cassoTransaction.description,
      balance: cassoTransaction.runningBalance || cassoTransaction.cusum_balance || 0,
      transactionDate: cassoTransaction.transactionDateTime || cassoTransaction.when || new Date().toISOString(),
      bankName: cassoTransaction.bankName
    };
  }
  
  if (portal === 'sepay') {
    const sepayTransaction = transaction as SepayTransaction;
    // Sepay uses transferType to indicate direction: 'in' for credit, 'out' for debit
    const amount = sepayTransaction.transferType === 'out' 
      ? -Math.abs(sepayTransaction.transferAmount) 
      : Math.abs(sepayTransaction.transferAmount);
    
    return {
      id: sepayTransaction.id,
      amount: amount,
      accountNumber: sepayTransaction.accountNumber,
      description: sepayTransaction.content || sepayTransaction.description || '',
      balance: sepayTransaction.accumulated || 0,
      transactionDate: sepayTransaction.transactionDate || new Date().toISOString(),
      bankName: sepayTransaction.gateway
    };
  }
  
  if (portal === 'secretagent') {
    const secretAgentTransaction = transaction as SecretAgentTransaction;
    return {
      id: secretAgentTransaction.id,
      transactionDate: secretAgentTransaction.transactiondate,
      bankName: secretAgentTransaction.bank_name,
      accountNumber: secretAgentTransaction.accountNumber,
      amount: secretAgentTransaction.amount,
      description: secretAgentTransaction.content,
      balance: secretAgentTransaction.balance
    };
  }
  
  // For future portals, add here...
  throw new Error(`Unsupported portal: ${portal}`);
}

// UNIVERSAL: Validate transaction ID for any portal
function validateTransactionId(id: number): string {
  if (!id || id <= 0) {
    throw new Error(`Invalid transaction ID: ${id}. Transaction must have valid ID.`);
  }
  
  const transactionId = id.toString();
  if (!/^\d+$/.test(transactionId)) {
    throw new Error(`Invalid transaction ID format: ${transactionId}. Must be numeric.`);
  }
  
  return transactionId;
}

// Interface for detailed transaction processing metrics
interface TransactionProcessingMetrics {
  dataValidation: number;
  lookupOperations: number;  // Combined: duplicate check, bank lookup, order ID extraction
  entryCreation: number;
  bankAndPayment: number;     // Combined: bank balance update + payment processing
  statusUpdate: number;
  total: number;
}

// UNIVERSAL: Process any portal transaction with detailed metrics
async function processUniversalTransaction(
  transaction: CassoflowTransaction | SepayTransaction | SecretAgentTransaction, 
  portal: string
): Promise<WebhookResult & { metrics?: TransactionProcessingMetrics }> {
  
  const processingMetrics: TransactionProcessingMetrics = {
    dataValidation: 0,
    lookupOperations: 0,
    entryCreation: 0,
    bankAndPayment: 0,
    statusUpdate: 0,
    total: 0
  };
  const txStartTime = performance.now();
  
  try {
    // Phase 1: Data validation and normalization
    const validationStart = performance.now();
    const normalizedTx = normalizeTransaction(transaction, portal);
    
    // VALIDATION: Validate transaction ID first before any processing
    let portalTransactionId: string;
    try {
      portalTransactionId = validateTransactionId(normalizedTx.id);
    } catch (validationError) {
      processingMetrics.dataValidation = performance.now() - validationStart;
      processingMetrics.total = performance.now() - txStartTime;
      return {
        id: normalizedTx.id || 'INVALID',
        status: 'failed',
        message: `Transaction ID validation failed: ${validationError instanceof Error ? validationError.message : 'Unknown validation error'}`,
        metrics: processingMetrics
      };
    }
    processingMetrics.dataValidation = performance.now() - validationStart;
    
    // Phase 2: Parallel lookup operations (duplicate check, bank lookup, order ID extraction)
    const lookupStart = performance.now();
    let isDuplicate: boolean;
    let odrId: string | null;
    let bankResult: Awaited<ReturnType<typeof findBankByAccountNumberOptimized>>;

    // Detect if this is part of a bulk operation for circuit breaker optimization
    const isBulkOperation = false; // Individual transactions within a batch are not bulk operations themselves

    if (portal === 'secretagent') {
      // SecretAgent provides order ID directly, but still validate bank account like other portals
      const secretAgentTx = transaction as SecretAgentTransaction;
      [isDuplicate, bankResult] = await Promise.all([
        checkDuplicateTransactionOptimized(portal, portalTransactionId, isBulkOperation),
        normalizedTx.accountNumber 
          ? findBankByAccountNumberOptimized(normalizedTx.accountNumber, isBulkOperation)
          : Promise.resolve({ success: false, bank: null, message: 'No account number provided' })
      ]);
      odrId = secretAgentTx.odrId;
    } else {
      [isDuplicate, odrId, bankResult] = await Promise.all([
        // 1. Check for duplicates with circuit breaker
        checkDuplicateTransactionOptimized(portal, portalTransactionId, isBulkOperation),
        
        // 2. Extract order ID with caching (now synchronous when cached)
        Promise.resolve(extractOrderIdOptimized(normalizedTx.description)),
        
        // 3. Find bank by account number with circuit breaker
        normalizedTx.accountNumber 
          ? findBankByAccountNumberOptimized(normalizedTx.accountNumber, isBulkOperation)
          : Promise.resolve({ success: false, bank: null, message: 'No account number provided' })
      ]);
    }
    processingMetrics.lookupOperations = performance.now() - lookupStart;

    // Handle duplicate transactions
    if (isDuplicate) {
      processingMetrics.total = performance.now() - txStartTime;
      return {
        id: normalizedTx.id,
        status: 'duplicated',
        message: 'Transaction already processed',
        metrics: processingMetrics
      };
    }

    // Handle missing account number
    if (!bankResult.success || !bankResult.bank) {
      processingMetrics.total = performance.now() - txStartTime;
      return {
        id: normalizedTx.id,
        status: 'failed',
        message: bankResult.message || `Bank account not found in ${portal} transfer`,
        metrics: processingMetrics
      };
    }

    // Phase 3 & 4: OPTIMIZED - Run createEntry, bankUpdate, and payment in PARALLEL
    // This is the KEY performance improvement - no more waiting!
    const parallelStart = performance.now();
    const transactionType: TransactionType = normalizedTx.amount < 0 ? 'debit' : 'credit';

    const bankTransactionData: BankTransactionEntryData = {
      portalId: portal,
      portalTransactionId: portalTransactionId,
      odrId: odrId || 'UNKNOWN',
      bankId: bankResult.bank?.$id,
      bankName: bankResult.bank?.bankName || normalizedTx.bankName || '',
      bankAccountNumber: normalizedTx.accountNumber,
      amount: Math.floor(normalizedTx.amount),
      transactionType: transactionType,
      balanceAfter: Math.floor(normalizedTx.balance),
      transactionDate: normalizedTx.transactionDate,
      rawPayload: '', // Start empty - will only store on error for debugging
      status: 'pending',
      notes: !odrId
        ? 'Order ID not found in transaction description, recording transaction only'
        : 'Bank found, processing transaction'
    };

    // OPTIMIZATION: Adaptive timeout based on batch size and portal performance
    const getAdaptiveTimeout = (transactionCount: number, portal: string): number => {
      const baseTimeout = 8000; // Base 8 seconds for single transactions
      const metrics = portalMetrics.get(portal);
      
      // Increase timeout for bulk operations
      const batchMultiplier = Math.min(Math.ceil(transactionCount / 10), 6); // Max 6x for 60+ transactions
      
      // Adjust based on portal performance
      const performanceMultiplier = metrics && metrics.averageResponseTime > 1000 ? 1.5 : 1;
      
      // Network conditions adjustment (if error rate is high, allow more time)
      const networkMultiplier = metrics && metrics.errorRate > 0.05 ? 1.3 : 1;
      
      return Math.min(
        baseTimeout * batchMultiplier * performanceMultiplier * networkMultiplier,
        120000 // Maximum 2 minutes to prevent webhook timeout
      );
    };
    
    const OPERATION_TIMEOUT = getAdaptiveTimeout(1, portal);
    
    const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
      return Promise.race([
        promise,
        new Promise<T>((_, reject) => 
          setTimeout(() => reject(new Error(`Operation timeout after ${timeoutMs}ms`)), timeoutMs)
        )
      ]);
    };

    // IMPROVEMENT: PARALLEL EXECUTION with retry logic - Run all 3 operations at once (MAJOR PERFORMANCE BOOST)
    // In client-only mode, we save bank entry to Supabase and only process Supabase order
    const [entryResult_settled, bankUpdateResult, paymentResult] = appConfig.useClientOnlyPayment
      ? await Promise.allSettled([
          // Save bank entry to Supabase backup
          withTimeout(
            (async () => {
              const bankEntryService = new BankTransactionEntryService();
              const result = await bankEntryService.createBankTransactionEntry({
                portal_id: portal,
                portal_transaction_id: portalTransactionId,
                odr_id: odrId || 'UNKNOWN',
                bank_id: bankResult.bank?.$id,
                bank_name: bankResult.bank?.bankName || normalizedTx.bankName || '',
                bank_account_number: normalizedTx.accountNumber,
                amount: Math.floor(normalizedTx.amount),
                transaction_type: transactionType,
                balance_after: Math.floor(normalizedTx.balance),
                status: 'pending',
                notes: 'Client-only mode - saved to Supabase'
              });
              return { 
                success: result.success, 
                entry: result.id ? { $id: result.id } : null,
                message: result.error
              };
            })(),
            OPERATION_TIMEOUT
          ),
          // Skip bank balance update (Appwrite unavailable)
          Promise.resolve({ success: true }),
          // Only process Supabase order payment
          odrId && Math.abs(normalizedTx.amount) > 0 
            ? withTimeout(
                processPaymentWithRaceConditionHandling(
                  odrId, 
                  Math.abs(normalizedTx.amount),
                  normalizedTx.accountNumber,
                  bankResult.bank
                ),
                OPERATION_TIMEOUT
              )
            : Promise.resolve({ success: false, message: 'No valid order ID or amount' })
        ])
      : await Promise.allSettled([
          // 1. Create entry with retry logic for transient failures
          withTimeout(
            retryWithBackoff(
              () => createBankTransactionEntry(bankTransactionData),
              3,
              150,
              `create-entry-${portalTransactionId}`
            ),
            OPERATION_TIMEOUT
          ),
          // 2. Update bank balance with retry logic
          withTimeout(
            retryWithBackoff(
              () => updateBankBalance(
                bankResult.bank!.bankId,
                Math.abs(Math.floor(normalizedTx.amount)),
                true,
                true,
                Math.floor(normalizedTx.amount) >= 0
              ),
              3,
              150,
              `update-balance-${bankResult.bank!.bankId}`
            ),
            OPERATION_TIMEOUT
          ),
          // 3. Process payment (if valid order) - already has retry logic in processPaymentWithRaceConditionHandling
          odrId && Math.abs(normalizedTx.amount) > 0 
            ? withTimeout(
                processPaymentWithRaceConditionHandling(
                  odrId, 
                  Math.abs(normalizedTx.amount),
                  normalizedTx.accountNumber,
                  bankResult.bank
                ),
                OPERATION_TIMEOUT
              )
            : Promise.resolve({ success: false, message: 'No valid order ID or amount' })
        ]);

    const parallelEnd = performance.now();
    processingMetrics.entryCreation = parallelEnd - parallelStart; // All 3 operations together
    processingMetrics.bankAndPayment = 0; // Already included in entryCreation

    // Extract results
    const entryResult = entryResult_settled.status === 'fulfilled' 
      ? entryResult_settled.value 
      : { success: false, message: 'Entry creation failed', entry: null };
    
    const bankResult_final = bankUpdateResult.status === 'fulfilled' 
      ? bankUpdateResult.value 
      : { success: false, message: 'Bank update failed' };
    
    const paymentResult_final = paymentResult.status === 'fulfilled' 
      ? paymentResult.value 
      : { success: false, message: 'Payment processing failed' };

    // DEBUG: Log results in client-only mode
    if (appConfig.useClientOnlyPayment) {
      console.log('🔍 Client-only mode results:', {
        txId: normalizedTx.id,
        odrId,
        entryResult: { success: entryResult.success, hasEntry: !!entryResult.entry },
        bankResult: { success: bankResult_final.success },
        paymentResult: { success: paymentResult_final.success, message: paymentResult_final.message }
      });
    }

    // Validate bank entry creation (skip validation in client-only mode since we're using Supabase)
    if (!appConfig.useClientOnlyPayment && (!entryResult.success || !entryResult.entry)) {
      // IMPORTANT: On error, update entry with error details for debugging
      // Note: rawPayload is empty, but error message provides context
      processingMetrics.total = performance.now() - txStartTime;
      const errorMessage = 'message' in entryResult ? entryResult.message : 'Failed to create transaction entry';
      return {
        id: normalizedTx.id,
        status: 'failed',
        message: errorMessage || 'Failed to create transaction entry',
        metrics: processingMetrics
      };
    }

    // Also check Supabase entry creation in client-only mode
    // NOTE: In client-only mode, entry creation failure (e.g., duplicate) should not fail the transaction
    // if payment processing succeeds. Entry is just for logging/tracking.
    if (appConfig.useClientOnlyPayment && !entryResult.success) {
      // If entry creation failed but payment succeeded, continue with success
      if (paymentResult_final.success) {
        await log.warn('Bank entry creation failed but payment succeeded (client-only mode)', {
          txId: normalizedTx.id,
          odrId,
          entryError: entryResult.message || 'Unknown error',
          paymentSuccess: true
        });
        // Continue processing - don't return failed
      } else {
        // Both entry and payment failed - return error
        processingMetrics.total = performance.now() - txStartTime;
        const errorMessage = 'message' in entryResult ? entryResult.message : 'Failed to create transaction entry in Supabase';
        return {
          id: normalizedTx.id,
          status: 'failed',
          message: errorMessage || 'Failed to create transaction entry in Supabase',
          metrics: processingMetrics
        };
      }
    }

    let finalStatus: TransactionStatus = 'pending';
    let finalNotes = '';

    // Handle transactions without order ID
    if (!odrId) {
      const statusUpdateStart = performance.now();
      finalStatus = 'unlinked' as TransactionStatus;
      finalNotes = appConfig.useClientOnlyPayment 
        ? 'Transaction without order ID - client-only mode'
        : 'Transaction recorded without order ID';

      // Update status in background for transactions without order ID
      if (entryResult.entry) {
        if (appConfig.useClientOnlyPayment) {
          // Update in Supabase
          const bankEntryService = new BankTransactionEntryService();
          bankEntryService.updateBankTransactionEntryStatus(
            entryResult.entry.$id, 
            finalStatus as 'pending' | 'processed' | 'available' | 'failed' | 'unlinked', 
            finalNotes
          ).catch(updateError => {
              console.error('Supabase status update error for transaction:', normalizedTx.id, updateError);
            });
        } else {
          // Update in Appwrite
          updateBankTransactionEntryStatus(entryResult.entry.$id, finalStatus, finalNotes)
            .catch(updateError => {
              console.error('Status update error for transaction:', normalizedTx.id, updateError);
            });
        }
      }
      processingMetrics.statusUpdate = performance.now() - statusUpdateStart;
      processingMetrics.total = performance.now() - txStartTime;

      return {
        id: normalizedTx.id,
        status: finalStatus,
        bankId: bankResult.bank.bankId,
        odrId: null,
        amount: Math.floor(normalizedTx.amount),
        message: finalNotes,
        metrics: processingMetrics
      };
    }

    // Check if order is overpaid
    const isOrderFullyPaid = paymentResult_final.success && 'isOverpayment' in paymentResult_final && Boolean(paymentResult_final.isOverpayment);

    // Determine final status based on results and overpayment status
    // In client-only mode, bank operations are skipped, so we only check payment result
    if (!appConfig.useClientOnlyPayment && !bankResult_final.success) {
      finalStatus = 'failed';
      const bankMessage = 'message' in bankResult_final ? bankResult_final.message : 'Unknown error';
      finalNotes = `Failed to update bank balance: ${bankMessage} | TxID: ${normalizedTx.id}`;
      
      // Error details are in notes, rawPayload stays empty (already set above)
    } else if (isOrderFullyPaid) {
      // Order is already fully paid - mark as available for redemption
      finalStatus = 'available' as TransactionStatus;
      if (!appConfig.useClientOnlyPayment && 'previousBalance' in bankResult_final && 'newBalance' in bankResult_final) {
        const prevBalance = (bankResult_final.previousBalance as { current?: number })?.current;
        const newBalance = (bankResult_final.newBalance as { current?: number })?.current;
        finalNotes = `Bank balance updated successfully. Previous: ${prevBalance}, New: ${newBalance} | Order already fully paid, marked as available for redemption`;
      } else {
        finalNotes = `Order already fully paid (client-only mode)`;
      }
      
      // OPTIMIZATION: Move order details lookup to background (non-blocking)
      if (entryResult.entry) {
        if (appConfig.useClientOnlyPayment) {
          // Update in Supabase
          const bankEntryService = new BankTransactionEntryService();
          getTransactionByOrderId(odrId)
            .then(orderDetails => {
              if (orderDetails) {
                const enhancedNotes = finalNotes + ` | Original order type: ${orderDetails.odrType}`;
                bankEntryService.updateBankTransactionEntryStatus(entryResult.entry!.$id, finalStatus as 'available', enhancedNotes)
                  .catch(error => console.error('Supabase background order details update error:', error));
              }
            })
            .catch(error => console.error('Background order details lookup error:', error));
        } else {
          // Update in Appwrite
          getTransactionByOrderId(odrId)
            .then(orderDetails => {
              if (orderDetails) {
                const enhancedNotes = finalNotes + ` | Original order type: ${orderDetails.odrType}`;
                updateBankTransactionEntryStatus(entryResult.entry!.$id, finalStatus, enhancedNotes)
                  .catch(error => console.error('Background order details update error:', error));
              }
            })
            .catch(error => console.error('Background order details lookup error:', error));
        }
      }
    } else {
      // Normal processing - bank updated and payment processed
      finalStatus = paymentResult_final.success ? 'processed' : 'failed';
      
      if (!appConfig.useClientOnlyPayment && 'previousBalance' in bankResult_final && 'newBalance' in bankResult_final) {
        const prevBalance = (bankResult_final.previousBalance as { current?: number })?.current;
        const newBalance = (bankResult_final.newBalance as { current?: number })?.current;
        finalNotes = `Bank balance updated. Previous: ${prevBalance}, New: ${newBalance}`;
      } else {
        finalNotes = `Payment processed (client-only mode)`;
      }
      
      if (paymentResult_final.success) {
        finalNotes += ` | Order payment: Success`;
      } else {
        finalNotes += ` | Order payment: Failed - ${paymentResult_final.message || 'Unknown error'}`;
      }
    }

    // Phase 5: Update status in background to avoid blocking webhook response
    const statusUpdateStart = performance.now();
    if (entryResult.entry) {
      if (appConfig.useClientOnlyPayment) {
        // Update in Supabase
        const bankEntryService = new BankTransactionEntryService();
        bankEntryService.updateBankTransactionEntryStatus(
          entryResult.entry.$id, 
          finalStatus as 'pending' | 'processed' | 'available' | 'failed' | 'unlinked', 
          finalNotes
        ).catch(updateError => {
          console.error('Supabase status update error for transaction:', normalizedTx.id, updateError);
        });
      } else {
        // Update in Appwrite
        updateBankTransactionEntryStatus(entryResult.entry.$id, finalStatus, finalNotes)
          .catch(updateError => {
            console.error('Status update error for transaction:', normalizedTx.id, updateError);
          });
      }
    }
    processingMetrics.statusUpdate = performance.now() - statusUpdateStart;
    processingMetrics.total = performance.now() - txStartTime;

    // Fetch url_callback and additional order details if in client-only mode and odrId exists
    let urlCallback: string | undefined;
    let merchantOrdId: string | undefined;
    let orderType: 'deposit' | 'withdraw' | undefined;
    let odrStatus: string | undefined;
    let bankReceiveNumber: string | undefined;
    let bankReceiveOwnerName: string | undefined;
    let paidAmount: number | undefined;

    if (appConfig.useClientOnlyPayment && odrId) {
      try {
        const backupOrderService = new BackupOrderService();
        const order = await backupOrderService.getBackupOrder(odrId);
        if (order) {
          urlCallback = order.url_callback || undefined;
          merchantOrdId = order.merchant_odr_id || undefined;
          orderType = order.odr_type;
          odrStatus = order.odr_status;
          paidAmount = order.paid_amount || undefined;

          // Bank receive number - use account_number for deposit, bank_receive_number for withdraw
          if (order.odr_type === 'deposit') {
            bankReceiveNumber = order.account_number || undefined;
            bankReceiveOwnerName = order.account_name || undefined;
          } else if (order.odr_type === 'withdraw') {
            bankReceiveNumber = order.bank_receive_number || undefined;
            bankReceiveOwnerName = order.bank_receive_owner_name || undefined;
          }
        }
      } catch {
        // Silently fail - these fields are optional
      }
    }

    return {
      id: normalizedTx.id,
      status: finalStatus,
      bankId: bankResult.bank.bankId,
      odrId: odrId || null,
      amount: normalizedTx.amount,
      url_callback: urlCallback,
      merchantOrdId,
      orderType,
      odrStatus,
      bankReceiveNumber,
      bankReceiveOwnerName,
      paidAmount,
      message: `Transaction ${finalStatus === 'processed' ? 'processed successfully' : 
                finalStatus === 'available' ? 'recorded as available for redemption' : 'failed'}`,
      metrics: processingMetrics
    };

  } catch (error) {
    // Log individual transaction errors silently to console for debugging
    const rawTransaction = transaction as CassoflowTransaction | SepayTransaction;
    const errorId = rawTransaction?.id || 'unknown';
    console.error('Transaction processing error:', errorId, error);

    // IMPORTANT: On error, try to save rawPayload for debugging
    try {
      const errorEntryData: BankTransactionEntryData = {
        portalId: portal,
        portalTransactionId: String(errorId), // Convert to string
        odrId: 'ERROR',
        bankName: 'Error Entry',
        bankAccountNumber: 'N/A',
        amount: 0,
        transactionType: 'credit',
        balanceAfter: 0,
        transactionDate: new Date().toISOString(),
        rawPayload: JSON.stringify(transaction), // Store full payload on error
        status: 'failed',
        notes: `Error: ${error instanceof Error ? error.message : String(error)}`
      };
      await createBankTransactionEntry(errorEntryData);
    } catch (saveError) {
      console.error('Failed to save error transaction entry:', saveError);
    }

    // Include partial metrics even on error
    processingMetrics.total = performance.now() - txStartTime;
    return {
      id: errorId,
      status: 'failed',
      message: `Error processing transaction: ${error instanceof Error ? error.message : String(error)}`,
      metrics: processingMetrics
    };
  }
}

// POST /api/webhook/payment - Receive payment updates from third-party  
export async function POST(
  request: NextRequest,
  context: Props
) {
  // OPTIMIZATION: Comprehensive performance monitoring with detailed phase tracking
  const requestStartTime = performance.now();
  const performanceMetrics = {
    // Phase 1: Setup + Validation + Authentication (combined small operations)
    setupAndValidation: 0,
    
    // Phase 2: Payload parsing
    payloadParsing: 0,
    
    // Phase 3: Core transaction processing (DB operations, business logic)
    transactionProcessing: 0,
    
    // Phase 4: Total request time
    total: 0
  };

  try {
    // Start timing for setup + validation combined
    const setupValidationStart = performance.now();
    
    const params = await context.params;
    const portal = params.portal.toLowerCase();
    
    // Fast-path: Check environment variables first (cached in memory)
    const CASSOFLOW_API_KEY = process.env.CASSOFLOW_API_KEY;
    const SEPAY_API_KEY = process.env.SEPAY_API_KEY;
    const SECRETAGENT_WEBHOOK_API_KEY = process.env.SECRETAGENT_WEBHOOK_API_KEY;
    
    // Read payload once
    const payload = await request.text();

    // CRITICAL: Never return errors for valid webhook structure - banking systems resend failures
    // Only log issues for debugging, but always process the transaction data

    switch (portal) {
      case 'cassoflow':
        // CRITICAL: Never fail cassoflow webhooks - banking systems resend failures
        const validationIssues: string[] = [];
        
        // Validate but log issues instead of failing
        if (!CASSOFLOW_API_KEY) {
          validationIssues.push('Missing CASSOFLOW_API_KEY environment variable');
        }
        
        const cassoSignature = request.headers.get('X-Casso-Signature');
        if (!cassoSignature) {
          validationIssues.push('Missing X-Casso-Signature header');
        }
        
        if (!payload || payload.length === 0) {
          validationIssues.push('Empty or missing payload');
        }

        // If critical validation failed, log and return success to prevent resend
        if (validationIssues.length > 0) {
          performanceMetrics.setupAndValidation = performance.now() - setupValidationStart;
          performanceMetrics.total = performance.now() - requestStartTime;
          
          await log.performance(`Webhook ${portal} validation failed`, performanceMetrics.total, {
            portal,
            phases: {
              setupAndValidation: Math.round(performanceMetrics.setupAndValidation),
              totalTime: Math.round(performanceMetrics.total)
            },
            result: 'validation_failed'
          });
          
          return NextResponse.json({
            success: true, // CRITICAL: Always return success to prevent resend
            message: `Webhook received but has validation issues: ${validationIssues.join(', ')}`,
            processed: 0,
            issues: validationIssues
          });
        }

        // Parse the payload with error handling
        const parsingStart = performance.now();
        let payloadParsed: CassoflowPayload;
        try {
          payloadParsed = JSON.parse(payload) as CassoflowPayload;
        } catch (parseError) {
          performanceMetrics.setupAndValidation = parsingStart - setupValidationStart;
          performanceMetrics.payloadParsing = performance.now() - parsingStart;
          performanceMetrics.total = performance.now() - requestStartTime;
          
          await log.performance(`Webhook ${portal} parse failed`, performanceMetrics.total, {
            portal,
            phases: {
              setupAndValidation: Math.round(performanceMetrics.setupAndValidation),
              payloadParsing: Math.round(performanceMetrics.payloadParsing),
              totalTime: Math.round(performanceMetrics.total)
            },
            result: 'parse_failed'
          });
          
          return NextResponse.json({
            success: true, // CRITICAL: Always return success
            message: 'Webhook received but JSON parsing failed',
            processed: 0,
            parseError: parseError instanceof Error ? parseError.message : 'Unknown error'
          });
        }
        
        // Complete setup+validation phase timing
        performanceMetrics.setupAndValidation = parsingStart - setupValidationStart;
        performanceMetrics.payloadParsing = performance.now() - parsingStart;

        // Verify signature but don't fail - log for debugging
        let isSignatureValid = false;
        if (cassoSignature && CASSOFLOW_API_KEY) {
          try {
            isSignatureValid = verifyCassoflowSignature(payloadParsed, cassoSignature, CASSOFLOW_API_KEY);
          } catch (sigError) {
            await log.warn(`Cassoflow signature verification error`, {
              portal: 'cassoflow',
              error: sigError instanceof Error ? sigError.message : 'Unknown signature error',
              timestamp: new Date().toISOString()
            });
          }
        }
        
        if (!isSignatureValid) {
          await log.warn(`Cassoflow webhook signature verification failed - returning success to prevent resend`, {
            portal: 'cassoflow',
            headers: Object.fromEntries(request.headers.entries()),
            body: payload,
            timestamp: new Date().toISOString()
          });
          
          return NextResponse.json({
            success: true, // CRITICAL: Always return success to prevent resend
            message: 'Webhook received but signature verification failed',
            processed: 0,
            signatureValid: false
          });
        }

        // Validate payload structure but don't fail
        if (!payloadParsed || !payloadParsed.data) {
          await log.warn(`Cassoflow webhook invalid payload structure - returning success to prevent resend`, {
            portal: 'cassoflow',
            headers: Object.fromEntries(request.headers.entries()),
            body: payload,
            parsedBody: payloadParsed,
            timestamp: new Date().toISOString()
          });
          
          return NextResponse.json({
            success: true, // CRITICAL: Always return success
            message: 'Webhook received but payload structure is invalid',
            processed: 0
          });
        }

        // Process transaction data
        let transactionsToProcess: (CassoflowTransaction | SepayTransaction)[] = [];
        let processingMode: 'single' | 'bulk' = 'single';
        
        if (Array.isArray(payloadParsed.data)) {
          if (payloadParsed.data.length === 0) {
            return NextResponse.json({
              success: true, // CRITICAL: Always return success
              message: 'Webhook received but data array is empty',
              processed: 0
            });
          }
          transactionsToProcess = payloadParsed.data;
          processingMode = payloadParsed.data.length > 1 ? 'bulk' : 'single';
        } else if (typeof payloadParsed.data === 'object' && payloadParsed.data !== null) {
          transactionsToProcess = [payloadParsed.data as CassoflowTransaction];
          processingMode = 'single';
        } else {
          return NextResponse.json({
            success: true, // CRITICAL: Always return success
            message: 'Webhook received but data format is invalid',
            processed: 0
          });
        }

        // Payload parsed successfully - details will be in final summary

        // Process transactions (typically 1 transaction per webhook)
        const transactionProcessingStart = performance.now();
        
        const results = await processTransactionsBatch(transactionsToProcess, portal);
        performanceMetrics.transactionProcessing = performance.now() - transactionProcessingStart;
        performanceMetrics.total = performance.now() - requestStartTime;

        // OPTIMIZATION: Update portal performance metrics
        const failureCount = results.filter(r => r.status === 'failed').length;
        updatePortalMetrics(portal, performanceMetrics.total, failureCount === 0);

        // Return unified response with automatic logging
        return await createWebhookResponse({
          portal: 'cassoflow',
          processingMode,
          transactionCount: transactionsToProcess.length,
          dataFormat: Array.isArray(payloadParsed.data) ? 'array' : 'object',
          supportsBoth: true,
          results,
          performanceMetrics,
          cacheHitRate: calculateCacheHitRate(),
          optimalConcurrency: getOptimalConcurrency(portal, transactionsToProcess.length),
          optimizationsApplied: ['parallel-processing', 'caching', 'background-tasks', 'batch-operations', 'dual-format-support', 'connection-pooling', 'adaptive-concurrency', 'cross-portal-metrics']
        });

      case 'sepay':
        // CRITICAL: Never fail sepay webhooks - banking systems resend failures
        const sepayValidationIssues: string[] = [];
        
        // Validate but log issues instead of failing
        if (!SEPAY_API_KEY) {
          sepayValidationIssues.push('Missing SEPAY_API_KEY environment variable');
        }
        
        const sepayAuthorization = request.headers.get('authorization');
        if (!sepayAuthorization) {
          sepayValidationIssues.push('Missing authorization header');
        } else {
          const expectedAuth = `Apikey ${SEPAY_API_KEY}`;
          if (sepayAuthorization !== expectedAuth) {
            sepayValidationIssues.push('Invalid authorization header format');
          }
        }
        
        if (!payload || payload.length === 0) {
          sepayValidationIssues.push('Empty or missing payload');
        }

        // If validation failed, log and return success to prevent resend
        if (sepayValidationIssues.length > 0) {
          await log.warn(`Sepay webhook validation issues - returning success to prevent resend`, {
            portal: 'sepay',
            issues: sepayValidationIssues,
            headers: Object.fromEntries(request.headers.entries()),
            bodyLength: payload?.length || 0,
            timestamp: new Date().toISOString()
          });
          
          return NextResponse.json({
            success: true, // CRITICAL: Always return success to prevent resend
            message: `Webhook received but has validation issues: ${sepayValidationIssues.join(', ')}`,
            processed: 0,
            issues: sepayValidationIssues
          });
        }

        // Complete setup+validation timing, start parsing
        performanceMetrics.setupAndValidation = performance.now() - setupValidationStart;
        const sepayParsingStart = performance.now();
        
        // Parse the payload with error handling
        let sepayPayloadParsed: SepayTransaction;
        try {
          sepayPayloadParsed = JSON.parse(payload) as SepayTransaction;
        } catch (parseError) {
          performanceMetrics.payloadParsing = performance.now() - sepayParsingStart;
          performanceMetrics.total = performance.now() - requestStartTime;
          
          await log.performance(`Webhook ${portal} parse failed`, performanceMetrics.total, {
            portal: 'sepay',
            error: parseError instanceof Error ? parseError.message : 'Unknown parse error',
            phases: {
              setupAndValidation: Math.round(performanceMetrics.setupAndValidation),
              payloadParsing: Math.round(performanceMetrics.payloadParsing),
              total: Math.round(performanceMetrics.total)
            },
            result: 'parse_failed'
          });
          
          return NextResponse.json({
            success: true, // CRITICAL: Always return success
            message: 'Webhook received but JSON parsing failed',
            processed: 0,
            parseError: parseError instanceof Error ? parseError.message : 'Unknown error'
          });
        }
        performanceMetrics.payloadParsing = performance.now() - sepayParsingStart;

        // Validate payload structure but don't fail
        if (!sepayPayloadParsed || !sepayPayloadParsed.id) {
          await log.warn(`Sepay webhook invalid payload structure - returning success to prevent resend`, {
            portal: 'sepay',
            headers: Object.fromEntries(request.headers.entries()),
            body: payload,
            parsedBody: sepayPayloadParsed,
            timestamp: new Date().toISOString()
          });
          
          return NextResponse.json({
            success: true, // CRITICAL: Always return success
            message: 'Webhook received but payload structure is invalid',
            processed: 0
          });
        }

        // Process single sepay transaction
        const sepayProcessingStart = performance.now();
        const sepayResult = await processUniversalTransaction(sepayPayloadParsed, portal);
        performanceMetrics.transactionProcessing = performance.now() - sepayProcessingStart;

        // Calculate final metrics
        performanceMetrics.total = performance.now() - requestStartTime;

        // OPTIMIZATION: Update portal performance metrics
        const sepayFailureCount = sepayResult.status === 'failed' ? 1 : 0;
        updatePortalMetrics(portal, performanceMetrics.total, sepayFailureCount === 0);

        // Return unified response with automatic logging (Sepay is always single transaction)
        return await createWebhookResponse({
          portal: 'sepay',
          processingMode: 'single',
          transactionCount: 1,
          dataFormat: 'object',
          supportsBoth: false,
          results: [sepayResult],
          performanceMetrics,
          cacheHitRate: calculateCacheHitRate(),
          optimalConcurrency: getOptimalConcurrency(portal, 1),
          optimizationsApplied: ['parallel-processing', 'caching', 'background-tasks', 'api-key-auth', 'connection-pooling', 'adaptive-concurrency', 'cross-portal-metrics']
        });

      case 'secretagent':
        // CRITICAL: Never fail secretagent webhooks - banking systems resend failures
        const secretAgentValidationIssues: string[] = [];
        
        // Validate but log issues instead of failing
        if (!SECRETAGENT_WEBHOOK_API_KEY) {
          secretAgentValidationIssues.push('Missing SECRETAGENT_WEBHOOK_API_KEY environment variable');
        }
        
        const secretAgentAuthorization = request.headers.get('authorization');
        if (!secretAgentAuthorization) {
          secretAgentValidationIssues.push('Missing authorization header');
        } else {
          const expectedAuth = `Bearer ${SECRETAGENT_WEBHOOK_API_KEY}`;
          if (secretAgentAuthorization !== expectedAuth) {
            secretAgentValidationIssues.push('Invalid authorization header format');
          }
        }
        
        if (!payload || payload.length === 0) {
          secretAgentValidationIssues.push('Empty or missing payload');
        }

        // If validation failed, log and return success to prevent resend
        if (secretAgentValidationIssues.length > 0) {
          await log.warn(`SecretAgent webhook validation issues - returning success to prevent resend`, {
            portal: 'secretagent',
            issues: secretAgentValidationIssues,
            headers: Object.fromEntries(request.headers.entries()),
            bodyLength: payload?.length || 0,
            timestamp: new Date().toISOString()
          });
          
          return NextResponse.json({
            success: true, // CRITICAL: Always return success to prevent resend
            message: `Webhook received but has validation issues: ${secretAgentValidationIssues.join(', ')}`,
            processed: 0,
            issues: secretAgentValidationIssues
          });
        }

        // Complete setup+validation timing, start parsing
        performanceMetrics.setupAndValidation = performance.now() - setupValidationStart;
        const secretAgentParsingStart = performance.now();
        
        // Parse the payload with error handling
        let secretAgentPayloadParsed: SecretAgentTransaction[];
        try {
          secretAgentPayloadParsed = JSON.parse(payload) as SecretAgentTransaction[];
        } catch (parseError) {
          performanceMetrics.payloadParsing = performance.now() - secretAgentParsingStart;
          performanceMetrics.total = performance.now() - requestStartTime;
          
          await log.performance(`Webhook ${portal} parse failed`, performanceMetrics.total, {
            portal: 'secretagent',
            error: parseError instanceof Error ? parseError.message : 'Unknown parse error',
            phases: {
              setupAndValidation: Math.round(performanceMetrics.setupAndValidation),
              payloadParsing: Math.round(performanceMetrics.payloadParsing),
              total: Math.round(performanceMetrics.total)
            },
            result: 'parse_failed'
          });
          
          return NextResponse.json({
            success: true, // CRITICAL: Always return success
            message: 'Webhook received but JSON parsing failed',
            processed: 0,
            parseError: parseError instanceof Error ? parseError.message : 'Unknown error'
          });
        }
        performanceMetrics.payloadParsing = performance.now() - secretAgentParsingStart;

        // Validate payload structure but don't fail
        if (!Array.isArray(secretAgentPayloadParsed) || secretAgentPayloadParsed.length === 0) {
          await log.warn(`SecretAgent webhook invalid payload structure - returning success to prevent resend`, {
            portal: 'secretagent',
            headers: Object.fromEntries(request.headers.entries()),
            body: payload,
            parsedBody: secretAgentPayloadParsed,
            timestamp: new Date().toISOString()
          });
          
          return NextResponse.json({
            success: true, // CRITICAL: Always return success
            message: 'Webhook received but payload structure is invalid',
            processed: 0
          });
        }

        // Process secretAgent transactions
        const secretAgentProcessingStart = performance.now();
        const secretAgentResults = await processTransactionsBatch(secretAgentPayloadParsed, portal);
        performanceMetrics.transactionProcessing = performance.now() - secretAgentProcessingStart;

        // Calculate final metrics
        performanceMetrics.total = performance.now() - requestStartTime;

        // OPTIMIZATION: Update portal performance metrics
        const secretAgentFailureCount = secretAgentResults.filter(r => r.status === 'failed').length;
        updatePortalMetrics(portal, performanceMetrics.total, secretAgentFailureCount === 0);

        // Determine processing mode
        const secretAgentProcessingMode = secretAgentPayloadParsed.length > 1 ? 'bulk' : 'single';

        // Return unified response with automatic logging
        return await createWebhookResponse({
          portal: 'secretagent',
          processingMode: secretAgentProcessingMode,
          transactionCount: secretAgentPayloadParsed.length,
          dataFormat: 'array',
          supportsBoth: false,
          results: secretAgentResults,
          performanceMetrics,
          cacheHitRate: calculateCacheHitRate(),
          optimalConcurrency: getOptimalConcurrency(portal, secretAgentPayloadParsed.length),
          optimizationsApplied: ['parallel-processing', 'caching', 'background-tasks', 'bearer-auth', 'connection-pooling', 'adaptive-concurrency', 'cross-portal-metrics']
        });

      default:
        // Calculate total time for invalid portal
        performanceMetrics.total = performance.now() - requestStartTime;
        
        // Log invalid portal but return success to prevent resend
        await log.performance(`Webhook invalid portal`, performanceMetrics.total, {
          portal,
          headers: Object.fromEntries(request.headers.entries()),
          body: payload,
          phases: {
            setupAndValidation: Math.round(performanceMetrics.setupAndValidation),
            total: Math.round(performanceMetrics.total)
          },
          result: 'invalid_portal'
        });
        
        return NextResponse.json({
          success: true, // CRITICAL: Always return success to prevent resend
          message: `Webhook received but portal '${portal}' is not supported`,
          processed: 0
        });
    }

  } catch (error) {
    performanceMetrics.total = performance.now() - requestStartTime;
    
    // Log error with performance metrics but return success to prevent resend
    await log.performance('Webhook processing error', performanceMetrics.total, {
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      headers: Object.fromEntries(request.headers.entries()),
      phases: {
        setupAndValidation: Math.round(performanceMetrics.setupAndValidation || 0),
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
}