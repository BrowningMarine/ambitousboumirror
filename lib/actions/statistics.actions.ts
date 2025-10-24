'use server';

import { ID, Query } from "appwrite";
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { DatabaseOptimizer } from "@/lib/database-optimizer";
import { getEndOfDayUTC, getStartOfDayUTC } from "../utils";

const DATABASE_ID = appwriteConfig.databaseId;
const ODRTRANS_COLLECTION_ID = appwriteConfig.odrtransCollectionId;
const STATISTICS_COLLECTION_ID = appwriteConfig.statisticsCollectionId;



interface DailyStatistics {
    recDate: string; // YYYY-MM-DD format
    totalOrder: number;
    totalAmount: number;
    completedDepositOrder: number;
    completedDepositAmount: number;
    completedWithdrawOrder: number;
    completedWithdrawAmount: number;
    failedDepositOrder: number;
    failedDepositAmount: number;
    failedWithdrawOrder: number;
    failedWithdrawAmount: number;
    pendingOrder: number;
    pendingAmount: number;
    averageProcessedTime: number;
}

// Helper function to safely convert Appwrite objects to plain objects
function toPlainObject<T>(obj: unknown): T {
    if (!obj) return null as unknown as T;

    try {
        // For arrays, map each item
        if (Array.isArray(obj)) {
            return obj.map(item => toPlainObject(item)) as unknown as T;
        }

        // For objects, create a new plain object
        if (typeof obj === 'object' && obj !== null) {
            const plainObj: Record<string, unknown> = {};

            // Only copy own properties
            for (const key in obj) {
                if (Object.prototype.hasOwnProperty.call(obj, key)) {
                    plainObj[key] = toPlainObject((obj as Record<string, unknown>)[key]);
                }
            }

            return plainObj as unknown as T;
        }

        // Return primitive values as is
        return obj as unknown as T;
    } catch (error) {
        console.error("Error converting to plain object:", error);
        return null as unknown as T;
    }
}

