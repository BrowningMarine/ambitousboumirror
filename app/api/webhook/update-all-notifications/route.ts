import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { Query } from "appwrite";
import { Databases } from "node-appwrite";
import { getResendProgress, resetResendProgress, updateResendProgress } from "@/lib/webhook/progress";

// POST /api/webhook/update-all-notifications
// Updates all notifications to isSentCallbackNotification=true/false based on request
export async function POST(request: Request) {
    // If already in progress, return status
    const progress = getResendProgress();
    if (progress.inProgress) {
        return NextResponse.json({
            success: true,
            message: "Operation already in progress",
            progress
        });
    }

    try {
        // Parse request body to get status and date range
        const body = await request.json();
        const status = body.status !== undefined ? body.status : true; // Default to marking as sent
        const dateRange = body.dateRange || {};

        // Reset progress
        resetResendProgress();

        const { database } = await createAdminClient();

        // Start the update process in the background
        updateAllNotifications(database, status, dateRange).catch(error => {
            console.error("Error in background update process:", error);
            const progress = getResendProgress();
            progress.inProgress = false;
            progress.errors.push(`Background process error: ${error.message || String(error)}`);
            updateResendProgress(progress);
        });

        return NextResponse.json({
            success: true,
            message: "Update process started",
            progress: getResendProgress()
        });
    } catch (error) {
        console.error('Error starting update process:', error);

        const progress = getResendProgress();
        progress.inProgress = false;
        updateResendProgress(progress);

        return NextResponse.json(
            {
                success: false,
                message: `Error starting update process: ${error instanceof Error ? error.message : String(error)}`
            },
            { status: 500 }
        );
    }
}

// Background process to update all notifications
async function updateAllNotifications(
    database: Databases,
    markAsSent: boolean = true,
    dateRange: { from?: string; to?: string } = {}
) {
    try {
        // Build query filters
        let filters = [];

        if (markAsSent) {
            // If marking as sent, find documents where isSentCallbackNotification is false OR null
            filters = [
                Query.or([
                    Query.equal("isSentCallbackNotification", [false]),
                    Query.isNull("isSentCallbackNotification")
                ]),
                Query.isNotNull("urlCallBack"),
            ];
        } else {
            // If marking as unsent, find documents where isSentCallbackNotification is true
            filters = [
                Query.equal("isSentCallbackNotification", [true]),
                Query.isNotNull("urlCallBack"),
            ];
        }

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

        if (progress.total === 0) {
            progress.inProgress = false;
            updateResendProgress(progress);
            return;
        }

        // Process in batches
        const batchSize = 20;
        let offset = 0;

        while (true) {
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

            // Process each document
            for (const doc of documents.documents) {
                const currentProgress = getResendProgress();
                try {
                    // Update the document
                    await database.updateDocument(
                        appwriteConfig.databaseId,
                        appwriteConfig.odrtransCollectionId,
                        doc.$id,
                        { isSentCallbackNotification: markAsSent }
                    );

                    currentProgress.success++;
                } catch (error) {
                    console.error(`Error updating document ${doc.$id}:`, error);
                    currentProgress.failed++;
                    currentProgress.errors.push(`Error updating ${doc.odrId || doc.$id}: ${error instanceof Error ? error.message : String(error)}`);
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
    } catch (error) {
        console.error("Error in update process:", error);
        const progress = getResendProgress();
        progress.errors.push(`Process error: ${error instanceof Error ? error.message : String(error)}`);
        updateResendProgress(progress);
    } finally {
        // Mark as complete
        const progress = getResendProgress();
        progress.inProgress = false;
        progress.lastUpdated = new Date();

        // Make sure success count matches processed count if all updates were successful
        if (progress.processed > 0 && progress.failed === 0) {
            progress.success = progress.processed;
        }

        updateResendProgress(progress);
    }
} 