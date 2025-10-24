import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { Query } from "appwrite";
import { sendWebhookNotification } from "@/utils/webhook";
import { Databases } from "node-appwrite";
import { getResendProgress, resetResendProgress, updateResendProgress } from "@/lib/webhook/progress";

// POST /api/webhook/resend-all-notifications
// Resends notifications for all transactions with isSentCallbackNotification=false
export async function POST(request: Request) {
    // If already in progress, return status
    const progress = getResendProgress();
    if (progress.inProgress) {
        return NextResponse.json({
            success: true,
            message: "Resend operation already in progress",
            progress
        });
    }

    try {
        // Parse request body to get date range
        const body = await request.json();
        const dateRange = body.dateRange || {};

        // Reset progress
        resetResendProgress();

        const { database } = await createAdminClient();

        // Start the resend process in the background
        resendNotifications(database, dateRange).catch(error => {
            console.error("Error in background resend process:", error);
            const progress = getResendProgress();
            progress.inProgress = false;
            progress.errors.push(`Background process error: ${error.message || String(error)}`);
            updateResendProgress(progress);
        });

        return NextResponse.json({
            success: true,
            message: "Resend process started",
            progress: getResendProgress()
        });
    } catch (error) {
        console.error('Error starting resend process:', error);

        const progress = getResendProgress();
        progress.inProgress = false;
        updateResendProgress(progress);

        return NextResponse.json(
            {
                success: false,
                message: `Error starting resend process: ${error instanceof Error ? error.message : String(error)}`
            },
            { status: 500 }
        );
    }
}

// Background process to resend notifications
async function resendNotifications(
    database: Databases,
    dateRange: { from?: string; to?: string } = {}
) {
    try {
        // Build query filters
        const filters = [
            Query.equal("isSentCallbackNotification", [false]),
            Query.isNotNull("urlCallBack"),
        ];

        // Add date range filters if provided
        if (dateRange.from) {
            filters.push(Query.greaterThanEqual("$createdAt", dateRange.from));
        }
        if (dateRange.to) {
            filters.push(Query.lessThanEqual("$createdAt", dateRange.to));
        }

        // Count total documents to process
        const countResult = await database.listDocuments(
            appwriteConfig.databaseId,
            appwriteConfig.odrtransCollectionId,
            [
                ...filters,
                Query.limit(1)
            ]
        );

        const progress = getResendProgress();
        progress.total = countResult.total;
        updateResendProgress(progress);

        console.log(`Batch resend: Found ${countResult.total} transactions to process`);

        if (progress.total === 0) {
            progress.inProgress = false;
            updateResendProgress(progress);
            return;
        }

        // Process in batches
        const batchSize = 10;
        let offset = 0;
        let batchCount = 0;

        while (true) {
            batchCount++;

            // Get a batch of documents
            const documents = await database.listDocuments(
                appwriteConfig.databaseId,
                appwriteConfig.odrtransCollectionId,
                [
                    ...filters,
                    Query.limit(batchSize),
                    Query.offset(offset)
                ]
            );

            if (documents.documents.length === 0) {
                break; // No more documents
            }

            console.log(`Batch resend: Processing batch ${batchCount} with ${documents.documents.length} transactions`);

            // Process each document
            for (const doc of documents.documents) {
                const currentProgress = getResendProgress();
                try {
                    if (!doc.urlCallBack) {
                        // Skip if no callback URL
                        currentProgress.processed++;
                        updateResendProgress(currentProgress);
                        continue;
                    }

                    // Create webhook data
                    const webhookData = {
                        odrId: doc.odrId,
                        merchantOrdId: doc.merchantOrdId || '',
                        orderType: doc.odrType,
                        odrStatus: doc.odrStatus,
                        bankReceiveNumber: doc.bankReceiveNumber || '',
                        bankReceiveOwnerName: doc.bankReceiveOwnerName || '',
                        amount: doc.paidAmount || 0,
                    };

                    // Get API key if available
                    const apiKey = doc.account?.apiKey || '';

                    // Send the notification - this will log the notification internally
                    const result = await sendWebhookNotification(
                        doc.urlCallBack,
                        webhookData,
                        apiKey,
                        true,
                        'resend-all-notifications'
                    );

                    if (result.success) {
                        // Update the document
                        await database.updateDocument(
                            appwriteConfig.databaseId,
                            appwriteConfig.odrtransCollectionId,
                            doc.$id,
                            { isSentCallbackNotification: true }
                        );

                        currentProgress.success++;
                    } else {
                        currentProgress.failed++;
                        currentProgress.errors.push(`Failed to send notification for ${doc.odrId}: ${result.message}`);
                    }
                } catch (error) {
                    console.error(`Error processing document ${doc.$id}:`, error);
                    currentProgress.failed++;
                    currentProgress.errors.push(`Error processing ${doc.odrId}: ${error instanceof Error ? error.message : String(error)}`);
                }

                // Update progress
                currentProgress.processed++;
                currentProgress.lastUpdated = new Date();
                updateResendProgress(currentProgress);
            }

            // Move to next batch
            offset += batchSize;

            // If we got fewer documents than the batch size, we're done
            if (documents.documents.length < batchSize) {
                break;
            }
        }

        console.log(`Batch resend completed: ${progress.processed} processed, ${progress.success} success, ${progress.failed} failed`);
    } catch (error) {
        console.error("Error in resend process:", error);
        const progress = getResendProgress();
        progress.errors.push(`Process error: ${error instanceof Error ? error.message : String(error)}`);
        updateResendProgress(progress);
    } finally {
        // Mark as complete
        const progress = getResendProgress();
        progress.inProgress = false;
        progress.lastUpdated = new Date();
        updateResendProgress(progress);
    }
} 