// Optimized statistics calculation using database aggregation
export async function calculateDailyStatistics(date?: Date) {
    const startTime = Date.now();
    
    try {
        // Use write client for statistics operations
        const { database } = await DatabaseOptimizer.getWriteClient();

        // Default to yesterday if no date provided
        const targetDate = date || new Date();
        targetDate.setUTCHours(0, 0, 0, 0);

        console.log("📊 Calculating statistics for:", targetDate);

        // Format date as YYYY-MM-DD for storage
        const dateString = targetDate.toISOString().split('T')[0];

        // Create date range for the entire day
        const startOfDay = new Date(targetDate);
        startOfDay.setUTCHours(0, 0, 0, 0);

        const endOfDay = new Date(targetDate);
        endOfDay.setUTCHours(23, 59, 59, 999);

        // Use parallel counting and processing time calculation
        const [
            totalCount,
            depositCompletedCount,
            depositFailedCount,
            depositPendingCount,
            withdrawCompletedCount,
            withdrawFailedCount,
            withdrawPendingCount,
            processingTimeData
        ] = await Promise.all([
            // Count total orders using pagination
            countTotalDocuments(database, startOfDay, endOfDay),
            
            // Count completed deposits using pagination
            countDocumentsByTypeAndStatus(database, startOfDay, endOfDay, "deposit", "completed"),
            
            // Count failed deposits using pagination
            countDocumentsByTypeAndStatus(database, startOfDay, endOfDay, "deposit", "failed"),
            
            // Count pending deposits using pagination
            countDocumentsByTypeAndStatus(database, startOfDay, endOfDay, "deposit", "pending"),
            
            // Count completed withdrawals using pagination
            countDocumentsByTypeAndStatus(database, startOfDay, endOfDay, "withdraw", "completed"),
            
            // Count failed withdrawals using pagination
            countDocumentsByTypeAndStatus(database, startOfDay, endOfDay, "withdraw", "failed"),
            
            // Count pending withdrawals using pagination
            countDocumentsByTypeAndStatus(database, startOfDay, endOfDay, "withdraw", "pending"),
            
            // Get completed transactions for processing time calculation (limited sample)
            database.listDocuments(DATABASE_ID, ODRTRANS_COLLECTION_ID, [
                Query.greaterThanEqual("$createdAt", getStartOfDayUTC(dateString)),
                Query.lessThanEqual("$createdAt", getEndOfDayUTC(dateString)),
                Query.equal("odrStatus", "completed"),
                Query.select(["$createdAt", "$updatedAt"]),
                Query.limit(1000)
            ])
        ]);

        console.log("📈 Database aggregation completed in:", Date.now() - startTime, "ms");

        // Calculate amounts using optimized batch processing
        const amountCalculationStart = Date.now();
        const [
            totalAmounts,
            depositCompletedAmounts,
            depositFailedAmounts,
            depositPendingAmounts,
            withdrawCompletedAmounts,
            withdrawFailedAmounts,
            withdrawPendingAmounts
        ] = await Promise.all([
            calculateTotalAmounts(database, startOfDay, endOfDay),
            calculateAmountsByTypeAndStatus(database, startOfDay, endOfDay, "deposit", "completed"),
            calculateAmountsByTypeAndStatus(database, startOfDay, endOfDay, "deposit", "failed"),
            calculateAmountsByTypeAndStatus(database, startOfDay, endOfDay, "deposit", "pending"),
            calculateAmountsByTypeAndStatus(database, startOfDay, endOfDay, "withdraw", "completed"),
            calculateAmountsByTypeAndStatus(database, startOfDay, endOfDay, "withdraw", "failed"),
            calculateAmountsByTypeAndStatus(database, startOfDay, endOfDay, "withdraw", "pending")
        ]);

        console.log("💰 Amount calculations completed in:", Date.now() - amountCalculationStart, "ms");

        // Calculate average processing time from sample
        let averageProcessedTime = 0;
        if (processingTimeData.documents.length > 0) {
            const totalProcessingTime = processingTimeData.documents.reduce((sum, transaction) => {
                if (transaction.$createdAt && transaction.$updatedAt) {
                    const createdAt = new Date(transaction.$createdAt).getTime();
                    const updatedAt = new Date(transaction.$updatedAt).getTime();
                    const processingTimeInMinutes = (updatedAt - createdAt) / (1000 * 60);
                    return sum + processingTimeInMinutes;
                }
                return sum;
            }, 0);
            
            averageProcessedTime = totalProcessingTime / processingTimeData.documents.length;
        }

        // Build optimized statistics object using actual counts (not capped at 5000)
        const stats: DailyStatistics = {
            recDate: dateString,
            totalOrder: totalCount,
            totalAmount: totalAmounts,
            completedDepositOrder: depositCompletedCount,
            completedDepositAmount: depositCompletedAmounts,
            completedWithdrawOrder: withdrawCompletedCount,
            completedWithdrawAmount: withdrawCompletedAmounts,
            failedDepositOrder: depositFailedCount,
            failedDepositAmount: depositFailedAmounts,
            failedWithdrawOrder: withdrawFailedCount,
            failedWithdrawAmount: withdrawFailedAmounts,
            pendingOrder: depositPendingCount + withdrawPendingCount,
            pendingAmount: depositPendingAmounts + withdrawPendingAmounts,
            averageProcessedTime
        };

        // Check if a record for this date already exists (using optimized query)
        const existingStats = await database.listDocuments(
            DATABASE_ID,
            STATISTICS_COLLECTION_ID,
            [
                Query.equal("recDate", dateString),
                Query.limit(1)
            ]
        );

        let result;

        // Update or create the statistics record
        if (existingStats.total > 0) {
            result = await database.updateDocument(
                DATABASE_ID,
                STATISTICS_COLLECTION_ID,
                existingStats.documents[0].$id,
                stats
            );
        } else {
            result = await database.createDocument(
                DATABASE_ID,
                STATISTICS_COLLECTION_ID,
                ID.unique(),
                stats
            );
        }

        const totalTime = Date.now() - startTime;
        console.log("✅ Statistics calculation completed in:", totalTime, "ms");

        // Convert result to plain object
        const plainResult = toPlainObject(result);

        return {
            success: true,
            message: `Statistics calculated successfully in ${totalTime}ms`,
            data: plainResult
        };
    } catch (error) {
        const totalTime = Date.now() - startTime;
        console.error("❌ Error calculating daily statistics:", error);
        console.log("Failed after:", totalTime, "ms");
        
        return {
            success: false,
            message: `Error calculating statistics: ${error instanceof Error ? error.message : String(error)}`,
            data: null
        };
    }
}

