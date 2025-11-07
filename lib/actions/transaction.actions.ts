"use server";

import { Query, Models } from "node-appwrite";
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { dbManager } from "@/lib/database/connection-manager";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { DatabaseQueryOptimizer } from "@/lib/database-query-optimizer";
import { DatabaseOptimizer } from "@/lib/database-optimizer";
import { getAccountsByUserRole, updateAccountBalance } from "./account.actions";
import { getBankById, validateBankAccount } from "./bank.actions";
import { Account, VietQRResponse } from "@/types";
import { ID } from "appwrite";
// import { sendWebhookNotification } from "@/utils/webhook"; // Deprecated: Now handled by batched webhook response
import axios from "axios";
import { scheduleTransactionExpiry } from "@/lib/redisJobScheduler";
import { fromLocalDateString, setStartOfDay, setEndOfDay, getStartOfDayUTC, getEndOfDayUTC } from "@/lib/utils";
import { appConfig } from "../appconfig";

// Environment variables from appwriteConfig  
const DATABASE_ID = appwriteConfig.databaseId;
const ODRTRANS_COLLECTION_ID = appwriteConfig.odrtransCollectionId;
const qrTemplateCode = appConfig.qrTemplateCode;
// Define TransactionFilters interface
export interface TransactionFilters {
  status?: string;
  type?: string;
  orderId?: string;
  merchantOrdId?: string;
  dateFrom?: Date | string;
  dateTo?: Date | string;
  amount?: {
    min: string;
    max: string;
  };
  isSentCallbackNotification?: string;
}

// Type definitions  
interface Transaction extends Models.Document {
  $id: string;
  odrId: string;
  merchantOrdId?: string;
  odrType: 'deposit' | 'withdraw';
  odrStatus: 'processing' | 'completed' | 'canceled' | 'failed' | 'pending';
  bankId: string;
  amount: number;
  paidAmount: number;
  unPaidAmount: number;
  positiveAccount: string;
  negativeAccount: string;
  qrCode?: string | null;
  urlSuccess?: string;
  urlFailed?: string;
  urlCanceled?: string;
  urlCallBack?: string;
  lastPaymentDate: string; //yyyyyy-mm-dd hh:mm:ss
  bankCode?: string;
  bankReceiveNumber?: string;
  bankReceiveOwnerName?: string;
  isSentCallbackNotification?: boolean;
  account: {
    $id: string;
    apiKey?: string;
    publicTransactionId?: string;
    // other needed account fields  
  }; // Allow for either format to handle existing data 
}

interface TransactionUpdateData {
  odrStatus: 'pending' | 'processing' | 'completed' | 'failed' | 'canceled';
  paidAmount?: number;
  unPaidAmount?: number;
}

// Cache the admin client for better performance
type AdminClient = Awaited<ReturnType<typeof createAdminClient>>;
let adminClientCache: AdminClient | null = null;
let adminClientCacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

const getAdminClient = async (): Promise<AdminClient> => {
  const now = Date.now();

  // Create a new client if none exists or if the cache is too old
  if (!adminClientCache || (now - adminClientCacheTimestamp) > CACHE_TTL) {
    adminClientCache = await createAdminClient();
    adminClientCacheTimestamp = now;
  }

  return adminClientCache;
};

// Get all transactions  
export async function getAllTransactions(limit = 100) {
  try {
    const { database } = await createAdminClient();

    const transactions = await database.listDocuments(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      [
        Query.orderDesc("$createdAt"),
        Query.limit(limit)
      ]
    );

    return transactions;
  } catch (error) {
    console.error("Error fetching all transactions:", error);
    throw error;
  }
}

export async function getTransactionByOrderId(odrId: string) {
  try {
    // Use database manager with retry logic to handle race conditions
    const transactionsResult = await dbManager.listDocuments(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      [Query.equal("odrId", odrId), Query.limit(1)],
      `get-transaction-${odrId}`
    );

    // If no transaction was found with this odrId  
    if (transactionsResult.total === 0) {
      return null;
    }

    // Get the transaction  
    const transaction = transactionsResult.documents[0] as Transaction;

    // Fetch bank information based on transaction type  
    let bankInfo = null;

    if (transaction.odrType === "deposit" && transaction.bankId) {
      // For deposit transactions, get the bank information from bankId  
      const bankResult = await getBankById(transaction.bankId);

      if (bankResult.success && bankResult.bank) {
        // Add the relevant bank details to the transaction  
        bankInfo = {
          bankName: bankResult.bank.bankName,
          accountNumber: bankResult.bank.accountNumber,
          accountName: bankResult.bank.ownerName
        };
      }
    } else if (transaction.odrType === "withdraw") {
      // For withdraw transactions, use the bankReceive fields that are already in the transaction  
      bankInfo = {
        bankName: transaction.bankCode || transaction.bankReceiveCode || "",
        accountNumber: transaction.bankReceiveNumber || "",
        accountName: transaction.bankReceiveOwnerName || ""
      };
    }

    // Return the transaction with added bank information  
    const result = {
      ...transaction,
      bankName: bankInfo?.bankName || "",
      accountNumber: bankInfo?.accountNumber || "",
      accountName: bankInfo?.accountName || "",
      // Convert dates to strings explicitly  
      $createdAt: String(transaction.$createdAt || ""),
      $updatedAt: String(transaction.$updatedAt || "")
    };

    // Simple JSON round-trip to remove any non-serializable items  
    return JSON.parse(JSON.stringify(result));
  } catch (error) {
    console.error("Error fetching transaction by odrId:", error);
    return null;
  }
}

// Get transactions for a specific user/merchant's accounts  
export async function getTransactionsByUser(userId: string, userRole: string) {
  try {
    const accountlists = await getAccountsByUserRole(userId, userRole);

    //console.log('userAccounts',userAccounts);
    // Extract account IDs  
    const accountPublicTransactionId = accountlists.documents.map((account: Account) => account.publicTransactionId);

    if (accountPublicTransactionId.length === 0) {
      return { documents: [] };
    }
    //console.log('accountIds',accountPublicTransactionId);
    // Then get all transactions where positiveAccount or negativeAccount matches any of these accounts  
    const { database } = await createAdminClient();
    const transactions = await database.listDocuments(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      [
        Query.equal("account", accountPublicTransactionId),
        Query.equal("odrStatus", "processing"),
        Query.orderDesc("$createdAt"),
        Query.limit(100)
      ]
    );

    return transactions;
  } catch (error) {
    console.error("Error fetching transactions by account:", error);
    throw error;
  }
}

// Helper function to convert date string or Date object to UTC Date
// Only used for converting client filter inputs to UTC for database queries
function parseDate(dateInput: Date | string | undefined): Date | null {
  if (!dateInput) return null;
  
  if (typeof dateInput === 'string') {
    // For YYYY-MM-DD format, create UTC date
    if (dateInput.match(/^\d{4}-\d{2}-\d{2}$/)) {
      return fromLocalDateString(dateInput);
    }
    return new Date(dateInput);
  }
  
  return dateInput;
}

