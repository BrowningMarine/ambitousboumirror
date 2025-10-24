"use server";

import { Query } from "node-appwrite";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { getReadyWithdrawUsers } from "./user.actions";
import { DatabaseOptimizer } from "@/lib/database-optimizer";

// Define the withdrawal data type
export interface WithdrawalData {
    $id: string;
    $createdAt: string;
    odrId: string;
    merchantOrdId: string;
    odrType: 'withdraw';
    odrStatus: 'pending' | 'processing' | 'completed' | 'canceled' | 'failed';
    amount: number;
    unPaidAmount: number;
    bankCode?: string;
    bankReceiveNumber?: string;
    bankReceiveOwnerName?: string;
    bankReceiveName?: string;
    qrCode?: string | null;
    createdIp?: string;
    isSuspicious?: boolean;
    users?: string;
}

// Define the response type for withdrawal operations
export interface WithdrawalResponse {
    success: boolean;
    message?: string;
    data?: WithdrawalData[];
    count?: number;
}

/**
 * Assign a withdrawal to a user using load balancing - WRITE OPERATION
 * Uses write-optimized client to avoid blocking read operations
 */
export async function assignWithdrawalToUser(withdrawalId: string): Promise<string | null> {
    try {
        // Get all users who are ready to handle withdrawals
        const readyUsers = await getReadyWithdrawUsers();
        
        // If no users are ready, return null
        if (!readyUsers || readyUsers.length === 0) {
            console.log("No users available for withdrawal assignment");
            return null;
        }
        
        // Use read-only client for querying user data (read operation)
        const readClient = await DatabaseOptimizer.getReadOnlyClient();
        
        // Create an array to store user load information
        const userLoads: { userId: string; userDocId: string; count: number }[] = [];
        
        // Fetch all user documents in one query
        const userDataBatch = await readClient.database.listDocuments(
            appwriteConfig.databaseId,
            appwriteConfig.userCollectionId,
            [Query.equal('userId', readyUsers)]
        );
        
        // Create a map of userId to document ID for quick lookups
        const userDocIdMap = new Map();
        userDataBatch.documents.forEach(doc => {
            if (doc.userId) {
                userDocIdMap.set(doc.userId, doc.$id);
            }
        });
        
        // Get the count of pending withdrawals for each ready user using cached data
        const promises = readyUsers.map(async (userId) => {
            try {
                const userDocId = userDocIdMap.get(userId);
                
                if (!userDocId) {
                    console.log(`No user document found for userId: ${userId}`);
                    return null;
                }
                
                // Use cached user data to avoid hitting database repeatedly
                const count = await DatabaseOptimizer.getCachedUserData(
                    userId,
                    'pending_withdrawals_count',
                    async () => {
                        const response = await readClient.database.listDocuments(
                            appwriteConfig.databaseId,
                            appwriteConfig.odrtransCollectionId,
                            [
                                Query.equal("odrType", "withdraw"),
                                Query.equal("odrStatus", "pending"),
                                Query.equal("users", [userDocId]),
                                Query.limit(1)
                            ]
                        );
                        return response.total;
                    }
                );
                
                return {
                    userId,
                    userDocId,
                    count
                };
                
            } catch (error) {
                console.error(`Error getting data for user ${userId}:`, error);
                return null;
            }
        });
        
        // Wait for all promises to resolve
        const results = await Promise.all(promises);
        
        // Filter out null results
        const validResults = results.filter(result => result !== null) as { userId: string; userDocId: string; count: number }[];
        
        // Add to userLoads
        userLoads.push(...validResults);
        
        // If no valid users were found, return null
        if (userLoads.length === 0) {
            console.log("No valid users found for assignment");
            return null;
        }
        
        // Sort users by their current load (ascending)
        userLoads.sort((a, b) => a.count - b.count);
        
        // Assign to the user with the lowest load
        const assignedUser = userLoads[0];
        
        console.log(`Attempting to assign withdrawal ${withdrawalId} to user ${assignedUser.userId} (doc: ${assignedUser.userDocId})`);
        
        // Use write-optimized client for the update operation
        await DatabaseOptimizer.executeWriteOperation(
            async (writeClient) => {
                const updatedDoc = await writeClient.database.updateDocument(
                    appwriteConfig.databaseId,
                    appwriteConfig.odrtransCollectionId,
                    withdrawalId,
                    {
                        users: assignedUser.userDocId
                    }
                );
                
                console.log(`Successfully updated withdrawal ${withdrawalId}, new users value: ${updatedDoc.users || 'update failed'}`);
                return updatedDoc;
            },
            {
                retryAttempts: 3,
                onSuccess: () => {
                    // Invalidate user cache after successful assignment
                    DatabaseOptimizer.invalidateUserCache(assignedUser.userId);
                    DatabaseOptimizer.invalidateStatsCache();
                },
                onError: (error) => {
                    console.error(`Database error when assigning withdrawal ${withdrawalId}:`, error);
                }
            }
        );
        
        return assignedUser.userId;
    } catch (error) {
        console.error("Error assigning withdrawal to user:", error);
        return null;
    }
}

