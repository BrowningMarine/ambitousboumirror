import { NextRequest, NextResponse } from "next/server";
import { getLoggedInUser } from "@/lib/actions/user.actions";
import { DatabaseOptimizer } from "@/lib/database-optimizer";
import { DatabaseQueryOptimizer } from "@/lib/database-query-optimizer";
import { getBanksByUserId } from "@/lib/actions/bank.actions";
import { getAccountsByUserRole } from "@/lib/actions/account.actions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { Query } from "appwrite";
import fs from "fs";
import path from "path";

// Types for unified bank mapping (supports both TCB and ACB and other banks)
interface BankMapping {
  "TCB-batchBankCode": string;
  "TCB-batchBankName": string;
  "ACB-batchBankCode": string;
  "ACB-batchBankName": string;
}

interface BankListItem {
  bankCode: string;
  "TCB-batchBankCode": string;
  "TCB-batchBankName": string;
  "ACB-batchBankCode": string;
  "ACB-batchBankName": string;
}

interface TransactionDocument {
  odrId: string;
  unPaidAmount?: number;
  amount?: number;
  bankCode?: string;
  bankReceiveOwnerName?: string;
  bankReceiveNumber?: string;
  odrType: string;
  odrStatus: string;
  $createdAt: string;
  $id: string;
  account: string;
}

// Cache for bank mapping data
let bankMappingCache: Record<string, BankMapping> | null = null;
let bankMappingCacheTimestamp = 0;
const BANK_MAPPING_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Rate limiting cache
const rateLimitCache = new Map<string, { count: number; resetTime: number; bulkExportMode: boolean }>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // 10 requests per minute per user
const BULK_EXPORT_MAX_REQUESTS = 50; // 50 requests per minute for bulk exports

// Database constants
const ODRTRANS_COLLECTION_ID = appwriteConfig.odrtransCollectionId;

// Helper function to remove Vietnamese diacritics and convert to uppercase
function removeVietnameseDiacritics(str: string): string {
  if (!str) return '';
  
  // Log input for debugging
  //console.log(`Input name: "${str}" (length: ${str.length})`);
  
  // Use a more robust approach with normalization and regex replacement
  const result = str
    .normalize('NFD') // Decompose Unicode characters
    .replace(/[\u0300-\u036f]/g, '') // Remove all combining diacritical marks
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toUpperCase()
    .trim();

  //console.log(`Final result: "${result}"`);
  return result;
}

// Rate limiting function with bulk export support
function checkRateLimit(userId: string, isBulkExport: boolean = false): boolean {
  const now = Date.now();
  const userKey = `withdrawal_export_${userId}`;
  const userLimit = rateLimitCache.get(userKey);

  // Determine the appropriate limit based on operation type
  const maxRequests = isBulkExport ? BULK_EXPORT_MAX_REQUESTS : RATE_LIMIT_MAX_REQUESTS;

  if (!userLimit || now > userLimit.resetTime) {
    // Reset or create new limit
    rateLimitCache.set(userKey, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW,
      bulkExportMode: isBulkExport
    });
    return true;
  }

  // Check if switching between bulk and regular mode
  if (userLimit.bulkExportMode !== isBulkExport) {
    // Reset counter when switching modes
    rateLimitCache.set(userKey, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW,
      bulkExportMode: isBulkExport
    });
    return true;
  }

  if (userLimit.count >= maxRequests) {
    return false; // Rate limit exceeded
  }

  userLimit.count += 1;
  return true;
}

