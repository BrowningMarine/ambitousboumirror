import { NextRequest, NextResponse } from "next/server";
import { OrderTransaction } from "@/types";
import { formatAmount, generateUniqueString, verifyApiKeyAndAccount } from "@/lib/utils";
import { Query } from "appwrite";
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { log, captureRequestDetails } from "@/lib/logger";
import { dbManager } from "@/lib/database/connection-manager";

import { appConfig, getPaymentBaseUrl } from "@/lib/appconfig";
import { chkBanksControl, getBankById } from "@/lib/actions/bank.actions";
import { createEncodedPaymentUrl, type PaymentData } from "@/lib/payment-encoder";
import { getAccount } from "@/lib/actions/account.actions";
import { MerchantAccountCacheService, BackupOrderService } from "@/lib/supabase-backup";

import { createTransactionOptimized, getProcessingWithdrawalsTotal } from "@/lib/actions/transaction.actions";
import { LRUCache } from 'lru-cache';
import { NotificationQueue } from "@/lib/background/notification-queue";
import { BulkRateLimiter } from "@/lib/rate-limit";
import { VietQRService } from "@/lib/vietqr-api";
import QRLocal from "@/lib/qr_local";

// OPTIMIZATION: Pre-import heavy modules to reduce runtime import overhead
import { updateAccountBalance } from "@/lib/actions/account.actions";
import { getReadyWithdrawUsers, getUserDocumentId } from "@/lib/actions/user.actions";
import { assignWithdrawalToUser } from "@/lib/actions/withdraw.actions";
import { updateTransactionStatus } from "@/lib/actions/transaction.actions";

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

const qrTemplateCode = appConfig.qrTemplateCode;

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
  // DEBUG: Log client-only mode configuration
  console.log('🔧 DEBUG validateCreateOrderFields:', {
    useClientOnlyPayment: appConfig.useClientOnlyPayment,
    envVar: process.env.USE_CLIENT_ONLY_PAYMENT,
    odrType: data.odrType,
    bankId: data.bankId,
    bankCode: data.bankCode
  });
  
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

    // Validate bankId against transactorBanks
    try {
      // Get admin client
      const { database } = await createAdminClient();

      // Check if bankId exists in transactor's active banks
      const bankDoc = await database.listDocuments(
        DATABASE_ID,
        appwriteConfig.banksCollectionId,
        [
          Query.equal("isActivated", [true]),
          Query.equal("bankId", [data.bankId]),
          Query.limit(1)
        ]
      );

      if (!bankDoc || bankDoc.documents.length === 0) {
        return { valid: false, message: "Invalid or inactive bank ID" };
      }
    } catch (error) {
      // Log detailed error information for debugging
      console.error("Error validating bank ID:", {
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorName: error instanceof Error ? error.name : 'Unknown',
        clientOnlyMode: appConfig.useClientOnlyPayment,
        bankId: data.bankId
      });
      
      // If client-only mode is enabled, ALWAYS skip validation when ANY database error occurs
      if (appConfig.useClientOnlyPayment) {
        console.warn(`Bank validation skipped (database error, client-only mode enabled): ${data.bankId}`);
        return { valid: true, message: "" };
      }
      
      // Check if this is a database connectivity error (for non-client-only mode)
      if (error instanceof Error && 
          (error.message?.includes('fetch failed') || 
           error.message?.includes('ECONNREFUSED') ||
           error.message?.includes('network') ||
           error.message?.includes('timeout') ||
           error.message?.includes('AppwriteException') ||
           error.message?.includes('connect') ||
           error.message?.includes('refused'))) {
        
        return { 
          valid: false, 
          message: "Database temporarily unavailable. Unable to validate bank ID. Please try again or contact support." 
        };
      }
      
      // For other errors in non-client-only mode, return generic validation failure
      return { valid: false, message: "Invalid bank ID" };
    }
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

    // Validate bankCode against bankBlackList & bankList
    try {
      const bankBlackList = await chkBanksControl({ bankCode: data.bankCode, bankNumber: data.bankReceiveNumber });

      if (!bankBlackList || bankBlackList.success) {
        return { valid: false, message: bankBlackList.message || "Withdrawal bank is blacklisted!!!" };
      }

      // Use local bank validation instead of VietQR API
      if (!QRLocal.isSupportedBankBin(data.bankCode)) {
        return { valid: false, message: `Bank code ${data.bankCode} is not supported by the local QR system` };
      }
      
      // Get bank name from local database
      const bankName = QRLocal.getBankNameFromBin(data.bankCode);
      return { valid: true, message: '', bankReceiveName: bankName || 'Unknown Bank' };
    } catch (error) {
      // Log detailed error information for debugging
      console.error("Error validating bank code:", {
        error,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        errorName: error instanceof Error ? error.name : 'Unknown',
        clientOnlyMode: appConfig.useClientOnlyPayment,
        bankCode: data.bankCode
      });
      
      // If client-only mode is enabled, ALWAYS skip blacklist check when ANY database error occurs
      if (appConfig.useClientOnlyPayment) {
        console.warn(`Bank blacklist check skipped (database error, client-only mode enabled): ${data.bankCode}`);
        
        // Still validate bank code locally
        if (!QRLocal.isSupportedBankBin(data.bankCode)) {
          return { valid: false, message: `Bank code ${data.bankCode} is not supported by the local QR system` };
        }
        
        // Get bank name from local database
        const bankName = QRLocal.getBankNameFromBin(data.bankCode);
        return { valid: true, message: '', bankReceiveName: bankName || 'Unknown Bank' };
      }
      
      // Check if this is a database connectivity error (for non-client-only mode)
      if (error instanceof Error && 
          (error.message?.includes('fetch failed') || 
           error.message?.includes('ECONNREFUSED') ||
           error.message?.includes('network') ||
           error.message?.includes('timeout') ||
           error.message?.includes('AppwriteException') ||
           error.message?.includes('connect') ||
           error.message?.includes('refused'))) {
        
        return { 
          valid: false, 
          message: "Database temporarily unavailable. Unable to validate bank. Please try again or contact support." 
        };
      }
      
      // For other errors in non-client-only mode, return generic validation failure
      return { valid: false, message: 'Could not validate bank code due to API error' };
    }
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

