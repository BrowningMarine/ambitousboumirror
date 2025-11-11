import { NextRequest, NextResponse } from "next/server";
import { OrderTransaction } from "@/types";
import { formatAmount, generateUniqueString, verifyApiKeyAndAccount } from "@/lib/utils";
import { MerchantCacheService } from "@/lib/cache/merchant-cache";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { log, captureRequestDetails } from "@/lib/logger";
import { dbManager } from "@/lib/database/connection-manager";
import { Query } from "node-appwrite";

import { appConfig, getPaymentBaseUrl } from "@/lib/appconfig";
import { getBankById } from "@/lib/actions/bank.actions";
import { createEncodedPaymentUrl, type PaymentData } from "@/lib/payment-encoder";
import { getAccount } from "@/lib/actions/account.actions";
import { BackupOrderService } from "@/lib/supabase-backup";

import { createTransactionOptimized, getProcessingWithdrawalsTotal } from "@/lib/actions/transaction.actions";
import { LRUCache } from 'lru-cache';
import { NotificationQueue } from "@/lib/background/notification-queue";
import { BulkRateLimiter } from "@/lib/rate-limit";
import QRLocal from "@/lib/qr_local";

// OPTIMIZATION: Pre-import heavy modules to reduce runtime import overhead
import { updateAccountBalance } from "@/lib/actions/account.actions";
import { getReadyWithdrawUsers, getUserDocumentId } from "@/lib/actions/user.actions";
import { assignWithdrawalToUser } from "@/lib/actions/withdraw.actions";
import { updateTransactionStatus } from "@/lib/actions/transaction.actions";

// NEW: Database health check for automatic failover
import { selectHealthyDatabase } from "@/lib/database/health-check";

// NEW: Fallback merchant validation when databases are down
import { validateMerchantFallback, getMerchantLimitsFallback } from "@/lib/fallback-merchant-validation";

// NEW: Dynamic order prefix based on database
import { getDynamicOrderPrefix } from "@/lib/appconfig";

// SECURITY LIMITS: Prevent system abuse and resource exhaustion
const SECURITY_LIMITS = {
  // Order count limits per request
  MAX_ORDERS_PER_REQUEST: 300,           // Absolute maximum orders in one request
  MAX_ORDERS_SINGLE_ROUTE: 1,            // Single route handles only 1 order
  MAX_ORDERS_PARALLEL: 20,               // Parallel processing up to 20 orders
  MAX_ORDERS_BATCHED: 100,               // Batched processing up to 100 orders
  
  // Rate limiting
  RATE_LIMIT_BULK_REQUESTS: 15,           // Max 15 bulk requests per minute per merchant
  RATE_LIMIT_WINDOW_MS: 60000,            // 1 minute window
  
  // Resource protection
  MAX_CONCURRENT_ORDERS: 50,              // Max concurrent orders being processed
  PROCESSING_TIMEOUT_MS: 30000,           // 30 second timeout per request
};

// Notification rate limiter cache
const notificationCache = new LRUCache<string, number>({
  max: 1000, // Maximum items in cache
  ttl: 300000, // 5 minutes TTL
});

// Function to check if notification should be sent (rate limited to 1 per minute)
function shouldSendNotification(merchantId: string): boolean {
  const key = `notification:withdraw:${merchantId}`;
  const lastSent = notificationCache.get(key);
  const now = Date.now();

  // If no previous notification or more than 5 minute has passed
  if (!lastSent || now - lastSent >= 300000) {
    notificationCache.set(key, now);
    return true;
  }

  return false;
}

// Environment variables  
const DATABASE_ID = appwriteConfig.databaseId;
const ORDER_TRANS_COLLECTION_ID = appwriteConfig.odrtransCollectionId;
// Define a type for order data  
interface CreateOrderData {
  odrId: string;
  merchantOrdId?: string;
  odrType: 'deposit' | 'withdraw';
  amount: number;
  urlSuccess?: string;
  urlFailed?: string;
  urlCanceled?: string;
  urlCallBack: string;

  //fields for Deposit
  bankId?: string;  // Required for deposit

  //fields for Withdraw
  bankCode?: string;  // Required for withdraw
  bankReceiveNumber?: string;  // Required for withdraw  
  bankReceiveOwnerName?: string;  // Required for withdraw
  bankReceiveName?: string;  // Bank short name from VietQR API
}