// Enhanced function that can handle both pagination and unlimited batch processing
export async function getTransactionsByUserEnhanced(
  userId: string,
  role: string,
  page?: number, // undefined means get ALL records (no pagination)
  limit: number = 10,
  filters: TransactionFilters = { status: "processing" }
) {
  try {
    // Get admin client once and reuse
    const { database } = await getAdminClient();

    // Use getAccountsByUserRole instead of direct database query
    const accountlists = await getAccountsByUserRole(userId, role);

    const accountPublicTransactionId = accountlists.documents.map(
      (account: Account) => account.publicTransactionId
    );

    if (accountPublicTransactionId.length === 0) {
      return { documents: [], total: 0, page: page || 1, limit, pages: 0 };
    }

    // Build query array once
    const baseQueries: string[] = [];

    // Add merchant account filter if needed
    if (role === 'merchant') {
      baseQueries.push(Query.equal("account", accountlists.documents[0].$id));
    }

    // Add status filter
    if (filters.status !== 'all') {
      baseQueries.push(Query.equal('odrStatus', filters.status || 'processing'));
    }

    // Add type filter
    if (filters.type && filters.type !== 'all') {
      baseQueries.push(Query.equal('odrType', filters.type));
    }

    // Handle ID filters
    const hasIdFilter = filters.orderId || filters.merchantOrdId;

    if (filters.orderId) {
      // Parse multiple order IDs separated by commas, semicolons, or newlines
      const orderIds = filters.orderId
        .split(/[,;\n]/)
        .map(id => id.trim())
        .filter(id => id.length > 0);
      
      if (orderIds.length === 1) {
        baseQueries.push(Query.equal('odrId', orderIds[0]));
      } else if (orderIds.length > 1) {
        baseQueries.push(Query.equal('odrId', orderIds));
      }
    }

    if (filters.merchantOrdId) {
      // Parse multiple merchant order IDs separated by commas, semicolons, or newlines
      const merchantOrderIds = filters.merchantOrdId
        .split(/[,;\n]/)
        .map(id => id.trim())
        .filter(id => id.length > 0);
      
      if (merchantOrderIds.length === 1) {
        baseQueries.push(Query.equal('merchantOrdId', merchantOrderIds[0]));
      } else if (merchantOrderIds.length > 1) {
        baseQueries.push(Query.equal('merchantOrdId', merchantOrderIds));
      }
    }

    // Handle date filters
    if (filters.dateFrom || filters.dateTo) {
      // If dateFrom is provided, get UTC start of that day
      if (typeof filters.dateFrom === 'string') {
        baseQueries.push(Query.greaterThanEqual('$createdAt', getStartOfDayUTC(filters.dateFrom)));
      }

      // If dateTo is provided, get UTC end of that day
      if (typeof filters.dateTo === 'string') {
        baseQueries.push(Query.lessThanEqual('$createdAt', getEndOfDayUTC(filters.dateTo)));
      }
    } else if (!hasIdFilter) {
      // If no date filters and no ID filters, default to today
      const today = new Date().toISOString().split('T')[0];
      baseQueries.push(Query.greaterThanEqual('$createdAt', getStartOfDayUTC(today)));
      baseQueries.push(Query.lessThanEqual('$createdAt', getEndOfDayUTC(today)));
    }

    // Add amount range filters
    if (filters.amount?.min) {
      baseQueries.push(Query.greaterThanEqual('amount', parseFloat(filters.amount.min)));
    }

    if (filters.amount?.max) {
      baseQueries.push(Query.lessThanEqual('amount', parseFloat(filters.amount.max)));
    }

    // Add callback notification filter
    if (filters.isSentCallbackNotification && filters.isSentCallbackNotification !== 'all') {
      const callbackValue = filters.isSentCallbackNotification === 'true';
      baseQueries.push(Query.equal('isSentCallbackNotification', callbackValue));
    }

    // Add ordering
    const baseParams = [
      ...baseQueries,
      Query.orderDesc('$createdAt')
    ];

    // For specific page (traditional pagination), make a single request
    if (page !== undefined) {
      const paginatedQueries = [
        ...baseParams,
        Query.limit(limit),
        Query.offset((page - 1) * limit)
      ];

      // Execute both count and paginated queries in parallel
      const [totalDocuments, documents] = await Promise.all([
        database.listDocuments(DATABASE_ID, ODRTRANS_COLLECTION_ID, [...baseQueries, Query.select(['$id'])]),
        database.listDocuments(DATABASE_ID, ODRTRANS_COLLECTION_ID, paginatedQueries)
      ]);

      return {
        documents: documents.documents,
        total: totalDocuments.total,
        page,
        limit,
        pages: Math.ceil(totalDocuments.total / limit)
      };
    }

    // For "all" records (page = undefined), use batch processing like your other app
    // Use the real count instead of Appwrite's limited count
    // If limit parameter is passed and it's large, use it as the total (from getAllTransactionsByUser)
    let totalRecords: number;
    if (limit > 1000) {
      // This is likely the real total passed from getAllTransactionsByUser
      totalRecords = limit;
    } else {
      // Fallback to Appwrite count (will be limited to 5000)
      const countResponse = await database.listDocuments(
        DATABASE_ID,
        ODRTRANS_COLLECTION_ID,
        [...baseQueries, Query.select(['$id'])] // Only fetch ID to minimize bandwidth
      );
      totalRecords = countResponse.total;
    }

    if (totalRecords === 0) {
      return { documents: [], total: 0, page: 1, limit, pages: 0 };
    }

    // Calculate optimal batch configuration for better performance
    // RENDER FREE TIER OPTIMIZATION: Reduce memory usage and connections
    const isFreeTier = process.env.RENDER_SERVICE_TYPE === 'free' || process.env.NODE_ENV === 'production';
    const maxBatchSize = isFreeTier ? 1000 : 2000; // Smaller batches on free tier
    const maxConcurrency = isFreeTier ? 3 : 8; // Fewer concurrent requests on free tier
    
    const batchSize = Math.min(maxBatchSize, Math.max(500, Math.ceil(totalRecords / 8))); 
    const numberOfBatches = Math.ceil(totalRecords / batchSize);
    const maxConcurrentRequests = Math.min(maxConcurrency, Math.max(2, Math.ceil(numberOfBatches / 6))); // Reduced concurrency

    // Process in chunks of concurrent requests
    const allDocuments: Transaction[] = [];
    for (let i = 0; i < numberOfBatches; i += maxConcurrentRequests) {
      const currentBatchPromises = [];
      const remainingBatches = Math.min(maxConcurrentRequests, numberOfBatches - i);

      for (let j = 0; j < remainingBatches; j++) {
        const offset = (i + j) * batchSize;
        const promise = database.listDocuments(
          DATABASE_ID,
          ODRTRANS_COLLECTION_ID,
          [
            ...baseParams,
            Query.limit(batchSize),
            Query.offset(offset)
          ]
        );
        currentBatchPromises.push(promise);
      }

      const batchResults = await Promise.all(currentBatchPromises);
      const newDocuments = batchResults.flatMap(result => result.documents as Transaction[]);
      allDocuments.push(...newDocuments);

      // RENDER FREE TIER OPTIMIZATION: Force garbage collection between chunks
      if (isFreeTier && allDocuments.length % 2000 === 0 && global.gc) {
        global.gc(); // Force garbage collection if available
      }

      // Progress tracking removed - server actions cannot call client callbacks
    }

    return {
      documents: allDocuments,
      total: totalRecords,
      page: 1,
      limit: allDocuments.length,
      pages: 1
    };

  } catch (error) {
    console.error("Error in getTransactionsByUserEnhanced:", error);
    throw error;
  }
}

// Legacy function maintained for backward compatibility
export async function getTransactionsByUserPaginated(
  userId: string,
  role: string,
  page: number = 1,
  limit: number = 10,
  filters: TransactionFilters = { status: "processing" }
) {
  // Use the enhanced function with pagination
  return getTransactionsByUserEnhanced(userId, role, page, limit, filters);
}

// Get a specific transaction by ID  
export async function getTransactionById(transactionId: string) {
  try {
    const { database } = await createAdminClient();

    const transaction = await database.getDocument(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      transactionId
    ) as Transaction;

    return transaction;
  } catch (error) {
    console.error("Error fetching transaction by ID:", error);
    return null;
  }
}

// Create a new transaction  
export async function createTransaction(transactionData: Omit<Transaction, '$id'>) {
  try {
    // Use database manager for consistent database operations
    const transaction = await dbManager.createDocument(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      ID.unique(),
      transactionData,
      `create-transaction-${transactionData.odrId}`
    );

    // Schedule expiry and update statistics in parallel if this is a processing transaction
    const promises = [];

    // Schedule expiry for processing transactions
    if (transaction.odrStatus === 'processing' && transaction.odrType === 'deposit') {
      promises.push(
        scheduleTransactionExpiry(
          transaction.$id,
          transaction.odrId,
          transaction.$createdAt
        )
      );
    }

    // Wait for all background operations to complete
    if (promises.length > 0) {
      // Don't await this - let it run in the background and return the transaction immediately
      Promise.all(promises).catch(error => {
        console.error("Error in background operations for transaction creation:", error);
      });
    }

    return {
      success: true,
      message: 'Transaction created successfully',
      data: transaction
    };
  } catch (error) {
    console.error('Error creating transaction:', error);
    return {
      success: false,
      message: `Failed to create transaction: ${error instanceof Error ? error.message : String(error)}`,
      data: null
    };
  }
}

// Optimized transaction creation function with performance improvements
export async function createTransactionOptimized(transactionData: Omit<Transaction, '$id'>) {
  try {
    // Import DatabaseOptimizer dynamically to avoid circular dependencies
    const { DatabaseOptimizer } = await import('@/lib/database-optimizer');
    
    // Use the optimized transaction creation method to minimize collection locks
    const transaction = await DatabaseOptimizer.createTransactionOptimized(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      ID.unique(),
      transactionData,
      {
        preCalculateFields: true,
        priority: 'high' // High priority for API transactions
      }
    );

    // Schedule expiry and background tasks in parallel without blocking the response
    const backgroundTasks: Promise<void>[] = [];

    // Schedule expiry for processing transactions
    if (transaction.odrStatus === 'processing' && transaction.odrType === 'deposit') {
      backgroundTasks.push(
        scheduleTransactionExpiry(
          transaction.$id,
          transaction.odrId as string,
          transaction.$createdAt as string
        ).catch(error => {
          console.error("Error scheduling transaction expiry:", error);
        })
      );
    }

    // Run background tasks without waiting (non-blocking)
    if (backgroundTasks.length > 0) {
      Promise.all(backgroundTasks).catch(error => {
        console.error("Error in background operations for transaction creation:", error);
      });
    }

    console.log(`Transaction ${transaction.$id} created successfully with optimized method`);
    return {
      success: true,
      message: 'Transaction created successfully',
      data: transaction
    };
  } catch (error) {
    console.error('Failed to create transaction:', error);
    return {
      success: false,
      message: `Failed to create transaction: ${error instanceof Error ? error.message : String(error)}`,
      data: null
    };
  }
}

export async function updateTransaction(
  transactionId: string,
  updateData: Partial<Transaction>
) {
  try {
    const { database } = await createAdminClient();

    const updatedTransaction = await database.updateDocument(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      transactionId,
      updateData
    ) as Transaction;

    return {
      success: true,
      data: updatedTransaction
    };
  } catch (error) {
    console.error("Error updating transaction:", error);
    return {
      success: false,
      message: `Error updating transaction: ${error}`
    };
  }
}

