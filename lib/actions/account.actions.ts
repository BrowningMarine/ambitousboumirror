'use server';

import { ID, Query } from "appwrite";
import { appwriteConfig } from "../appwrite/appwrite-config";
import { createAdminClient } from "../appwrite/appwrite.actions";
import { parseStringify } from "../utils";
import { Account, AccountUpdateParams } from "@/types";

const DATABASE_ID = appwriteConfig.databaseId;
const ACCOUNT_COLLECTION_ID = appwriteConfig.accountsCollectionId;

// Get all accounts (for admin) with pagination support  
export const getAllAccounts = async (page: number = 1, limit: number = 10) => {
  try {
    const { database } = await createAdminClient();

    // Calculate offset for pagination
    const offset = (page - 1) * limit;

    // Get total count using the smallest valid limit (1)
    const totalQuery = await database.listDocuments(
      DATABASE_ID!,
      ACCOUNT_COLLECTION_ID!,
      [Query.limit(1)]
    );

    // Then get paginated results
    const accounts = await database.listDocuments(
      DATABASE_ID!,
      ACCOUNT_COLLECTION_ID!,
      [
        Query.orderDesc("$createdAt"),
        Query.limit(limit),
        Query.offset(offset)
      ]
    );

    // Add total to the results for pagination info
    const result = parseStringify(accounts);
    result.total = totalQuery.total;
    result.page = page;
    result.limit = limit;

    return result;
  } catch (error) {
    console.error("Error fetching all accounts:", error);
    return { documents: [], total: 0, page: page, limit: limit };
  }
};

export const getAccountsByUserId = async ({ userId }: { userId: string }) => {
  try {
    const { database } = await createAdminClient();

    // Use the Query.or operator correctly  
    const accounts = await database.listDocuments(
      DATABASE_ID!,
      ACCOUNT_COLLECTION_ID!,
      [
        Query.equal('users', [userId])
      ]
    );

    return parseStringify(accounts);
  } catch (error) {
    console.error("Error fetching user accounts:", error);
    return { documents: [] };
  }
};

export const getAccountsByUserRole = async (
  userId: string,
  userRole: string,
  page?: number,
  limit?: number
) => {
  try {
    // If page and limit are provided, use them for pagination
    const usePagination = typeof page === 'number' && typeof limit === 'number';

    // If admin and using pagination, return paginated accounts
    if (userRole === 'admin' && usePagination) {
      return await getAllAccounts(page, limit);
    }
    // If admin without pagination, return all accounts (backward compatibility)
    else if (userRole === 'admin') {
      return await getAllAccounts();
    }

    // Initialize queries array  
    let queries = [];

    // Build queries based on role  
    if (userRole === 'transactor') {
      queries = [
        Query.or([
          Query.equal('users', [userId]),
          Query.equal('referenceUserId', [userId])
        ])
      ];
    } else if (userRole === 'merchant') {
      queries = [
        Query.equal('users', [userId])
      ];
    } else {
      // For unknown roles, return empty result  
      return { documents: [], total: 0 };
    }

    const { database } = await createAdminClient();

    // First get total count with the role filter but without pagination
    const totalQuery = await database.listDocuments(
      DATABASE_ID!,
      ACCOUNT_COLLECTION_ID!,
      queries
    );

    // If using pagination, add pagination params to the query
    if (usePagination) {
      const offset = (page! - 1) * limit!;
      queries.push(Query.orderDesc("$createdAt"));
      queries.push(Query.limit(limit!));
      queries.push(Query.offset(offset));
    }

    // Get the paginated results
    const accounts = await database.listDocuments(
      DATABASE_ID!,
      ACCOUNT_COLLECTION_ID!,
      queries
    );

    // Prepare the result
    const result = parseStringify(accounts);

    // If using pagination, add pagination info
    if (usePagination) {
      result.total = totalQuery.total;
      result.page = page;
      result.limit = limit;
    }

    return result;
  } catch (error) {
    console.error("Error fetching user accounts:", error);
    // Return consistent format even in error case
    return { documents: [], total: 0 };
  }
};

