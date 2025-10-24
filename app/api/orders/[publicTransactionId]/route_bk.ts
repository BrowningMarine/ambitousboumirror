import { NextRequest, NextResponse } from "next/server";
import { OrderTransaction } from "@/types";
import { formatAmount, generateUniqueString, verifyApiKeyAndAccount } from "@/lib/utils";
import { Query } from "appwrite";
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import axios from 'axios';
import { appConfig } from "@/lib/appconfig";
import { chkBanksControl, getBankById } from "@/lib/actions/bank.actions";
import { NotificationService } from "@/services/notification-service";
import { getProcessingWithdrawalsTotal } from "@/lib/actions/transaction.actions";
import { LRUCache } from 'lru-cache';

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
const BASE_PAYMENT_URL = appConfig.baseurl || 'http://localhost:3000';
const VIETQR_BANKS_URL = 'https://api.vietqr.io/v2/banks';

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

// Define bank-related types

// Define a type for VietQR bank response
interface VietQRBankResponse {
  code: string;
  desc: string;
  data: Array<{
    id: number;
    name: string;
    code: string;
    bin: string;
    shortName: string;
    logo: string;
    transferSupported: number;
    lookupSupported: number;
  }>;
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
        return { valid: false, message: "Invalid or inactive bank ID" };
      }
    } catch (error) {
      console.error("Error validating bank ID:", error);
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

    // Validate bankReceiveOwnerName format (only letters and spaces)
    const nameRegex = /^[A-Za-zÀ-ỹ\s]+$/;
    if (!nameRegex.test(data.bankReceiveOwnerName)) {
      return { valid: false, message: "bankReceiveOwnerName must contain only letters and spaces" };
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

      // Fetch bank list from VietQR API
      const response = await axios.get<VietQRBankResponse>(VIETQR_BANKS_URL);

      if (response.data && response.data.code === "00") {
        const banks = response.data.data;
        const validBank = banks.find(bank => bank.bin === data.bankCode);

        if (!validBank) {
          return { valid: false, message: "Invalid bankCode" };
        }

        // Return the bank's short name for storage
        return { valid: true, message: '', bankReceiveName: validBank.shortName };
      } else {
        // If we can't validate against the API, block!
        //console.warn("Could not validate bank code against Viet Nam bank list");
        return { valid: false, message: 'Could not validate bank code against Viet Nam bank list' };
      }
    } catch (error) {
      console.error("Error validating bank code:", error);
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
    console.error('Error getting order transactions:', error);
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
  try {
    // Get API key from Authorization header  
    const apiKey = request.headers.get('x-api-key');

    if (!apiKey) {
      return NextResponse.json(
        { success: false, message: 'API key is required' },
        { status: 401 }
      );
    }

    const { publicTransactionId } = await params;

    // Get order data from request body  
    const data = await request.json() as CreateOrderData;

    // Check if merchantOrdId already exists (if provided)
    if (data.merchantOrdId && data.merchantOrdId.trim() !== '') {
      try {
        // Get admin client
        const { database } = await createAdminClient();

        // Check if merchantOrdId already exists in the database
        const existingOrders = await database.listDocuments(
          DATABASE_ID!,
          ORDER_TRANS_COLLECTION_ID!,
          [
            Query.equal("merchantOrdId", [data.merchantOrdId]),
            Query.limit(1)
          ]
        );

        if (existingOrders.total > 0) {
          return NextResponse.json(
            { success: false, message: `Order with merchantOrdId '${data.merchantOrdId}' already exists` },
            { status: 400 }
          );
        }
      } catch (error) {
        console.error('Error checking for duplicate merchantOrdId:', error);
        // Continue with order creation even if check fails
      }
    }

    // Try to get the most reliable IP address
    // In Next.js, we can't directly access the socket IP, so we have to use a combination of approaches

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
      return NextResponse.json(
        {
          success: false,
          message: 'Valid public IP address is required. Contact your system administrator for assistance.',
        },
        { status: 403 }
      );
    }

    // Valid public IP address found - proceed with order creation
    // Verify API key and account  
    const merchantAccount = await verifyApiKeyAndAccount(apiKey, publicTransactionId);

    if (!merchantAccount) {
      return NextResponse.json(
        { success: false, message: 'Invalid API key or account' },
        { status: 401 }
      );
    }

    // Validate the request data with merchant account limits
    const validation = await validateCreateOrderFields(data, merchantAccount);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, message: validation.message },
        { status: 400 }
      );
    }

    // Store the bank receive name from validation for withdraw orders
    const bankReceiveName: string | undefined = validation.bankReceiveName;

    // For withdraw operations, check if merchantAccount has sufficient balance  
    if (data.odrType === 'withdraw' && merchantAccount.avaiableBalance < data.amount) {
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

    // Import the createTransaction function early to avoid waterfall requests
    const { createTransaction } = await import('@/lib/actions/transaction.actions');

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

    // Call your createTransaction function  
    const transactionResult = await createTransaction(transactionData);

    if (!transactionResult) {
      console.error('Transaction result is undefined');
      return NextResponse.json({ success: false, message: 'Transaction result is undefined' }, { status: 500 });
    }
    if (!transactionResult.success) {
      console.error('Transaction creation reported failure:', transactionResult.message);
      return NextResponse.json({ success: false, message: transactionResult.message }, { status: 500 });
    }
    if (!transactionResult.data) {
      console.error('Transaction success but no data returned');
      return NextResponse.json({ success: false, message: 'No transaction data returned' }, { status: 500 });
    }

    const createdOrder = transactionResult.data;

    // Format the createdAt timestamp    
    const formattedTimestamp = formatTimestamp(createdOrder.$createdAt);

    // For withdraw orders, update the available balance of both accounts using updateAccount  
    if (data.odrType === 'withdraw') {
      try {
        // Import the updateAccountBalance function  
        const { updateAccountBalance } = await import('@/lib/actions/account.actions');

        // Update merchant account - reduce available balance only  
        // Parameters: accountId, amount, isUpdateCurrentBalance, isUpdateAvaiableBalance, isPositive  
        const updateResult = await updateAccountBalance(
          merchantAccount.publicTransactionId,
          Number(data.amount),
          false,                // Don't update current balance at this stage  
          true,                 // Update available balance  
          false                 // Not positive (subtract amount for withdraw)  
        );

        if (updateResult.success) {
          // Check if previousBalance and newBalance exist before accessing them  
          if (updateResult.previousBalance && updateResult.newBalance) {
            console.log(`Locked funds for withdraw order ${odrId}:   
              Previous available: ${updateResult.previousBalance.available},   
              New available: ${updateResult.newBalance.available},  
              Current balance (unchanged): ${updateResult.previousBalance.current}`);
          } else {
            console.log(`Available balance updated (funds locked) for order ${odrId}`);
          }

          // Assign the withdrawal to a transassistant user with load balancing
          try {
            // Import the assignWithdrawalToUser function
            const { assignWithdrawalToUser } = await import('@/lib/actions/withdraw.actions');
            
            // Assign the withdrawal to a user
            const assignedUserId = await assignWithdrawalToUser(createdOrder.$id);
            
            // Log the assignment result
            if (assignedUserId) {
              console.log(`Withdrawal ${odrId} assigned to user ${assignedUserId} via load balancing`);
            } else {
              console.log(`No available users to handle withdrawal ${odrId}`);
            }
          } catch (assignError) {
            console.error('Error assigning withdrawal to user:', assignError);
            // Continue processing even if assignment fails
          }

          // Get the count and total amount of processing withdrawals  
          const withdrawalsInfo = await getProcessingWithdrawalsTotal();
          const pendingCount = withdrawalsInfo.count;
          const pendingTotal = await formatAmount(withdrawalsInfo.totalAmount);

          // Only send notification if rate limit allows (once per minute per merchant)
          // AND the order ID doesn't contain 'test'
          if (shouldSendNotification(merchantAccount.publicTransactionId) && 
              (!createdOrder.merchantOrdId || !createdOrder.merchantOrdId.toLowerCase().includes('test'))) {
            const notiamount = await formatAmount(data.amount);
            await NotificationService.sendToMerchantAndRoles(
              'YÊU CẦU RÚT TIỀN',
              `Vừa có yều cầu rút ${notiamount} VND . Đang kẹt ${pendingCount} đơn (Tổng ${pendingTotal} VND). Hãy đăng nhập và giải quyết nhanh nhất có thể!`,
              merchantAccount.publicTransactionId,  // The merchant account ID  
              ['admin', 'transactor'],  // Roles to notify  
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
            console.log(`Notification sent for withdrawal order ${createdOrder.odrId}`);
          } else {
            const skipReason = !shouldSendNotification(merchantAccount.publicTransactionId) 
              ? "rate limited" 
              : "test order";
            console.log(`Notification skipped for withdrawal order ${createdOrder.odrId} (${skipReason})`);
          }
        } else {
          // If we couldn't lock the funds, we should cancel the transaction  
          console.error(`Failed to lock funds for withdrawal: ${updateResult.message || 'Unknown error'}`);

          // Use the existing updateTransactionStatus function  
          const { updateTransactionStatus } = await import('@/lib/actions/transaction.actions');
          await updateTransactionStatus(createdOrder.$id, 'canceled');

          return NextResponse.json({
            success: false,
            message: 'Failed to lock funds for withdrawal',
            data: null
          }, { status: 500 });
        }
      } catch (updateError) {
        console.error('Error locking funds for withdrawal:', updateError);

        // Use the existing updateTransactionStatus function for this case too  
        const { updateTransactionStatus } = await import('@/lib/actions/transaction.actions');
        await updateTransactionStatus(createdOrder.$id, 'canceled');

        return NextResponse.json({
          success: false,
          message: 'Error locking funds for withdrawal',
          data: null
        }, { status: 500 });
      }
    }

    // Return response based on order type  
    if (data.odrType === 'deposit') {
      // Generate payment URL for deposit  
      const paymentUrl = `${BASE_PAYMENT_URL}/payment/${createdOrder.odrId}`;

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
    console.error('Error creating order transaction:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}