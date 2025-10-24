import { ID, Query, Models } from "appwrite";
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { dbManager } from "@/lib/database/connection-manager";

const DATABASE_ID = appwriteConfig.databaseId;
const BANK_COLLECTION_ID = appwriteConfig.banksCollectionId;
const BANK_TRANS_COLLECTION_ID = appwriteConfig.bankTransactionEntryCollectionId;
const ODRTRANS_COLLECTION_ID = appwriteConfig.odrtransCollectionId;

// Define specific types for transaction status and type  
export type TransactionStatus = 'pending' | 'processed' | 'failed' | 'duplicated' | 'unlinked' | 'available';
export type TransactionType = 'credit' | 'debit';

// Define interface for bank transaction entry data  
export interface BankTransactionEntryData {
  portalId: string;
  portalTransactionId: string;
  odrId?: string | null;
  bankId?: string | null;
  bankName: string;
  bankAccountNumber: string;
  amount: number;
  transactionType: TransactionType;
  balanceAfter: number;
  transactionDate: string;
  rawPayload?: string;
  status?: TransactionStatus;
  notes?: string;
  processingDate?: string;
}

// Interface for the created document result  
export interface BankTransactionDocument extends BankTransactionEntryData, Models.Document {
  $id: string;
  $createdAt: string;
  $updatedAt: string;
}

// Define interface for bank data  
export interface BankData extends Models.Document {
  $id: string;
  bankId: string;
  accountNumber: string;
  bankName: string;
  availableBalance: number;
  currentBalance: number;
  ownerName?: string;
  isActivated?: boolean;
  bankBinCode?: string;
  userId?: string;
}

// Type for function results  
export interface FunctionResult<T> {
  success: boolean;
  message?: string;
  entry?: T;
  entries?: T[];
}

// Helper function to create a bank transaction entry  
export async function createBankTransactionEntry(
  transactionData: BankTransactionEntryData
): Promise<FunctionResult<BankTransactionDocument>> {
  try {
    //console.log("Database ID:", DATABASE_ID);  
    //console.log("Collection ID:", BANK_TRANS_COLLECTION_ID);  

    // Use database manager for reliable operations
    const processingDate = new Date().toISOString();

    const entry = await dbManager.createDocument(
      DATABASE_ID,
      BANK_TRANS_COLLECTION_ID,
      ID.unique(),
      {
        ...transactionData,
        processingDate,
        status: transactionData.status || 'pending'
      },
      'create-bank-transaction-entry'
    ) as BankTransactionDocument;

    return { success: true, entry };
  } catch (error) {
    console.error("Error creating bank transaction entry:", error);
    console.error("Error details:", {
      DATABASE_ID,
      BANK_TRANS_COLLECTION_ID,
      transactionData
    });

    return {
      success: false,
      message: `Error creating transaction entry: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Helper function to check if a transaction has already been processed  
export async function checkDuplicateTransaction(
  portalId: string,
  portalTransactionId: string
): Promise<boolean> {
  try {
    const existingTransactions = await dbManager.listDocuments(
      DATABASE_ID,
      BANK_TRANS_COLLECTION_ID,
      [
        Query.equal("portalId", [portalId]),
        Query.equal("portalTransactionId", [portalTransactionId]),
        Query.limit(1)
      ],
      'check-duplicate-transaction'
    );

    return existingTransactions.total > 0;
  } catch (error) {
    console.error("Error checking for duplicate transactions:", error);
    return false; // Assume it's not a duplicate if we can't check  
  }
}

// Helper function to check if a transaction has already been successfully processed
// This excludes unlinked, failed, and pending transactions
// A transaction is truly processed only if:
// 1. It has status "processed" in bankTransactionEntry
// 2. It has a valid odrId 
// 3. That odrId exists in the orderTransactions table
export async function checkProcessedTransaction(
  portalId: string,
  portalTransactionId: string
): Promise<boolean> {
  try {
    const processedTransactions = await dbManager.listDocuments(
      DATABASE_ID,
      BANK_TRANS_COLLECTION_ID,
      [
        Query.equal("portalId", [portalId]),
        Query.equal("portalTransactionId", [portalTransactionId]),
        Query.equal("status", ["processed"]), // Only check for successfully processed transactions
        Query.limit(1)
      ],
      'check-processed-transaction'
    );

    if (processedTransactions.total === 0) {
      return false;
    }

    const bankTransaction = processedTransactions.documents[0] as BankTransactionDocument;
    
    // Check if the bank transaction has a valid odrId
    if (!bankTransaction.odrId) {
      console.log(`Bank transaction ${portalTransactionId} has status 'processed' but no odrId - not truly processed`);
      return false;
    }

    // Verify that the odrId exists in the orderTransactions table
    try {
      const orderTransactions = await dbManager.listDocuments(
        DATABASE_ID,
        ODRTRANS_COLLECTION_ID,
        [
          Query.equal("odrId", [bankTransaction.odrId]),
          Query.limit(1)
        ],
        'verify-order-exists'
      );

      if (orderTransactions.total === 0) {
        console.log(`Bank transaction ${portalTransactionId} has odrId ${bankTransaction.odrId} but order doesn't exist - not truly processed`);
        return false;
      }

      // Transaction is truly processed: has processed status, valid odrId, and order exists
      return true;
    } catch (orderCheckError) {
      console.error(`Error checking order existence for odrId ${bankTransaction.odrId}:`, orderCheckError);
      return false;
    }
  } catch (error) {
    console.error("Error checking for processed transactions:", error);
    return false; // Assume it's not processed if we can't check  
  }
}