// Optimized function to get cached bank mapping data
async function getCachedBankMapping(): Promise<Record<string, BankMapping>> {
  const now = Date.now();
  
  // Check if cache is still valid
  if (bankMappingCache && (now - bankMappingCacheTimestamp) < BANK_MAPPING_CACHE_TTL) {
    return bankMappingCache;
  }

  // Load from file and cache
  try {
    const filePath = path.join(process.cwd(), 'lib', 'json', 'batchBankList.json');
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const bankList = JSON.parse(fileContent) as BankListItem[];
    
    // Convert to mapping for faster lookups (includes both TCB and ACB)
    const mapping: Record<string, BankMapping> = {};
    bankList.forEach((bank: BankListItem) => {
      if (bank.bankCode) {
        mapping[bank.bankCode] = {
          "TCB-batchBankCode": bank["TCB-batchBankCode"],
          "TCB-batchBankName": bank["TCB-batchBankName"],
          "ACB-batchBankCode": bank["ACB-batchBankCode"],
          "ACB-batchBankName": bank["ACB-batchBankName"]
        };
      }
    });

    bankMappingCache = mapping;
    bankMappingCacheTimestamp = now;
    

    return mapping;
  } catch (error) {
    console.error("Error loading bank mapping:", error);
    // Return empty mapping if file can't be loaded
    return {};
  }
}

// Optimized withdrawal transaction fetching
async function getOptimizedWithdrawalTransactions(
  userId: string,
  userRole: string,
  filters: Record<string, unknown>,
  offset: number = 0,
  limit: number = 100
) {
  // Use cached account data to avoid repeated queries
  const accounts = await DatabaseOptimizer.getCachedUserData(
    userId,
    'accounts_for_withdrawal',
    async () => await getAccountsByUserRole(userId, userRole)
  );

  const accountPublicTransactionId = (accounts as { documents: Array<{ publicTransactionId: string; $id: string }> }).documents.map(
    (account) => account.publicTransactionId
  );

  if (accountPublicTransactionId.length === 0) {
    return { documents: [], total: 0 };
  }

  // Build optimized query using indexed fields
  const queries: string[] = [];

  // Force withdrawal type and pending status (most selective filters first)
  queries.push(Query.equal("odrType", "withdraw"));
  queries.push(Query.equal("odrStatus", "pending"));
  queries.push(Query.equal("isSuspicious", false));

  // Add merchant account filter if needed
  if (userRole === 'merchant') {
    queries.push(Query.equal("account", accounts.documents[0].$id));
  }

  // Add date filters if provided
  if (filters.dateFrom && typeof filters.dateFrom === 'string') {
    const startDate = new Date(filters.dateFrom);
    startDate.setHours(0, 0, 0, 0);
    queries.push(Query.greaterThanEqual("$createdAt", startDate.toISOString()));
  }

  if (filters.dateTo && typeof filters.dateTo === 'string') {
    const endDate = new Date(filters.dateTo);
    endDate.setHours(23, 59, 59, 999);
    queries.push(Query.lessThanEqual("$createdAt", endDate.toISOString()));
  }

  // Add ordering and pagination
  queries.push(Query.orderDesc("$createdAt"));
  
  if (limit > 0) {
    queries.push(Query.limit(limit));
    queries.push(Query.offset(offset));
  }

  // Use optimized query execution with read replica and caching
  return await DatabaseQueryOptimizer.executeOptimizedQuery(
    ODRTRANS_COLLECTION_ID!,
    queries,
    {
      useCache: limit <= 100, // Cache smaller queries
      cacheTTL: 30 * 1000, // 30 seconds cache
      useReadReplica: true, // Use read replica to avoid blocking writes
      batchSize: limit
    }
  );
}

// Function to detect bank type from account number
interface BankDocument {
  bankId: string;
  bankName: string;
  accountNumber: string;
  ownerName: string;
  bankBinCode?: string;
}

