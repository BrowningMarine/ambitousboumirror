import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { Query } from "appwrite";

// GET /api/webhook/count-pending-notifications
// Counts the number of transactions with isSentCallbackNotification=false and urlCallBack not null
export async function GET() {
    try {
        const { database } = await createAdminClient();

        // Count documents that have not had their notification sent yet
        const countResult = await database.listDocuments(
            appwriteConfig.databaseId,
            appwriteConfig.odrtransCollectionId,
            [
                Query.or([
                    Query.equal("isSentCallbackNotification", [false]),
                    Query.isNull("isSentCallbackNotification")
                ]),
                Query.isNotNull("urlCallBack"),
                Query.limit(1)
            ]
        );

        // Count documents with null isSentCallbackNotification separately
        const nullCountResult = await database.listDocuments(
            appwriteConfig.databaseId,
            appwriteConfig.odrtransCollectionId,
            [
                Query.isNull("isSentCallbackNotification"),
                Query.isNotNull("urlCallBack"),
                Query.limit(1)
            ]
        );

        // Count documents with false isSentCallbackNotification separately
        const falseCountResult = await database.listDocuments(
            appwriteConfig.databaseId,
            appwriteConfig.odrtransCollectionId,
            [
                Query.equal("isSentCallbackNotification", [false]),
                Query.isNotNull("urlCallBack"),
                Query.limit(1)
            ]
        );

        console.log("Count results:", {
            total: countResult.total,
            nullCount: nullCountResult.total,
            falseCount: falseCountResult.total
        });

        return NextResponse.json({
            success: true,
            count: countResult.total,
            nullCount: nullCountResult.total,
            falseCount: falseCountResult.total
        });
    } catch (error) {
        console.error('Error counting pending notifications:', error);

        return NextResponse.json(
            {
                success: false,
                message: `Error counting pending notifications: ${error instanceof Error ? error.message : String(error)}`
            },
            { status: 500 }
        );
    }
} 