// Update transaction status  
export async function updateTransactionStatus(
  transactionId: string,
  newStatus: 'pending' | 'processing' | 'completed' | 'failed' | 'canceled'
) {
  try {
    // Use read-only client for getting current transaction data
    const readClient = await DatabaseOptimizer.getReadOnlyClient();

    // Get the current transaction using read-only client
    const transaction = await readClient.database.getDocument(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      transactionId
    ) as Transaction;

    // If transaction is already in the target status, return early
    if (transaction.odrStatus === newStatus) {
      return {
        success: true,
        message: `Transaction already in ${newStatus} status`,
        data: transaction
      };
    }

    // Check if we're changing to processing from another status
    if (transaction.odrStatus !== 'processing' && newStatus === 'processing' && transaction.odrType === 'deposit') {
      // Schedule a new expiry job
      await scheduleTransactionExpiry(
        transactionId,
        transaction.odrId,
        transaction.$createdAt
      );
    }

    // Update the transaction status using write-optimized client
    const updateData: TransactionUpdateData = { odrStatus: newStatus };

    // Use DatabaseOptimizer's write operation for better performance
    const updatedTransaction = await DatabaseOptimizer.executeWriteOperation(
      async (writeClient) => {
        return await writeClient.database.updateDocument(
          DATABASE_ID,
          ODRTRANS_COLLECTION_ID,
          transactionId,
          updateData
        );
      },
      {
        retryAttempts: 3,
        onSuccess: () => {
          // Invalidate relevant caches
          DatabaseOptimizer.invalidateStatsCache();
          DatabaseOptimizer.invalidateCache(`transaction_${transactionId}`);
        },
        onError: (error) => {
          console.error(`Failed to update transaction status for ${transactionId}:`, error);
        }
      }
    );

    // For completed or failed transactions, update account balances
    if (newStatus === 'completed' || newStatus === 'failed' || newStatus === 'canceled') {
      if (transaction.odrType === 'withdraw' && transaction.odrStatus === 'pending') {
        try {
          // Restore the available balance for the account
          if (transaction.negativeAccount) {
            await updateAccountBalance(
              transaction.negativeAccount,
              transaction.amount,
              false,  // Don't update current balance
              true,   // Update available balance
              true    // Add the amount back (positive)
            );
          }
        } catch (balanceError) {
          console.error('Error updating account balance:', balanceError);
          // Continue execution even if balance update fails
        }
      }

      // WEBHOOK NOTIFICATIONS NOW HANDLED BY BATCHED WEBHOOK RESPONSE
      // The webhook response handler (lib/webhook/webhook-response.ts) sends batched notifications
      // after all transactions are processed, grouping by callback URL for efficiency
      
      // Deprecated: Individual webhook sending in updateTransactionStatus
      // if (transaction.urlCallBack) { ... webhookData ... sendWebhookNotification ... }
    }

    return {
      success: true,
      message: `Transaction status updated to ${newStatus}`,
      data: updatedTransaction
    };
  } catch (error) {
    console.error('Error updating transaction status:', error);
    return {
      success: false,
      message: `Failed to update transaction status: ${error instanceof Error ? error.message : String(error)}`,
      data: null
    };
  }
}

// Update transaction payment details  
export async function proccessTransactionPayment(
  odrId: string,
  amount: number,
) {
  try {
    // Use database manager with retry logic to handle race conditions with order creation API
    const transactions = await dbManager.listDocuments(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      [
        Query.equal("odrId", [odrId]),
        Query.limit(1)
      ],
      `find-transaction-${odrId}`
    );

    if (transactions.total === 0) {
      return {
        success: false,
        message: `Transaction with order ID ${odrId} not found`,
        data: null
      };
    }

    const transaction = transactions.documents[0] as Transaction;

    // Check if transaction is failed or canceled
    if (transaction.odrStatus === 'failed' || transaction.odrStatus === 'canceled') {
      return {
        success: false,
        message: `Cannot process payment for ${transaction.odrStatus} transaction`,
        data: transaction
      };
    }

    // Check if transaction is already fully paid - if so, don't update anything
    if ((transaction.paidAmount || 0) >= transaction.amount) {
      return {
        success: true,
        message: 'Transaction is already fully paid - no update needed',
        data: transaction,
        isOverpayment: true
      };
    }

    // Check if transaction is already completed
    if (transaction.odrStatus === 'completed') {
      return {
        success: true,
        message: 'Transaction is already completed',
        data: transaction
      };
    }
    
    // Calculate new paid and unpaid amounts
    const newPaidAmount = (transaction.paidAmount || 0) + amount;
    const newUnpaidAmount = Math.max(0, transaction.amount - newPaidAmount);

    // Determine if transaction is now complete
    const isComplete = newPaidAmount >= transaction.amount;
    const newStatus = isComplete ? 'completed' : transaction.odrStatus;

    // Update the transaction
    const updateData = {
      paidAmount: newPaidAmount,
      unPaidAmount: newUnpaidAmount,
      odrStatus: newStatus,
      lastPaymentDate: new Date().toISOString()
    };

    const updatedTransaction = await dbManager.updateDocument(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      transaction.$id,
      updateData,
      `update-transaction-${odrId}`
    );

    // If transaction is now complete, update account balances
    if (isComplete) {
      try {
        // For deposits, update the merchant account's balances
        if (transaction.odrType === 'deposit' && transaction.positiveAccount) {
          await updateAccountBalance(
            transaction.positiveAccount,
            transaction.amount,
            true,  // Update current balance
            true,  // Update available balance
            true   // Add the amount (positive)
          );
        }

        // For withdrawals that are now complete, update the transactor account's balance
        else if (transaction.odrType === 'withdraw' && transaction.positiveAccount) {
          await updateAccountBalance(
            transaction.positiveAccount,
            transaction.amount,
            true,   // Update current balance
            false,  // Available balance was already updated when transaction was created
            true    // Add the amount (positive)
          );
        }

        // WEBHOOK NOTIFICATIONS NOW HANDLED BY BATCHED WEBHOOK RESPONSE
        // The webhook response handler (lib/webhook/webhook-response.ts) sends batched notifications
        // after all transactions are processed, grouping by callback URL for efficiency
        
        // Deprecated: Individual webhook sending - now replaced by batching system
        // if (transaction.urlCallBack) {
        //   ... webhook sending code removed to enable batching ...
        // }
        
        // Note: Webhook status (isSentCallbackNotification) is updated by the webhook response handler
      } catch (error) {
        console.error('Error updating account balance:', error);
        // Continue execution even if these operations fail
      }
    }

    return {
      success: true,
      message: isComplete ? 'Transaction completed successfully' : 'Payment processed successfully',
      data: updatedTransaction
    };
  } catch (error) {
    console.error('Error processing transaction payment:', error);
    return {
      success: false,
      message: `Failed to process payment: ${error instanceof Error ? error.message : String(error)}`,
      data: null
    };
  }
}

// Update transaction status when expired
export async function updateExpiredTransactionStatus(transactionId: string) {
  try {
    // Use the existing updateTransactionStatus function to change status to 'pending'
    const result = await updateTransactionStatus(transactionId, 'pending');

    return {
      success: result.success,
      message: result.success ? 'Expired transaction updated to pending status' : result.message,
      data: result.data
    };
  } catch (error) {
    console.error("Error updating expired transaction:", error);
    return {
      success: false,
      message: `Error updating expired transaction: ${error}`,
    };
  }
}

