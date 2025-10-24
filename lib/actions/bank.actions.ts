"use server";

import { BankAccount, chkBanksControlProps, createBankAccountProps } from "@/types";
import { createAdminClient } from "../appwrite/appwrite.actions";
import { appwriteConfig } from "../appwrite/appwrite-config";
import { ID, Query, Models } from "appwrite";
import { parseStringify } from "../utils";
import { createBankTransactionEntry } from "./bankTransacionEntry.action";
import { dbManager } from "@/lib/database/connection-manager";

interface AppwriteDocumentsList<T> {
  documents: T[];
  total: number;
}

const DATABASE_ID = appwriteConfig.databaseId;
const BANK_COLLECTION_ID = appwriteConfig.banksCollectionId;
const BANKS_CONTROL_COLLECTION_ID = appwriteConfig.banksControlCollectionId;

export const chkBanksControl = async (bankData: chkBanksControlProps) => {
  try {
    const banksBlacklist = await dbManager.listDocuments(
      DATABASE_ID!,
      BANKS_CONTROL_COLLECTION_ID!,
      [
        Query.equal("bankCode", [bankData.bankCode]),
        Query.equal("bankNumber", [bankData.bankNumber]),
        Query.equal("isBlackList", [true]),
      ],
      'check-banks-control'
    );

    if (banksBlacklist.total > 0) {
      return {
        success: true,
        message: "Bank is blacklisted",
        data: banksBlacklist.documents
      };
    }

    return {
      success: false,
      message: "Bank is ok!",
      data: []
    };

  } catch (error) {
    console.error("Error checking bank control:", error);
    return {
      success: true,
      message: "Can not verify bank blacklist",
      data: []
    };
  }
}

export const createBankAccount = async (bankData: createBankAccountProps) => {
  try {
    // Convert string values to numbers for the balance fields  
    const formattedData = {
      ...bankData,
      availableBalance: parseFloat(bankData.availableBalance),
      currentBalance: parseFloat(bankData.currentBalance),
      realBalance: parseFloat(bankData.availableBalance), // Initialize real balance with available balance   
    };

    const newBank = await dbManager.createDocument(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      ID.unique(),
      formattedData,
      'create-bank-account'
    );

    if (!newBank) {
      throw new Error('Failed to create bank account document');
    }

    // Create an initial transaction entry if there's an initial balance  
    if (formattedData.availableBalance > 0) {
      await createBankTransactionEntry({
        portalId: 'system',
        portalTransactionId: `init-${newBank.$id}`,
        bankId: newBank.bankId,
        bankName: newBank.bankName,
        bankAccountNumber: newBank.accountNumber,
        amount: formattedData.availableBalance,
        transactionType: 'credit',
        balanceAfter: formattedData.availableBalance,
        transactionDate: new Date().toISOString(),
        status: 'processed',
        notes: 'Initial balance'
      });
    }

    // Return a plain object instead of the Appwrite document object  
    return {
      id: newBank.$id,
      bankId: newBank.bankId,
      bankName: newBank.bankName,
      accountNumber: newBank.accountNumber,
      cardNumber: newBank.cardNumber,
      ownerName: newBank.ownerName,
      availableBalance: newBank.availableBalance,
      currentBalance: newBank.currentBalance,
      realBalance: newBank.realBalance,
      userId: newBank.userId,
      isActivated: newBank.isActivated,
      bankBinCode: newBank.bankBinCode,
    };
  } catch (error) {
    console.error('Error creating bank account:', error);
    return null;
  }
}

export const getBanksByUserId = async ({ userId }: { userId: string }): Promise<AppwriteDocumentsList<BankAccount> | { documents: BankAccount[] }> => {
  try {
    const banks = await dbManager.listDocuments(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      [Query.equal('userId', [userId])],
      'get-banks-by-userId'
    ) as unknown as AppwriteDocumentsList<BankAccount>;

    return parseStringify(banks);
  } catch (error) {
    console.error("Error fetching bank accounts:", error);
    return { documents: [] };
  }
};

/**  
 * Get a bank account by its ID  
 * @param bankId The ID of the bank account to retrieve  
 * @returns The bank account if found, or null if not found  
 */
