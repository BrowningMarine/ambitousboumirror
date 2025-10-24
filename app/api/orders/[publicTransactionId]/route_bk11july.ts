import { NextRequest, NextResponse } from "next/server";
import { OrderTransaction } from "@/types";
import { formatAmount, generateUniqueString, verifyApiKeyAndAccount } from "@/lib/utils";
import { Query } from "appwrite";
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { log } from "@/lib/logger";

import { appConfig, getPaymentBaseUrl } from "@/lib/appconfig";
import { chkBanksControl, getBankById } from "@/lib/actions/bank.actions";

import { createTransactionOptimized, getProcessingWithdrawalsTotal } from "@/lib/actions/transaction.actions";
import { LRUCache } from 'lru-cache';
import { VietQRCache } from "@/lib/cache/vietqr-cache";
import { NotificationQueue } from "@/lib/background/notification-queue";

// OPTIMIZATION: Pre-import heavy modules to reduce runtime import overhead
import { updateAccountBalance } from "@/lib/actions/account.actions";
import { getReadyWithdrawUsers, getUserDocumentId } from "@/lib/actions/user.actions";
import { assignWithdrawalToUser } from "@/lib/actions/withdraw.actions";
import { updateTransactionStatus } from "@/lib/actions/transaction.actions";

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
  // Check common required fields  
  if (!data.odrType) {
    log.warn("Validation failed: Missing required field odrType", { merchantId: merchantAccount.publicTransactionId, data });
    return { valid: false, message: "Missing required field: odrType" };
  }

  if (!data.amount) {
    log.warn("Validation failed: Missing required field amount", { merchantId: merchantAccount.publicTransactionId, data });
    return { valid: false, message: "Missing required field: amount" };
  }

  // Validate odrType values  
  if (data.odrType !== 'deposit' && data.odrType !== 'withdraw') {
    log.warn("Validation failed: Invalid odrType value", { merchantId: merchantAccount.publicTransactionId, odrType: data.odrType, data });
    return { valid: false, message: "odrType must be either 'deposit' or 'withdraw'" };
  }

  // Validate amount is a number and positive  
  const amount = Number(data.amount);
  if (isNaN(amount)) {
    log.warn("Validation failed: Invalid amount format", { merchantId: merchantAccount.publicTransactionId, amount: data.amount, data });
    return { valid: false, message: "amount must be a valid number" };
  }

  if (amount <= 0) {
    log.warn("Validation failed: Amount must be positive", { merchantId: merchantAccount.publicTransactionId, amount: amount, data });
    return { valid: false, message: "amount must be greater than 0" };
  }

  // Validate amount doesn't exceed 13 digits  
  if (amount.toString().replace('.', '').length > 13) {
    log.warn("Validation failed: Amount exceeds 13 digits", { merchantId: merchantAccount.publicTransactionId, amount: amount, digits: amount.toString().replace('.', '').length, data });
    return { valid: false, message: "amount cannot exceed 13 digits" };
  }

  if (!data.urlCallBack || data.urlCallBack.trim() === '') {
    log.warn("Validation failed: Missing urlCallBack", { merchantId: merchantAccount.publicTransactionId, urlCallBack: data.urlCallBack, data });
    return { valid: false, message: "urlCallBack is required" };
  }

  // Validate type-specific required fields  
  if (data.odrType === 'deposit') {
    if (!data.bankId || data.bankId.trim() === '') {
      log.warn("Validation failed: Missing bankId for deposit", { merchantId: merchantAccount.publicTransactionId, bankId: data.bankId, data });
      return { valid: false, message: "bankId is required" };
    }

    // Validate deposit amount limits
    if (merchantAccount.minDepositAmount && merchantAccount.minDepositAmount > 0 && amount < merchantAccount.minDepositAmount) {
      log.warn("Validation failed: Deposit amount below minimum", { 
        merchantId: merchantAccount.publicTransactionId, 
        amount: amount, 
        minDepositAmount: merchantAccount.minDepositAmount,
        data 
      });
      return { valid: false, message: `Deposit amount must be at least ${merchantAccount.minDepositAmount}` };
    }

    if (merchantAccount.maxDepositAmount && merchantAccount.maxDepositAmount > 0 && amount > merchantAccount.maxDepositAmount) {
      log.warn("Validation failed: Deposit amount exceeds maximum", { 
        merchantId: merchantAccount.publicTransactionId, 
        amount: amount, 
        maxDepositAmount: merchantAccount.maxDepositAmount,
        data 
      });
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
      //console.log(bankDoc);

      if (!bankDoc || bankDoc.documents.length === 0) {
        log.warn("Validation failed: Invalid or inactive bank ID", { merchantId: merchantAccount.publicTransactionId, bankId: data.bankId, data });
        return { valid: false, message: "Invalid or inactive bank ID" };
      }
    } catch (error) {
      console.error("Error validating bank ID:", error);
      log.warn("Validation failed: Error validating bank ID", { merchantId: merchantAccount.publicTransactionId, bankId: data.bankId, error: error, data });
      return { valid: false, message: "Invalid bank ID" };
    }
  } else if (data.odrType === 'withdraw') {
    if (!data.bankCode || data.bankCode.trim() === '') {
      log.warn("Validation failed: Missing bankCode for withdraw", { merchantId: merchantAccount.publicTransactionId, bankCode: data.bankCode, data });
      return { valid: false, message: "bankCode is required" };
    }

    if (!data.bankReceiveNumber || data.bankReceiveNumber.trim() === '') {
      log.warn("Validation failed: Missing bankReceiveNumber for withdraw", { merchantId: merchantAccount.publicTransactionId, bankReceiveNumber: data.bankReceiveNumber, data });
      return { valid: false, message: "bankReceiveNumber is required for withdraw orders" };
    }

    // Validate bankReceiveNumber format (only alphanumeric, 6-19 characters, no spaces)
    const bankNumberRegex = /^[a-zA-Z0-9]{5,19}$/;
    if (!bankNumberRegex.test(data.bankReceiveNumber)) {
      log.warn("Validation failed: Invalid bankReceiveNumber format", { 
        merchantId: merchantAccount.publicTransactionId, 
        bankReceiveNumber: data.bankReceiveNumber, 
        length: data.bankReceiveNumber.length,
        data 
      });
      return { valid: false, message: "bankReceiveNumber must contain only letters and numbers, be 5-19 characters long, and contain no spaces" };
    }

    if (!data.bankReceiveOwnerName || data.bankReceiveOwnerName.trim() === '') {
      log.warn("Validation failed: Missing bankReceiveOwnerName for withdraw", { merchantId: merchantAccount.publicTransactionId, bankReceiveOwnerName: data.bankReceiveOwnerName, data });
      return { valid: false, message: "bankReceiveOwnerName is required for withdraw orders" };
    }

    // Validate bankReceiveOwnerName format (only letters and spaces)
    const nameRegex = /^[A-Za-zÀ-ỹ\s]+$/;
    if (!nameRegex.test(data.bankReceiveOwnerName)) {
      log.warn("Validation failed: Invalid bankReceiveOwnerName format", { 
        merchantId: merchantAccount.publicTransactionId, 
        bankReceiveOwnerName: data.bankReceiveOwnerName,
        data 
      });
      return { valid: false, message: "bankReceiveOwnerName must contain only letters and spaces" };
    }

    // Validate withdraw amount limits
    if (merchantAccount.minWithdrawAmount && merchantAccount.minWithdrawAmount > 0 && amount < merchantAccount.minWithdrawAmount) {
      log.warn("Validation failed: Withdraw amount below minimum", { 
        merchantId: merchantAccount.publicTransactionId, 
        amount: amount, 
        minWithdrawAmount: merchantAccount.minWithdrawAmount,
        data 
      });
      return { valid: false, message: `Withdraw amount must be at least ${merchantAccount.minWithdrawAmount}` };
    }

    if (merchantAccount.maxWithdrawAmount && merchantAccount.maxWithdrawAmount > 0 && amount > merchantAccount.maxWithdrawAmount) {
      log.warn("Validation failed: Withdraw amount exceeds maximum", { 
        merchantId: merchantAccount.publicTransactionId, 
        amount: amount, 
        maxWithdrawAmount: merchantAccount.maxWithdrawAmount,
        data 
      });
      return { valid: false, message: `Withdraw amount cannot exceed ${merchantAccount.maxWithdrawAmount}` };
    }

    // Validate bankCode against bankBlackList & bankList
    try {
      const bankBlackList = await chkBanksControl({ bankCode: data.bankCode, bankNumber: data.bankReceiveNumber });

      if (!bankBlackList || bankBlackList.success) {
        log.warn("Validation failed: Bank is blacklisted", { 
          merchantId: merchantAccount.publicTransactionId, 
          bankCode: data.bankCode, 
          bankReceiveNumber: data.bankReceiveNumber,
          message: bankBlackList?.message,
          data 
        });
        return { valid: false, message: bankBlackList.message || "Withdrawal bank is blacklisted!!!" };
      }

      // OPTIMIZATION: Use cached VietQR API data instead of direct API call
      // This eliminates 500-1500ms external API dependency
      const bankValidation = await VietQRCache.validateBankCode(data.bankCode);
      
      if (!bankValidation.valid) {
        log.warn("Validation failed: Invalid bank code from VietQR", { 
          merchantId: merchantAccount.publicTransactionId, 
          bankCode: data.bankCode,
          message: bankValidation.message,
          data 
        });
        return { valid: false, message: bankValidation.message };
      }
      
      // Return the bank's short name for storage
      return { valid: true, message: '', bankReceiveName: bankValidation.bankReceiveName };
    } catch (error) {
      console.error("Error validating bank code:", error);
      log.warn("Validation failed: Error validating bank code", { 
        merchantId: merchantAccount.publicTransactionId, 
        bankCode: data.bankCode,
        error: error,
        data 
      });
      // If API call fails, block the transaction
      //console.warn("Could not validate bank code due to API error");
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
  // Try to get the most reliable IP address
  let clientIp = '';

  // Get client IP from headers (less reliable, can be spoofed)
  const ipFromHeaders = request.headers.get('cf-connecting-ip') ||
    request.headers.get('x-forwarded-for') ||
    request.headers.get('x-real-ip') ||
    request.headers.get('true-client-ip') ||
    '';

  // Use the first IP if multiple are present in headers
  clientIp = ipFromHeaders.split(',')[0].trim();

  try {
    // Get API key from Authorization header  
    const apiKey = request.headers.get('x-api-key');

    if (!apiKey) {
      log.warn("Validation failed: Missing API key", { endpoint: 'GET /api/orders', clientIp: clientIp, headers: Object.fromEntries(request.headers.entries()) });
      return NextResponse.json(
        { success: false, message: 'API key is required', "IP": clientIp },
        { status: 401 }
      );
    }

    const { publicTransactionId } = await params;

    // Get filter parameters  
    const { searchParams } = new URL(request.url);
    const orderType = searchParams.get('orderType');

    // Verify API key and account  
    const account = await verifyApiKeyAndAccount(apiKey, publicTransactionId);

    if (!account) {
      log.warn("Validation failed: Invalid API key or account", { 
        endpoint: 'GET /api/orders', 
        apiKey: apiKey, 
        publicTransactionId: publicTransactionId, 
        clientIp: clientIp 
      });
      return NextResponse.json(
        { success: false, message: 'Invalid API key or account', "IP": clientIp },
        { status: 401 }
      );
    }

    // Get admin client  
    const { database } = await createAdminClient();

    // Build query  
    const queries = [
      Query.equal("positiveAccount", [publicTransactionId]),
      Query.orderDesc("$createdAt")
    ];

    // Add order type filter if provided  
    if (orderType === 'deposit' || orderType === 'withdraw') {
      queries.push(Query.equal("odrType", [orderType]));
    }

    // Query for orders with matching account ID  
    const orders = await database.listDocuments(
      DATABASE_ID!,
      ORDER_TRANS_COLLECTION_ID!,
      queries
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

    return NextResponse.json({
      success: true,
      data: filteredOrders
    });

  } catch (error) {
    log.error("Error getting order transactions", error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json(
      { success: false, message: 'Internal server error', "IP": clientIp },
      { status: 500 }
    );
  }
}

// POST /api/orders/[publicTransactionId] - Create a new order for an account  
export async function POST(
  request: NextRequest,
  { params }: { params: { publicTransactionId: string } }
) {
  // OPTIMIZATION: Add performance monitoring to track improvements
  const requestStartTime = performance.now();
  const performanceMetrics = {
    initialization: 0,
    parallelOperations: 0,
    validation: 0,
    qrGeneration: 0,
    userLookup: 0,
    transactionCreation: 0,
    balanceUpdate: 0,
    responseGeneration: 0,
    total: 0
  };
  
  try {
    // Get API key from Authorization header  
    const apiKey = request.headers.get('x-api-key');

    if (!apiKey) {
      log.warn("Validation failed: Missing API key", { endpoint: 'POST /api/orders', headers: Object.fromEntries(request.headers.entries()) });
      return NextResponse.json(
        { success: false, message: 'API key is required' },
        { status: 401 }
      );
    }

    const { publicTransactionId } = await params;

    // Get order data from request body  
    const data = await request.json() as CreateOrderData;

    // 1. Try to get IP from request object if available (might be available in some environments)
    let clientIp = '';

    // 2. Get client IP from headers (less reliable, can be spoofed)
    const ipFromHeaders = request.headers.get('cf-connecting-ip') ||
      request.headers.get('x-forwarded-for') ||
      request.headers.get('x-real-ip') ||
      request.headers.get('true-client-ip') ||
      '';

    // Use the first IP if multiple are present in headers
    clientIp = ipFromHeaders.split(',')[0].trim();

    // Check for valid IP address
    if (!clientIp || !isValidPublicIp(clientIp)) {
      log.warn("Validation failed: Invalid or missing public IP address", { 
        clientIp: clientIp, 
        headers: {
          'cf-connecting-ip': request.headers.get('cf-connecting-ip'),
          'x-forwarded-for': request.headers.get('x-forwarded-for'),
          'x-real-ip': request.headers.get('x-real-ip'),
          'true-client-ip': request.headers.get('true-client-ip')
        }
      });
      return NextResponse.json(
        {
          success: false,
          message: 'Valid public IP address is required. Contact your system administrator for assistance.',
        },
        { status: 403 }
      );
    }

    // Track initialization time (request parsing, IP validation, etc.)
    const initializationTime = performance.now() - requestStartTime;
    performanceMetrics.initialization = initializationTime;

    // OPTIMIZATION: Parallelize independent database operations
    // Instead of sequential: verifyApiKeyAndAccount -> validateCreateOrderFields
    // Run in parallel: verifyApiKeyAndAccount + basic validation + duplicate check
    
    const parallelOperationsStart = performance.now();
    
    const [merchantAccount, duplicateCheck, basicValidation] = await Promise.all([
      // 1. Verify API key and account (independent operation)
      verifyApiKeyAndAccount(apiKey, publicTransactionId),
      
      // 2. Check for duplicate merchantOrdId (independent operation)
      data.merchantOrdId && data.merchantOrdId.trim() !== '' 
        ? (async () => {
            try {
              const { database } = await createAdminClient();
              const existingOrders = await database.listDocuments(
                DATABASE_ID!,
                ORDER_TRANS_COLLECTION_ID!,
                [
                  Query.equal("merchantOrdId", [data.merchantOrdId!]),
                  Query.limit(1)
                ]
              );
              return { isDuplicate: existingOrders.total > 0, merchantOrdId: data.merchantOrdId };
            } catch (error) {
              console.error('Error checking for duplicate merchantOrdId:', error);
              return { isDuplicate: false, merchantOrdId: data.merchantOrdId };
            }
          })()
        : Promise.resolve({ isDuplicate: false, merchantOrdId: null }),
      
      // 3. Basic field validation (independent of account data)
      (async () => {
        // Validate basic required fields without account dependency
        if (!data.odrType) {
          log.warn("Validation failed: Missing required field odrType (basic validation)", { data });
          return { valid: false, message: "Missing required field: odrType" };
        }
        if (!data.amount) {
          log.warn("Validation failed: Missing required field amount (basic validation)", { data });
          return { valid: false, message: "Missing required field: amount" };
        }
        if (data.odrType !== 'deposit' && data.odrType !== 'withdraw') {
          log.warn("Validation failed: Invalid odrType value (basic validation)", { odrType: data.odrType, data });
          return { valid: false, message: "odrType must be either 'deposit' or 'withdraw'" };
        }
        
        const amount = Number(data.amount);
        if (isNaN(amount) || amount <= 0) {
          log.warn("Validation failed: Invalid amount value (basic validation)", { amount: data.amount, parsedAmount: amount, data });
          return { valid: false, message: "amount must be a valid positive number" };
        }
        if (amount.toString().replace('.', '').length > 13) {
          log.warn("Validation failed: Amount exceeds 13 digits (basic validation)", { amount: amount, digits: amount.toString().replace('.', '').length, data });
          return { valid: false, message: "amount cannot exceed 13 digits" };
        }
        if (!data.urlCallBack || data.urlCallBack.trim() === '') {
          log.warn("Validation failed: Missing urlCallBack (basic validation)", { urlCallBack: data.urlCallBack, data });
          return { valid: false, message: "urlCallBack is required" };
        }
        
        return { valid: true, message: '' };
      })()
    ]);
    
    const parallelOperationsTime = performance.now() - parallelOperationsStart;
    performanceMetrics.parallelOperations = parallelOperationsTime;

    // Check results from parallel operations
    if (!merchantAccount) {
      log.warn("Validation failed: Invalid API key or account", { apiKey: apiKey, publicTransactionId: publicTransactionId });
      return NextResponse.json(
        { success: false, message: 'Invalid API key or account' },
        { status: 401 }
      );
    }

    if (duplicateCheck.isDuplicate) {
      log.warn("Validation failed: Duplicate merchantOrdId", { 
        merchantId: merchantAccount.publicTransactionId, 
        merchantOrdId: duplicateCheck.merchantOrdId,
        data 
      });
      return NextResponse.json(
        { success: false, message: `Order with merchantOrdId '${duplicateCheck.merchantOrdId}' already exists` },
        { status: 400 }
      );
    }

    if (!basicValidation.valid) {
      log.warn("Validation failed: Basic validation error", { 
        merchantId: merchantAccount.publicTransactionId, 
        message: basicValidation.message,
        data 
      });
      return NextResponse.json(
        { success: false, message: basicValidation.message },
        { status: 400 }
      );
    }

    // Now run account-dependent validation (requires merchantAccount data)
    const validationStart = performance.now();
    const validation = await validateCreateOrderFields(data, merchantAccount);
    const validationTime = performance.now() - validationStart;
    performanceMetrics.validation = validationTime;
    
    // Variables for final performance log
    const cacheStats = VietQRCache.getCacheStats();
    
    if (!validation.valid) {
      log.warn("Validation failed: Field validation error", { 
        merchantId: merchantAccount.publicTransactionId, 
        message: validation.message,
        data 
      });
      return NextResponse.json(
        { success: false, message: validation.message },
        { status: 400 }
      );
    }

    // Store the bank receive name from validation for withdraw orders
    const bankReceiveName: string | undefined = validation.bankReceiveName;

    // For withdraw operations, check if merchantAccount has sufficient balance  
    if (data.odrType === 'withdraw' && merchantAccount.avaiableBalance < data.amount) {
      log.warn("Validation failed: Insufficient balance for withdrawal", { 
        merchantId: merchantAccount.publicTransactionId, 
        requestedAmount: data.amount,
        availableBalance: merchantAccount.avaiableBalance,
        data 
      });
      return NextResponse.json(
        { success: false, message: `Merchant account ${merchantAccount.publicTransactionId} Insufficient balance` },
        { status: 400 }
      );
    }

    // Generate a unique order ID if not provided  
    const odrId = data.odrId || generateOrderId();

    // Variables for transactor bank info and QR code   
    let qrCode: string | undefined = undefined;
    let bank;

    // Prepare transaction data and get bank info in parallel
    const createTransactionPromises = [];

    // Import functions early to avoid waterfall requests

    // Generate QR based on type  
    if (data.odrType === 'deposit' && data.bankId) {
      // Verify that bank exists and is active for deposit  
      const bankPromise = getBankById(data.bankId).then(bankResult => {
        if (!bankResult.success || !bankResult.bank) {
          throw new Error('Transactor bank not found');
        }

        // Get the first bank from the results  
        bank = bankResult.bank;

        // Make sure bank exists before trying to access its properties  
        if (!bank) {
          throw new Error('Bank information is missing');
        }

        return bank;
      });

      createTransactionPromises.push(bankPromise);

      // Generate QR code for deposit in parallel using direct VietQR image URL
      const qrPromise = bankPromise.then(bank => {
        // Create direct VietQR image URL
        qrCode = `https://img.vietqr.io/image/${bank.bankBinCode}-${bank.accountNumber}-${qrTemplateCode}.png?amount=${Math.floor(Number(data.amount))}&addInfo=${odrId}`;
        return qrCode;
      }).catch(error => {
        console.error('Error generating QR code URL:', error);
        return undefined;
      });

      createTransactionPromises.push(qrPromise);
    }
    else if (data.odrType === 'withdraw' && data.bankReceiveNumber && data.bankCode) {
      // For withdrawals, generate QR code but it will only be stored internally
      // Create direct VietQR image URL for withdrawal  
      qrCode = `https://img.vietqr.io/image/${data.bankCode}-${data.bankReceiveNumber}-${qrTemplateCode}.png?amount=${Math.floor(Number(data.amount))}&addInfo=${odrId}`;
      createTransactionPromises.push(Promise.resolve(qrCode));
    }

    // Wait for all promises to resolve
    if (createTransactionPromises.length > 0) {
      await Promise.all(createTransactionPromises);
    }

    // Check if IP is in the whitelist based on order type
    let isSuspicious = false;
    if (data.odrType === 'deposit') {
      // Check against deposit whitelist
      isSuspicious = !isIpInWhitelist(clientIp, merchantAccount.depositWhitelistIps);
    } else if (data.odrType === 'withdraw') {
      // Check against withdraw whitelist
      isSuspicious = !isIpInWhitelist(clientIp, merchantAccount.withdrawWhitelistIps);
    }

    // Create transaction object  
    const transactionData: Omit<OrderTransaction, '$id'> = {
      odrId,
      merchantOrdId: data.merchantOrdId || '',
      odrType: data.odrType,
      odrStatus: data.odrType === 'deposit' ? 'processing' : 'pending', // Only deposit orders get 15-minute expiry timer
      bankId: data.bankId || '',
      amount: Math.floor(Number(data.amount)),  // Floor the amount to remove decimal places
      paidAmount: 0, // Initial paid amount is 0  
      unPaidAmount: Math.floor(Number(data.amount)), // Initial unpaid amount is the full amount   
      positiveAccount: data.odrType === 'deposit' ? merchantAccount.publicTransactionId : '',
      negativeAccount: data.odrType === 'withdraw' ? merchantAccount.publicTransactionId : '',
      urlSuccess: data.urlSuccess || '',
      urlFailed: data.urlFailed || '',
      urlCanceled: data.urlCanceled || '',
      urlCallBack: data.urlCallBack || '',
      qrCode: qrCode,
      lastPaymentDate: new Date().toISOString(),
      account: merchantAccount.$id,
      createdIp: clientIp, // Store the verified client IP
      isSuspicious: isSuspicious, // Set suspicious flag based on IP whitelist check
    };

    // Add type-specific fields  
    if (data.odrType === 'withdraw') {
      transactionData.bankCode = data.bankCode;
      transactionData.bankReceiveNumber = data.bankReceiveNumber;
      transactionData.bankReceiveOwnerName = data.bankReceiveOwnerName;
      transactionData.bankReceiveName = bankReceiveName;
    }

    // For withdraw orders, assign to user BEFORE creating transaction to avoid race condition
    let assignedUserId: string | null = null;
    let userLookupTime = 0;
    if (data.odrType === 'withdraw') {
      try {
        const userLookupStart = performance.now();
        const readyUsers = await getReadyWithdrawUsers();
        userLookupTime = performance.now() - userLookupStart;
        performanceMetrics.userLookup = userLookupTime;
        
        console.log(`[USER LOOKUP] Found ${readyUsers.length} ready users in ${Math.round(userLookupTime)}ms for order ${odrId}`);
        
        if (readyUsers.length > 0) {
          // Implement simple load balancing by rotating through users
          const userIndex = Math.floor(Date.now() / 10000) % readyUsers.length;
          assignedUserId = readyUsers[userIndex];
          
          // Get user document ID for assignment
          const userDocId = await getUserDocumentId(assignedUserId);
          
          if (userDocId) {
            // Add user assignment to transaction data BEFORE creation
            transactionData.users = userDocId;
          } else {
            assignedUserId = null; // Reset if we can't get document ID
          }
        }
      } catch (error) {
        console.error('Error pre-assigning withdrawal user:', error);
        assignedUserId = null;
      }
    }

    // Call your createTransaction function  
    const transactionStart = performance.now();
    const transactionResult = await createTransactionOptimized(transactionData);
    performanceMetrics.transactionCreation = performance.now() - transactionStart;
    
    if (!transactionResult) {
      log.error(`Transaction creation failed for order ${odrId}`, new Error('Transaction result is undefined'));
      return NextResponse.json({ success: false, message: 'Transaction result is undefined' }, { status: 500 });
    }
    if (!transactionResult.success) {
      log.error(`Transaction creation failed for order ${odrId}`, new Error(transactionResult.message || 'Unknown transaction error'));
      return NextResponse.json({ success: false, message: transactionResult.message }, { status: 500 });
    }
    if (!transactionResult.data) {
      log.error(`Transaction creation failed for order ${odrId}`, new Error('No transaction data returned'));
      return NextResponse.json({ success: false, message: 'No transaction data returned' }, { status: 500 });
    }

    const createdOrder = transactionResult.data;

    // Format the createdAt timestamp    
    const formattedTimestamp = formatTimestamp(createdOrder.$createdAt);

    // For withdraw orders, update the available balance of both accounts using updateAccount  
    if (data.odrType === 'withdraw') {
      try {
        const balanceUpdateStart = performance.now();
        
        // OPTIMIZATION: Move balance update to parallel with transaction creation
        // This is safe because we already verified sufficient balance above
        const [updateResult] = await Promise.all([
          // Balance update
          (async () => {
            return await updateAccountBalance(
              merchantAccount.publicTransactionId,
              Number(data.amount),
              false,                // Don't update current balance at this stage  
              true,                 // Update available balance  
              false                 // Not positive (subtract amount for withdraw)  
            );
          })(),
          
          // Add small delay to ensure transaction is fully committed
          new Promise(resolve => setTimeout(resolve, 10))
        ]);
        
        performanceMetrics.balanceUpdate = performance.now() - balanceUpdateStart;

        if (updateResult.success) {
          // Balance update successful - funds locked for withdrawal

          // OPTIMIZATION: Move non-critical operations to background processing
          // This improves response time by 200-500ms for withdrawal orders
          setImmediate(async () => {
            try {
              // Skip assignment if already done during creation
              if (!assignedUserId) {
                // Background task 1: Assign withdrawal to user (non-blocking) - fallback only
                await assignWithdrawalToUser(createdOrder.$id);
              }

              // Background task 2: Send notifications (non-blocking with queue)
              if (shouldSendNotification(merchantAccount.publicTransactionId) && 
                  (!createdOrder.merchantOrdId || !createdOrder.merchantOrdId.toLowerCase().includes('test'))) {
                
                // OPTIMIZATION: Use background notification queue instead of blocking calls
                // This eliminates 200-500ms of blocking notification processing
                try {
                  // Get withdrawal statistics for notification (keep this fast)
                  const withdrawalsInfo = await getProcessingWithdrawalsTotal();
                  const pendingCount = withdrawalsInfo.count;
                  const pendingTotal = await formatAmount(withdrawalsInfo.totalAmount);
                  const notiamount = await formatAmount(data.amount);
                  
                  // Queue the notification for background processing
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
                } catch (notificationError) {
                  // Don't let notification errors affect the main response - log silently
                  console.error('Error queuing notification for order:', createdOrder.odrId, notificationError);
                }
              }
            } catch (backgroundError) {
              // Background errors don't affect the main response - log silently
              console.error('Background processing error for order:', odrId, backgroundError);
            }
          });
        } else {
          // If we couldn't lock the funds, we should cancel the transaction  
          log.error(`Failed to lock funds for withdrawal ${odrId}`, new Error(updateResult.message || 'Balance update failed'));

          // Use the existing updateTransactionStatus function  
          await updateTransactionStatus(createdOrder.$id, 'canceled');

          return NextResponse.json({
            success: false,
            message: 'Failed to lock funds for withdrawal',
            data: null
          }, { status: 500 });
        }
      } catch (updateError) {
        log.error(`Error locking funds for withdrawal ${odrId}`, updateError instanceof Error ? updateError : new Error(String(updateError)));

        // Use the existing updateTransactionStatus function for this case too  
        await updateTransactionStatus(createdOrder.$id, 'canceled');

        return NextResponse.json({
          success: false,
          message: 'Error locking funds for withdrawal',
          data: null
        }, { status: 500 });
      }
    }

    // Calculate total performance metrics
    performanceMetrics.total = performance.now() - requestStartTime;
    
    // Create detailed performance log with complete timing breakdown
    log.info(`API Performance Metrics for ${createdOrder.odrId}`, {
      // Order essentials
      orderId: createdOrder.odrId,
      orderType: data.odrType,
      amount: createdOrder.amount,
      merchantId: merchantAccount.publicTransactionId,
      clientIp: clientIp,
      
      // Complete performance timing breakdown (ms)
      timing: {
        initialization: Math.round(performanceMetrics.initialization * 100) / 100,
        parallelOperations: Math.round(performanceMetrics.parallelOperations * 100) / 100,
        validation: Math.round(performanceMetrics.validation * 100) / 100,
        userLookup: data.odrType === 'withdraw' ? Math.round(performanceMetrics.userLookup * 100) / 100 : null,
        transaction: Math.round(performanceMetrics.transactionCreation * 100) / 100,
        balanceUpdate: data.odrType === 'withdraw' ? Math.round(performanceMetrics.balanceUpdate * 100) / 100 : null,
        total: Math.round(performanceMetrics.total * 100) / 100,
        // Calculate unaccounted time
        unaccounted: Math.round((performanceMetrics.total - (
          performanceMetrics.initialization + 
          performanceMetrics.parallelOperations + 
          performanceMetrics.validation + 
          performanceMetrics.userLookup + 
          performanceMetrics.transactionCreation + 
          performanceMetrics.balanceUpdate
        )) * 100) / 100
      },
      
      // Cache performance
      cacheStats: data.odrType === 'withdraw' ? {
        vietqr: cacheStats.hasCache ? 'HIT' : 'MISS',
        userCache: performanceMetrics.userLookup < 10 ? 'HIT' : 'MISS',
        userCacheSpeedup: performanceMetrics.userLookup < 10 ? 
          `~${Math.round(500 / performanceMetrics.userLookup)}x faster` : 
          'First request - building cache'
      } : { 
        vietqr: 'N/A',
        userCache: 'N/A' 
      },
      
      // Status flags
      flags: {
        suspicious: isSuspicious,
        assigned: data.odrType === 'withdraw' ? !!assignedUserId : null,
        assignedFromCache: data.odrType === 'withdraw' ? 
          (!!assignedUserId && performanceMetrics.userLookup < 10) : null,
        backgroundNotifications: data.odrType === 'withdraw'
      },
      
      // Summary
      success: true,
      timestamp: formattedTimestamp
    });

    // Return response based on order type  
    if (data.odrType === 'deposit') {
      // Generate payment URL for deposit using payment base URL (maps API domain to UI domain)
      const baseUrl = getPaymentBaseUrl(request);
      const paymentUrl = `${baseUrl}/payment/${createdOrder.odrId}`;

      return NextResponse.json({
        success: true,
        message: 'Deposit order created successfully',
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
      });
    } else {
      // Response for withdraw orders - note we're not including the QR code in the response  
      return NextResponse.json({
        success: true,
        message: 'Withdraw order created successfully',
        data: {
          odrId: createdOrder.odrId,
          odrStatus: createdOrder.odrStatus,
          bankReceiveCode: createdOrder.bankReceiveCode,
          bankReceiveNumber: createdOrder.bankReceiveNumber,
          bankReceiveOwnerName: createdOrder.bankReceiveOwnerName,
          //bankReceiveName: createdOrder.bankReceiveName,
          amount: createdOrder.amount,
          timestamp: formattedTimestamp,
          // qrCode is intentionally not included in the response for withdrawals  
        }
      });
    }

  } catch (error) {
    log.error("Error creating order transaction", error instanceof Error ? error : new Error(String(error)));
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}

// VietQR Cache is now imported from shared utility