/**
 * Fetch ALL unassigned pending withdrawal transactions - READ OPERATION
 * Used for bulk assignment operations
 */
export async function fetchAllUnassignedWithdrawals({
    transassistantId = null
}: {
    transassistantId?: string | null;
} = {}): Promise<WithdrawalResponse> {
    try {
        // Use read-only client for better performance
        const readClient = await DatabaseOptimizer.getReadOnlyClient();

        // Build query conditions
        const queries = [
            Query.equal("odrType", "withdraw"),
            Query.equal("odrStatus", "pending"),
            Query.isNull("users"), // Only unassigned withdrawals
            Query.orderAsc("$createdAt") // FIFO order
        ];

        // Add transassistant filter if specified
        if (transassistantId) {
            // For transassistants, we don't need to filter by users since they should see all unassigned
            // The transassistantId is used for permission checking, not data filtering for unassigned orders
        }

        // Fetch ALL unassigned withdrawals (no pagination limit)
        const response = await readClient.database.listDocuments(
            appwriteConfig.databaseId,
            appwriteConfig.odrtransCollectionId,
            queries
        );

        return {
            success: true,
            data: response.documents as unknown as WithdrawalData[],
            count: response.total
        };

    } catch (error) {
        console.error("Error fetching all unassigned withdrawals:", error);
        return {
            success: false,
            message: "Failed to fetch unassigned withdrawals"
        };
    }
}

/**
 * Fetch pending withdrawal transactions with pagination - READ OPERATION
 * Uses read-optimized client and caching for better performance
 */
export async function fetchPendingWithdrawals({
    page = 1,
    limit = 10,
    sortByCreatedAt = "asc",
    transassistantId = null
}: {
    page: number;
    limit: number;
    sortByCreatedAt?: "asc" | "desc";
    transassistantId?: string | null;
}): Promise<WithdrawalResponse> {
    try {
        // Use read-only client for better performance
        const readClient = await DatabaseOptimizer.getReadOnlyClient();

        // Calculate offset for pagination with validation
        const validPage = Math.max(1, parseInt(String(page)) || 1);
        const validLimit = Math.max(1, Math.min(parseInt(String(limit)) || 10, 100)); // Max 100 per page
        const offset = (validPage - 1) * validLimit;

        // Create cache key for this specific query
        const cacheKey = `withdrawals_${page}_${limit}_${sortByCreatedAt}_${transassistantId || 'all'}`;
        
        // Use longer cache TTL for first page (most commonly accessed) and shorter for others
        const cacheTTL = page === 1 ? 10000 : 5000; // 10 seconds for page 1, 5 seconds for others
        
        // Try to get data from cache first
        const cachedData = await DatabaseOptimizer.getCachedStats(
            cacheKey,
            async () => {
                // Optimize user document lookup with caching
                let userDocId: string | null = null;
                if (transassistantId) {
                    // Cache user document ID lookups to avoid repeated queries
                    const userCacheKey = `user_doc_id_${transassistantId}`;
                    userDocId = await DatabaseOptimizer.getCachedStats(
                        userCacheKey,
                        async () => {
                            try {
                                const userData = await readClient.database.listDocuments(
                                    appwriteConfig.databaseId,
                                    appwriteConfig.userCollectionId,
                                    [Query.equal('userId', [transassistantId])]
                                );
                                
                                if (!userData || userData.documents.length === 0) {
                                    console.log(`No user document found for userId: ${transassistantId}`);
                                    return null;
                                }
                                
                                return userData.documents[0].$id;
                            } catch (error) {
                                console.error(`Error getting document ID for user ${transassistantId}:`, error);
                                return null;
                            }
                        },
                        // Cache user document IDs for 5 minutes (they rarely change)
                        300000
                    );

                    if (!userDocId) {
                        return [];
                    }
                }

                // Build the query for pending withdrawals
                const queries = [
                    Query.equal("odrType", "withdraw"),
                    Query.equal("odrStatus", "pending"),
                    sortByCreatedAt === "asc"
                        ? Query.orderAsc("$createdAt")
                        : Query.orderDesc("$createdAt"),
                    Query.limit(validLimit),
                    Query.offset(offset)
                ];

                // Add filter by users field if userDocId was found
                if (userDocId) {
                    queries.push(Query.equal("users", userDocId));
                }

                // Fetch data using read-only client
                const response = await readClient.database.listDocuments(
                    appwriteConfig.databaseId,
                    appwriteConfig.odrtransCollectionId,
                    queries
                );

                // Map the response to extract only the fields we need for the UI
                return response.documents.map(doc => ({
                    $id: doc.$id,
                    $createdAt: doc.$createdAt,
                    odrId: doc.odrId,
                    merchantOrdId: doc.merchantOrdId || "",
                    odrType: doc.odrType,
                    odrStatus: doc.odrStatus,
                    amount: doc.amount,
                    unPaidAmount: doc.unPaidAmount,
                    bankCode: doc.bankCode,
                    bankReceiveNumber: doc.bankReceiveNumber,
                    bankReceiveOwnerName: doc.bankReceiveOwnerName,
                    bankReceiveName: doc.bankReceiveName,
                    qrCode: doc.qrCode,
                    createdIp: doc.createdIp,
                    isSuspicious: doc.isSuspicious,
                    users: doc.users
                }));
            },
            cacheTTL
        );

        return {
            success: true,
            data: cachedData as WithdrawalData[]
        };
    } catch (error) {
        console.error("Error fetching pending withdrawals:", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "Unknown error occurred"
        };
    }
}