// Function to find existing transaction by portal ID and transaction ID
export async function findExistingTransaction(
  portalId: string,
  portalTransactionId: string
): Promise<FunctionResult<BankTransactionDocument>> {
  try {
    const existingTransactions = await dbManager.listDocuments(
      DATABASE_ID,
      BANK_TRANS_COLLECTION_ID,
      [
        Query.equal("portalId", [portalId]),
        Query.equal("portalTransactionId", [portalTransactionId]),
        Query.limit(1)
      ],
      'find-existing-transaction'
    );

    if (existingTransactions.total > 0) {
      return { 
        success: true, 
        entry: existingTransactions.documents[0] as BankTransactionDocument 
      };
    } else {
      return { 
        success: false, 
        message: "Transaction not found" 
      };
    }
  } catch (error) {
    console.error("Error finding existing transaction:", error);
    return { 
      success: false, 
      message: `Error finding transaction: ${error instanceof Error ? error.message : String(error)}` 
    };
  }
}

// Function to find bank by account number  
export async function findBankByAccountNumber(accountNumber: string): Promise<{
  success: boolean;
  message?: string;
  bank?: BankData;
}> {
  try {
    const banksResult = await dbManager.listDocuments(
      DATABASE_ID,
      BANK_COLLECTION_ID,
      [
        Query.equal("accountNumber", [accountNumber]),
        Query.limit(1)
      ],
      'find-bank-by-account-number'
    );

    if (banksResult.total === 0) {
      return { success: false, message: "Bank account not found" };
    }

    return { success: true, bank: banksResult.documents[0] as BankData };
  } catch (error) {
    console.error("Error finding bank by account number:", error);
    return { success: false, message: `Error: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// Function to update a bank transaction entry  
export async function updateBankTransactionEntryStatus(
  entryId: string,
  status: TransactionStatus,
  notes?: string
): Promise<FunctionResult<BankTransactionDocument>> {
  try {
    // Use database manager for reliable operations
    // First, get the current document to see its structure  
    try {
      // const currentEntry = await database.getDocument(  
      //   DATABASE_ID,  
      //   BANK_TRANS_COLLECTION_ID,  
      //   entryId  
      // );  

      // console.log("Current entry structure:", JSON.stringify({  
      //   id: currentEntry.$id,  
      //   status: currentEntry.status,  
      //   // Include other key fields for debugging  
      // }));  

      // Create update data object with explicit non-relationship fields  
      const updateData: Record<string, unknown> = {};

      // Only set fields we know are not relationships  
      updateData.status = status;

      if (notes) {
        updateData.notes = notes;
      }

      if (status === 'processed') {
        updateData.processingDate = new Date().toISOString();
      }

      // console.log("Updating document with data:", JSON.stringify(updateData));  
      // console.log("Entry ID:", entryId);  
      // console.log("Collection ID:", BANK_TRANS_COLLECTION_ID);  

      const updatedEntry = await dbManager.updateDocument(
        DATABASE_ID,
        BANK_TRANS_COLLECTION_ID,
        entryId,
        updateData,
        'update-bank-transaction-entry-status'
      ) as BankTransactionDocument;

      return { success: true, entry: updatedEntry };
    } catch (getError) {
      console.error("Error retrieving document before update:", getError);
      return {
        success: false,
        message: `Error retrieving document: ${getError instanceof Error ? getError.message : String(getError)}`
      };
    }
  } catch (error) {
    console.error("Error updating bank transaction entry:", error);
    return {
      success: false,
      message: `Error updating transaction entry: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Function to update a bank transaction entry with order ID and other fields
export async function updateBankTransactionEntry(
  entryId: string,
  updates: {
    status?: TransactionStatus;
    odrId?: string;
    notes?: string;
  }
): Promise<FunctionResult<BankTransactionDocument>> {
  try {
    const { database } = await createAdminClient();

    // Create update data object with explicit non-relationship fields  
    const updateData: Record<string, unknown> = {};

    if (updates.status) {
      updateData.status = updates.status;
    }

    if (updates.odrId) {
      updateData.odrId = updates.odrId;
    }

    if (updates.notes) {
      updateData.notes = updates.notes;
    }

    if (updates.status === 'processed') {
      updateData.processingDate = new Date().toISOString();
    }

    const updatedEntry = await database.updateDocument(
      DATABASE_ID,
      BANK_TRANS_COLLECTION_ID,
      entryId,
      updateData
    ) as BankTransactionDocument;

    return { success: true, entry: updatedEntry };
  } catch (error) {
    console.error("Error updating bank transaction entry:", error);
    return {
      success: false,
      message: `Error updating transaction entry: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Function to get bank transaction entries by status  
export async function getBankTransactionEntriesByStatus(
  status: TransactionStatus,
  limit = 50
): Promise<FunctionResult<BankTransactionDocument>> {
  try {
    const { database } = await createAdminClient();

    const entries = await database.listDocuments(
      DATABASE_ID,
      BANK_TRANS_COLLECTION_ID,
      [
        Query.equal("status", [status]),
        Query.orderDesc("$createdAt"),
        Query.limit(limit)
      ]
    );

    return {
      success: true,
      entries: entries.documents as BankTransactionDocument[]
    };
  } catch (error) {
    console.error("Error fetching bank transaction entries:", error);
    return {
      success: false,
      message: `Error fetching transaction entries: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Function to get a single bank transaction entry by ID  
export async function getBankTransactionEntryById(
  entryId: string
): Promise<FunctionResult<BankTransactionDocument>> {
  try {
    const { database } = await createAdminClient();

    const entry = await database.getDocument(
      DATABASE_ID,
      BANK_TRANS_COLLECTION_ID,
      entryId
    ) as BankTransactionDocument;

    return { success: true, entry };
  } catch (error) {
    console.error("Error fetching bank transaction entry:", error);
    return {
      success: false,
      message: `Error fetching transaction entry: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Function to get transaction entries by order ID  
export async function getBankTransactionEntriesByOrderId(
  odrId: string,
  odrStt: string,
  limit: number | null = null
): Promise<FunctionResult<BankTransactionDocument>> {
  try {
    const { database } = await createAdminClient();

    const queries: string[] = [
      Query.orderDesc("$createdAt"),
    ];

    if (odrStt === 'pending') {
      queries.push(Query.equal("status", ["pending"]));
      // No limit for pending status as per requirement
    } else if (odrStt === 'completed') {
      queries.push(Query.equal("odrId", [odrId]));
      if (limit !== null) {
        queries.push(Query.limit(limit));
      }
    } else {
      return {
        success: false,
        entries: [],
        message: `Getting bank transaction entries with order status : ${odrStt} is not allowed!`,
      };
    }

    const entries = await database.listDocuments(
      DATABASE_ID,
      BANK_TRANS_COLLECTION_ID,
      queries
    );

    return {
      success: true,
      entries: entries.documents as BankTransactionDocument[]
    };
  } catch (error) {
    console.error("Error fetching bank transaction entries by order ID:", error);
    return {
      success: false,
      message: `Error fetching transaction entries: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Function to get ALL transaction entries by order ID (no status filtering)
export async function getAllBankTransactionEntriesByOrderId(
  odrId: string,
  limit: number | null = null
): Promise<FunctionResult<BankTransactionDocument>> {
  try {
    const { database } = await createAdminClient();

    const queries: string[] = [
      Query.equal("odrId", [odrId]),
      Query.orderDesc("$createdAt"),
    ];

    if (limit !== null) {
      queries.push(Query.limit(limit));
    }

    const entries = await database.listDocuments(
      DATABASE_ID,
      BANK_TRANS_COLLECTION_ID,
      queries
    );

    return {
      success: true,
      entries: entries.documents as BankTransactionDocument[]
    };
  } catch (error) {
    console.error("Error fetching all bank transaction entries by order ID:", error);
    return {
      success: false,
      message: `Error fetching transaction entries: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Function to get transaction entries by bank ID  
export async function getBankTransactionEntriesByBankId(
  bankId: string,
  limit = 50
): Promise<FunctionResult<BankTransactionDocument>> {
  try {
    const { database } = await createAdminClient();

    // Try first with bankId field
    let entries = await database.listDocuments(
      DATABASE_ID,
      BANK_TRANS_COLLECTION_ID,
      [
        Query.equal("bankId", [bankId]),
        Query.orderDesc("$createdAt"),
        Query.limit(limit)
      ]
    );

    // If no results found with bankId, try with $id field as a fallback
    if (entries.total === 0) {
      //console.log("No transactions found with bankId, trying with $id as reference");
      entries = await database.listDocuments(
        DATABASE_ID,
        BANK_TRANS_COLLECTION_ID,
        [
          Query.equal("$id", [bankId]),
          Query.orderDesc("$createdAt"),
          Query.limit(limit)
        ]
      );
    }

    return {
      success: true,
      entries: entries.documents as BankTransactionDocument[]
    };
  } catch (error) {
    console.error("Error fetching bank transaction entries by bank ID:", error);
    return {
      success: false,
      message: `Error fetching transaction entries: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Function to find unlinked transactions that could potentially match an order
export async function findUnlinkedTransactionsByAmountAndBank(
  amount: number,
  bankAccountNumber: string,
  limit = 10
): Promise<FunctionResult<BankTransactionDocument>> {
  try {
    const { database } = await createAdminClient();

    const entries = await database.listDocuments(
      DATABASE_ID,
      BANK_TRANS_COLLECTION_ID,
      [
        Query.equal("status", ["unlinked"]),
        Query.equal("amount", [amount]),
        Query.equal("bankAccountNumber", [bankAccountNumber]),
        Query.orderDesc("$createdAt"),
        Query.limit(limit)
      ]
    );

    return {
      success: true,
      entries: entries.documents as BankTransactionDocument[]
    };
  } catch (error) {
    console.error("Error fetching unlinked transactions:", error);
    return {
      success: false,
      message: `Error fetching unlinked transactions: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Function to find available transactions that could be used for redemption
export async function findAvailableTransactionsByAmount(
  amount: number,
  transactionType: 'credit' | 'debit' = 'debit',
  limit = 10
): Promise<FunctionResult<BankTransactionDocument>> {
  try {
    const { database } = await createAdminClient();

    // For withdrawals, we need debit transactions (negative amount)
    // For deposits, we need credit transactions (positive amount)
    const searchAmount = transactionType === 'debit' ? -Math.abs(amount) : Math.abs(amount);

    const entries = await database.listDocuments(
      DATABASE_ID,
      BANK_TRANS_COLLECTION_ID,
      [
        Query.equal("status", ["available"]),
        Query.equal("amount", [searchAmount]),
        Query.equal("transactionType", [transactionType]),
        Query.orderDesc("$createdAt"),
        Query.limit(limit)
      ]
    );

    return {
      success: true,
      entries: entries.documents as BankTransactionDocument[]
    };
  } catch (error) {
    console.error("Error fetching available transactions:", error);
    return {
      success: false,
      message: `Error fetching available transactions: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Function to find available transaction by portal transaction ID (for direct lookup)
export async function findAvailableTransactionByPortalId(
  portalId: string,
  portalTransactionId: string
): Promise<FunctionResult<BankTransactionDocument>> {
  try {
    const { database } = await createAdminClient();

    const entries = await database.listDocuments(
      DATABASE_ID,
      BANK_TRANS_COLLECTION_ID,
      [
        Query.equal("portalId", [portalId]),
        Query.equal("portalTransactionId", [portalTransactionId]),
        Query.equal("status", ["available"]),
        Query.limit(1)
      ]
    );

    if (entries.total === 0) {
      return {
        success: false,
        message: 'No available transaction found with this payment ID'
      };
    }

    return {
      success: true,
      entry: entries.documents[0] as BankTransactionDocument
    };
  } catch (error) {
    console.error("Error fetching available transaction by portal ID:", error);
    return {
      success: false,
      message: `Error fetching available transaction: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Function to calculate current balance from transactions  
export async function calculateBankBalanceFromTransactions(
  bankId: string
): Promise<{ success: boolean; calculatedBalance?: number; message?: string }> {
  try {
    const { database } = await createAdminClient();

    // Get all transactions for this bank, ordered by creation date (ascending)  
    const entries = await database.listDocuments(
      DATABASE_ID,
      BANK_TRANS_COLLECTION_ID,
      [
        Query.equal("bankId", [bankId]),
        Query.orderAsc("$createdAt"),
        // No limit to get all transactions  
      ]
    );

    if (entries.total === 0) {
      return { success: true, calculatedBalance: 0 };
    }

    let calculatedBalance = 0;
    const transactions = entries.documents as BankTransactionDocument[];

    for (const transaction of transactions) {
      // Add the amount (which is already negative for debits)  
      calculatedBalance += transaction.amount;
    }

    return { success: true, calculatedBalance };
  } catch (error) {
    console.error("Error calculating bank balance from transactions:", error);
    return {
      success: false,
      message: `Error calculating balance: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}