// Get a single account by ID 
export const getAccount = async (accountId: string) => {
  try {
    const { database } = await createAdminClient();
    const accounts = await database.listDocuments(
      DATABASE_ID!,
      ACCOUNT_COLLECTION_ID!,
      [Query.equal('publicTransactionId', [accountId])]
    );

    if (accounts.total === 0) {
      return null;
    }

    return parseStringify(accounts.documents[0]);
  } catch (error) {
    console.error("Error fetching account:", error);
    return null;
  }
};

export const getAccountById = async (id: string) => {
  try {
    const { database } = await createAdminClient();
    const account = await database.getDocument(
      DATABASE_ID!,
      ACCOUNT_COLLECTION_ID!,
      id
    );

    if (!account) {
      return null;
    }

    return parseStringify(account);
  } catch (error) {
    console.error("Error fetching account:", error);
    return null;
  }
};

export const createAccount = async (accountData: {
  accountName: string;
  userId: string;
  publicTransactionId: string;
  status?: boolean;
  apiKey?: string;
  avaiableBalance?: number;
  currentBalance?: number;
}) => {
  try {
    const { database } = await createAdminClient();

    // Format the data for Appwrite  
    const newAccountData = {
      accountId: ID.unique(),
      publicTransactionId: accountData.publicTransactionId,
      accountName: accountData.accountName,
      avaiableBalance: accountData.avaiableBalance || 0,
      currentBalance: accountData.currentBalance || 0,
      users: accountData.userId, // This is the relationship field  
      status: accountData.status || false,
      apiKey: accountData.apiKey || ''
    };

    //console.log('Creating new account with data:', newAccountData);  

    const newAccount = await database.createDocument(
      DATABASE_ID!,
      ACCOUNT_COLLECTION_ID!,
      ID.unique(),
      newAccountData
    );

    //console.log('Account created successfully:', newAccount.$id);  

    return parseStringify(newAccount);
  } catch (error) {
    console.error('Error creating account:', error);
    throw error; // Re-throw to allow handling in the form component  
  }
};

// Update an existing account  
export const updateAccount = async (
  documentId: string,
  updateData: Omit<AccountUpdateParams, 'accountId'>
): Promise<Account | null> => {
  try {
    const { database } = await createAdminClient();
    console.log('Updating account with documentId:', documentId);
    const updatedAccount = await database.updateDocument(
      DATABASE_ID!,
      ACCOUNT_COLLECTION_ID!,
      documentId,
      updateData
    );

    if (!updatedAccount) {
      throw new Error('Failed to update account');
    }

    return parseStringify(updatedAccount) as Account;
  } catch (error) {
    console.error('Error updating account:', error);
    return null;
  }
};