export async function getBankById(bankId: string) {
  try {
    // Try to get the bank by Appwrite $id first  
    try {
      const banks = await dbManager.listDocuments(
        DATABASE_ID!,
        BANK_COLLECTION_ID!,
        [Query.equal("bankId", bankId)],
        'get-bank-by-id'
      );

      const bank = banks.documents[0];
      if (!bank) {
        return {
          success: false,
          message: `Bank account not found with ID: ${bankId}`
        };
      }

      return {
        success: true,
        bank: {
          id: bank.$id,
          bankId: bank.bankId,
          bankName: bank.bankName,
          accountNumber: bank.accountNumber,
          cardNumber: bank.cardNumber,
          ownerName: bank.ownerName,
          availableBalance: Number(bank.availableBalance || 0),
          currentBalance: Number(bank.currentBalance || 0),
          realBalance: Number(bank.realBalance || bank.currentBalance || 0),
          userId: bank.userId,
          isActivated: bank.isActivated,
          bankBinCode: bank.bankBinCode,
        }
      };
    } catch (error) {
      console.error('error getBankById:', error)
      // If getting by $id fails, try by bankId field  
      const banksResult = await dbManager.listDocuments(
        DATABASE_ID!,
        BANK_COLLECTION_ID!,
        [Query.equal("bankId", [bankId])],
        'get-bank-by-id-fallback'
      );

      if (banksResult.total === 0) {
        return {
          success: false,
          message: `Bank account not found with ID: ${bankId}`
        };
      }

      const bank = banksResult.documents[0];

      return {
        success: true,
        bank: {
          id: bank.$id,
          bankId: bank.bankId,
          bankName: bank.bankName,
          accountNumber: bank.accountNumber,
          cardNumber: bank.cardNumber,
          ownerName: bank.ownerName,
          availableBalance: Number(bank.availableBalance || 0),
          currentBalance: Number(bank.currentBalance || 0),
          realBalance: Number(bank.realBalance || bank.currentBalance || 0),
          userId: bank.userId,
          isActivated: bank.isActivated,
          bankBinCode: bank.bankBinCode,
        }
      };
    }
  } catch (error) {
    console.error("Error fetching bank by ID:", error);
    return {
      success: false,
      message: "Failed to fetch bank account",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// Add this function for updating bank balances  
export async function updateBankBalance(
  bankId: string,  // This is your custom bankId field, not the Appwrite document ID  
  amount: number,
  isUpdateCurrentBalance = true,
  isUpdateAvailableBalance = true,
  isPositive = true
) {
  try {
    // First, query to find the bank document with this bankId value  
    try {
      const bankDocuments = await dbManager.listDocuments(
        DATABASE_ID!,
        BANK_COLLECTION_ID!,
        [
          Query.equal('bankId', bankId)
        ],
        'find-bank-for-balance-update'
      );

      if (bankDocuments.total === 0) {
        return {
          success: false,
          message: `Bank account with bankId ${bankId} not found`
        };
      }

      // Get the first match (should be only one)  
      const bank = bankDocuments.documents[0];
      const documentId = bank.$id; // Get the actual Appwrite document ID  

      // Initialize with current values  
      let newCurrentBalance = Number(bank.currentBalance || 0);
      let newAvailableBalance = Number(bank.availableBalance || 0);

      // Update the balances based on parameters  
      if (isUpdateCurrentBalance) {
        if (isPositive) {
          // Add the amount  
          newCurrentBalance += amount;
        } else {
          // Subtract the amount  
          newCurrentBalance -= amount;
        }
      }

      if (isUpdateAvailableBalance) {
        if (isPositive) {
          // Add the amount  
          newAvailableBalance += amount;
        } else {
          // Subtract the amount  
          newAvailableBalance -= amount;
        }
      }

      // Prepare update data based on what needs to be updated  
      const updateData: {
        availableBalance?: number;
        currentBalance?: number;
        realBalance?: number;
      } = {};

      if (isUpdateAvailableBalance) {
        updateData.availableBalance = newAvailableBalance;
      }

      if (isUpdateCurrentBalance) {
        updateData.currentBalance = newCurrentBalance;
        // Also update realBalance to match currentBalance by default  
        // (Webhooks might override this later with exact bank values)  
        updateData.realBalance = newCurrentBalance;
      }

      // Update the bank account if there's anything to update  
      if (Object.keys(updateData).length > 0) {
        try {
          // Add retry logic for concurrent updates to prevent race conditions
          let retries = 3;
          let updatedBank: Models.Document | null = null;
          
          while (retries > 0) {
            try {
              // Get fresh bank data before updating to handle concurrent modifications
              const freshBankData = await dbManager.getDocument(
                DATABASE_ID!,
                BANK_COLLECTION_ID!,
                documentId,
                'get-fresh-bank-data'
              );
              
              // Recalculate based on fresh data
              const freshUpdateData: typeof updateData = {};
              
              if (isUpdateAvailableBalance) {
                const freshAvailable = Number(freshBankData.availableBalance || 0);
                freshUpdateData.availableBalance = isPositive 
                  ? freshAvailable + amount 
                  : freshAvailable - amount;
              }
              
              if (isUpdateCurrentBalance) {
                const freshCurrent = Number(freshBankData.currentBalance || 0);
                const newCurrent = isPositive 
                  ? freshCurrent + amount 
                  : freshCurrent - amount;
                freshUpdateData.currentBalance = newCurrent;
                freshUpdateData.realBalance = newCurrent;
              }
              
              updatedBank = await dbManager.updateDocument(
                DATABASE_ID!,
                BANK_COLLECTION_ID!,
                documentId,
                freshUpdateData,
                'update-bank-balance'
              );
              
              break; // Success, exit retry loop
            } catch (updateError) {
              retries--;
              if (retries === 0) throw updateError;
              
              // Brief delay before retry to reduce contention
              await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));
            }
          }
          
          // Ensure we have a valid updated bank document
          if (!updatedBank) {
            throw new Error('Failed to update bank document after retries');
          }

          return {
            success: true,
            documentId: bank.$id,    // The Appwrite document ID  
            bankId: bank.bankId,     // Your custom bankId field  
            previousBalance: {
              available: Number(bank.availableBalance || 0),
              current: Number(bank.currentBalance || 0),
              real: Number(bank.realBalance || bank.currentBalance || 0)
            },
            newBalance: {
              available: isUpdateAvailableBalance ? newAvailableBalance : Number(bank.availableBalance || 0),
              current: isUpdateCurrentBalance ? newCurrentBalance : Number(bank.currentBalance || 0),
              real: updateData.realBalance || Number(bank.realBalance || bank.currentBalance || 0)
            },
            updatedBank: {
              id: updatedBank.$id,           // Appwrite document ID  
              bankId: updatedBank.bankId,    // Your custom bankId field  
              bankName: updatedBank.bankName,
              accountNumber: updatedBank.accountNumber,
              ownerName: updatedBank.ownerName,
              availableBalance: updatedBank.availableBalance,
              currentBalance: updatedBank.currentBalance,
              realBalance: updatedBank.realBalance,
            }
          };
        } catch (updateError) {
          console.error(`Error updating bank document ${documentId}:`, updateError);
          return {
            success: false,
            message: updateError instanceof Error
              ? `Error updating bank document: ${updateError.message}`
              : "Unknown error during document update",
            bankId: bankId,
            documentId: documentId
          };
        }
      } else {
        // If nothing was updated, just return the current state  
        return {
          success: true,
          message: "No balance updates were requested",
          documentId: bank.$id,    // The Appwrite document ID  
          bankId: bank.bankId,     // Your custom bankId field  
          previousBalance: {
            available: Number(bank.availableBalance || 0),
            current: Number(bank.currentBalance || 0),
            real: Number(bank.realBalance || bank.currentBalance || 0)
          },
          newBalance: {
            available: Number(bank.availableBalance || 0),
            current: Number(bank.currentBalance || 0),
            real: Number(bank.realBalance || bank.currentBalance || 0)
          },
          updatedBank: {
            id: bank.$id,           // Appwrite document ID  
            bankId: bank.bankId,    // Your custom bankId field  
            bankName: bank.bankName,
            accountNumber: bank.accountNumber,
            ownerName: bank.ownerName,
            availableBalance: bank.availableBalance,
            currentBalance: bank.currentBalance,
            realBalance: bank.realBalance || bank.currentBalance,
          }
        };
      }
    } catch (queryError) {
      console.error(`Error querying for bank with bankId ${bankId}:`, queryError);
      return {
        success: false,
        message: queryError instanceof Error
          ? `Error finding bank: ${queryError.message}`
          : "Unknown error during bank lookup",
        bankId: bankId
      };
    }
  } catch (error) {
    console.error("Error in updateBankBalance function:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error updating bank balance",
      bankId: bankId
    };
  }
}

/**  
 * Update the real balance from bank API/webhook  
 * @param bankId ID of the bank to update  
 * @param realBalance The real balance from the bank API or webhook  
 * @returns Result of the update operation  
 */
export async function updateRealBalance(
  bankId: string,
  realBalance: number
) {
  try {
    // Find the bank document  
    const bankDocuments = await dbManager.listDocuments(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      [
        Query.equal('bankId', bankId)
      ],
      'find-bank-for-real-balance-update'
    );

    if (bankDocuments.total === 0) {
      return {
        success: false,
        message: `Bank account with bankId ${bankId} not found`
      };
    }

    const bank = bankDocuments.documents[0];
    const documentId = bank.$id;
    const previousRealBalance = Number(bank.realBalance || bank.currentBalance || 0);

    // Update just the real balance  
    const updatedBank = await dbManager.updateDocument(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      documentId,
      { realBalance },
      'update-real-balance'
    );

    return {
      success: true,
      bankId,
      previousRealBalance,
      newRealBalance: realBalance,
      bank: updatedBank
    };
  } catch (error) {
    console.error("Error updating real balance:", error);
    return {
      success: false,
      message: error instanceof Error ? error.message : "Unknown error updating real balance",
      bankId
    };
  }
}

// Calculate bank balance from transaction entries  
export async function calculateBankBalanceFromTransactions(
  bankId: string
): Promise<{ success: boolean; calculatedBalance?: number; message?: string }> {
  try {
    // Get all transactions for this bank, ordered by creation date (ascending)  
    const entries = await dbManager.listDocuments(
      DATABASE_ID!,
      appwriteConfig.bankTransactionEntryCollectionId!,
      [
        Query.equal("bankId", [bankId]),
        Query.orderAsc("$createdAt"),
        // No limit to get all transactions  
      ],
      'calculate-bank-balance-from-transactions'
    );

    if (entries.total === 0) {
      return { success: true, calculatedBalance: 0 };
    }

    let calculatedBalance = 0;
    const transactions = entries.documents;

    for (const transaction of transactions) {
      // For credit transactions, add the amount  
      // For debit transactions, subtract the amount (amount should already be negative)  
      calculatedBalance += Number(transaction.amount);
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

/**  
 * Reconcile bank balance with transaction entries  
 * Creates a reconciliation transaction if there's a discrepancy  
 * @param bankId The ID of the bank to reconcile  
 * @returns Result of the reconciliation  
 */
export async function reconcileBankBalance(bankId: string) {
  try {
    // Get the bank  
    const bankResult = await getBankById(bankId);
    if (!bankResult.success || !bankResult.bank) {
      return {
        success: false,
        message: `Bank not found with ID: ${bankId}`
      };
    }

    // Calculate balance from transactions  
    const calculationResult = await calculateBankBalanceFromTransactions(bankId);

    if (!calculationResult.success) {
      return {
        success: false,
        message: calculationResult.message || 'Failed to calculate balance'
      };
    }

    const calculatedBalance = calculationResult.calculatedBalance || 0;
    const bankBalance = Number(bankResult.bank.currentBalance || 0);
    const realBalance = Number(bankResult.bank.realBalance || bankBalance || 0);

    // Check if there's a significant discrepancy (avoid floating point issues)  
    // Using a small threshold to avoid floating point comparison issues  
    const discrepancy = realBalance - calculatedBalance;
    const isSignificantDiscrepancy = Math.abs(discrepancy) > 0.01;

    if (!isSignificantDiscrepancy) {
      return {
        success: true,
        message: "No reconciliation needed, balances already match",
        calculatedBalance,
        bankBalance,
        realBalance
      };
    }

    // Create a reconciliation transaction  
    const { createBankTransactionEntry } = await import('./bankTransacionEntry.action');
    await createBankTransactionEntry({
      portalId: 'system',
      portalTransactionId: `reconcile-${Date.now()}`,
      bankId: bankResult.bank.bankId,
      bankName: bankResult.bank.bankName,
      bankAccountNumber: bankResult.bank.accountNumber,
      amount: discrepancy,
      transactionType: discrepancy > 0 ? 'credit' : 'debit',
      balanceAfter: realBalance,
      transactionDate: new Date().toISOString(),
      status: 'processed',
      notes: 'Balance reconciliation adjustment'
    });

    // Update the bank currentBalance to match the realBalance  
    const { database } = await createAdminClient();
    await database.updateDocument(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      bankResult.bank.id,
      {
        currentBalance: realBalance,
        availableBalance: realBalance
      }
    );

    return {
      success: true,
      message: `Balance reconciled. Adjustment of ${discrepancy > 0 ? '+' : ''}${discrepancy} applied.`,
      previousCalculatedBalance: calculatedBalance,
      previousBankBalance: bankBalance,
      realBalance,
      newBalance: realBalance,
      discrepancy
    };
  } catch (error) {
    console.error("Error reconciling bank balance:", error);
    return {
      success: false,
      message: `Error reconciling balance: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Add a transaction-focused version for bank deposits/withdrawals  
export async function processBankTransaction(
  bankId: string,
  transactionType: 'deposit' | 'withdraw',
  amount: number,
  description?: string
) {
  try {
    // Validate amount  
    if (amount <= 0) {
      return {
        success: false,
        message: "Transaction amount must be greater than zero"
      };
    }

    // For deposits, we add money (positive)  
    // For withdrawals, we subtract money (negative)  
    const isPositive = transactionType === 'deposit';

    // Get the bank first  
    const bankResult = await getBankById(bankId);
    if (!bankResult.success || !bankResult.bank) {
      return {
        success: false,
        message: `Bank account not found: ${bankId}`
      };
    }

    // Create transaction entry first  
    const { createBankTransactionEntry } = await import('./bankTransacionEntry.action');
    const entryAmount = isPositive ? amount : -amount;
    const newBalance = bankResult.bank.currentBalance + entryAmount;

    const transactionEntry = await createBankTransactionEntry({
      portalId: 'manual',
      portalTransactionId: `manual-${Date.now()}`,
      bankId: bankId,
      bankName: bankResult.bank.bankName,
      bankAccountNumber: bankResult.bank.accountNumber,
      amount: entryAmount,
      transactionType: isPositive ? 'credit' : 'debit',
      balanceAfter: newBalance,
      transactionDate: new Date().toISOString(),
      status: 'processed',
      notes: description || `Manual ${transactionType} transaction`
    });

    if (!transactionEntry.success) {
      return {
        success: false,
        message: `Failed to create transaction record: ${transactionEntry.message}`
      };
    }

    // Update the bank balance  
    const result = await updateBankBalance(
      bankId,
      amount,
      true, // Update current balance  
      true, // Update available balance  
      isPositive
    );

    if (!result.success) {
      return {
        success: false,
        message: `Failed to update bank balance: ${result.message}`
      };
    }

    return {
      success: true,
      transactionType,
      amount,
      bankId: result.bankId,
      previousBalance: result.previousBalance,
      newBalance: result.newBalance,
      bank: result.updatedBank,
      transactionEntry: transactionEntry.entry
    };
  } catch (error) {
    console.error(`Error processing bank ${transactionType}:`, error);
    return {
      success: false,
      message: `Error processing ${transactionType}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**  
 * Delete a bank account  
 * @param bankId The ID of the bank account to delete  
 * @returns Object indicating success or failure  
 */
export async function deleteBank(bankId: string) {
  try {
    // First get the bank to verify it exists and to return its data  
    const bank = await dbManager.getDocument(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      bankId,
      'get-bank-before-delete'
    );

    if (!bank) {
      return {
        success: false,
        message: `Bank account not found: ${bankId}`
      };
    }

    // Delete the bank account  
    await dbManager.deleteDocument(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      bankId,
      'delete-bank-account'
    );

    // Return success with the deleted bank's information  
    return {
      success: true,
      message: "Bank account successfully deleted",
      deletedBank: {
        id: bank.$id,
        bankId: bank.bankId,
        bankName: bank.bankName,
        accountNumber: bank.accountNumber,
        ownerName: bank.ownerName
      }
    };
  } catch (error) {
    console.error("Error deleting bank account:", error);

    // Check if error is because the bank doesn't exist  
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes("Document not found")) {
      return {
        success: false,
        message: `Bank account not found: ${bankId}`
      };
    }

    // Otherwise return a generic error  
    return {
      success: false,
      message: "Failed to delete bank account",
      error: errorMessage
    };
  }
}

/**  
 * Delete a bank account with additional authorization check  
 * @param bankId The ID of the bank account to delete  
 * @param userId The ID of the user requesting deletion  
 * @returns Object indicating success or failure  
 */
export async function deleteBankWithAuth(bankId: string, userId: string) {
  try {
    // First get the bank to check ownership  
    const bank = await dbManager.getDocument(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      bankId,
      'get-bank-for-auth-delete'
    );

    if (!bank) {
      return {
        success: false,
        message: "Bank account not found"
      };
    }

    // Check if the user is authorized to delete this bank  
    if (bank.userId !== userId) {
      return {
        success: false,
        message: "Unauthorized: You don't have permission to delete this bank account"
      };
    }

    // Delete the bank account  
    await dbManager.deleteDocument(
      DATABASE_ID!,
      BANK_COLLECTION_ID!,
      bankId,
      'delete-bank-account-with-auth'
    );

    // Return success with the deleted bank's information  
    return {
      success: true,
      message: "Bank account successfully deleted",
      deletedBank: {
        id: bank.$id,
        bankId: bank.bankId,
        bankName: bank.bankName,
        accountNumber: bank.accountNumber,
        ownerName: bank.ownerName
      }
    };
  } catch (error) {
    console.error("Error deleting bank account:", error);
    return {
      success: false,
      message: "Failed to delete bank account",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Validate a bank account using VietQR API
 * @param accountNumber The bank account number to validate
 * @param bin The bank BIN code
 * @returns Validation result with account information if successful
 */
export async function validateBankAccount(accountNumber: string, bin: number) {
  try {
    const response = await axios.post<{
      code?: string;
      desc?: string;
      data?: {
        accountName: string;
        accountNumber?: string;
        bin?: number;
        bankShortName?: string;
      };
      status?: number;
      error?: string;
    }>('https://api.vietqr.io/v2/lookup', {
      accountNumber,
      bin
    }, {
      headers: {
        'x-client-id': 'f928265a-985e-4a86-a312-d80975b22b79',
        'x-api-key': '12e367e4-a0a9-4488-8183-06976e00c8cf',
        'Content-Type': 'application/json'
      }
    });

    // Handle success case - code "00"
    if (response.data && response.data.code === '00') {
      return {
        success: true,
        data: response.data.data || null,
        message: response.data.desc || 'Success'
      };
    }
    // Handle API error response - status 500
    else if (response.data && response.data.status === 500) {
      return {
        success: false,
        message: response.data.error || 'System interrupted. Sorry for the inconvenience.',
        errorCode: 'SYSTEM_ERROR',
        data: null
      };
    }
    // Handle validation error cases - code other than "00"
    else if (response.data && response.data.code) {
      return {
        success: false,
        message: response.data.desc || 'Validation failed',
        errorCode: response.data.code,
        data: null
      };
    }
    // Handle unexpected response format
    else {
      return {
        success: false,
        message: 'Unexpected response format from bank validation API',
        data: null
      };
    }
  } catch (error) {
    console.error("Error validating bank account:", error);
    return {
      success: false,
      message: `Error validating bank account: ${error instanceof Error ? error.message : String(error)}`,
      errorCode: 'NETWORK_ERROR',
      data: null
    };
  }
}