/**
 * Get the total count of pending withdrawal transactions - READ OPERATION
 * Uses read-optimized client and longer caching since count changes less frequently
 */
export async function getWithdrawalsTotalCount(transassistantId: string | null = null): Promise<WithdrawalResponse> {
    try {
        // Use read-only client for better performance
        const readClient = await DatabaseOptimizer.getReadOnlyClient();

        // Create cache key for the count query
        const countCacheKey = `withdrawals_count_${transassistantId || 'all'}`;
        
        // Use longer cache TTL for count (20 seconds) since it changes less frequently
        const count = await DatabaseOptimizer.getCachedStats(
            countCacheKey,
            async () => {
                // Reuse cached user document ID if available
                let userDocId: string | null = null;
                if (transassistantId) {
                    // Try to get from cache first
                    const userCacheKey = `user_doc_id_${transassistantId}`;
                    userDocId = await DatabaseOptimizer.getCachedStats(
                        userCacheKey,
                        async () => {
                            try {
                                const userData = await readClient.database.listDocuments(
                                    appwriteConfig.databaseId,
                                    appwriteConfig.userCollectionId,
                                    [Query.equal('userId', [transassistantId])]
                                );
                                
                                if (!userData || userData.documents.length === 0) {
                                    console.log(`No user document found for userId: ${transassistantId}`);
                                    return null;
                                }
                                
                                return userData.documents[0].$id;
                            } catch (error) {
                                console.error(`Error getting document ID for user ${transassistantId}:`, error);
                                return null;
                            }
                        },
                        // Cache user document IDs for 5 minutes (they rarely change)
                        300000
                    );

                    if (!userDocId) {
                        return 0;
                    }
                }

                // Build query to get the count
                const queries = [
                    Query.equal("odrType", "withdraw"),
                    Query.equal("odrStatus", "pending"),
                    Query.limit(1)
                ];

                // Add filter by users field if userDocId was found
                if (userDocId) {
                    queries.push(Query.equal("users", userDocId));
                }

                // Query to get the count using read-only client
                const response = await readClient.database.listDocuments(
                    appwriteConfig.databaseId,
                    appwriteConfig.odrtransCollectionId,
                    queries
                );

                return response.total;
            },
            // Longer cache TTL (15 seconds) for count queries
            15000
        );

        return {
            success: true,
            count: count as number
        };
    } catch (error) {
        console.error("Error getting withdrawals count:", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "Unknown error occurred",
            count: 0
        };
    }
}