export async function updateAccountBalance(
  accountId: string,  // This should now be publicTransactionId  
  amount: number,
  isUpdateCurrentBalance: boolean,
  isUpdateAvaiableBalance: boolean,
  isPositive: boolean
) {
  // CRITICAL: Retry logic for handling concurrent balance updates
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 100; // Start with 100ms
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { database } = await createAdminClient();

      // First find the account by publicTransactionId  
      const accountsQuery = await database.listDocuments(
        DATABASE_ID,
        ACCOUNT_COLLECTION_ID,
        [Query.equal("publicTransactionId", [accountId])]
      );

      if (accountsQuery.total === 0) {
        throw new Error(`Account not found with publicTransactionId: ${accountId}`);
      }

      // Get the first matching account  
      const account = accountsQuery.documents[0];
      
      // CRITICAL: Store original values for optimistic locking verification
      const originalAvailableBalance = Number(account.avaiableBalance || 0);
      const originalCurrentBalance = Number(account.currentBalance || 0);

      // Initialize with current values  
      let newCurrentBalance = originalCurrentBalance;
      let newAvailableBalance = originalAvailableBalance;

      // Update the balances based on parameters  
      if (isUpdateCurrentBalance) {
        if (isPositive) {
          // For deposits, add the amount  
          newCurrentBalance += amount;
        } else {
          // For withdrawals, subtract the amount  
          newCurrentBalance -= amount;
        }
      }

      if (isUpdateAvaiableBalance) {
        if (isPositive) {
          // For deposits, add the amount  
          newAvailableBalance += amount;
        } else {
          // For withdrawals, subtract the amount (allows negative balance)
          newAvailableBalance -= amount;
        }
      }

      // Prepare update data based on what needs to be updated  
      const updateData: { avaiableBalance?: number; currentBalance?: number } = {};

      if (isUpdateAvaiableBalance) {
        updateData.avaiableBalance = newAvailableBalance;
      }

      if (isUpdateCurrentBalance) {
        updateData.currentBalance = newCurrentBalance;
      }

      // Update the account if there's anything to update  
      if (Object.keys(updateData).length > 0) {
        // CRITICAL: Verify balance hasn't changed since we read it (optimistic locking)
        // Re-fetch to check if concurrent update occurred
        const verifyQuery = await database.listDocuments(
          DATABASE_ID,
          ACCOUNT_COLLECTION_ID,
          [Query.equal("publicTransactionId", [accountId])]
        );
        
        const currentAccount = verifyQuery.documents[0];
        const currentAvailable = Number(currentAccount.avaiableBalance || 0);
        const currentCurrent = Number(currentAccount.currentBalance || 0);
        
        // Check if values changed (concurrent update detected)
        if (currentAvailable !== originalAvailableBalance || currentCurrent !== originalCurrentBalance) {
          // Retry with exponential backoff
          if (attempt < MAX_RETRIES) {
            const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1); // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, delay));
            continue; // Retry the entire operation
          } else {
            throw new Error(`Balance update conflict after ${MAX_RETRIES} retries - concurrent modification detected`);
          }
        }
        
        const updatedAccount = await database.updateDocument(
          DATABASE_ID,
          ACCOUNT_COLLECTION_ID,
          account.$id, // Use the document ID for the update  
          updateData
        );

        return {
          success: true,
          accountId: accountId, // Return the publicTransactionId used  
          documentId: account.$id, // Also return the document ID for reference  
          previousBalance: {
            available: originalAvailableBalance,
            current: originalCurrentBalance
          },
          newBalance: {
            available: isUpdateAvaiableBalance ? newAvailableBalance : originalAvailableBalance,
            current: isUpdateCurrentBalance ? newCurrentBalance : originalCurrentBalance
          },
          account: updatedAccount,
          retryAttempt: attempt // Track how many retries were needed
        };
      } else {
        // If nothing was updated, just return the current state  
        return {
          success: true,
          message: "No balance updates were requested",
          accountId: accountId,
          documentId: account.$id,
          previousBalance: {
            available: originalAvailableBalance,
            current: originalCurrentBalance
          },
          newBalance: {
            available: originalAvailableBalance,
            current: originalCurrentBalance
          },
          account: account,
          retryAttempt: attempt
        };
      }
    } catch (error) {
      // If this is the last retry or a non-retryable error (account not found), throw it
      if (attempt === MAX_RETRIES || 
          (error instanceof Error && error.message.includes('not found'))) {
        console.error(`Error updating account balance (attempt ${attempt}/${MAX_RETRIES}):`, error);
        return {
          success: false,
          message: error instanceof Error ? error.message : "Unknown error updating account balance",
          accountId: accountId,
          retryAttempt: attempt
        };
      }
      
      // Otherwise, retry with backoff
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // Should never reach here, but TypeScript needs it
  return {
    success: false,
    message: "Unexpected error: retry loop completed without return",
    accountId: accountId
  };
}

// Delete an account  
export const deleteAccount = async (accountId: string): Promise<boolean> => {
  try {
    const { database } = await createAdminClient();

    // Delete the account document  
    await database.deleteDocument(
      appwriteConfig.databaseId,
      appwriteConfig.accountsCollectionId,
      accountId
    );

    return true;
  } catch (error) {
    console.error("Error deleting account:", error);
    throw new Error("Failed to delete account");
  }
};