function generateOrderId(): string {
  // Get current date in YYYYMMDD format  
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const firstprefix = appConfig.odrPrefix;
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
      const requestDetails = await captureRequestDetails(request);
      await log.warn('POST orders: Missing API key', { 
        merchantId: publicTransactionId, 
        clientIp,
        requestDetails
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

    // Verify merchant account
    // When useClientOnlyPayment is enabled, use Supabase cache instead of querying main database
    let merchantAccount;
    
    if (appConfig.useClientOnlyPayment) {
      // Use Supabase cache for merchant verification
      const merchantCacheService = new MerchantAccountCacheService();
      const cachedMerchant = await merchantCacheService.getMerchantByApiKey(apiKey, publicTransactionId);
      
      if (!cachedMerchant) {
        const requestDetails = await captureRequestDetails(request);
        await log.warn('POST orders: Invalid API key or account (Supabase cache)', { 
          merchantId: publicTransactionId,
          clientIp,
          requestDetails,
          cacheMode: 'supabase'
        });
        return NextResponse.json(
          { success: false, message: 'Invalid API key or account. Please ensure merchant is cached in Supabase.' },
          { status: 401 }
        );
      }
      
      // Convert cached merchant to expected format (Supabase uses snake_case)
      merchantAccount = {
        $id: cachedMerchant.appwrite_doc_id || cachedMerchant.merchant_id,
        publicTransactionId: cachedMerchant.merchant_id,
        depositWhitelistIps: cachedMerchant.deposit_whitelist_ips || [],
        withdrawWhitelistIps: cachedMerchant.withdraw_whitelist_ips || [],
        avaiableBalance: cachedMerchant.available_balance || 0,
        minDepositAmount: cachedMerchant.min_deposit_amount,
        maxDepositAmount: cachedMerchant.max_deposit_amount,
        minWithdrawAmount: cachedMerchant.min_withdraw_amount,
        maxWithdrawAmount: cachedMerchant.max_withdraw_amount,
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
    } else {
      // Normal mode: query main database
      try {
        merchantAccount = await verifyApiKeyAndAccount(apiKey, publicTransactionId);
        if (!merchantAccount) {
          const requestDetails = await captureRequestDetails(request);
          await log.warn('POST orders: Invalid API key or account', { 
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
        // Database connection error - suggest fallback mode
        const requestDetails = await captureRequestDetails(request);
        await log.error('POST orders: Database connection error during merchant verification', 
          dbError instanceof Error ? dbError : new Error(String(dbError)), { 
          merchantId: publicTransactionId,
          clientIp,
          requestDetails,
          suggestion: 'Enable USE_CLIENT_ONLY_PAYMENT=true in .env for resilient operation'
        });
        return NextResponse.json(
          { 
            success: false, 
            message: 'Database temporarily unavailable. Please try again or contact support.',
            error: 'DB_CONNECTION_ERROR',
            suggestion: 'System administrator: Consider enabling client-only payment mode for resilient operation'
          },
          { status: 503 }
        );
      }
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
        request
      );
    } else if (ordersArray.length >= 2 && ordersArray.length <= SECURITY_LIMITS.MAX_ORDERS_PARALLEL) {
      processingStrategy = 'parallel-optimized';
      processingResults = await processOrdersParallel(
        ordersArray as CreateOrderData[], 
        merchantAccount, 
        clientIp, 
        request
      );
    } else if (ordersArray.length >= (SECURITY_LIMITS.MAX_ORDERS_PARALLEL + 1) && ordersArray.length <= SECURITY_LIMITS.MAX_ORDERS_BATCHED) {
      processingStrategy = 'batched-optimized';
      processingResults = await processOrdersBatched(
        ordersArray as CreateOrderData[], 
        merchantAccount, 
        clientIp, 
        request,
        10
      );
    } else {
      processingStrategy = 'conservative-batched';
      processingResults = await processOrdersBatched(
        ordersArray as CreateOrderData[], 
        merchantAccount, 
        clientIp, 
        request,
        5
      );
    }

    const successCount = processingResults.filter(r => r.success).length;
    const failureCount = processingResults.length - successCount;
    const totalTime = performance.now() - requestStartTime;

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
      mode: appConfig.useClientOnlyPayment ? 'client-only' : 'normal',
      totalTime: Math.round(totalTime),
      clientIp
    };

    // Add performance breakdown for single orders
    if (ordersArray.length === 1 && firstResult.performance) {
      logData.odrId = firstResult.odrId;
      logData.odrType = firstResult.odrType;
      logData.amount = firstResult.amount;
      logData.performance = firstResult.performance;
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
      
      return NextResponse.json({
        success: overallSuccess,
        message: message,
        summary: {
          totalOrders: processingResults.length,
          successCount,
          failureCount,
          depositCount,
          withdrawCount,
          processingTime: Math.round(totalTime),
          strategy: processingStrategy
        },
        results: processingResults
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
  request: NextRequest
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

    // Generate a unique order ID if not provided  
    const odrId = data.odrId || generateOrderId();

    // STEP 2: QR Code Generation (deposit/withdraw)
    const qrStart = performance.now();
    let qrCode: string | undefined = undefined;
    let bank;

    // Generate QR based on type and configuration
    if (data.odrType === 'deposit' && data.bankId) {
      try {
        const bankResult = await getBankById(data.bankId);
        if (!bankResult.success || !bankResult.bank) {
          // If client-only mode is enabled, use fallback bank data
          if (appConfig.useClientOnlyPayment) {
            console.warn(`Bank lookup failed (client-only mode): Using fallback bank data for bankId: ${data.bankId}`);
            // Use fallback bank data from config
            bank = {
              $id: data.bankId,
              ...appConfig.fallbackBankData,
              bankId: data.bankId  // Override with actual bankId from request
            };
          } else {
            throw new Error('Transactor bank not found');
          }
        } else {
          bank = bankResult.bank;
        }
      } catch (error) {
        console.error("Error fetching bank data:", {
          error,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          clientOnlyMode: appConfig.useClientOnlyPayment,
          bankId: data.bankId
        });
        
        // If client-only mode is enabled and this is a database error, use fallback bank data
        if (appConfig.useClientOnlyPayment) {
          console.warn(`Database error (client-only mode): Using fallback bank data for bankId: ${data.bankId}`);
          // Use fallback bank data from config
          bank = {
            $id: data.bankId,
            ...appConfig.fallbackBankData,
            bankId: data.bankId  // Override with actual bankId from request
          };
        } else {
          throw error;
        }
      }
      
      if (appConfig.create_qr_by === 'local') {
        // Use QR Local for deposit
        try {
          const qrResult = await QRLocal.generateQR({
            bankBin: bank.bankBinCode,
            accountNumber: bank.accountNumber,
            amount: Number(data.amount),
            orderId: odrId
          });
          
          if (qrResult.success && qrResult.qrDataURL) {
            qrCode = qrResult.qrDataURL;
          } else {
            qrCode = `https://img.vietqr.io/image/${bank.bankBinCode}-${bank.accountNumber}-${qrTemplateCode}.png?amount=${Math.floor(Number(data.amount))}&addInfo=${odrId}`;
          }
        } catch {
          qrCode = `https://img.vietqr.io/image/${bank.bankBinCode}-${bank.accountNumber}-${qrTemplateCode}.png?amount=${Math.floor(Number(data.amount))}&addInfo=${odrId}`;
        }
      } else if (appConfig.create_qr_by === 'vietqr') {
        // Use VietQR API for deposit
        try {
          const qrResult = await VietQRService.generateQRCode({
            bankCode: bank.bankBinCode,
            accountNumber: bank.accountNumber,
            accountName: bank.ownerName,
            amount: Number(data.amount),
            orderId: odrId
          });
          
          if (qrResult.success) {
            qrCode = qrResult.qrCode;
          } else {
            qrCode = `https://img.vietqr.io/image/${bank.bankBinCode}-${bank.accountNumber}-${qrTemplateCode}.png?amount=${Math.floor(Number(data.amount))}&addInfo=${odrId}`;
          }
        } catch {
          qrCode = `https://img.vietqr.io/image/${bank.bankBinCode}-${bank.accountNumber}-${qrTemplateCode}.png?amount=${Math.floor(Number(data.amount))}&addInfo=${odrId}`;
        }
      }
    }
    else if (data.odrType === 'withdraw' && data.bankReceiveNumber && data.bankCode) {
      if (appConfig.create_qr_by === 'local') {
        // Use QR Local for withdraw
        try {
          const qrResult = await QRLocal.generateQR({
            bankBin: data.bankCode,
            accountNumber: data.bankReceiveNumber,
            amount: Number(data.amount),
            orderId: odrId
          });
          
          if (qrResult.success && qrResult.qrDataURL) {
            qrCode = qrResult.qrDataURL;
          } else {
            qrCode = `https://img.vietqr.io/image/${data.bankCode}-${data.bankReceiveNumber}-${qrTemplateCode}.png?amount=${Math.floor(Number(data.amount))}&addInfo=${odrId}`;
          }
        } catch {
          qrCode = `https://img.vietqr.io/image/${data.bankCode}-${data.bankReceiveNumber}-${qrTemplateCode}.png?amount=${Math.floor(Number(data.amount))}&addInfo=${odrId}`;
        }
      } else {
        // Use VietQR direct URL for withdraw (default for vietqr mode)
        qrCode = `https://img.vietqr.io/image/${data.bankCode}-${data.bankReceiveNumber}-${qrTemplateCode}.png?amount=${Math.floor(Number(data.amount))}&addInfo=${odrId}`;
      }
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
    
    // Choose database based on useClientOnlyPayment config
    let transactionResult;
    let createdOrder;
    
    if (appConfig.useClientOnlyPayment) {
      // Write to Supabase backup database
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
        $createdAt: new Date().toISOString()
      };
      
      transactionResult = { success: true, data: createdOrder };
    } else {
      // Normal mode: Write to Appwrite
      transactionResult = await createTransactionOptimized(transactionData);
      
      if (!transactionResult || !transactionResult.success || !transactionResult.data) {
        throw new Error(transactionResult?.message || 'Transaction creation failed');
      }
      
      createdOrder = transactionResult.data;
    }
    
    performanceMetrics.transactionCreation = performance.now() - transactionStart;
    
    if (!transactionResult || !transactionResult.success || !createdOrder) {
      throw new Error('Transaction creation failed');
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
      const baseUrl = getPaymentBaseUrl(request);
      let paymentUrl = `${baseUrl}/payment/${createdOrder.odrId}`;
      
      // If client-only payment mode is enabled, create encoded payment URL
      if (appConfig.useClientOnlyPayment) {
        try {
          // Get merchant account info for logo and name
          const merchantInfo = await getAccount(merchantAccount.publicTransactionId);
          
          const paymentData: PaymentData = {
            odrId: createdOrder.odrId,
            merchantOrdId: createdOrder.merchantOrdId,
            odrType: createdOrder.odrType,
            odrStatus: createdOrder.odrStatus,
            amount: createdOrder.amount,
            timestamp: createdOrder.$createdAt,
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
          // If encoding fails, fallback to regular URL
          console.error('Failed to create encoded payment URL:', error);
          await log.error('Failed to create encoded payment URL', error instanceof Error ? error : new Error(String(error)), {
            orderId: createdOrder.odrId,
            merchantId: merchantAccount.publicTransactionId
          });
        }
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
          bankReceiveCode: createdOrder.bankReceiveCode,
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
  request: NextRequest
): Promise<ProcessingResult[]> {
  // Process all orders simultaneously
  const promises = ordersArray.map((orderData) =>
    processSingleOrderOptimized(orderData, merchantAccount, clientIp, request)
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
  batchSize: number = 10
): Promise<ProcessingResult[]> {
  const results: ProcessingResult[] = [];
  
  for (let i = 0; i < ordersArray.length; i += batchSize) {
    const batch = ordersArray.slice(i, i + batchSize);
    
    const batchPromises = batch.map((orderData) =>
      processSingleOrderOptimized(orderData, merchantAccount, clientIp, request)
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