/**
 * Fetch single pending withdrawal transaction - OPTIMIZED FOR REAL-TIME
 * No caching, direct database query for immediate results
 * Perfect for single transaction workflows with frequent updates (< 5 seconds)
 */
export async function fetchSinglePendingWithdrawal({
    sortByCreatedAt = "asc",
    transassistantId = null
}: {
    sortByCreatedAt?: "asc" | "desc";
    transassistantId?: string | null;
}): Promise<WithdrawalResponse> {
    try {
        // Use read-only client for better performance (but no caching)
        const readClient = await DatabaseOptimizer.getReadOnlyClient();

        let userDocId: string | null = null;
        
        // Direct user lookup without caching for real-time accuracy
        if (transassistantId) {
            try {
                const userData = await readClient.database.listDocuments(
                    appwriteConfig.databaseId,
                    appwriteConfig.userCollectionId,
                    [Query.equal('userId', [transassistantId])]
                );
                
                if (!userData || userData.documents.length === 0) {
                    console.log(`No user document found for userId: ${transassistantId}`);
                    return {
                        success: true,
                        data: []
                    };
                }
                
                userDocId = userData.documents[0].$id;
            } catch (error) {
                console.error(`Error getting document ID for user ${transassistantId}:`, error);
                return {
                    success: false,
                    message: "Failed to get user information"
                };
            }
        }

        // Build optimized query for single transaction
        const queries = [
            Query.equal("odrType", "withdraw"),
            Query.equal("odrStatus", "pending"),
            sortByCreatedAt === "asc"
                ? Query.orderAsc("$createdAt")
                : Query.orderDesc("$createdAt"),
            Query.limit(1) // Only fetch 1 transaction
        ];

        // Add user filter if needed
        if (userDocId) {
            queries.push(Query.equal("users", userDocId));
        }

        // Direct database query without caching
        const response = await readClient.database.listDocuments(
            appwriteConfig.databaseId,
            appwriteConfig.odrtransCollectionId,
            queries
        );

        // Return minimal data structure for single transaction
        const data = response.documents.length > 0 ? [{
            $id: response.documents[0].$id,
            $createdAt: response.documents[0].$createdAt,
            odrId: response.documents[0].odrId,
            merchantOrdId: response.documents[0].merchantOrdId || "",
            odrType: response.documents[0].odrType,
            odrStatus: response.documents[0].odrStatus,
            amount: response.documents[0].amount,
            unPaidAmount: response.documents[0].unPaidAmount,
            bankCode: response.documents[0].bankCode,
            bankReceiveNumber: response.documents[0].bankReceiveNumber,
            bankReceiveOwnerName: response.documents[0].bankReceiveOwnerName,
            bankReceiveName: response.documents[0].bankReceiveName,
            qrCode: response.documents[0].qrCode,
            createdIp: response.documents[0].createdIp,
            isSuspicious: response.documents[0].isSuspicious,
            users: response.documents[0].users
        }] : [];

        return {
            success: true,
            data: data as WithdrawalData[]
        };
    } catch (error) {
        console.error("Error fetching single pending withdrawal:", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "Unknown error occurred"
        };
    }
}

/**
 * Get the total count of suspicious pending withdrawal transactions - READ OPERATION
 * Uses read-optimized client and caching for better performance
 */