function detectBankTypeFromAccount(selectedFromAccount: string, banks: BankDocument[]): 'TCB' | 'ACB' | 'UNKNOWN' {
  if (!selectedFromAccount || !banks) {
    return 'UNKNOWN';
  }
  
  // Find the bank that matches the selected account number
  const bank = banks.find((b: BankDocument) => b.accountNumber === selectedFromAccount);
  
  if (!bank) {
    return 'UNKNOWN';
  }
  
  // Get the bank code from the bank
  const bankCode = bank.bankBinCode;
  
  if (!bankCode) {
    return 'UNKNOWN';
  }
  
  // Check if it's Techcombank (970407) -> TCB format
  if (bankCode === '970407') {
    return 'TCB';
  }
  
  // Check if it's ACB (970416) -> ACB format
  if (bankCode === '970416') {
    return 'ACB';
  }
  
  // Default to TCB format for other banks
  return 'TCB';
}

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Verify user is authenticated
    const user = await getLoggedInUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const { filters, userRole, mode, offset, limit, selectedFromAccount } = await req.json();

    // Validate required fields
    if (!filters || !userRole || !mode) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Validate user role
    if (!["admin", "transactor", "merchant"].includes(userRole)) {
      return NextResponse.json({ error: "Invalid user role" }, { status: 403 });
    }

    // Detect bulk export operation (when offset is provided, it's part of a multi-file export)
    const isBulkExport = mode === "export" && typeof offset === "number" && offset >= 0;
    
    // Check rate limit with bulk export detection
    if (!checkRateLimit(user.$id, isBulkExport)) {
      const limitType = isBulkExport ? "bulk export" : "regular";
      const maxRequests = isBulkExport ? BULK_EXPORT_MAX_REQUESTS : RATE_LIMIT_MAX_REQUESTS;
      return NextResponse.json({ 
        error: `Rate limit exceeded for ${limitType} operations (${maxRequests} requests per minute). Please wait before making another request.` 
      }, { status: 429 });
    }



    if (mode === "count") {
      // Get count using optimized query with caching
      const cacheKey = `withdrawal_count_${user.$id}_${userRole}_${JSON.stringify(filters)}`;
      
      const count = await DatabaseOptimizer.getCachedStats(
        cacheKey,
        async () => {
          const result = await getOptimizedWithdrawalTransactions(
            user.$id,
            userRole,
            filters,
            0, // offset
            1   // small limit for count
          );
          return result.total || 0;
        },
        60 * 1000 // 1 minute cache for counts
      );



      return NextResponse.json({
        success: true,
        total: count
      });
    }

    if (mode === "export") {
      // Validate export-specific fields
      if (!selectedFromAccount) {
        return NextResponse.json({ error: "Missing export configuration" }, { status: 400 });
      }

      // Get cached bank mapping
      const bankMapping = await getCachedBankMapping();

      // Get user banks to detect bank type (same as transactor-banks API)
      const banks = await getBanksByUserId({ userId: user.$id });
      
      // Filter and map banks to match transactor-banks format
      let banksData: Array<{
        bankId: string;
        bankName: string;
        accountNumber: string;
        ownerName: string;
        bankBinCode?: string;
      }> = [];

      if (banks.documents && banks.documents.length > 0) {
        banksData = banks.documents
          .filter(bank => {
            const bankData = bank as unknown as Record<string, unknown>;
            return bankData.isDeposit === false && bankData.isActivated === true;
          })
          .map(bank => {
            const bankData = bank as unknown as Record<string, unknown>;
            return {
              bankId: bank.bankId || bank.$id || '',
              bankName: bank.bankName || 'Unknown Bank',
              accountNumber: bank.accountNumber || '',
              ownerName: bank.ownerName || 'Unknown Owner',
              bankBinCode: (bankData.bankBinCode as string) || '',
            };
          });
      }

      const bankType = detectBankTypeFromAccount(selectedFromAccount, banksData);

      // Get transactions with pagination for this batch using optimized query
      const batchSize = limit || 100;
      const batchOffset = offset || 0;

      const result = await getOptimizedWithdrawalTransactions(
        user.$id,
        userRole,
        filters,
        batchOffset,
        batchSize
      );

      if (!result || !result.documents || result.documents.length === 0) {
        return NextResponse.json({
          success: false,
          message: "No withdrawal transactions found"
        });
      }

      // Transform transactions to withdrawal batch format (supports both TCB and ACB)
      const withdrawalData = (result.documents as TransactionDocument[]).map((doc, index: number) => {
        const transaction = doc as TransactionDocument;
        
        // Generate sequence number for both formats
        const globalSequenceNumber = batchOffset + index + 1;
        
        // Get bank mapping for this transaction's bank code
        const bankCode = transaction.bankCode || '';
        const mapping = bankMapping[bankCode] || {
          "TCB-batchBankCode": bankCode,
          "TCB-batchBankName": "UNKNOWN BANK",
          "ACB-batchBankCode": bankCode,
          "ACB-batchBankName": "UNKNOWN BANK"
        };

        // Remove diacritics and convert beneficiary name to uppercase
        const beneficiaryName = removeVietnameseDiacritics(transaction.bankReceiveOwnerName || '');

        // Return different formats based on detected bank type
        if (bankType === 'ACB') {
          // ACB Vietnamese template format
          // Check if receiving bank is ACB (970416) to determine column placement
          const isReceivingBankACB = transaction.bankCode === '970416';
          
          return {
            "STT": globalSequenceNumber,
            "Tên đơn vị thụ hưởng": beneficiaryName,
            "Mã ngân hàng": mapping["ACB-batchBankCode"],
            "Số tài khoản nhận": isReceivingBankACB ? '' : (transaction.bankReceiveNumber || ''),
            "Số thẻ (ACB)": isReceivingBankACB ? (transaction.bankReceiveNumber || '') : '',
            "Số tiền": transaction.unPaidAmount || transaction.amount || 0,
            "Nội dung": transaction.odrId
          };
        } else {
          // TCB format (default)
          const referenceNumber = `${transaction.odrId.substring(0, 3)} ${globalSequenceNumber.toString().padStart(3, '0')}`;
          return {
            "Reference number": referenceNumber,
            "From Account": selectedFromAccount,
            "Amount": transaction.unPaidAmount || transaction.amount || 0,
            "Beneficiary name": beneficiaryName,
            "Beneficiary Account": transaction.bankReceiveNumber || '',
            "Description": transaction.odrId,
            "Beneficiary Bank code": mapping["TCB-batchBankCode"],
            "Beneficiary Bank name": mapping["TCB-batchBankName"]
          };
        }
      });

      const flattenedData = withdrawalData as Array<Record<string, unknown>>;

      // Log appropriate range based on format
      let logMessage, performanceData;
      if (bankType === 'ACB') {
        const stts = flattenedData.map((item) => item["STT"] as number);
        const firstSTT = stts[0];
        const lastSTT = stts[stts.length - 1];
        logMessage = `Exported ${flattenedData.length} ${bankType} withdrawal records (STT ${firstSTT} to ${lastSTT})`;
        performanceData = {
          duration: Date.now() - startTime,
          cached: true,
          bankType: bankType,
          sttRange: `${firstSTT} to ${lastSTT}`
        };
      } else {
        const referenceNumbers = flattenedData.map((item) => item["Reference number"] as string);
        const firstRef = referenceNumbers[0];
        const lastRef = referenceNumbers[referenceNumbers.length - 1];
        logMessage = `Exported ${flattenedData.length} ${bankType} withdrawal records (${firstRef} to ${lastRef})`;
        performanceData = {
          duration: Date.now() - startTime,
          cached: true,
          bankType: bankType,
          referenceRange: `${firstRef} to ${lastRef}`
        };
      }


      return NextResponse.json({
        success: true,
        data: {
          withdrawals: flattenedData
        },
        message: logMessage,
        performance: performanceData
      });
    }

    return NextResponse.json({ error: "Invalid mode" }, { status: 400 });

  } catch (error) {
    console.error("Error in optimized withdrawal export API route:", error);
    
    // Invalidate relevant caches on error
    DatabaseOptimizer.invalidateCache(`withdrawal_count_${req.url}`);
    
    return NextResponse.json(
      { error: "Internal server error during withdrawal export" },
      { status: 500 }
    );
  }
}

// Set longer timeout for exports
export const maxDuration = 300; 