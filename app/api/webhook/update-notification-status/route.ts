import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";

// POST /api/webhook/update-notification-status
// Updates the isSentCallbackNotification status for a single transaction
export async function POST(request: NextRequest) {
    try {
        const { transactionId, status } = await request.json();

        if (!transactionId) {
            return NextResponse.json(
                { success: false, message: "Transaction ID is required" },
                { status: 400 }
            );
        }

        if (typeof status !== 'boolean') {
            return NextResponse.json(
                { success: false, message: "Status must be a boolean value" },
                { status: 400 }
            );
        }

        const { database } = await createAdminClient();

        // Update the document
        await database.updateDocument(
            appwriteConfig.databaseId,
            appwriteConfig.odrtransCollectionId,
            transactionId,
            { isSentCallbackNotification: status }
        );

        return NextResponse.json({
            success: true,
            message: `Successfully updated notification status to ${status ? 'sent' : 'not sent'}`
        });
    } catch (error) {
        console.error('Error updating notification status:', error);

        return NextResponse.json(
            {
                success: false,
                message: `Error updating notification status: ${error instanceof Error ? error.message : String(error)}`
            },
            { status: 500 }
        );
    }
} 