export async function getSuspiciousWithdrawalsCount(transassistantId: string | null = null): Promise<WithdrawalResponse> {
    try {
        // Use read-only client for better performance
        const readClient = await DatabaseOptimizer.getReadOnlyClient();

        // Create cache key for the suspicious count query
        const countCacheKey = `suspicious_withdrawals_count_${transassistantId || 'all'}`;
        
        // Use shorter cache TTL for suspicious count (10 seconds) since security status can change quickly
        const count = await DatabaseOptimizer.getCachedStats(
            countCacheKey,
            async () => {
                // Reuse cached user document ID if available
                let userDocId: string | null = null;
                if (transassistantId) {
                    // Try to get from cache first
                    const userCacheKey = `user_doc_id_${transassistantId}`;
                    userDocId = await DatabaseOptimizer.getCachedStats(
                        userCacheKey,
                        async () => {
                            try {
                                const userData = await readClient.database.listDocuments(
                                    appwriteConfig.databaseId,
                                    appwriteConfig.userCollectionId,
                                    [Query.equal('userId', [transassistantId])]
                                );
                                
                                if (!userData || userData.documents.length === 0) {
                                    console.log(`No user document found for userId: ${transassistantId}`);
                                    return null;
                                }
                                
                                return userData.documents[0].$id;
                            } catch (error) {
                                console.error(`Error getting document ID for user ${transassistantId}:`, error);
                                return null;
                            }
                        },
                        // Cache user document IDs for 5 minutes (they rarely change)
                        300000
                    );

                    if (!userDocId) {
                        return 0;
                    }
                }

                // Build query to get the suspicious transactions count
                const queries = [
                    Query.equal("odrType", "withdraw"),
                    Query.equal("odrStatus", "pending"),
                    Query.equal("isSuspicious", true), // Only suspicious transactions
                    Query.limit(1)
                ];

                // Add filter by users field if userDocId was found
                if (userDocId) {
                    queries.push(Query.equal("users", userDocId));
                }

                // Query to get the count using read-only client
                const response = await readClient.database.listDocuments(
                    appwriteConfig.databaseId,
                    appwriteConfig.odrtransCollectionId,
                    queries
                );

                return response.total;
            },
            // Shorter cache TTL (10 seconds) for suspicious count queries
            10000
        );

        return {
            success: true,
            count: count as number
        };
    } catch (error) {
        console.error("Error getting suspicious withdrawals count:", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "Unknown error occurred",
            count: 0
        };
    }
}

/**
 * Fetch single transaction with counts in one operation - OPTIMIZED FOR REAL-TIME
 * Gets single transaction + total count + suspicious count in parallel
 * Perfect for single transaction workflows with dashboard stats
 */
export async function fetchSingleWithdrawalWithCounts({
    sortByCreatedAt = "asc",
    transassistantId = null
}: {
    sortByCreatedAt?: "asc" | "desc";
    transassistantId?: string | null;
}): Promise<{
    success: boolean;
    message?: string;
    data?: WithdrawalData[];
    totalCount?: number;
    suspiciousCount?: number;
    completedTodayCount?: number;
}> {
    try {
        // Use read-only client for better performance
        const readClient = await DatabaseOptimizer.getReadOnlyClient();

        let userDocId: string | null = null;
        
        // Direct user lookup without caching for real-time accuracy
        if (transassistantId) {
            try {
                const userData = await readClient.database.listDocuments(
                    appwriteConfig.databaseId,
                    appwriteConfig.userCollectionId,
                    [Query.equal('userId', [transassistantId])]
                );
                
                if (!userData || userData.documents.length === 0) {
                    console.log(`No user document found for userId: ${transassistantId}`);
                    return {
                        success: true,
                        data: [],
                        totalCount: 0,
                        suspiciousCount: 0
                    };
                }
                
                userDocId = userData.documents[0].$id;
            } catch (error) {
                console.error(`Error getting document ID for user ${transassistantId}:`, error);
                return {
                    success: false,
                    message: "Failed to get user information"
                };
            }
        }

        // Build base queries
        const baseQueries = [
            Query.equal("odrType", "withdraw"),
            Query.equal("odrStatus", "pending")
        ];

        // Add user filter if needed
        if (userDocId) {
            baseQueries.push(Query.equal("users", userDocId));
        }

        // Execute all queries in parallel for maximum performance
        const [singleTransactionResponse, totalCountResponse, suspiciousCountResponse, completedTodayResponse] = await Promise.all([
            // Query 1: Get single transaction
            readClient.database.listDocuments(
                appwriteConfig.databaseId,
                appwriteConfig.odrtransCollectionId,
                [
                    ...baseQueries,
                    sortByCreatedAt === "asc"
                        ? Query.orderAsc("$createdAt")
                        : Query.orderDesc("$createdAt"),
                    Query.limit(1)
                ]
            ),
            
            // Query 2: Get total count
            readClient.database.listDocuments(
                appwriteConfig.databaseId,
                appwriteConfig.odrtransCollectionId,
                [
                    ...baseQueries,
                    Query.limit(1) // We only need the total count
                ]
            ),
            
            // Query 3: Get suspicious count
            readClient.database.listDocuments(
                appwriteConfig.databaseId,
                appwriteConfig.odrtransCollectionId,
                [
                    ...baseQueries,
                    Query.equal("isSuspicious", true),
                    Query.limit(1) // We only need the total count
                ]
            ),
            
            // Query 4: Get completed today count
            (() => {
                // Calculate today's date range
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const todayEnd = new Date();
                todayEnd.setHours(23, 59, 59, 999);

                return readClient.database.listDocuments(
                    appwriteConfig.databaseId,
                    appwriteConfig.odrtransCollectionId,
                    [
                        Query.equal("odrType", "withdraw"),
                        Query.equal("odrStatus", "completed"),
                        Query.greaterThanEqual("$updatedAt", todayStart.toISOString()),
                        Query.lessThanEqual("$updatedAt", todayEnd.toISOString()),
                        ...(userDocId ? [Query.equal("users", userDocId)] : []),
                        Query.limit(1) // We only need the total count
                    ]
                );
            })()
        ]);

        // Process single transaction data
        const data = singleTransactionResponse.documents.length > 0 ? [{
            $id: singleTransactionResponse.documents[0].$id,
            $createdAt: singleTransactionResponse.documents[0].$createdAt,
            odrId: singleTransactionResponse.documents[0].odrId,
            merchantOrdId: singleTransactionResponse.documents[0].merchantOrdId || "",
            odrType: singleTransactionResponse.documents[0].odrType,
            odrStatus: singleTransactionResponse.documents[0].odrStatus,
            amount: singleTransactionResponse.documents[0].amount,
            unPaidAmount: singleTransactionResponse.documents[0].unPaidAmount,
            bankCode: singleTransactionResponse.documents[0].bankCode,
            bankReceiveNumber: singleTransactionResponse.documents[0].bankReceiveNumber,
            bankReceiveOwnerName: singleTransactionResponse.documents[0].bankReceiveOwnerName,
            bankReceiveName: singleTransactionResponse.documents[0].bankReceiveName,
            qrCode: singleTransactionResponse.documents[0].qrCode,
            createdIp: singleTransactionResponse.documents[0].createdIp,
            isSuspicious: singleTransactionResponse.documents[0].isSuspicious,
            users: singleTransactionResponse.documents[0].users
        }] : [];

        return {
            success: true,
            data: data as WithdrawalData[],
            totalCount: totalCountResponse.total,
            suspiciousCount: suspiciousCountResponse.total,
            completedTodayCount: completedTodayResponse.total
        };
    } catch (error) {
        console.error("Error fetching single withdrawal with counts:", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "Unknown error occurred"
        };
    }
}