// Type for database document with amount field
interface AmountDocument {
    amount?: number;
    [key: string]: unknown;
}

// Type for database result with documents
interface DatabaseResult {
    documents: AmountDocument[];
    total: number;
}

// Type for database client with listDocuments method
interface DatabaseClient {
    listDocuments: (databaseId: string, collectionId: string, queries?: string[]) => Promise<DatabaseResult>;
}

// Optimized helper function to calculate total amounts
async function calculateTotalAmounts(database: DatabaseClient, startOfDay: Date, endOfDay: Date): Promise<number> {
    let totalAmount = 0;
    let offset = 0;
    const batchSize = 2000;
    
    while (true) {
        const batch = await database.listDocuments(DATABASE_ID, ODRTRANS_COLLECTION_ID, [
            Query.greaterThanEqual("$createdAt", startOfDay.toISOString()),
            Query.lessThanEqual("$createdAt", endOfDay.toISOString()),
            Query.select(["amount"]),
            Query.limit(batchSize),
            Query.offset(offset)
        ]);
        
        if (batch.documents.length === 0) break;
        
        totalAmount += batch.documents.reduce((sum: number, doc: AmountDocument) => sum + (doc.amount || 0), 0);
        offset += batchSize;
        
        if (batch.documents.length < batchSize) break;
    }
    
    return totalAmount;
}

// Optimized helper function to calculate amounts by type and status
async function calculateAmountsByTypeAndStatus(
    database: DatabaseClient, 
    startOfDay: Date, 
    endOfDay: Date, 
    type: string, 
    status: string
): Promise<number> {
    let totalAmount = 0;
    let offset = 0;
    const batchSize = 2000;
    
    while (true) {
        const batch = await database.listDocuments(DATABASE_ID, ODRTRANS_COLLECTION_ID, [
            Query.greaterThanEqual("$createdAt", startOfDay.toISOString()),
            Query.lessThanEqual("$createdAt", endOfDay.toISOString()),
            Query.equal("odrType", type),
            Query.equal("odrStatus", status),
            Query.select(["amount"]),
            Query.limit(batchSize),
            Query.offset(offset)
        ]);
        
        if (batch.documents.length === 0) break;
        
        totalAmount += batch.documents.reduce((sum: number, doc: AmountDocument) => sum + (doc.amount || 0), 0);
        offset += batchSize;
        
        if (batch.documents.length < batchSize) break;
    }
    
    return totalAmount;
}

// Helper function to count total documents (handles 5000+ limit)
async function countTotalDocuments(database: DatabaseClient, startOfDay: Date, endOfDay: Date): Promise<number> {
    let totalCount = 0;
    let offset = 0;
    const batchSize = 2000;
    
    while (true) {
        const batch = await database.listDocuments(DATABASE_ID, ODRTRANS_COLLECTION_ID, [
            Query.greaterThanEqual("$createdAt", startOfDay.toISOString()),
            Query.lessThanEqual("$createdAt", endOfDay.toISOString()),
            Query.select(["$id"]), // Only select ID for minimal data transfer
            Query.limit(batchSize),
            Query.offset(offset)
        ]);
        
        if (batch.documents.length === 0) break;
        
        totalCount += batch.documents.length;
        offset += batchSize;
        
        if (batch.documents.length < batchSize) break;
    }
    
    return totalCount;
}