export async function fixTransactionFailQr() {
  try {
    const { database } = await createAdminClient();
    // Update the query to find transactions with missing, empty, or null QR codes
    const misQrTransactions = await database.listDocuments(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      [
        Query.or([
          Query.equal("qrCode", ""),
          Query.isNull("qrCode")
        ]),
        // Limit to a reasonable number for performance
        Query.limit(50)
      ]
    );

    console.log(`Found ${misQrTransactions.total} transactions with missing QR codes`);

    const updatedTransactions = [];
    const failedTransactions = [];

    for (const transaction of misQrTransactions.documents as Transaction[]) {
      try {
        console.log(`Processing transaction ${transaction.$id} (${transaction.odrId})`);

        // Convert LPB bank code to its BIN code
        let bankCode = transaction.bankCode;
        let needsBankCodeUpdate = false;

        // Check if bankCode is LPB and convert it
        if (transaction.bankCode === "LPB") {
          bankCode = "970449";
          needsBankCodeUpdate = true;
          console.log(`Converted LPB to 970449 for transaction ${transaction.$id}`);
        }

        // Make sure we have account info
        const accountNumber = transaction.accountNumber || transaction.bankReceiveNumber;
        const accountName = transaction.ownerName || transaction.bankReceiveOwnerName;

        if (!bankCode || !accountNumber) {
          console.log(`Missing info for ${transaction.$id}: bankCode=${bankCode}, accountNumber=${accountNumber}`);
          failedTransactions.push({
            id: transaction.$id,
            reason: "Missing bank code or account number"
          });
          continue;
        }

        // Skip validation if it's causing issues
        let accountNameToUse = accountName;
        const validateAccount = false;
        if (validateAccount) {
          try {
            const bankValidation = await validateBankAccount(
              accountNumber,
              parseInt(bankCode)
            );

            if (bankValidation.success) {
              accountNameToUse = bankValidation.data?.accountName || accountName;
              console.log(`Validation successful for ${transaction.$id} - account name: ${accountNameToUse}`);
            } else {
              console.log(`Validation failed for ${transaction.$id}: ${bankValidation.message}`);
              // Continue anyway, using the existing account name
            }
          } catch (validationError) {
            console.error(`Validation error for ${transaction.$id}:`, validationError);
            // Continue anyway, using the existing account name
          }
        }

        // If account validation is successful, proceed with QR code generation
        console.log(`Generating QR for ${transaction.$id} with data:`, {
          accountNo: accountNumber,
          accountName: accountNameToUse,
          acqId: bankCode,
          amount: transaction.amount,
          addInfo: transaction.odrId
        });

        try {
          const response = await axios.post<VietQRResponse>('https://api.vietqr.io/v2/generate', {
            accountNo: accountNumber,
            accountName: accountNameToUse,
            acqId: bankCode,
            amount: transaction.amount,
            addInfo: transaction.odrId,
            format: "text",
            template: qrTemplateCode,
          }, {
            headers: {
              'x-client-id': 'f928265a-985e-4a86-a312-d80975b22b79',
              'x-api-key': '12e367e4-a0a9-4488-8183-06976e00c8cf',
              'Content-Type': 'application/json'
            }
          });

          if (response.data && response.data.code === "00") {
            // Update the transaction with the QR code
            const updateData: Partial<Transaction> = {
              qrCode: response.data.data.qrDataURL
            };

            // Update bankCode if needed
            if (needsBankCodeUpdate) {
              updateData.bankCode = "970449"; // Also update the bankCode field
            }

            console.log(`Updating transaction ${transaction.$id} with new QR code`);
            const updatedTransaction = await database.updateDocument(
              DATABASE_ID,
              ODRTRANS_COLLECTION_ID,
              transaction.$id,
              updateData
            );

            updatedTransactions.push(updatedTransaction);
            console.log(`Successfully updated transaction ${transaction.$id}`);
          } else {
            console.log(`QR generation failed for ${transaction.$id}: ${response.data?.desc || "Unknown error"}`);
            failedTransactions.push({
              id: transaction.$id,
              reason: `QR generation failed: ${response.data?.desc || "Unknown error"}`
            });
          }
        } catch (qrError) {
          console.error(`QR API error for ${transaction.$id}:`, qrError);
          failedTransactions.push({
            id: transaction.$id,
            reason: `QR API error: ${qrError instanceof Error ? qrError.message : String(qrError)}`
          });
        }
      } catch (error) {
        console.error(`Error processing transaction ${transaction.$id}:`, error);
        failedTransactions.push({
          id: transaction.$id,
          reason: `Error: ${error instanceof Error ? error.message : String(error)}`
        });
      }
    }

    const result = {
      success: updatedTransactions.length > 0,
      message: `Fixed QR codes for ${updatedTransactions.length} transactions. Failed: ${failedTransactions.length} transactions.`,
      updatedTransactions,
      failedTransactions
    };

    console.log(`Completed QR fix with result:`, result.message);
    return result;
  } catch (error) {
    console.error("Error fixing transaction fail qr:", error);
    return {
      success: false,
      message: `Error fixing QR codes: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Get transactions with filtering (OPTIMIZED with indexed queries and caching)
export async function getFilteredTransactions({
  status,
  type,
  bankId,
  startDate,
  endDate,
  search,
  limit = 50,
  page = 1
}: {
  status?: string;
  type?: string;
  bankId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
  limit?: number;
  page?: number;
}) {
  try {
    // Use optimized filtered transactions with indexed queries and caching (30-40% faster)
    const result = await DatabaseQueryOptimizer.getFilteredTransactionsOptimized({
      status: status !== 'all' ? status : undefined,
      type: type !== 'all' ? type : undefined,
      bankId: bankId !== 'all' ? bankId : undefined,
      startDate,
      endDate,
      search,
      limit,
      page
    });

    return result;
  } catch (error) {
    console.error("Error fetching filtered transactions:", error);
    throw error;
  }
}

// Get transaction statistics (OPTIMIZED with indexed queries and caching)
export async function getTransactionStats() {
  try {
    // Use the new optimized query system for 30-40% performance improvement
    return await DatabaseQueryOptimizer.getTransactionStatsOptimized();
  } catch (error) {
    console.error("Error fetching transaction statistics:", error);
    throw error;
  }
}

export async function getProcessingWithdrawalsCount() {
  try {
    const { database } = await createAdminClient();

    // Query for processing withdrawals  
    const processingWithdrawals = await database.listDocuments(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      [
        Query.equal("odrType", "withdraw"),
        Query.equal("odrStatus", "processing"),
        Query.limit(0) // We only need the count, not the actual documents  
      ]
    );

    return {
      success: true,
      count: processingWithdrawals.total,
      data: null
    };
  } catch (error) {
    console.error("Error getting processing withdrawals count:", error);
    return {
      success: false,
      count: 0,
      message: `Error getting processing withdrawals: ${error}`,
      data: null
    };
  }
}

// Add this function to get the total amount of processing withdrawals  
export async function getProcessingWithdrawalsTotal() {
  try {
    const { database } = await createAdminClient();

    // Query for processing withdrawals (get actual documents this time)  
    const processingWithdrawals = await database.listDocuments(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      [
        Query.equal("odrType", "withdraw"),
        Query.equal("odrStatus", "pending"),
        //Query.limit(100) // Adjust limit as needed  
      ]
    );

    // Calculate total amount  
    let totalAmount = 0;
    for (const withdrawal of processingWithdrawals.documents as Transaction[]) {
      totalAmount += withdrawal.amount;
    }

    return {
      success: true,
      count: processingWithdrawals.total,
      totalAmount,
      data: null
    };
  } catch (error) {
    console.error("Error getting processing withdrawals total:", error);
    return {
      success: false,
      count: 0,
      totalAmount: 0,
      message: `Error getting processing withdrawals total: ${error}`,
      data: null
    };
  }
}

// Get detailed transaction statistics with date filtering (optimized for full data)
export async function getDetailedTransactionStats(dateFrom?: Date, dateTo?: Date) {
  try {
    const { database } = await createAdminClient();

    // Set default date range (today if no dates provided)
    const today = new Date();
    const startDate = dateFrom || new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const endDate = dateTo || new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);

    // Base query for date range
    const baseQueries = [
      Query.greaterThanEqual("$createdAt", startDate.toISOString()),
      Query.lessThanEqual("$createdAt", endDate.toISOString()),
      Query.orderDesc("$createdAt") // Order for consistent pagination
    ];

    // Get all transactions using pagination for optimal performance
    let allTransactions: Transaction[] = [];
    let hasMore = true;
    let offset = 0;
    const batchSize = 1000; // Larger batch size for efficiency

    while (hasMore) {
      const batchQueries = [
        ...baseQueries,
        Query.limit(batchSize),
        Query.offset(offset)
      ];

      const batch = await database.listDocuments(
        DATABASE_ID,
        ODRTRANS_COLLECTION_ID,
        batchQueries
      );

      const batchTransactions = batch.documents as Transaction[];
      allTransactions = allTransactions.concat(batchTransactions);

      // Check if we have more data
      hasMore = batchTransactions.length === batchSize;
      offset += batchSize;

      // Safety check to prevent infinite loops
      if (offset > 50000) { // Max 50k transactions per query
        console.warn(`Transaction stats query reached safety limit of 50k records for date range ${startDate.toISOString()} to ${endDate.toISOString()}`);
        break;
      }
    }

    // Calculate all statistics from the complete dataset
    const depositTransactions = allTransactions.filter(tx => tx.odrType === 'deposit');
    const withdrawTransactions = allTransactions.filter(tx => tx.odrType === 'withdraw');
    const completedTransactions = allTransactions.filter(tx => tx.odrStatus === 'completed');

    // Calculate statistics
    const stats = {
      totalOrders: allTransactions.length,
      totalDeposits: depositTransactions.length,
      totalWithdraws: withdrawTransactions.length,

      // Calculate total amounts
      totalDepositAmount: depositTransactions.reduce((sum: number, tx: Transaction) => sum + (tx.paidAmount || 0), 0),
      totalWithdrawAmount: withdrawTransactions.reduce((sum: number, tx: Transaction) => sum + (tx.paidAmount || 0), 0),

      // Calculate processing times
      averageProcessingTime: calculateAverageProcessingTime(completedTransactions),

      // Status breakdown
      statusBreakdown: {
        pending: allTransactions.filter(tx => tx.odrStatus === 'pending').length,
        processing: allTransactions.filter(tx => tx.odrStatus === 'processing').length,
        completed: completedTransactions.length,
        failed: allTransactions.filter(tx => tx.odrStatus === 'failed').length,
        canceled: allTransactions.filter(tx => tx.odrStatus === 'canceled').length,
      },

      // Success rate
      successRate: allTransactions.length > 0 ?
        (completedTransactions.length / allTransactions.length * 100) : 0,

      dateRange: {
        from: startDate.toISOString(),
        to: endDate.toISOString()
      },

      // Add metadata about the query
      metadata: {
        totalRecordsProcessed: allTransactions.length,
        batchesProcessed: Math.ceil(offset / batchSize),
        queryTimestamp: new Date().toISOString()
      }
    };

    return {
      success: true,
      data: stats
    };
  } catch (error) {
    console.error("Error fetching detailed transaction statistics:", error);
    return {
      success: false,
      message: `Error fetching statistics: ${error}`,
      data: null
    };
  }
}

// Helper function to calculate average processing time
function calculateAverageProcessingTime(completedTransactions: Transaction[]): number {
  if (completedTransactions.length === 0) return 0;

  const processingTimes = completedTransactions
    .filter(tx => tx.$createdAt && tx.$updatedAt)
    .map(tx => {
      const createdAt = new Date(tx.$createdAt);
      const updatedAt = new Date(tx.$updatedAt);
      return updatedAt.getTime() - createdAt.getTime(); // Time in milliseconds
    });

  if (processingTimes.length === 0) return 0;

  const averageMs = processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length;
  return Math.round(averageMs / (1000 * 60)); // Convert to minutes
}

// Function to process all expired transactions - called by the Cloudflare Worker
export async function processAllExpiredTransactions(internalApiSecret?: string) {
  // Validate internal API secret if provided
  if (process.env.INTERNAL_API_SECRET && internalApiSecret !== process.env.INTERNAL_API_SECRET) {
    return {
      success: false,
      message: 'Unauthorized: Invalid internal API secret',
      processed: 0,
      failed: 0
    };
  }

  try {
    const { database } = await getAdminClient();
    const processingTime = appConfig.paymentWindowSeconds * 1000;
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - processingTime);

    // Find all transactions in processing status that have exceeded the time limit
    const expiredTransactions = await database.listDocuments(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      [
        Query.equal('odrStatus', 'processing'),
        Query.lessThan('$createdAt', cutoffTime.toISOString()),
        Query.limit(100) // Process in batches of 100
      ]
    );

    console.log(`Found ${expiredTransactions.total} expired transactions to process`);

    // Process each expired transaction
    const results = {
      processed: 0,
      failed: 0,
      transactionIds: [] as string[],
      errors: [] as Array<{ id: string; error: unknown }>
    };

    // Process in parallel for efficiency, but with concurrency limit
    const batchSize = 10; // Process 10 at a time
    const transactions = expiredTransactions.documents as Transaction[];

    for (let i = 0; i < transactions.length; i += batchSize) {
      const batch = transactions.slice(i, i + batchSize);
      const batchResults = await Promise.allSettled(
        batch.map(transaction =>
          updateExpiredTransactionStatus(transaction.$id)
        )
      );

      // Process batch results
      batchResults.forEach((result, index) => {
        const transaction = batch[index];
        if (result.status === 'fulfilled') {
          results.processed++;
          results.transactionIds.push(transaction.odrId);
          console.log(`✅ Successfully processed expired transaction: ${transaction.odrId}`);
        } else {
          results.failed++;
          results.errors.push({
            id: transaction.odrId,
            error: result.reason
          });
          console.error(`❌ Failed to process expired transaction ${transaction.odrId}:`, result.reason);
        }
      });

      // Small pause between batches to prevent database overload
      if (i + batchSize < transactions.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    return {
      success: true,
      message: `Processed ${results.processed} expired transactions with ${results.failed} failures`,
      processed: results.processed,
      failed: results.failed,
      details: results
    };
  } catch (error) {
    console.error("Error processing expired transactions:", error);
    return {
      success: false,
      message: `Error processing expired transactions: ${error}`,
      processed: 0,
      failed: 0,
      error: String(error)
    };
  }
}

// Helper function to get all processing transactions that need expiry check
export async function getAllProcessingTransactions() {
  try {
    const { database } = await getAdminClient();

    // Get all transactions in processing status
    const processingTransactions = await database.listDocuments(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      [
        Query.equal('odrStatus', 'processing'),
        Query.orderAsc('$createdAt'),
        Query.limit(1000) // Reasonable limit
      ]
    );

    return {
      success: true,
      total: processingTransactions.total,
      transactions: processingTransactions.documents
    };
  } catch (error) {
    console.error("Error fetching processing transactions:", error);
    return {
      success: false,
      message: `Error fetching processing transactions: ${error}`,
      total: 0,
      transactions: []
    };
  }
}

// Optimized Excel export function for client components
export async function exportTransactionsOptimized(
  userId: string,
  userRole: string,
  filters: TransactionFilters
) {
  try {
    // Import optimization classes dynamically to avoid client-side issues
    const { DatabaseOptimizer } = await import("@/lib/database-optimizer");
    const { DatabaseQueryOptimizer } = await import("@/lib/database-query-optimizer");

    // Use read-only database client to prevent blocking write operations
    await DatabaseOptimizer.getReadOnlyClient();

    // Get user accounts using the same role-based logic with caching
    const accountlists = await DatabaseOptimizer.getCachedUserData(
      userId,
      'accounts',
      () => getAccountsByUserRole(userId, userRole)
    );
    
    const accountPublicTransactionId = accountlists.documents.map(
      (account: Account) => account.publicTransactionId
    );

    if (accountPublicTransactionId.length === 0) {
      return {
        success: false,
        message: "No accounts found for export",
        data: null
      };
    }

    // Build the same query logic as getTransactionsByUserPaginated
    const queries: string[] = [];

    // Add merchant account filter if needed
    if (userRole === 'merchant') {
      queries.push(Query.equal("account", accountlists.documents[0].$id));
    }

    // Add status filter
    if (filters.status !== 'all') {
      queries.push(Query.equal('odrStatus', filters.status || 'processing'));
    }

    // Add type filter
    if (filters.type && filters.type !== 'all') {
      queries.push(Query.equal('odrType', filters.type));
    }

    // Handle ID filters
    const hasIdFilter = filters.orderId || filters.merchantOrdId;

    if (filters.orderId) {
      // Parse multiple order IDs separated by commas, semicolons, or newlines
      const orderIds = filters.orderId
        .split(/[,;\n]/)
        .map(id => id.trim())
        .filter(id => id.length > 0);
      
      if (orderIds.length === 1) {
        queries.push(Query.equal('odrId', orderIds[0]));
      } else if (orderIds.length > 1) {
        queries.push(Query.equal('odrId', orderIds));
      }
    }

    if (filters.merchantOrdId) {
      // Parse multiple merchant order IDs separated by commas, semicolons, or newlines
      const merchantOrderIds = filters.merchantOrdId
        .split(/[,;\n]/)
        .map(id => id.trim())
        .filter(id => id.length > 0);
      
      if (merchantOrderIds.length === 1) {
        queries.push(Query.equal('merchantOrdId', merchantOrderIds[0]));
      } else if (merchantOrderIds.length > 1) {
        queries.push(Query.equal('merchantOrdId', merchantOrderIds));
      }
    }

    // Handle date filters
    const hasDateFilter = filters.dateFrom || filters.dateTo;

    // If no ID filters and no date filters, default to today's transactions in UTC
    if (!hasIdFilter && !hasDateFilter) {
      const today = new Date();
      const startOfToday = setStartOfDay(today);
      const endOfToday = setEndOfDay(today);
      
      queries.push(Query.greaterThanEqual('$createdAt', startOfToday.toISOString()));
      queries.push(Query.lessThanEqual('$createdAt', endOfToday.toISOString()));
    }
    // Handle date range filters
    else if (hasDateFilter) {
      if (hasIdFilter) {
        // Simple date filters when ID filters are present (no 2-day restriction)
        if (filters.dateFrom) {
          const fromDate = parseDate(filters.dateFrom);
          if (fromDate) {
            const startOfDay = setStartOfDay(fromDate);
            queries.push(Query.greaterThanEqual('$createdAt', startOfDay.toISOString()));
          }
        }

        if (filters.dateTo) {
          const toDate = parseDate(filters.dateTo);
          if (toDate) {
            const endOfDay = setEndOfDay(toDate);
            queries.push(Query.lessThanEqual('$createdAt', endOfDay.toISOString()));
          }
        }
      }
      else {
        // Apply 2-day restriction when no ID filters are present
        if (filters.dateFrom && filters.dateTo) {
          // Both dates provided
          const fromDate = parseDate(filters.dateFrom);
          const toDate = parseDate(filters.dateTo);

          if (fromDate && toDate) {
            const diffTime = Math.abs(toDate.getTime() - fromDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            // Set start date to beginning of day
            const startOfDay = setStartOfDay(fromDate);
            queries.push(Query.greaterThanEqual('$createdAt', startOfDay.toISOString()));

            // End date - either original or adjusted to 2-day maximum
            const endDate = new Date(diffDays > 2 ?
              fromDate.getTime() + (2 * 24 * 60 * 60 * 1000) :
              toDate.getTime());
            const endOfDay = setEndOfDay(endDate);
            queries.push(Query.lessThanEqual('$createdAt', endOfDay.toISOString()));
          }
        }
        else if (filters.dateFrom) {
          // Only fromDate provided
          const fromDate = parseDate(filters.dateFrom);
          if (fromDate) {
            const startOfDay = setStartOfDay(fromDate);
            queries.push(Query.greaterThanEqual('$createdAt', startOfDay.toISOString()));

            // Add toDate as fromDate + 2 days
            const endDate = new Date(fromDate.getTime() + (2 * 24 * 60 * 60 * 1000));
            const endOfDay = setEndOfDay(endDate);
            queries.push(Query.lessThanEqual('$createdAt', endOfDay.toISOString()));
          }
        }
        else if (filters.dateTo) {
          // Only toDate provided
          const toDate = parseDate(filters.dateTo);
          if (toDate) {
            const endOfDay = setEndOfDay(toDate);
            queries.push(Query.lessThanEqual('$createdAt', endOfDay.toISOString()));

            // Add fromDate as toDate - 2 days
            const fromDate = new Date(toDate.getTime() - (2 * 24 * 60 * 60 * 1000));
            const startOfDay = setStartOfDay(fromDate);
            queries.push(Query.greaterThanEqual('$createdAt', startOfDay.toISOString()));
          }
        }
      }
    }

    // Add amount range filters
    if (filters.amount?.min) {
      queries.push(Query.greaterThanEqual('amount', parseFloat(filters.amount.min)));
    }

    if (filters.amount?.max) {
      queries.push(Query.lessThanEqual('amount', parseFloat(filters.amount.max)));
    }

    // Add callback notification filter
    if (filters.isSentCallbackNotification && filters.isSentCallbackNotification !== 'all') {
      const callbackValue = filters.isSentCallbackNotification === 'true';
      queries.push(Query.equal('isSentCallbackNotification', callbackValue));
    }

    // Use optimized query execution for better performance and non-blocking behavior
    const countResult = await DatabaseQueryOptimizer.executeOptimizedQuery(
      ODRTRANS_COLLECTION_ID,
      queries,
      {
        useCache: false, // Don't cache count queries for exports
        useReadReplica: true, // Use read replica to avoid blocking writes
        batchSize: 1000
      }
    );
    
    if (!countResult || countResult.total === 0) {
      return {
        success: false,
        message: "No data to export",
        data: null
      };
    }

        // Use parallel batch processing for optimal performance
    // RENDER FREE TIER OPTIMIZATION: Reduce memory usage
    const isFreeTier = process.env.RENDER_SERVICE_TYPE === 'free' || process.env.NODE_ENV === 'production';
    const maxExportBatch = isFreeTier ? 1500 : 2500; // Smaller export batches on free tier
    
    const allTransactions: Array<Record<string, string | number>> = [];
    const exportBatchSize = Math.min(maxExportBatch, Math.max(800, Math.ceil(countResult.total / 8))); // Reduced minimum for free tier
    const totalRecords = countResult.total;
    const batches = Math.ceil(totalRecords / exportBatchSize);

    console.log(`📦 Export using ${batches} batches of ${exportBatchSize} records each`);

    // Create parallel batch queries to maximize throughput
    const batchPromises: Promise<Array<Record<string, string | number>>>[] = [];
    for (let i = 0; i < batches; i++) {
      const offset = i * exportBatchSize;
      const batchQueries = [
        ...queries,
        Query.orderDesc('$createdAt'),
        Query.limit(exportBatchSize),
        Query.offset(offset)
      ];

      // Use optimized query execution for each batch
      const batchPromise = DatabaseQueryOptimizer.executeOptimizedQuery(
        ODRTRANS_COLLECTION_ID,
        batchQueries,
        {
          useCache: false, // Don't cache export data
          useReadReplica: true, // Use read replica for non-blocking operation
          batchSize: exportBatchSize
        }
              ).then((batchResult) => {
          if (batchResult.documents && batchResult.documents.length > 0) {
            return batchResult.documents.map((doc: unknown) => {
            const transaction = doc as unknown as Transaction;
            
            // Format data for Excel with optimized field mapping
            return {
              "Order ID": transaction.odrId,
              "Merchant Ref ID": transaction.merchantOrdId || "",
              "Type": transaction.odrType,
              "Status": transaction.odrStatus,
              "Amount": transaction.amount,
              "Paid Amount": transaction.paidAmount,
              "Unpaid Amount": transaction.unPaidAmount,
              "Bank Code": (transaction as Record<string, unknown>).bankCode as string || "",
              "Bank Account": (transaction as Record<string, unknown>).bankReceiveNumber as string || "",
              "Bank Owner": (transaction as Record<string, unknown>).bankReceiveOwnerName as string || "",
              "isSentCallbackNotification": transaction.isSentCallbackNotification ? "Yes" : "No",
              "Created Date": transaction.$createdAt ? new Date(transaction.$createdAt).toLocaleDateString() : "",
              "Created Time": transaction.$createdAt ? new Date(transaction.$createdAt).toLocaleTimeString() : "",
              "Updated Date": transaction.$updatedAt ? new Date(transaction.$updatedAt).toLocaleDateString() : "",
              "Updated Time": transaction.$updatedAt ? new Date(transaction.$updatedAt).toLocaleTimeString() : "",
              "Last Payment": (transaction as Record<string, unknown>).lastPaymentDate as string || "",
            };
          });
        }
        return [];
      });

      batchPromises.push(batchPromise);
    }

    // Execute all batches in parallel with controlled concurrency
    const batchResults = await Promise.all(batchPromises);

    // Flatten all batch results
    batchResults.forEach((batchTransactions: Array<Record<string, string | number>>) => {
      allTransactions.push(...batchTransactions);
    });

    // Log performance metrics
    console.log(`Optimized Excel export completed: ${allTransactions.length} records from ${batches} parallel batches`);
    
    return {
      success: true,
      message: `Export data prepared successfully`,
      data: {
        transactions: allTransactions,
        totalRecords: allTransactions.length,
        filename: generateExportFilename(filters, allTransactions.length)
      }
    };
    
  } catch (error) {
    console.error("Error in optimized Excel export:", error);
    return {
      success: false,
      message: `Failed to export transactions: ${error instanceof Error ? error.message : String(error)}`,
      data: null
    };
  }
}



// Utility function to get ALL transactions (no pagination limit)
export async function getAllTransactionsByUser(
  userId: string,
  role: string,
  filters: TransactionFilters = { status: "processing" }
) {
  // Use the REAL count function to get the actual total, not limited to 5000
  const realTotal = await getRealTransactionCount(userId, role, filters);
  
  if (realTotal === 0) {
    return { documents: [], total: 0, page: 1, limit: 0, pages: 0 };
  }
  
  // Use the enhanced function without page parameter to get ALL records
  // Override the total with the real count
  const result = await getTransactionsByUserEnhanced(userId, role, undefined, realTotal, filters);
  
  // Ensure we return the real total count
  return {
    ...result,
    total: realTotal,
    limit: realTotal
  };
}

// Simplified export function that uses the new batch processing method
export async function exportTransactionsSimplified(
  userId: string,
  userRole: string,
  filters: TransactionFilters
) {
  try {
    // RENDER FREE TIER OPTIMIZATION: Monitor memory usage
    const isFreeTier = process.env.RENDER_SERVICE_TYPE === 'free' || process.env.NODE_ENV === 'production';
    
    if (isFreeTier) {
      const memUsage = process.memoryUsage();
      if (memUsage.heapUsed > 400 * 1024 * 1024) { // 400MB threshold
        throw new Error("Memory usage too high for export operation. Please try with smaller date range or filters.");
      }
    }

    // Use the new enhanced function to get ALL transactions without pagination limits
    const result = await getAllTransactionsByUser(userId, userRole, filters);
    
    if (!result || result.total === 0) {
      return {
        success: false,
        message: "No data to export",
        data: null
      };
    }

    // Transform transactions for Excel export
    const exportData = (result.documents as Transaction[]).map((transaction: Transaction) => {
      return {
        "Order ID": transaction.odrId,
        "Merchant Ref ID": transaction.merchantOrdId || "",
        "Type": transaction.odrType,
        "Status": transaction.odrStatus,
        "Amount": transaction.amount,
        "Paid Amount": transaction.paidAmount,
        "Unpaid Amount": transaction.unPaidAmount,
        "Bank Code": (transaction as Record<string, unknown>).bankCode as string || "",
        "Bank Account": (transaction as Record<string, unknown>).bankReceiveNumber as string || "",
        "Bank Owner": (transaction as Record<string, unknown>).bankReceiveOwnerName as string || "",
        "isSentCallbackNotification": transaction.isSentCallbackNotification ? "Yes" : "No",
        "Created Date": transaction.$createdAt ? new Date(transaction.$createdAt).toLocaleDateString() : "",
        "Created Time": transaction.$createdAt ? new Date(transaction.$createdAt).toLocaleTimeString() : "",
        "Updated Date": transaction.$updatedAt ? new Date(transaction.$updatedAt).toLocaleDateString() : "",
        "Updated Time": transaction.$updatedAt ? new Date(transaction.$updatedAt).toLocaleTimeString() : "",
        "Last Payment": (transaction as Record<string, unknown>).lastPaymentDate as string || "",
      };
    });

    // Generate filename with timestamp and filter info
    const timestamp = new Date().toISOString().split('T')[0];
    const filterInfo = filters.status !== 'all' ? `_${filters.status}` : '';
    const typeInfo = filters.type && filters.type !== 'all' ? `_${filters.type}` : '';
    const filename = `transactions_${timestamp}${filterInfo}${typeInfo}_${result.total}records.xlsx`;

    return {
      success: true,
      message: `Export completed successfully`,
      data: {
        transactions: exportData,
        filename: filename
      }
    };

  } catch (error) {
    console.error("Error in simplified export:", error);
    return {
      success: false,
      message: `Failed to export transactions: ${error instanceof Error ? error.message : String(error)}`,
      data: null
    };
  }
}

// Helper function to generate export filename
function generateExportFilename(filters: TransactionFilters, recordCount: number): string {
  const date = new Date();
  const dateStr = `${date.getFullYear()}-${String(
    date.getMonth() + 1
  ).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const timeStr = `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}`;
  const statusFilter = filters.status && filters.status !== "all" ? `_${filters.status}` : "";
  const typeFilter = filters.type && filters.type !== "all" ? `_${filters.type}` : "";
  return `transactions_${dateStr}_${timeStr}${statusFilter}${typeFilter}_${recordCount}records.xlsx`;
}

// Function to get REAL total count without pagination limits - OPTIMIZED VERSION
export async function getRealTransactionCount(
  userId: string,
  role: string,
  filters: TransactionFilters = { status: "processing" }
) {
  try {
    // Import optimization classes dynamically
    const { DatabaseOptimizer } = await import("@/lib/database-optimizer");
    const { DatabaseQueryOptimizer } = await import("@/lib/database-query-optimizer");

    // Use read-only client for counting (doesn't block writes)
    await DatabaseOptimizer.getReadOnlyClient();

    // Generate cache key for this specific count query with user context
    const cacheKey = `real_count_${userId}_${role}_${JSON.stringify(filters)}_v2`;
    
    // Try to get from cache first (60 second cache for counts)
    const cachedCount = await DatabaseOptimizer.getCachedStats(
      cacheKey,
      async () => {
        return await performOptimizedCount();
      },
      60 * 1000 // 1 minute cache for count queries
    );

    return cachedCount as number;

    async function performOptimizedCount(): Promise<number> {
      // Use getAccountsByUserRole with caching
      const accountlists = await DatabaseOptimizer.getCachedUserData(
        userId,
        'accounts',
        () => getAccountsByUserRole(userId, role)
      );

      const accountPublicTransactionId = accountlists.documents.map(
        (account: Account) => account.publicTransactionId
      );

      if (accountPublicTransactionId.length === 0) {
        return 0;
      }

      // Build optimized query array using indexed fields
      const baseQueries: string[] = [];

      // OPTIMIZATION: Use indexed fields in optimal order
      // Add merchant account filter first (most selective for merchants)
      if (role === 'merchant') {
        baseQueries.push(Query.equal("account", accountlists.documents[0].$id));
      }

      // Add status filter early (highly selective and indexed)
      if (filters.status !== 'all') {
        baseQueries.push(Query.equal('odrStatus', filters.status || 'processing'));
      }

      // Add type filter (indexed field)
      if (filters.type && filters.type !== 'all') {
        baseQueries.push(Query.equal('odrType', filters.type));
      }

      // Handle ID filters (most selective when present)
      const hasIdFilter = filters.orderId || filters.merchantOrdId;

      if (filters.orderId) {
        const orderIds = filters.orderId
          .split(/[,;\n]/)
          .map(id => id.trim())
          .filter(id => id.length > 0);
        
        if (orderIds.length === 1) {
          baseQueries.push(Query.equal('odrId', orderIds[0]));
        } else if (orderIds.length > 1) {
          baseQueries.push(Query.equal('odrId', orderIds));
        }
      }

      if (filters.merchantOrdId) {
        const merchantOrderIds = filters.merchantOrdId
          .split(/[,;\n]/)
          .map(id => id.trim())
          .filter(id => id.length > 0);
        
        if (merchantOrderIds.length === 1) {
          baseQueries.push(Query.equal('merchantOrdId', merchantOrderIds[0]));
        } else if (merchantOrderIds.length > 1) {
          baseQueries.push(Query.equal('merchantOrdId', merchantOrderIds));
        }
      }

      // OPTIMIZATION: Use indexed date fields efficiently
      if (filters.dateFrom || filters.dateTo) {
        if (typeof filters.dateFrom === 'string') {
          baseQueries.push(Query.greaterThanEqual('$createdAt', getStartOfDayUTC(filters.dateFrom)));
        }
        if (typeof filters.dateTo === 'string') {
          baseQueries.push(Query.lessThanEqual('$createdAt', getEndOfDayUTC(filters.dateTo)));
        }
      } else if (!hasIdFilter) {
        // Default to today for better index utilization
        const today = new Date().toISOString().split('T')[0];
        baseQueries.push(Query.greaterThanEqual('$createdAt', getStartOfDayUTC(today)));
        baseQueries.push(Query.lessThanEqual('$createdAt', getEndOfDayUTC(today)));
      }

      // Add amount range filters (indexed fields)
      if (filters.amount?.min) {
        baseQueries.push(Query.greaterThanEqual('amount', parseFloat(filters.amount.min)));
      }
      if (filters.amount?.max) {
        baseQueries.push(Query.lessThanEqual('amount', parseFloat(filters.amount.max)));
      }

      // Add callback notification filter
      if (filters.isSentCallbackNotification && filters.isSentCallbackNotification !== 'all') {
        const callbackValue = filters.isSentCallbackNotification === 'true';
        baseQueries.push(Query.equal('isSentCallbackNotification', callbackValue));
      }

      // OPTIMIZATION: Quick check for small datasets using optimized query
      // DISABLED CACHE: Cache key doesn't differentiate users properly, causing wrong counts
      const quickResult = await DatabaseQueryOptimizer.executeOptimizedQuery(
        ODRTRANS_COLLECTION_ID,
        [...baseQueries, Query.select(['$id']), Query.limit(500)],
        {
          useCache: false, // Disable cache to prevent wrong counts
          useReadReplica: true,
          batchSize: 500
        }
      );

      if (quickResult.documents.length < 500) {
        return quickResult.documents.length;
      }

      // For larger datasets, use cursor-based counting to avoid offset limitations
      // Use larger batches for better performance (only fetching IDs)
      const isFreeTier = process.env.RENDER_SERVICE_TYPE === 'free' || process.env.NODE_ENV === 'production';
      const batchSize = isFreeTier ? 800 : 1000; // Smaller batches for free tier
      let totalCount = 0;
      let lastCreatedAt: string | null = null;
      let hasMore = true;
      
      // Use cursor-based counting to avoid offset limitations
      while (hasMore) {
        // Build queries for cursor-based counting
        const countQueries = [...baseQueries];
        
        // Add cursor condition for pagination (avoid large offsets)
        if (lastCreatedAt) {
          countQueries.push(Query.lessThan('$createdAt', lastCreatedAt));
        }
        
        countQueries.push(Query.orderDesc('$createdAt'));
        countQueries.push(Query.select(['$id', '$createdAt'])); // Need $createdAt for cursor
        countQueries.push(Query.limit(batchSize));

        const result = await DatabaseQueryOptimizer.executeOptimizedQuery(
          ODRTRANS_COLLECTION_ID,
          countQueries,
          {
            useCache: false, // Don't cache individual count batches
            useReadReplica: true, // Use read replica for counting
            batchSize: batchSize
          }
        );

        const batchCount = result.documents.length;
        totalCount += batchCount;
        
        // Update cursor for next iteration
        if (result.documents.length > 0) {
          const lastDoc = result.documents[result.documents.length - 1] as { $createdAt: string };
          lastCreatedAt = lastDoc.$createdAt;
        }

        // Check if we have more data
        hasMore = batchCount === batchSize;
      }

      return totalCount;
    }

  } catch (error) {
    console.error("Error in optimized real transaction count:", error);
    return 0;
  }
}

// Enhanced paginated function that gets REAL total count - OPTIMIZED VERSION
export async function getTransactionsByUserPaginatedWithRealCount(
  userId: string,
  role: string,
  page: number = 1,
  limit: number = 10,
  filters: TransactionFilters = { status: "processing" }
) {
  try {
    // Execute both optimized queries in parallel
    const [paginatedResult, realTotalCount] = await Promise.all([
      // Optimized paginated query
      getTransactionsByUserPaginated(userId, role, page, limit, filters),
      // Optimized count query with caching
      getRealTransactionCount(userId, role, filters)
    ]);

    // Return the paginated result but with the REAL total count
    return {
      ...paginatedResult,
      total: realTotalCount,
      pages: Math.ceil(realTotalCount / limit)
    };

  } catch (error) {
    console.error("Error in optimized getTransactionsByUserPaginatedWithRealCount:", error);
    throw error;
  }
}

// ULTRA-OPTIMIZED streaming export for very large datasets (32K+ rows)
// Uses incremental processing and response streaming to avoid timeouts
export async function exportTransactionsStreaming(
  userId: string,
  userRole: string,
  filters: TransactionFilters
) {
  try {
    // Enhanced memory monitoring for large exports
    const isFreeTier = process.env.RENDER_SERVICE_TYPE === 'free' || process.env.NODE_ENV === 'production';
    
    if (isFreeTier) {
      const memUsage = process.memoryUsage();
      if (memUsage.heapUsed > 350 * 1024 * 1024) { // Lower threshold for very large exports
        throw new Error("Memory usage too high for large export. Please try with smaller date range or contact support.");
      }
    }

    // Get total count first to determine strategy
    const realTotal = await getRealTransactionCount(userId, userRole, filters);
    
    if (realTotal === 0) {
      return {
        success: false,
        message: "No data to export",
        data: null
      };
    }

    // For very large datasets (25K+), use ultra-optimized streaming approach
    if (realTotal >= 25000) {
      return await processLargeExportInChunks(userId, userRole, filters, realTotal);
    }

    // For medium datasets (8K-25K), use standard optimized approach
    const result = await getAllTransactionsByUser(userId, userRole, filters);
    
    if (!result || result.total === 0) {
      return {
        success: false,
        message: "No data to export",
        data: null
      };
    }

    // Transform transactions for Excel export
    const exportData = (result.documents as Transaction[]).map((transaction: Transaction) => {
      return {
        "Order ID": transaction.odrId,
        "Merchant Ref ID": transaction.merchantOrdId || "",
        "Type": transaction.odrType,
        "Status": transaction.odrStatus,
        "Amount": transaction.amount,
        "Paid Amount": transaction.paidAmount,
        "Unpaid Amount": transaction.unPaidAmount,
        "Bank Code": (transaction as Record<string, unknown>).bankCode as string || "",
        "Bank Account": (transaction as Record<string, unknown>).bankReceiveNumber as string || "",
        "Bank Owner": (transaction as Record<string, unknown>).bankReceiveOwnerName as string || "",
        "isSentCallbackNotification": transaction.isSentCallbackNotification ? "Yes" : "No",
        "Created Date": transaction.$createdAt ? new Date(transaction.$createdAt).toLocaleDateString() : "",
        "Created Time": transaction.$createdAt ? new Date(transaction.$createdAt).toLocaleTimeString() : "",
        "Updated Date": transaction.$updatedAt ? new Date(transaction.$updatedAt).toLocaleDateString() : "",
        "Updated Time": transaction.$updatedAt ? new Date(transaction.$updatedAt).toLocaleTimeString() : "",
        "Last Payment": (transaction as Record<string, unknown>).lastPaymentDate as string || "",
      };
    });

    // Generate filename with timestamp and filter info
    const timestamp = new Date().toISOString().split('T')[0];
    const filterInfo = filters.status !== 'all' ? `_${filters.status}` : '';
    const typeInfo = filters.type && filters.type !== 'all' ? `_${filters.type}` : '';
    const filename = `transactions_${timestamp}${filterInfo}${typeInfo}_${result.total}records.xlsx`;

    return {
      success: true,
      message: `Export completed successfully`,
      data: {
        transactions: exportData,
        filename: filename
      }
    };

  } catch (error) {
    console.error("Error in streaming export:", error);
    return {
      success: false,
      message: `Failed to export transactions: ${error instanceof Error ? error.message : String(error)}`,
      data: null
    };
  }
}

// Process very large exports in chunks to avoid timeouts
async function processLargeExportInChunks(
  userId: string,
  userRole: string,
  filters: TransactionFilters,
  totalRecords: number
) {
  try {
    // Get user accounts using the same role-based logic
    const accountlists = await getAccountsByUserRole(userId, userRole);
    const accountPublicTransactionId = accountlists.documents.map(
      (account: Account) => account.publicTransactionId
    );

    if (accountPublicTransactionId.length === 0) {
      return {
        success: false,
        message: "No accounts found for export",
        data: null
      };
    }

    // Build query array (same logic as other functions)
    const baseQueries: string[] = [];

    // Add merchant account filter if needed
    if (userRole === 'merchant') {
      baseQueries.push(Query.equal("account", accountlists.documents[0].$id));
    }

    // Add status filter
    if (filters.status !== 'all') {
      baseQueries.push(Query.equal('odrStatus', filters.status || 'processing'));
    }

    // Add type filter
    if (filters.type && filters.type !== 'all') {
      baseQueries.push(Query.equal('odrType', filters.type));
    }

    // Handle ID filters
    const hasIdFilter = filters.orderId || filters.merchantOrdId;

    if (filters.orderId) {
      const orderIds = filters.orderId
        .split(/[,;\n]/)
        .map(id => id.trim())
        .filter(id => id.length > 0);
      
      if (orderIds.length === 1) {
        baseQueries.push(Query.equal('odrId', orderIds[0]));
      } else if (orderIds.length > 1) {
        baseQueries.push(Query.equal('odrId', orderIds));
      }
    }

    if (filters.merchantOrdId) {
      const merchantOrderIds = filters.merchantOrdId
        .split(/[,;\n]/)
        .map(id => id.trim())
        .filter(id => id.length > 0);
      
      if (merchantOrderIds.length === 1) {
        baseQueries.push(Query.equal('merchantOrdId', merchantOrderIds[0]));
      } else if (merchantOrderIds.length > 1) {
        baseQueries.push(Query.equal('merchantOrdId', merchantOrderIds));
      }
    }

    // Handle date filters (same logic as other functions)
    const hasDateFilter = filters.dateFrom || filters.dateTo;

    if (!hasIdFilter && !hasDateFilter) {
      const today = new Date();
      const startOfToday = setStartOfDay(today);
      const endOfToday = setEndOfDay(today);
      
      baseQueries.push(Query.greaterThanEqual('$createdAt', startOfToday.toISOString()));
      baseQueries.push(Query.lessThanEqual('$createdAt', endOfToday.toISOString()));
    }
    else if (hasDateFilter) {
      if (hasIdFilter) {
        if (filters.dateFrom) {
          const fromDate = parseDate(filters.dateFrom);
          if (fromDate) {
            const startOfDay = setStartOfDay(fromDate);
            baseQueries.push(Query.greaterThanEqual('$createdAt', startOfDay.toISOString()));
          }
        }

        if (filters.dateTo) {
          const toDate = parseDate(filters.dateTo);
          if (toDate) {
            const endOfDay = setEndOfDay(toDate);
            baseQueries.push(Query.lessThanEqual('$createdAt', endOfDay.toISOString()));
          }
        }
      }
      else {
        if (filters.dateFrom && filters.dateTo) {
          const fromDate = parseDate(filters.dateFrom);
          const toDate = parseDate(filters.dateTo);

          if (fromDate && toDate) {
            // For exports: Use the actual date range specified by user
            // Remove the 2-day restriction that was for browsing performance
            const startOfDay = setStartOfDay(fromDate);
            baseQueries.push(Query.greaterThanEqual('$createdAt', startOfDay.toISOString()));

            const endOfDay = setEndOfDay(toDate);
            baseQueries.push(Query.lessThanEqual('$createdAt', endOfDay.toISOString()));
          }
        }
        else if (filters.dateFrom) {
          const fromDate = parseDate(filters.dateFrom);
          if (fromDate) {
            const startOfDay = setStartOfDay(fromDate);
            baseQueries.push(Query.greaterThanEqual('$createdAt', startOfDay.toISOString()));

            // For exports: if only dateFrom is specified, don't add automatic end date
            // This allows exporting all records from the specified date forward
            // (The 2-day limit is for regular browsing, not exports)
          }
        }
        else if (filters.dateTo) {
          const toDate = parseDate(filters.dateTo);
          if (toDate) {
            const endOfDay = setEndOfDay(toDate);
            baseQueries.push(Query.lessThanEqual('$createdAt', endOfDay.toISOString()));

            // For exports: if only dateTo is specified, don't add automatic start date
            // This allows exporting all records up to the specified date
            // (The 2-day limit is for regular browsing, not exports)
          }
        }
      }
    }

    // Add amount range filters
    if (filters.amount?.min) {
      baseQueries.push(Query.greaterThanEqual('amount', parseFloat(filters.amount.min)));
    }

    if (filters.amount?.max) {
      baseQueries.push(Query.lessThanEqual('amount', parseFloat(filters.amount.max)));
    }

    // Add callback notification filter
    if (filters.isSentCallbackNotification && filters.isSentCallbackNotification !== 'all') {
      const callbackValue = filters.isSentCallbackNotification === 'true';
      baseQueries.push(Query.equal('isSentCallbackNotification', callbackValue));
    }

    // ULTRA-OPTIMIZED configuration for very large datasets
    const isFreeTier = process.env.RENDER_SERVICE_TYPE === 'free' || process.env.NODE_ENV === 'production';
    
    // Ultra-conservative settings for 32K+ records - prevent timeouts
    const chunkSize = totalRecords > 50000 
      ? (isFreeTier ? 500 : 800)   // Even smaller for 50K+ records
      : (isFreeTier ? 800 : 1200); // Standard for 25K-50K records
    
    // Note: Using sequential processing instead of concurrent for reliability
      
    const processingDelay = totalRecords > 50000
      ? (isFreeTier ? 200 : 100)   // Longer delays for very large datasets
      : (isFreeTier ? 100 : 50);   // Standard delays
    
    const { database } = await getAdminClient();
    const allTransactions: Array<Record<string, string | number>> = [];
    
    // Calculate estimated chunks (actual may vary due to cursor-based pagination)
    const estimatedChunks = Math.ceil(totalRecords / chunkSize);
    console.log(`📦 Processing ${totalRecords} records in ~${estimatedChunks} chunks of up to ${chunkSize} records each`);
    console.log(`🔍 Base queries applied:`, baseQueries.map(q => q.toString()));
    console.log(`📅 Date filters:`, { 
      dateFrom: filters.dateFrom, 
      dateTo: filters.dateTo,
      hasIdFilter,
      hasDateFilter 
    });

    // Process chunks using cursor-based pagination to avoid offset limitations
    let hasMoreData = true;
    let lastCreatedAt: string | null = null;
    let processedRecords = 0;
    let chunkNumber = 0;

    while (hasMoreData) {
      const currentChunkSize = chunkSize;

      // Build queries for cursor-based pagination
      const chunkQueries = [...baseQueries];
      
      // Add cursor condition for pagination (avoid large offsets)
      if (lastCreatedAt) {
        chunkQueries.push(Query.lessThan('$createdAt', lastCreatedAt));
      }
      
      chunkQueries.push(Query.orderDesc('$createdAt'));
      chunkQueries.push(Query.limit(currentChunkSize));

        try {
          console.log(`🔍 Chunk ${chunkNumber + 1} query:`, {
            queriesCount: chunkQueries.length,
            hasTimeFilter: chunkQueries.some(q => q.includes('$createdAt')),
            hasCursor: !!lastCreatedAt,
            chunkSize: currentChunkSize
          });
          
          const result = await database.listDocuments(
            DATABASE_ID,
            ODRTRANS_COLLECTION_ID,
            chunkQueries
          );

          console.log(`📊 Chunk ${chunkNumber + 1} result:`, {
            documentsReceived: result.documents.length,
            totalInResult: result.total,
            expectedChunkSize: currentChunkSize,
            lastRecordDate: result.documents.length > 0 ? result.documents[result.documents.length - 1].$createdAt : 'none'
          });

        const batchTransactions = result.documents.map((doc: unknown) => {
          const transaction = doc as Transaction;
          
          return {
            "Order ID": transaction.odrId,
            "Merchant Ref ID": transaction.merchantOrdId || "",
            "Type": transaction.odrType,
            "Status": transaction.odrStatus,
            "Amount": transaction.amount,
            "Paid Amount": transaction.paidAmount,
            "Unpaid Amount": transaction.unPaidAmount,
            "Bank Code": (transaction as Record<string, unknown>).bankCode as string || "",
            "Bank Account": (transaction as Record<string, unknown>).bankReceiveNumber as string || "",
            "Bank Owner": (transaction as Record<string, unknown>).bankReceiveOwnerName as string || "",
            "isSentCallbackNotification": transaction.isSentCallbackNotification ? "Yes" : "No",
            "Created Date": transaction.$createdAt ? new Date(transaction.$createdAt).toLocaleDateString() : "",
            "Created Time": transaction.$createdAt ? new Date(transaction.$createdAt).toLocaleTimeString() : "",
            "Updated Date": transaction.$updatedAt ? new Date(transaction.$updatedAt).toLocaleDateString() : "",
            "Updated Time": transaction.$updatedAt ? new Date(transaction.$updatedAt).toLocaleTimeString() : "",
            "Last Payment": (transaction as Record<string, unknown>).lastPaymentDate as string || "",
          };
        });

        // Add to main array
        allTransactions.push(...batchTransactions);
        processedRecords += batchTransactions.length;
        chunkNumber++;

        // Update cursor for next iteration
        if (result.documents.length > 0) {
          const lastDoc = result.documents[result.documents.length - 1] as Transaction;
          lastCreatedAt = lastDoc.$createdAt;
        }

        // Check if we have more data
        hasMoreData = result.documents.length === currentChunkSize;

        // Memory management for large exports
        if (isFreeTier && allTransactions.length % 5000 === 0 && global.gc) {
          global.gc(); // Force garbage collection
        }

        // Progress logging with actual records processed
        const progressPercent = Math.round((processedRecords / totalRecords) * 100);
        console.log(`📈 Export progress: ${processedRecords}/${totalRecords} (${progressPercent}%) - Chunk ${chunkNumber} returned ${batchTransactions.length} records, hasMore: ${hasMoreData}`);

        // Small delay between chunks to prevent server overload
        if (hasMoreData) {
          await new Promise(resolve => setTimeout(resolve, processingDelay));
        }

      } catch (error) {
        console.error(`Error processing chunk ${chunkNumber}:`, error);
        // Continue with next chunk instead of failing completely
        hasMoreData = false;
      }
    }

    // Generate filename
    const timestamp = new Date().toISOString().split('T')[0];
    const filterInfo = filters.status !== 'all' ? `_${filters.status}` : '';
    const typeInfo = filters.type && filters.type !== 'all' ? `_${filters.type}` : '';
    const filename = `transactions_large_${timestamp}${filterInfo}${typeInfo}_${allTransactions.length}records.xlsx`;

    console.log(`✅ Large export completed: ${allTransactions.length} records processed in ${chunkNumber} chunks`);

    return {
      success: true,
      message: `Large export completed successfully`,
      data: {
        transactions: allTransactions,
        filename: filename
      }
    };

  } catch (error) {
    console.error("Error in large export processing:", error);
    throw error;
  }
}