// Helper to validate required fields and their values  
async function validateCreateOrderFields(
  data: CreateOrderData,
  merchantAccount: {
    publicTransactionId: string;
    minDepositAmount?: number;
    maxDepositAmount?: number;
    minWithdrawAmount?: number;
    maxWithdrawAmount?: number;
    avaiableBalance: number;
    depositWhitelistIps?: string[];
    withdrawWhitelistIps?: string[];
  }
): Promise<{ valid: boolean; message: string; bankReceiveName?: string }> {
  // Check common required fields  
  if (!data.odrType) {
    return { valid: false, message: "Missing required field: odrType" };
  }

  if (!data.amount) {
    return { valid: false, message: "Missing required field: amount" };
  }

  // Validate odrType values  
  if (data.odrType !== 'deposit' && data.odrType !== 'withdraw') {
    return { valid: false, message: "odrType must be either 'deposit' or 'withdraw'" };
  }

  // Validate amount is a number and positive  
  const amount = Number(data.amount);
  if (isNaN(amount)) {
    return { valid: false, message: "amount must be a valid number" };
  }

  if (amount <= 0) {
    return { valid: false, message: "amount must be greater than 0" };
  }

  // Validate amount doesn't exceed 13 digits  
  if (amount.toString().replace('.', '').length > 13) {
    return { valid: false, message: "amount cannot exceed 13 digits" };
  }

  if (!data.urlCallBack || data.urlCallBack.trim() === '') {
    return { valid: false, message: "urlCallBack is required" };
  }

  // Validate type-specific required fields  
  if (data.odrType === 'deposit') {
    if (!data.bankId || data.bankId.trim() === '') {
      return { valid: false, message: "bankId is required" };
    }

    // Validate deposit amount limits
    if (merchantAccount.minDepositAmount && merchantAccount.minDepositAmount > 0 && amount < merchantAccount.minDepositAmount) {
      return { valid: false, message: `Deposit amount must be at least ${merchantAccount.minDepositAmount}` };
    }

    if (merchantAccount.maxDepositAmount && merchantAccount.maxDepositAmount > 0 && amount > merchantAccount.maxDepositAmount) {
      return { valid: false, message: `Deposit amount cannot exceed ${merchantAccount.maxDepositAmount}` };
    }

    // OPTIMIZATION: Skip bank validation in validation step (saves ~180ms)
    // Bank validation is done later in processSingleOrderOptimized with getBankById + fallback
    // This allows for fast validation while still ensuring bank exists during order processing
  } else if (data.odrType === 'withdraw') {
    if (!data.bankCode || data.bankCode.trim() === '') {
      return { valid: false, message: "bankCode is required" };
    }

    if (!data.bankReceiveNumber || data.bankReceiveNumber.trim() === '') {
      return { valid: false, message: "bankReceiveNumber is required for withdraw orders" };
    }

    // Validate bankReceiveNumber format (only alphanumeric, 6-19 characters, no spaces)
    const bankNumberRegex = /^[a-zA-Z0-9]{5,19}$/;
    if (!bankNumberRegex.test(data.bankReceiveNumber)) {
      return { valid: false, message: "bankReceiveNumber must contain only letters and numbers, be 5-19 characters long, and contain no spaces" };
    }

    if (!data.bankReceiveOwnerName || data.bankReceiveOwnerName.trim() === '') {
      return { valid: false, message: "bankReceiveOwnerName is required for withdraw orders" };
    }

    // Validate bankReceiveOwnerName format (only letters, spaces, and apostrophes)
    const nameRegex = /^[A-Za-zÀ-ỹ\s']+$/;
    if (!nameRegex.test(data.bankReceiveOwnerName)) {
      return { valid: false, message: "bankReceiveOwnerName must contain only letters, spaces, and apostrophes" };
    }

    // Validate withdraw amount limits
    if (merchantAccount.minWithdrawAmount && merchantAccount.minWithdrawAmount > 0 && amount < merchantAccount.minWithdrawAmount) {
      return { valid: false, message: `Withdraw amount must be at least ${merchantAccount.minWithdrawAmount}` };
    }

    if (merchantAccount.maxWithdrawAmount && merchantAccount.maxWithdrawAmount > 0 && amount > merchantAccount.maxWithdrawAmount) {
      return { valid: false, message: `Withdraw amount cannot exceed ${merchantAccount.maxWithdrawAmount}` };
    }

    // OPTIMIZATION: Use local-only bank validation (skip database blacklist check for speed)
    // Blacklist check is expensive (~100-150ms), use local validation only
    // If you need blacklist, move it to background processing after order creation
    
    // Use local bank validation (fast, no database query)
    if (!QRLocal.isSupportedBankBin(data.bankCode)) {
      return { valid: false, message: `Bank code ${data.bankCode} is not supported by the local QR system` };
    }
    
    // Get bank name from local database (fast, in-memory)
    const bankName = QRLocal.getBankNameFromBin(data.bankCode);
    return { valid: true, message: '', bankReceiveName: bankName || 'Unknown Bank' };
  }

  return { valid: true, message: '' };
}

function formatTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function generateOrderId(activeDatabase: 'appwrite' | 'supabase' | 'none'): string {
  // Get current date in YYYYMMDD format  
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  
  // Get dynamic prefix based on active database
  const firstprefix = getDynamicOrderPrefix(activeDatabase);
  
  const datePrefix = `${year}${month}${day}`;

  // Generate 7 random characters  
  const randomSuffix = generateUniqueString({ length: 7, includeLowercase: false, includeUppercase: true });

  // Combine date prefix and random suffix  
  return `${firstprefix}${datePrefix}${randomSuffix}`;
}

// Add a helper function to validate IP addresses at the top of the file
/**
 * Validates that an IP address is valid and not a local/private address
 * @param ip The IP address to validate
 * @returns Boolean indicating if the IP is valid and public
 */
function isValidPublicIp(ip: string): boolean {
  if (!ip) return false;

  // Check if it's a valid IPv4 address
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const ipv4Match = ip.match(ipv4Regex);

  if (ipv4Match) {
    // Check if it's a valid IPv4 address with each octet between 0-255
    const octets = [
      parseInt(ipv4Match[1]),
      parseInt(ipv4Match[2]),
      parseInt(ipv4Match[3]),
      parseInt(ipv4Match[4])
    ];

    const validOctets = octets.every(octet => octet >= 0 && octet <= 255);
    if (!validOctets) return false;

    // Exclude private IP ranges and loopback
    // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 127.0.0.0/8
    if (
      octets[0] === 10 ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      octets[0] === 127
    ) {
      return false;
    }

    return true;
  }

  // Check if it's a valid IPv6 address (simplified check)
  const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::1$|^::$|^([0-9a-fA-F]{1,4}:){1,7}:|^:[0-9a-fA-F]{1,4}(:[0-9a-fA-F]{1,4}){0,6}$|^([0-9a-fA-F]{1,4}:){1,7}:$/;
  if (ipv6Regex.test(ip)) {
    // Exclude loopback and unspecified addresses
    if (ip === '::1' || ip === '::') {
      return false;
    }

    // Exclude link-local addresses (fe80::/10)
    if (ip.toLowerCase().startsWith('fe8') ||
      ip.toLowerCase().startsWith('fe9') ||
      ip.toLowerCase().startsWith('fea') ||
      ip.toLowerCase().startsWith('feb')) {
      return false;
    }

    return true;
  }

  return false;
}

/**
 * Checks if an IP address is in a whitelist
 * @param ip The IP address to check
 * @param whitelist Array of allowed IP addresses (can include wildcards with *)
 * @returns Boolean indicating if the IP is in the whitelist
 */
function isIpInWhitelist(ip: string, whitelist?: string[]): boolean {
  // If no whitelist is provided or it's empty, return false
  if (!whitelist || whitelist.length === 0) {
    return false;
  }

  // Check if the exact IP is in the whitelist
  if (whitelist.includes(ip)) {
    return true;
  }

  // Check for wildcard matches (e.g., 192.168.1.*)
  return whitelist.some(whitelistedIp => {
    if (whitelistedIp.includes('*')) {
      // Convert the wildcard pattern to a regex pattern
      const regexPattern = whitelistedIp
        .replace(/\./g, '\\.')  // Escape dots
        .replace(/\*/g, '.*');  // Replace * with .*

      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(ip);
    }
    return false;
  });
}

// GET /api/orders/[publicTransactionId] - Get all orders for an account  
export async function GET(
  request: NextRequest,
  { params }: { params: { publicTransactionId: string } }
) {
  // Get client IP
  const ipFromHeaders = request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('true-client-ip') ||
    '';
  const clientIp = ipFromHeaders.split(',')[0].trim();

  try {
    const apiKey = request.headers.get('x-api-key');

    if (!apiKey) {
      const requestDetails = await captureRequestDetails(request);
      await log.warn('GET orders: Missing API key', { 
        clientIp,
        requestDetails
      });
      return NextResponse.json(
        { success: false, message: 'API key is required' },
        { status: 401 }
      );
    }

    const { publicTransactionId } = await params;

    // Get filter parameters  
    const { searchParams } = new URL(request.url);
    const orderType = searchParams.get('orderType');

    // Verify API key and account
    let account;
    try {
      account = await verifyApiKeyAndAccount(apiKey, publicTransactionId);

      if (!account) {
        const requestDetails = await captureRequestDetails(request);
        await log.warn('GET orders: Invalid API key or account', { 
          merchantId: publicTransactionId, 
          clientIp,
          requestDetails
        });
        return NextResponse.json(
          { success: false, message: 'Invalid API key or account' },
          { status: 401 }
        );
      }
    } catch (dbError) {
      // Database connection error
      const requestDetails = await captureRequestDetails(request);
      await log.error('GET orders: Database connection error during merchant verification', 
        dbError instanceof Error ? dbError : new Error(String(dbError)), { 
        merchantId: publicTransactionId,
        clientIp,
        requestDetails
      });
      return NextResponse.json(
        { 
          success: false, 
          message: 'Database temporarily unavailable. Please try again later.',
          error: 'DB_CONNECTION_ERROR'
        },
        { status: 503 }
      );
    }

    // Build query  
    const queries = [
      Query.equal("positiveAccount", [publicTransactionId]),
      Query.orderDesc("$createdAt")
    ];

    // Add order type filter if provided  
    if (orderType === 'deposit' || orderType === 'withdraw') {
      queries.push(Query.equal("odrType", [orderType]));
    }

    // Use database manager for reliable operations
    const orders = await dbManager.listDocuments(
      DATABASE_ID!,
      ORDER_TRANS_COLLECTION_ID!,
      queries,
      'get-orders-for-account'
    );

    // Map the response to only include specific fields  
    const filteredOrders = orders.documents.map(order => ({
      odrId: order.odrId,
      merchantOrdId: order.merchantOrdId || '',
      odrType: order.odrType,
      odrStatus: order.odrStatus,
      amount: order.amount,
      paidAmount: order.paidAmount || 0,
      unPaidAmount: order.unPaidAmount || order.amount,
      createdAt: order.$createdAt,
      createdIp: order.createdIp || null,
      // Include withdraw-specific fields if present  
      bankReceiveCode: order.bankReceiveCode,
      bankReceiveNumber: order.bankReceiveNumber,
      bankReceiveOwnerName: order.bankReceiveOwnerName,
      bankReceiveName: order.bankReceiveName
    }));

    await log.info('GET orders: Successfully retrieved orders', {
      merchantId: publicTransactionId,
      orderCount: filteredOrders.length,
      orderType: orderType || 'all'
    });

    return NextResponse.json({
      success: true,
      data: filteredOrders
    });

  } catch (error) {
    await log.error('GET orders: Database error', error instanceof Error ? error : new Error(String(error)), {
      merchantId: params.publicTransactionId,
      clientIp
    });
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// HYBRID STRATEGY: Smart automatic routing based on request type and order count

export async function POST(
  request: NextRequest,
  { params }: { params: { publicTransactionId: string } }
) {
  const requestStartTime = performance.now();
  const { publicTransactionId } = await params;
  
  // Get client IP
  const ipFromHeaders = request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('true-client-ip') ||
    '';
  const clientIp = ipFromHeaders.split(',')[0].trim();

  try {
    // CRITICAL: Reject Next.js Server Actions - this is an API-only endpoint
    // Server Actions have 'next-action' header and 'text/x-component' accept type
    const isServerAction = request.headers.get('next-action') || 
                          request.headers.get('accept')?.includes('text/x-component');
    
    if (isServerAction) {
      await log.warn('POST orders: Server Action blocked - API endpoint only', {
        merchantId: publicTransactionId,
        clientIp,
        headers: {
          'next-action': request.headers.get('next-action'),
          'accept': request.headers.get('accept'),
          'referer': request.headers.get('referer')
        }
      });
      return NextResponse.json(
        { success: false, message: 'This is an external API endpoint. Server Actions are not supported here.' },
        { status: 400 }
      );
    }

    // Step 1: API Key validation
    const apiKey = request.headers.get('x-api-key');
    if (!apiKey) {
      // OPTIMIZATION: Only capture details in error cases, skip expensive body parsing
      await log.warn('POST orders: Missing API key', { 
        merchantId: publicTransactionId, 
        clientIp,
        method: request.method,
        url: request.url
      });
      return NextResponse.json(
        { success: false, message: 'API key is required' },
        { status: 401 }
      );
    }

    // Step 2: Request normalization
    const requestData = await request.json();
    let ordersArray: CreateOrderData[] = [];
    let isOriginallyArray = false;
    let globalSettings: {
      globalUrlSuccess?: string;
      globalUrlFailed?: string;
      globalUrlCanceled?: string;
      globalUrlCallBack?: string;
    } = {};
    
    if (Array.isArray(requestData)) {
      ordersArray = requestData as CreateOrderData[];
      isOriginallyArray = true;
    } else if (requestData.orders && Array.isArray(requestData.orders)) {
      ordersArray = requestData.orders as CreateOrderData[];
      isOriginallyArray = true;
      globalSettings = {
        globalUrlSuccess: requestData.globalUrlSuccess,
        globalUrlFailed: requestData.globalUrlFailed,
        globalUrlCanceled: requestData.globalUrlCanceled,
        globalUrlCallBack: requestData.globalUrlCallBack,
      };
    } else {
      ordersArray = [requestData as CreateOrderData];
      isOriginallyArray = false;
    }

    if (ordersArray.length === 0) {
      await log.warn('POST orders: No orders provided', { merchantId: publicTransactionId });
      return NextResponse.json(
        { success: false, message: 'At least one order is required' },
        { status: 400 }
      );
    }

    // Security: Check order count limit
    if (ordersArray.length > SECURITY_LIMITS.MAX_ORDERS_PER_REQUEST) {
      await log.warn('POST orders: Too many orders', { 
        merchantId: publicTransactionId, 
        orderCount: ordersArray.length,
        maxAllowed: SECURITY_LIMITS.MAX_ORDERS_PER_REQUEST
      });
      return NextResponse.json(
        { 
          success: false, 
          message: `Too many orders in request. Maximum allowed: ${SECURITY_LIMITS.MAX_ORDERS_PER_REQUEST}, received: ${ordersArray.length}` 
        },
        { status: 400 }
      );
    }

    // Security: Rate limiting for bulk orders
    if (ordersArray.length >= 2) {
      const bulkRateLimiter = new BulkRateLimiter();
      const rateLimitResult = await bulkRateLimiter.check(publicTransactionId);
      
      if (rateLimitResult.limited) {
        await log.warn('POST orders: Rate limit exceeded', {
          merchantId: publicTransactionId,
          orderCount: ordersArray.length,
          limit: rateLimitResult.limit
        });
        
        const resetTime = new Date(rateLimitResult.reset).toISOString();
        const waitTimeSeconds = Math.ceil((rateLimitResult.reset - Date.now()) / 1000);
        
        return NextResponse.json(
          { 
            success: false, 
            message: `Rate limit exceeded. Maximum ${rateLimitResult.limit} bulk requests per minute allowed.`,
            rateLimit: {
              limit: rateLimitResult.limit,
              remaining: rateLimitResult.remaining,
              resetTime: resetTime,
              retryAfterSeconds: waitTimeSeconds
            }
          },
          { 
            status: 429,
            headers: {
              'Retry-After': waitTimeSeconds.toString(),
              'X-RateLimit-Limit': rateLimitResult.limit.toString(),
              'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
              'X-RateLimit-Reset': rateLimitResult.reset.toString()
            }
          }
        );
      }
    }

    // Validate IP
    if (!clientIp || !isValidPublicIp(clientIp)) {
      await log.warn('POST orders: Invalid IP address', { merchantId: publicTransactionId, clientIp });
      return NextResponse.json(
        {
          success: false,
          message: 'Valid public IP address is required. Contact your system administrator for assistance.',
        },
        { status: 403 }
      );
    }

    // NEW: Health check - determine which database to use (Appwrite priority, Supabase fallback, JSON fallback)
    const healthyDatabase = await selectHealthyDatabase();

    // OPTIMIZATION: Verify merchant with multi-layer cache (L1 in-memory -> L2 Supabase -> L3 Database)
    // Expected performance: L1 hit ~0.1ms (99.99% faster), L2 hit ~50ms (97% faster), L3 miss ~1500ms
    const merchantVerifyStart = performance.now();
    let merchantAccount;
    
    try {
      const cachedMerchant = await MerchantCacheService.getMerchantAccount(
        apiKey,
        publicTransactionId,
        healthyDatabase
      );
      
      if (!cachedMerchant) {
        // OPTIMIZATION: Skip expensive captureRequestDetails in hot path
        await log.warn('POST orders: Invalid API key or account', { 
          merchantId: publicTransactionId,
          clientIp,
          database: healthyDatabase,
          verificationTime: Math.round(performance.now() - merchantVerifyStart),
          apiKeyPrefix: apiKey.substring(0, 8) + '...'
        });
        return NextResponse.json(
          { success: false, message: 'Invalid API key or account' },
          { status: 401 }
        );
      }
      
      // Convert to expected format
      merchantAccount = {
        $id: cachedMerchant.$id,
        publicTransactionId: cachedMerchant.publicTransactionId,
        depositWhitelistIps: cachedMerchant.depositWhitelistIps || [],
        withdrawWhitelistIps: cachedMerchant.withdrawWhitelistIps || [],
        avaiableBalance: cachedMerchant.avaiableBalance || 0,
        minDepositAmount: cachedMerchant.minDepositAmount,
        maxDepositAmount: cachedMerchant.maxDepositAmount,
        minWithdrawAmount: cachedMerchant.minWithdrawAmount,
        maxWithdrawAmount: cachedMerchant.maxWithdrawAmount,
      } as {
        $id: string;
        publicTransactionId: string;
        minDepositAmount?: number;
        maxDepositAmount?: number;
        minWithdrawAmount?: number;
        maxWithdrawAmount?: number;
        avaiableBalance: number;
        depositWhitelistIps?: string[];
        withdrawWhitelistIps?: string[];
      };
      
      const merchantVerifyTime = Math.round(performance.now() - merchantVerifyStart);
      console.log(`✅ Merchant verified in ${merchantVerifyTime}ms (cache: ${healthyDatabase})`);
      
    } catch (dbError) {
      // Keep detailed logging for actual errors
      const requestDetails = await captureRequestDetails(request);
      await log.error('POST orders: Merchant verification error', 
        dbError instanceof Error ? dbError : new Error(String(dbError)), { 
        merchantId: publicTransactionId,
        clientIp,
        requestDetails,
        database: healthyDatabase,
        verificationTime: Math.round(performance.now() - merchantVerifyStart)
      });
      return NextResponse.json(
        { 
          success: false, 
          message: 'Database temporarily unavailable. Please try again.',
          error: 'DB_CONNECTION_ERROR'
        },
        { status: 503 }
      );
    }
    
    // JSON Fallback mode (only if both databases are unhealthy and cache miss)
    if (!merchantAccount && healthyDatabase === 'none') {
      // Fallback 2: Both databases unhealthy - use JSON fallback
      const fallbackResult = validateMerchantFallback(apiKey, clientIp, 'deposit');
      
      if (!fallbackResult.success) {
        const requestDetails = await captureRequestDetails(request);
        await log.warn('POST orders: Fallback validation failed', { 
          merchantId: publicTransactionId,
          clientIp,
          requestDetails,
          database: 'json-fallback',
          error: fallbackResult.error
        });
        return NextResponse.json(
          { success: false, message: fallbackResult.error || 'Invalid API key or account' },
          { status: 401 }
        );
      }
      
      // Get merchant limits from fallback
      const limits = getMerchantLimitsFallback(fallbackResult.merchantId!, 'deposit');
      const withdrawLimits = getMerchantLimitsFallback(fallbackResult.merchantId!, 'withdraw');
      
      // Create merchant account from fallback data
      merchantAccount = {
        $id: fallbackResult.accountId!,
        publicTransactionId: fallbackResult.merchantId!,
        depositWhitelistIps: [], // Already validated by fallback
        withdrawWhitelistIps: [], // Already validated by fallback
        avaiableBalance: 0, // No balance tracking in fallback mode
        minDepositAmount: limits?.minAmount,
        maxDepositAmount: limits?.maxAmount,
        minWithdrawAmount: withdrawLimits?.minAmount,
        maxWithdrawAmount: withdrawLimits?.maxAmount,
      } as {
        $id: string;
        publicTransactionId: string;
        minDepositAmount?: number;
        maxDepositAmount?: number;
        minWithdrawAmount?: number;
        maxWithdrawAmount?: number;
        avaiableBalance: number;
        depositWhitelistIps?: string[];
        withdrawWhitelistIps?: string[];
      };
      
      await log.info('POST orders: Using JSON fallback for merchant verification', {
        merchantId: fallbackResult.merchantId,
        clientIp,
        database: 'json-fallback'
      });
    }

    // Validate all orders
    const validationErrors: string[] = [];
    let depositCount = 0;
    let withdrawCount = 0;
    
    for (let i = 0; i < ordersArray.length; i++) {
      const order = ordersArray[i];
      const orderPrefix = ordersArray.length > 1 ? `Order ${i + 1}: ` : '';
      
      // Apply global settings if not specified in individual order
      if (Object.keys(globalSettings).length > 0) {
        order.urlSuccess = order.urlSuccess || globalSettings.globalUrlSuccess || '';
        order.urlFailed = order.urlFailed || globalSettings.globalUrlFailed || '';
        order.urlCanceled = order.urlCanceled || globalSettings.globalUrlCanceled || '';
        order.urlCallBack = order.urlCallBack || globalSettings.globalUrlCallBack || '';
      }
      
      const validation = await validateCreateOrderFields(order as CreateOrderData, merchantAccount);
      
      if (!validation.valid) {
        validationErrors.push(`${orderPrefix}${validation.message}`);
        continue;
      }
      
      if (validation.bankReceiveName) {
        order.bankReceiveName = validation.bankReceiveName;
      }
      
      if (order.odrType === 'withdraw') {
        withdrawCount++;
      } else if (order.odrType === 'deposit') {
        depositCount++;
      }
    }
    
    if (validationErrors.length > 0) {
      await log.warn('POST orders: Validation errors', {
        merchantId: publicTransactionId,
        errors: validationErrors
      });
      return NextResponse.json(
        { success: false, message: validationErrors.join('; ') },
        { status: 400 }
      );
    }
    
    // BUSINESS RULE: Deposits can only be single orders, bulk orders must be all withdrawals
    if (ordersArray.length > 1) {
      // Bulk request detected
      if (depositCount > 0) {
        await log.warn('POST orders: Bulk deposits not allowed', {
          merchantId: publicTransactionId,
          orderCount: ordersArray.length,
          depositCount,
          withdrawCount
        });
        return NextResponse.json(
          { 
            success: false, 
            message: 'Bulk orders are only allowed for withdrawals. Deposits must be created one at a time. Please separate deposit orders into individual requests.' 
          },
          { status: 400 }
        );
      }
      
      // Ensure all orders are withdrawals
      if (withdrawCount !== ordersArray.length) {
        await log.warn('POST orders: Mixed order types in bulk request', {
          merchantId: publicTransactionId,
          orderCount: ordersArray.length,
          depositCount,
          withdrawCount
        });
        return NextResponse.json(
          { 
            success: false, 
            message: 'Bulk requests must contain orders of the same type. Found mixed deposit and withdraw orders.' 
          },
          { status: 400 }
        );
      }
    }
    
    // FALLBACK MODE: Check if we're in fallback mode and validate order types
    if (healthyDatabase === 'none') {
      const { getCoreRunningMode } = await import('@/lib/appconfig');
      const runningMode = getCoreRunningMode();
      
      if (runningMode === 'fallback') {
        // Fallback mode only supports deposits (withdrawals need balance tracking)
        if (withdrawCount > 0) {
          await log.warn('POST orders: Withdrawals not allowed in fallback mode', {
            merchantId: publicTransactionId,
            orderCount: ordersArray.length,
            withdrawCount,
            database: 'fallback'
          });
          return NextResponse.json(
            { 
              success: false, 
              message: 'Fallback mode only supports deposit orders. Withdrawals require database for balance tracking. Please wait for database to be available or contact support.' 
            },
            { status: 503 }
          );
        }
        
        // Log fallback mode usage
        await log.info('POST orders: Processing in fallback mode', {
          merchantId: publicTransactionId,
          orderCount: ordersArray.length,
          depositCount,
          database: 'fallback'
        });
      }
    }
    
    // NOTE: No balance check for withdrawals - business allows negative balances
    // Merchants can withdraw beyond their available balance (credit line model)

    // Process orders based on count
    let processingResults: ProcessingResult[];
    let processingStrategy: string;
    
    if (ordersArray.length === 1) {
      processingStrategy = 'single-optimized';
      processingResults = await processSingleOrderOptimized(
        ordersArray[0] as CreateOrderData, 
        merchantAccount, 
        clientIp, 
        request,
        healthyDatabase
      );
    } else if (ordersArray.length >= 2 && ordersArray.length <= SECURITY_LIMITS.MAX_ORDERS_PARALLEL) {
      processingStrategy = 'parallel-optimized';
      processingResults = await processOrdersParallel(
        ordersArray as CreateOrderData[], 
        merchantAccount, 
        clientIp, 
        request,
        healthyDatabase
      );
    } else if (ordersArray.length >= (SECURITY_LIMITS.MAX_ORDERS_PARALLEL + 1) && ordersArray.length <= SECURITY_LIMITS.MAX_ORDERS_BATCHED) {
      processingStrategy = 'batched-optimized';
      processingResults = await processOrdersBatched(
        ordersArray as CreateOrderData[], 
        merchantAccount, 
        clientIp, 
        request,
        10,
        healthyDatabase
      );
    } else {
      processingStrategy = 'conservative-batched';
      processingResults = await processOrdersBatched(
        ordersArray as CreateOrderData[], 
        merchantAccount, 
        clientIp, 
        request,
        5,
        healthyDatabase
      );
    }

    const successCount = processingResults.filter(r => r.success).length;
    const failureCount = processingResults.length - successCount;
    const totalTime = performance.now() - requestStartTime;

    // Get core running mode for detailed logging
    const { getCoreRunningMode } = await import('@/lib/appconfig');
    const coreRunningMode = getCoreRunningMode();

    // Single consolidated log for all cases (success or failure)
    const firstResult = processingResults[0];
    const logData: Record<string, unknown> = {
      merchantId: publicTransactionId,
      orderCount: ordersArray.length,
      depositCount,
      withdrawCount,
      successCount,
      failureCount,
      strategy: processingStrategy,
      database: {
        active: healthyDatabase, // Which database was actually used (appwrite/supabase/none)
        mode: coreRunningMode     // Core running mode (auto/appwrite/supabase/fallback)
      },
      totalTime: Math.round(totalTime),
      clientIp
    };

    // Add performance breakdown for single orders
    if (ordersArray.length === 1 && firstResult.performance) {
      logData.odrId = firstResult.odrId;
      logData.odrType = firstResult.odrType;
      logData.amount = firstResult.amount;
      
      // Calculate overhead time (request parsing, merchant verification, etc.)
      const orderProcessingTime = firstResult.performance.total;
      const overheadTime = Math.max(0, Math.round(totalTime - orderProcessingTime));
      
      // Complete performance breakdown with all timing phases
      logData.performance = {
        // Phase 1: Request overhead (parsing, merchant verification, validation loops)
        requestOverhead: overheadTime,
        
        // Phase 2: Order processing steps
        validation: firstResult.performance.validation,
        qrGeneration: firstResult.performance.qrGeneration,
        userAssignment: firstResult.performance.userAssignment,
        transactionCreation: firstResult.performance.transactionCreation,
        balanceUpdate: firstResult.performance.balanceUpdate,
        
        // Phase 3: Order processing total
        orderProcessing: orderProcessingTime,
        
        // Total time
        total: Math.round(totalTime)
      };
    }

    // Add aggregated performance for bulk orders
    if (ordersArray.length > 1) {
      const allPerformances = processingResults
        .filter(r => r.performance)
        .map(r => r.performance!);
      
      if (allPerformances.length > 0) {
        const avgPerf = {
          validation: Math.round(allPerformances.reduce((sum, p) => sum + p.validation, 0) / allPerformances.length),
          qrGeneration: Math.round(allPerformances.reduce((sum, p) => sum + p.qrGeneration, 0) / allPerformances.length),
          userAssignment: Math.round(allPerformances.reduce((sum, p) => sum + p.userAssignment, 0) / allPerformances.length),
          transactionCreation: Math.round(allPerformances.reduce((sum, p) => sum + p.transactionCreation, 0) / allPerformances.length),
          balanceUpdate: Math.round(allPerformances.reduce((sum, p) => sum + p.balanceUpdate, 0) / allPerformances.length),
          orderProcessing: Math.round(allPerformances.reduce((sum, p) => sum + p.total, 0) / allPerformances.length)
        };
        
        const maxPerf = {
          validation: Math.max(...allPerformances.map(p => p.validation)),
          qrGeneration: Math.max(...allPerformances.map(p => p.qrGeneration)),
          userAssignment: Math.max(...allPerformances.map(p => p.userAssignment)),
          transactionCreation: Math.max(...allPerformances.map(p => p.transactionCreation)),
          balanceUpdate: Math.max(...allPerformances.map(p => p.balanceUpdate)),
          orderProcessing: Math.max(...allPerformances.map(p => p.total))
        };
        
        // Calculate bulk overhead
        const totalOrderProcessing = allPerformances.reduce((sum, p) => sum + p.total, 0);
        const bulkOverhead = Math.max(0, Math.round(totalTime - totalOrderProcessing));
        
        logData.performance = {
          requestOverhead: bulkOverhead,
          average: avgPerf,
          slowest: maxPerf,
          avgPerOrder: Math.round(totalTime / ordersArray.length),
          ordersPerSecond: Math.round((ordersArray.length / (totalTime / 1000)) * 100) / 100,
          total: Math.round(totalTime)
        };
      }
    }

    // Log once with all details (success or failure)
    if (failureCount === 0) {
      await log.info('Orders processed successfully', logData);
    } else if (successCount === 0) {
      await log.error('Orders processing failed', new Error(firstResult.message), logData);
    } else {
      await log.warn('Orders partially processed', logData);
    }

    // Return response
    if (!isOriginallyArray) {
      const result = processingResults[0];
      
      if (result.success) {
        return NextResponse.json({
          success: true,
          message: result.message || 'Order created successfully',
          data: result.data
        });
      } else {
        return NextResponse.json({
          success: false,
          message: result.message || 'Order creation failed'
        }, { status: 400 });
      }
    } else {
      const overallSuccess = failureCount === 0;
      const message = overallSuccess 
        ? `All ${processingResults.length} orders created successfully`
        : `${successCount} of ${processingResults.length} orders created successfully, ${failureCount} failed`;
      
      // Simplify results to match original single order format
      const simplifiedResults = processingResults.map(result => {
        if (result.success) {
          return {
            success: true,
            message: result.message,
            data: result.data
          };
        } else {
          return {
            success: false,
            message: result.message,
            merchantOrdId: result.merchantOrdId
          };
        }
      });
      
      return NextResponse.json({
        success: overallSuccess,
        message: message,
        total: processingResults.length,
        successful: successCount,
        failed: failureCount,
        results: simplifiedResults
      });
    }

  } catch (error) {
    const totalTime = performance.now() - requestStartTime;
    await log.error('POST orders: Processing error', error instanceof Error ? error : new Error(String(error)), {
      merchantId: publicTransactionId,
      totalTime: Math.round(totalTime),
      clientIp
    });
    
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Define types for processing results
interface ProcessingResult {
  success: boolean;
  odrId?: string;
  odrType?: string;
  amount?: number;
  merchantOrdId?: string;
  message: string;
  timestamp?: string;
  performance?: {
    validation: number;
    qrGeneration: number;
    userAssignment: number;
    transactionCreation: number;
    balanceUpdate: number;
    total: number;
  };
  data?: {
    odrId?: string;
    odrStatus?: string;
    bankName?: string;
    accountNumber?: string;
    ownerName?: string;
    amount?: number;
    timestamp?: string;
    paymentUrl?: string;
    qrCode?: string | null;
    bankReceiveCode?: string;
    bankReceiveNumber?: string;
    bankReceiveOwnerName?: string;
  };
}

interface MerchantAccount {
  $id: string;
  publicTransactionId: string;
  avaiableBalance: number;
  depositWhitelistIps?: string[];
  withdrawWhitelistIps?: string[];
  minDepositAmount?: number;
  maxDepositAmount?: number;
  minWithdrawAmount?: number;
  maxWithdrawAmount?: number;
}

// STEP 4: PROCESSING STRATEGY IMPLEMENTATIONS

// Ultra-optimized single order processing
async function processSingleOrderOptimized(
  orderData: CreateOrderData,
  merchantAccount: MerchantAccount,
  clientIp: string,
  request: NextRequest,
  healthyDatabase: 'appwrite' | 'supabase' | 'none'
): Promise<ProcessingResult[]> {
  const data = orderData as CreateOrderData;
  
  // Performance monitoring for identifying bottlenecks
  const performanceMetrics = {
    validation: 0,
    qrGeneration: 0,
    userAssignment: 0,
    transactionCreation: 0,
    balanceUpdate: 0,
    total: 0
  };
  
  const orderStartTime = performance.now();

  try {
    // STEP 1: Validation (field validation only)
    // NOTE: Duplicate merchantOrdId check removed for performance (was taking 4-5 seconds)
    // merchantOrdId is optional and merchant-controlled - they should handle duplicates on their end
    // odrId (system-generated) is always unique, so no risk of duplicate orders
    const validationStart = performance.now();
    
    // Field validation
    const basicValidation = await validateCreateOrderFields(data, merchantAccount);
    
    performanceMetrics.validation = performance.now() - validationStart;

    // Check validation result
    if (!basicValidation.valid) {
      throw new Error(basicValidation.message);
    }

    // Store the bank receive name from validation for withdraw orders
    const bankReceiveName: string | undefined = basicValidation.bankReceiveName;

    // Generate a unique order ID if not provided (using dynamic prefix based on database)
    const odrId = data.odrId || generateOrderId(healthyDatabase);

    // STEP 2: QR Code Generation (deposit/withdraw)
    const qrStart = performance.now();
    let qrCode: string | undefined = undefined;
    let bank;

    // OPTIMIZATION: Generate QR based on type - use local mode only (no URL fallback)
    if (data.odrType === 'deposit' && data.bankId) {
      try {
        const bankResult = await getBankById(data.bankId);
        if (!bankResult.success || !bankResult.bank) {
          // Automatic fallback: Use fallback bank data when lookup fails
          console.warn(`Bank lookup failed: Using fallback bank data for bankId: ${data.bankId}`);
          bank = {
            $id: data.bankId,
            ...appConfig.fallbackBankData,
            bankId: data.bankId  // Override with actual bankId from request
          };
        } else {
          bank = bankResult.bank;
        }
      } catch (error) {
        console.error("Error fetching bank data:", {
          error,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          bankId: data.bankId
        });
        
        // Automatic fallback: Use fallback bank data on database error
        console.warn(`Database error: Using fallback bank data for bankId: ${data.bankId}`);
        bank = {
          $id: data.bankId,
          ...appConfig.fallbackBankData,
          bankId: data.bankId  // Override with actual bankId from request
        };
      }
      
      // OPTIMIZATION: Use QR Local directly (no try-catch overhead, no URL fallback)
      const qrResult = await QRLocal.generateQR({
        bankBin: bank.bankBinCode,
        accountNumber: bank.accountNumber,
        amount: Number(data.amount),
        orderId: odrId
      });
      
      qrCode = qrResult.qrDataURL || undefined;
    }
    else if (data.odrType === 'withdraw' && data.bankReceiveNumber && data.bankCode) {
      // OPTIMIZATION: Use QR Local directly for withdraw (no try-catch overhead, no URL fallback)
      const qrResult = await QRLocal.generateQR({
        bankBin: data.bankCode,
        accountNumber: data.bankReceiveNumber,
        amount: Number(data.amount),
        orderId: odrId
      });
      
      qrCode = qrResult.qrDataURL || undefined;
    }
    
    performanceMetrics.qrGeneration = performance.now() - qrStart;

    // Check if IP is in the whitelist based on order type
    let isSuspicious = false;
    if (data.odrType === 'deposit') {
      isSuspicious = !isIpInWhitelist(clientIp, merchantAccount.depositWhitelistIps);
    } else if (data.odrType === 'withdraw') {
      isSuspicious = !isIpInWhitelist(clientIp, merchantAccount.withdrawWhitelistIps);
    }

    // Create transaction object  
    const transactionData: Omit<OrderTransaction, '$id'> = {
      odrId,
      merchantOrdId: data.merchantOrdId || '',
      odrType: data.odrType,
      odrStatus: data.odrType === 'deposit' ? 'processing' : 'pending',
      bankId: data.bankId || '',
      amount: Math.floor(Number(data.amount)),
      paidAmount: 0,
      unPaidAmount: Math.floor(Number(data.amount)),
      positiveAccount: data.odrType === 'deposit' ? merchantAccount.publicTransactionId : '',
      negativeAccount: data.odrType === 'withdraw' ? merchantAccount.publicTransactionId : '',
      urlSuccess: data.urlSuccess || '',
      urlFailed: data.urlFailed || '',
      urlCanceled: data.urlCanceled || '',
      urlCallBack: data.urlCallBack || '',
      qrCode: qrCode,
      lastPaymentDate: new Date().toISOString(),
      account: merchantAccount.$id,
      createdIp: clientIp,
      isSuspicious: isSuspicious,
    };

    // Add type-specific fields  
    if (data.odrType === 'withdraw') {
      transactionData.bankCode = data.bankCode;
      transactionData.bankReceiveNumber = data.bankReceiveNumber;
      transactionData.bankReceiveOwnerName = data.bankReceiveOwnerName;
      transactionData.bankReceiveName = bankReceiveName;
    }

    // STEP 3: User Assignment (withdraw only)
    let assignedUserId: string | null = null;
    if (data.odrType === 'withdraw') {
      const userAssignStart = performance.now();
      try {
        const readyUsers = await getReadyWithdrawUsers();
        
        if (readyUsers.length > 0) {
          const userIndex = Math.floor(Date.now() / 10000) % readyUsers.length;
          assignedUserId = readyUsers[userIndex];
          
          const userDocId = await getUserDocumentId(assignedUserId);
          if (userDocId) {
            transactionData.users = userDocId;
          } else {
            assignedUserId = null;
          }
        }
      } catch (error) {
        console.error('Error pre-assigning withdrawal user:', error);
        assignedUserId = null;
      }
      performanceMetrics.userAssignment = performance.now() - userAssignStart;
    }

    // STEP 4: Transaction Creation
    const transactionStart = performance.now();
    
    // Choose database based on health check (Appwrite priority, Supabase fallback)
    let transactionResult;
    let createdOrder;
    
    if (healthyDatabase === 'appwrite') {
      // Priority 1: Write to Appwrite
      try {
        transactionResult = await createTransactionOptimized(transactionData);
        
        if (!transactionResult || !transactionResult.success || !transactionResult.data) {
          throw new Error(transactionResult?.message || 'Transaction creation failed');
        }
        
        createdOrder = transactionResult.data;
      } catch (error) {
        console.error('Appwrite transaction creation failed:', error);
        throw new Error(`Failed to create transaction: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else if (healthyDatabase === 'supabase') {
      // Fallback: Write to Supabase backup database
      try {
        const backupService = new BackupOrderService();
        const supabaseResult = await backupService.createBackupOrder({
          odr_id: odrId,
          merchant_odr_id: data.merchantOrdId || '',
          odr_type: data.odrType,
          odr_status: data.odrType === 'deposit' ? 'processing' : 'pending',
          amount: Math.floor(Number(data.amount)),
          paid_amount: 0,
          unpaid_amount: Math.floor(Number(data.amount)),
          merchant_id: merchantAccount.publicTransactionId,
          merchant_account_id: merchantAccount.$id,
          
          // Deposit fields
          bank_id: data.bankId,
          bank_name: bank?.bankName,
          bank_bin_code: bank?.bankBinCode,
          account_number: bank?.accountNumber,
          account_name: bank?.ownerName,
          qr_code: qrCode,
          
          // Withdraw fields
          bank_code: data.bankCode,
          bank_receive_number: data.bankReceiveNumber,
          bank_receive_owner_name: data.bankReceiveOwnerName,
          bank_receive_name: bankReceiveName,
          
          // URLs
          url_success: data.urlSuccess || '',
          url_failed: data.urlFailed || '',
          url_canceled: data.urlCanceled || '',
          url_callback: data.urlCallBack || '',
          
          created_ip: clientIp,
          is_suspicious: isSuspicious,
          last_payment_date: new Date().toISOString()
        });
        
        if (!supabaseResult.success) {
          throw new Error(supabaseResult.error || 'Failed to create order in Supabase');
        }
        
        // Create a mock order object matching Appwrite structure for compatibility
        createdOrder = {
          $id: supabaseResult.orderId || odrId,
          odrId: odrId,
          merchantOrdId: data.merchantOrdId || '',
          odrType: data.odrType,
          odrStatus: data.odrType === 'deposit' ? 'processing' : 'pending',
          amount: Math.floor(Number(data.amount)),
          paidAmount: 0,
          unPaidAmount: Math.floor(Number(data.amount)),
          bankId: data.bankId || '',
          qrCode: qrCode,
          bankCode: data.bankCode,
          bankReceiveNumber: data.bankReceiveNumber,
          bankReceiveOwnerName: data.bankReceiveOwnerName,
          bankReceiveName: bankReceiveName,
          urlSuccess: data.urlSuccess,
          urlFailed: data.urlFailed,
          urlCanceled: data.urlCanceled,
          urlCallBack: data.urlCallBack,
          $createdAt: new Date().toISOString()
        };
        
        transactionResult = { success: true, data: createdOrder };
      } catch (error) {
        console.error('Supabase transaction creation failed:', error);
        throw new Error(`Failed to create transaction in: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      // Fallback mode or both databases unhealthy
      const { getCoreRunningMode } = await import('@/lib/appconfig');
      const runningMode = getCoreRunningMode();
      const isFallbackMode = runningMode === 'fallback';
      
      // IMPORTANT: Fallback mode only supports deposits (withdrawals require balance tracking)
      if (data.odrType === 'withdraw') {
        throw new Error('Fallback mode only supports deposit orders. Withdrawals require database for balance tracking.');
      }
      
      // Create a temporary order object for payment URL generation (no database write)
      createdOrder = {
        $id: odrId,
        odrId: odrId,
        merchantOrdId: data.merchantOrdId || '',
        odrType: data.odrType,
        odrStatus: 'processing', // Always processing for deposits in fallback mode
        amount: Math.floor(Number(data.amount)),
        paidAmount: 0,
        unPaidAmount: Math.floor(Number(data.amount)),
        bankId: data.bankId || '',
        qrCode: qrCode,
        bankCode: data.bankCode,
        bankReceiveNumber: data.bankReceiveNumber,
        bankReceiveOwnerName: data.bankReceiveOwnerName,
        bankReceiveName: bankReceiveName,
        urlSuccess: data.urlSuccess,
        urlFailed: data.urlFailed,
        urlCanceled: data.urlCanceled,
        urlCallBack: data.urlCallBack,
        $createdAt: new Date().toISOString()
      };
      
      transactionResult = { success: true, data: createdOrder };
      
      if (isFallbackMode) {
        console.log('🟡 [Fallback Mode] Order created without database - payment URL generated with encrypted data');
      } else {
        console.warn('⚠️ [Resilient Mode] Both databases unhealthy - order not saved but payment URL generated');
      }
    }
    
    performanceMetrics.transactionCreation = performance.now() - transactionStart;
    
    if (!transactionResult || !transactionResult.success || !createdOrder) {
      throw new Error('Transaction creation failed');
    }

    // OPTIMIZATION: Cache webhook data ONLY in fallback mode (when databases are down)
    // This allows merchant webhooks to be sent even when databases are unavailable
    // In normal mode (appwrite/supabase), webhook data is already in database
    if (healthyDatabase === 'none' && createdOrder.urlCallBack) {
      try {
        const { cacheFallbackWebhookData } = await import('@/lib/cache/webhook-fallback-cache');
        const apiKeyFromRequest = request.headers.get('x-api-key') || '';
        
        await cacheFallbackWebhookData({
          odrId: createdOrder.odrId,
          merchantOrdId: createdOrder.merchantOrdId || '',
          orderType: createdOrder.odrType,
          urlCallback: createdOrder.urlCallBack,
          apiKey: apiKeyFromRequest, // API key from request headers
          bankReceiveNumber: createdOrder.bankReceiveNumber,
          bankReceiveOwnerName: createdOrder.bankReceiveOwnerName,
          accountName: createdOrder.bankReceiveName, // Bank name from order
          accountNumber: data.odrType === 'deposit' ? (createdOrder.bankReceiveNumber || '') : '',
          merchantId: merchantAccount.publicTransactionId,
          cachedAt: Date.now()
        });
        
        console.log('✅ [Fallback Mode] Cached webhook data (L1+L2) for order:', createdOrder.odrId);
      } catch (error) {
        // Cache failure shouldn't block order creation
        console.error('⚠️ [Fallback Mode] Failed to cache webhook data:', error);
      }
    }

    const formattedTimestamp = formatTimestamp(createdOrder.$createdAt);

    // STEP 5: Balance Update (withdraw only)
    if (data.odrType === 'withdraw') {
      const balanceUpdateStart = performance.now();
      
      // NOTE: No balance validation - business allows negative balances (credit line model)
      const updateResult = await updateAccountBalance(
        merchantAccount.publicTransactionId,
        Number(data.amount),
        false,
        true,
        false
      );
      
      performanceMetrics.balanceUpdate = performance.now() - balanceUpdateStart;

      if (!updateResult.success) {
        await log.error('Balance update failed - canceling withdrawal', new Error(updateResult.message || 'Balance update failed'), {
          merchantId: merchantAccount.publicTransactionId,
          orderId: createdOrder.odrId,
          amount: data.amount,
          errorMessage: updateResult.message,
          retryAttempt: updateResult.retryAttempt
        });
        await updateTransactionStatus(createdOrder.$id, 'canceled');
        throw new Error(updateResult.message || 'Failed to lock funds for withdrawal');
      }
      
      // Log if retries were needed (indicates concurrent update contention)
      if (updateResult.retryAttempt && updateResult.retryAttempt > 1) {
        await log.warn('Balance update required retries due to concurrent modifications', {
          merchantId: merchantAccount.publicTransactionId,
          orderId: createdOrder.odrId,
          retryAttempt: updateResult.retryAttempt,
          balanceUpdateTime: performanceMetrics.balanceUpdate
        });
      }

      // Background processing for withdrawals (notifications - not timed)
      setImmediate(async () => {
        try {
          if (!assignedUserId) {
            await assignWithdrawalToUser(createdOrder.$id);
          }

          if (shouldSendNotification(merchantAccount.publicTransactionId) && 
              (!createdOrder.merchantOrdId || !createdOrder.merchantOrdId.toLowerCase().includes('test'))) {
            
            const withdrawalsInfo = await getProcessingWithdrawalsTotal();
            const pendingCount = withdrawalsInfo.count;
            const pendingTotal = await formatAmount(withdrawalsInfo.totalAmount);
            const notiamount = await formatAmount(data.amount);
            
            NotificationQueue.queueMerchantAndRoles(
              'YÊU CẦU RÚT TIỀN',
              `Vừa có yều cầu rút ${notiamount} ₫ . Đang kẹt ${pendingCount} đơn (Tổng ${pendingTotal} ₫). Hãy đăng nhập và giải quyết nhanh nhất có thể!`,
              merchantAccount.publicTransactionId,
              ['admin', 'transactor'],
              {
                orderId: createdOrder.odrId,
                amount: data.amount,
                pendingCount: pendingCount,
                pendingTotal: withdrawalsInfo.totalAmount,
                formattedPendingTotal: pendingTotal,
                bankInfo: `${data.bankReceiveOwnerName} - ${data.bankReceiveNumber}`,
                timestamp: formattedTimestamp,
                type: 'withdraw'
              }
            );
          }
        } catch (backgroundError) {
          // Silent background error - don't log to avoid multiple log entries
          console.error('Background processing error for order:', odrId, backgroundError);
        }
      });
    }

    // Calculate total time (logging moved to main POST handler for single consolidated log)
    performanceMetrics.total = performance.now() - orderStartTime;
    
    // Return formatted result with performance data
    if (data.odrType === 'deposit') {
      const baseUrl = getPaymentBaseUrl();
      
      // ALWAYS use payment-direct with encoded URL (client-only, no database queries, faster)
      let paymentUrl: string;
      
      try {
        // Get merchant account info for logo and name (with fallback)
        let merchantInfo;
        try {
          merchantInfo = await getAccount(merchantAccount.publicTransactionId);
        } catch {
          // If account fetch fails, use basic info
          merchantInfo = { accountName: '' };
        }
        
        const paymentData: PaymentData = {
          odrId: createdOrder.odrId,
          merchantOrdId: createdOrder.merchantOrdId,
          odrType: createdOrder.odrType,
          odrStatus: createdOrder.odrStatus,
          amount: createdOrder.amount,
          timestamp: createdOrder.$createdAt, // This is the createdAt for expiration check
          bankName: bank!.bankName,
          bankBinCode: bank!.bankBinCode,
          accountNumber: bank!.accountNumber,
          accountName: bank!.ownerName,
          // OPTIMIZATION: Don't include large data in URL to prevent 431 errors
          qrCode: null, // QR will be generated client-side from bank info
          urlSuccess: createdOrder.urlSuccess,
          urlFailed: createdOrder.urlFailed,
          urlCanceled: createdOrder.urlCanceled,
          urlCallBack: createdOrder.urlCallBack,
          merchantName: merchantInfo?.accountName || '',
          // OPTIMIZATION: Don't include logo URL - use default icon instead
          merchantLogoUrl: '',
          merchantId: merchantAccount.publicTransactionId
        };
        
        paymentUrl = createEncodedPaymentUrl(baseUrl, paymentData);
      } catch (error) {
        // If encoding fails, log error and use fallback regular URL
        console.error('Failed to create encoded payment URL, using regular URL:', error);
        await log.warn('Failed to create encoded payment URL, falling back to regular URL', {
          orderId: createdOrder.odrId,
          merchantId: merchantAccount.publicTransactionId,
          error: error instanceof Error ? error.message : String(error)
        });
        paymentUrl = `${baseUrl}/payment/${createdOrder.odrId}`;
      }

      return [{
        success: true,
        odrId: createdOrder.odrId,
        odrType: createdOrder.odrType,
        amount: createdOrder.amount,
        merchantOrdId: createdOrder.merchantOrdId,
        message: 'Deposit order created successfully',
        timestamp: formattedTimestamp,
        performance: {
          validation: Math.round(performanceMetrics.validation),
          qrGeneration: Math.round(performanceMetrics.qrGeneration),
          userAssignment: 0,
          transactionCreation: Math.round(performanceMetrics.transactionCreation),
          balanceUpdate: 0,
          total: Math.round(performanceMetrics.total)
        },
        data: {
          odrId: createdOrder.odrId,
          odrStatus: createdOrder.odrStatus,
          bankName: bank!.bankName,
          accountNumber: bank!.accountNumber,
          ownerName: bank!.ownerName,
          amount: createdOrder.amount,
          timestamp: formattedTimestamp,
          paymentUrl: paymentUrl,
          qrCode: createdOrder.qrCode || null,
        }
      }];
    } else {
      return [{
        success: true,
        odrId: createdOrder.odrId,
        odrType: createdOrder.odrType,
        amount: createdOrder.amount,
        merchantOrdId: createdOrder.merchantOrdId,
        message: 'Withdraw order created successfully',
        timestamp: formattedTimestamp,
        performance: {
          validation: Math.round(performanceMetrics.validation),
          qrGeneration: Math.round(performanceMetrics.qrGeneration),
          userAssignment: Math.round(performanceMetrics.userAssignment),
          transactionCreation: Math.round(performanceMetrics.transactionCreation),
          balanceUpdate: Math.round(performanceMetrics.balanceUpdate),
          total: Math.round(performanceMetrics.total)
        },
        data: {
          odrId: createdOrder.odrId,
          odrStatus: createdOrder.odrStatus,
          bankReceiveNumber: createdOrder.bankReceiveNumber,
          bankReceiveOwnerName: createdOrder.bankReceiveOwnerName,
          amount: createdOrder.amount,
          timestamp: formattedTimestamp,
        }
      }];
    }

  } catch (error) {
    return [{
      success: false,
      message: error instanceof Error ? error.message : String(error),
      odrType: data.odrType,
      amount: data.amount,
      merchantOrdId: data.merchantOrdId,
      performance: {
        validation: Math.round(performanceMetrics.validation),
        qrGeneration: Math.round(performanceMetrics.qrGeneration),
        userAssignment: Math.round(performanceMetrics.userAssignment),
        transactionCreation: Math.round(performanceMetrics.transactionCreation),
        balanceUpdate: Math.round(performanceMetrics.balanceUpdate),
        total: Math.round(performance.now() - orderStartTime)
      }
    }];
  }
}

// All-parallel processing for small batches (2-10 orders)
async function processOrdersParallel(
  ordersArray: CreateOrderData[],
  merchantAccount: MerchantAccount,
  clientIp: string,
  request: NextRequest,
  healthyDatabase: 'appwrite' | 'supabase' | 'none'
): Promise<ProcessingResult[]> {
  // Process all orders simultaneously
  const promises = ordersArray.map((orderData) =>
    processSingleOrderOptimized(orderData, merchantAccount, clientIp, request, healthyDatabase)
      .then(result => result[0]) // Extract single result from array
      .catch(error => ({
        success: false,
        message: error instanceof Error ? error.message : String(error),
        odrType: orderData.odrType,
        amount: orderData.amount,
        merchantOrdId: orderData.merchantOrdId
      }))
  );
  
  return await Promise.all(promises);
}

// Batched processing for medium/large batches (11+ orders)
async function processOrdersBatched(
  ordersArray: CreateOrderData[],
  merchantAccount: MerchantAccount,
  clientIp: string,
  request: NextRequest,
  batchSize: number = 10,
  healthyDatabase: 'appwrite' | 'supabase' | 'none'
): Promise<ProcessingResult[]> {
  const results: ProcessingResult[] = [];
  
  for (let i = 0; i < ordersArray.length; i += batchSize) {
    const batch = ordersArray.slice(i, i + batchSize);
    
    const batchPromises = batch.map((orderData) =>
      processSingleOrderOptimized(orderData, merchantAccount, clientIp, request, healthyDatabase)
        .then(result => result[0]) // Extract single result from array
        .catch(error => ({
          success: false,
          message: error instanceof Error ? error.message : String(error),
          odrType: orderData.odrType,
          amount: orderData.amount,
          merchantOrdId: orderData.merchantOrdId
        }))
    );
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }
  
  return results;
}