/**
 * Get the count of completed withdrawal transactions for today - READ OPERATION
 * Uses read-optimized client and caching for better performance
 */
export async function getCompletedTodayCount(transassistantId: string | null = null): Promise<WithdrawalResponse> {
    try {
        // Use read-only client for better performance
        const readClient = await DatabaseOptimizer.getReadOnlyClient();

        // Create cache key for today's completed count query
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
        const countCacheKey = `completed_today_count_${today}_${transassistantId || 'all'}`;
        
        // Use moderate cache TTL for completed count (30 seconds) since it updates throughout the day
        const count = await DatabaseOptimizer.getCachedStats(
            countCacheKey,
            async () => {
                // Reuse cached user document ID if available
                let userDocId: string | null = null;
                if (transassistantId) {
                    // Try to get from cache first
                    const userCacheKey = `user_doc_id_${transassistantId}`;
                    userDocId = await DatabaseOptimizer.getCachedStats(
                        userCacheKey,
                        async () => {
                            try {
                                const userData = await readClient.database.listDocuments(
                                    appwriteConfig.databaseId,
                                    appwriteConfig.userCollectionId,
                                    [Query.equal('userId', [transassistantId])]
                                );
                                
                                if (!userData || userData.documents.length === 0) {
                                    console.log(`No user document found for userId: ${transassistantId}`);
                                    return null;
                                }
                                
                                return userData.documents[0].$id;
                            } catch (error) {
                                console.error(`Error getting document ID for user ${transassistantId}:`, error);
                                return null;
                            }
                        },
                        // Cache user document IDs for 5 minutes (they rarely change)
                        300000
                    );

                    if (!userDocId) {
                        return 0;
                    }
                }

                // Calculate today's date range
                const todayStart = new Date();
                todayStart.setHours(0, 0, 0, 0);
                const todayEnd = new Date();
                todayEnd.setHours(23, 59, 59, 999);

                // Build query to get today's completed transactions count
                const queries = [
                    Query.equal("odrType", "withdraw"),
                    Query.equal("odrStatus", "completed"),
                    Query.greaterThanEqual("$updatedAt", todayStart.toISOString()),
                    Query.lessThanEqual("$updatedAt", todayEnd.toISOString()),
                    Query.limit(1)
                ];

                // Add filter by users field if userDocId was found
                if (userDocId) {
                    queries.push(Query.equal("users", userDocId));
                }

                // Query to get the count using read-only client
                const response = await readClient.database.listDocuments(
                    appwriteConfig.databaseId,
                    appwriteConfig.odrtransCollectionId,
                    queries
                );

                return response.total;
            },
            // Cache for 30 seconds (balance between freshness and performance)
            30000
        );

        return {
            success: true,
            count: count as number
        };
    } catch (error) {
        console.error("Error getting completed today count:", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "Unknown error occurred",
            count: 0
        };
    }
}