// Helper function to count documents by type and status (handles 5000+ limit)
async function countDocumentsByTypeAndStatus(
    database: DatabaseClient, 
    startOfDay: Date, 
    endOfDay: Date, 
    type: string, 
    status: string
): Promise<number> {
    let totalCount = 0;
    let offset = 0;
    const batchSize = 2000;
    
    while (true) {
        const batch = await database.listDocuments(DATABASE_ID, ODRTRANS_COLLECTION_ID, [
            Query.greaterThanEqual("$createdAt", startOfDay.toISOString()),
            Query.lessThanEqual("$createdAt", endOfDay.toISOString()),
            Query.equal("odrType", type),
            Query.equal("odrStatus", status),
            Query.select(["$id"]), // Only select ID for minimal data transfer
            Query.limit(batchSize),
            Query.offset(offset)
        ]);
        
        if (batch.documents.length === 0) break;
        
        totalCount += batch.documents.length;
        offset += batchSize;
        
        if (batch.documents.length < batchSize) break;
    }
    
    return totalCount;
}

/**
 * Calculate statistics for a date range
 * @param startDate Start date of the range
 * @param endDate End date of the range
 */
export async function calculateStatisticsRange(startDate: Date, endDate: Date) {
    try {
        console.log("Server received date range:", startDate, "to", endDate);

        // Ensure we're working with UTC midnight for the dates
        startDate.setUTCHours(0, 0, 0, 0);
        endDate.setUTCHours(23, 59, 59, 999);

        console.log("Normalized date range (UTC):", startDate, "to", endDate);

        // Process each day in the range
        const currentDate = new Date(startDate);
        const results = [];

        while (currentDate <= endDate) {
            const result = await calculateDailyStatistics(new Date(currentDate));
            results.push({
                success: result.success,
                message: result.message,
                data: result.data
            });

            // Move to next day
            currentDate.setDate(currentDate.getDate() + 1);
        }

        return {
            success: true,
            message: `Statistics calculated for date range ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
            data: results
        };
    } catch (error) {
        console.error("Error calculating statistics range:", error);
        return {
            success: false,
            message: `Error calculating statistics range: ${error instanceof Error ? error.message : String(error)}`,
            data: null
        };
    }
}

/**
 * Get statistics for a specific date
 */
export async function getStatisticsByDate(date: string) {
    try {
        const { database } = await createAdminClient();

        const stats = await database.listDocuments(
            DATABASE_ID,
            STATISTICS_COLLECTION_ID,
            [
                Query.equal("recDate", date),
                Query.limit(1)
            ]
        );

        if (stats.total === 0) {
            return {
                success: false,
                message: `No statistics found for date ${date}`,
                data: null
            };
        }

        // Convert to plain object
        const plainResult = toPlainObject(stats.documents[0]);

        return {
            success: true,
            data: plainResult
        };
    } catch (error) {
        console.error(`Error fetching statistics for date ${date}:`, error);
        return {
            success: false,
            message: `Error fetching statistics: ${error instanceof Error ? error.message : String(error)}`,
            data: null
        };
    }
}

/**
 * Get statistics for a date range
 */
export async function getStatisticsForDateRange(startDate: string, endDate: string) {
    try {
        const { database } = await createAdminClient();

        // Get statistics for each day in the range
        const stats = await database.listDocuments(
            DATABASE_ID,
            STATISTICS_COLLECTION_ID,
            [
                Query.greaterThanEqual("recDate", startDate),
                Query.lessThanEqual("recDate", endDate),
                Query.orderAsc("recDate"),
                Query.limit(100) // Reasonable limit for date ranges
            ]
        );

        if (stats.total === 0) {
            return {
                success: false,
                message: `No statistics found for date range ${startDate} to ${endDate}`,
                data: null
            };
        }

        // Convert to plain objects
        const plainResults = toPlainObject(stats.documents);

        return {
            success: true,
            data: plainResults
        };
    } catch (error) {
        console.error(`Error fetching statistics for date range ${startDate} to ${endDate}:`, error);
        return {
            success: false,
            message: `Error fetching statistics: ${error instanceof Error ? error.message : String(error)}`,
            data: null
        };
    }
}