/**
 * Fast fetch single withdrawal - optimized for speed, no counts
 * Used when we only need the next transaction immediately after status update
 */
export async function fetchNextWithdrawalFast({
    sortByCreatedAt = "asc",
    transassistantId = null,
    cachedUserDocId = null
}: {
    sortByCreatedAt?: "asc" | "desc";
    transassistantId?: string | null;
    cachedUserDocId?: string | null;
}): Promise<{
    success: boolean;
    message?: string;
    data?: WithdrawalData[];
    userDocId?: string | null; // Return user doc ID for caching
}> {
    try {
        // Use read-only client for better performance
        const readClient = await DatabaseOptimizer.getReadOnlyClient();

        let userDocId: string | null = cachedUserDocId;
        
        // Only lookup user if not cached and needed
        if (transassistantId && !userDocId) {
            console.log("[Fast] User doc ID not cached, performing lookup...");
            try {
                const userData = await readClient.database.listDocuments(
                    appwriteConfig.databaseId,
                    appwriteConfig.userCollectionId,
                    [Query.equal('userId', [transassistantId])]
                );
                
                if (!userData || userData.documents.length === 0) {
                    console.log(`No user document found for userId: ${transassistantId}`);
                    return {
                        success: true,
                        data: [],
                        userDocId: null
                    };
                }
                
                userDocId = userData.documents[0].$id;
                console.log("[Fast] User doc ID lookup completed and will be cached");
            } catch (error) {
                console.error(`Error getting document ID for user ${transassistantId}:`, error);
                return {
                    success: false,
                    message: "Failed to get user information",
                    userDocId: null
                };
            }
        } else if (cachedUserDocId) {
            console.log("[Fast] Using cached user doc ID - no lookup needed!");
        }

        // Build minimal query - only what we need
        const queries = [
            Query.equal("odrType", "withdraw"),
            Query.equal("odrStatus", "pending"),
            sortByCreatedAt === "asc"
                ? Query.orderAsc("$createdAt")
                : Query.orderDesc("$createdAt"),
            Query.limit(1)
        ];

        // Add user filter if needed
        if (userDocId) {
            queries.push(Query.equal("users", userDocId));
        }

        // Single fast query
        console.log("[Fast] Executing single optimized database query...");
        const response = await readClient.database.listDocuments(
            appwriteConfig.databaseId,
            appwriteConfig.odrtransCollectionId,
            queries
        );
        console.log("[Fast] Database query completed");

        // Process data
        const data = response.documents.length > 0 ? [{
            $id: response.documents[0].$id,
            $createdAt: response.documents[0].$createdAt,
            odrId: response.documents[0].odrId,
            merchantOrdId: response.documents[0].merchantOrdId || "",
            odrType: response.documents[0].odrType,
            odrStatus: response.documents[0].odrStatus,
            amount: response.documents[0].amount,
            unPaidAmount: response.documents[0].unPaidAmount,
            bankCode: response.documents[0].bankCode,
            bankReceiveNumber: response.documents[0].bankReceiveNumber,
            bankReceiveOwnerName: response.documents[0].bankReceiveOwnerName,
            bankReceiveName: response.documents[0].bankReceiveName,
            qrCode: response.documents[0].qrCode,
            createdIp: response.documents[0].createdIp,
            isSuspicious: response.documents[0].isSuspicious,
            users: response.documents[0].users
        }] : [];

        return {
            success: true,
            data: data as WithdrawalData[],
            userDocId: userDocId // Return for caching
        };
    } catch (error) {
        console.error("Error fetching next withdrawal fast:", error);
        return {
            success: false,
            message: error instanceof Error ? error.message : "Unknown error occurred",
            userDocId: null
        };
    }
} 