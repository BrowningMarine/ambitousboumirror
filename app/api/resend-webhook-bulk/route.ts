import { NextRequest, NextResponse } from "next/server";
import { getTransactionByOrderId } from "@/lib/actions/transaction.actions";
import { sendWebhookNotifications, type WebhookOrderData } from "@/lib/webhook/send-notifications";

/**
 * POST /api/resend-webhook-bulk - Endpoint to resend webhook notifications in bulk
 * 
 * This endpoint uses the centralized webhook system with support for:
 * - Separate batch/legacy modes for deposit and withdraw orders
 * - Automatic grouping and intelligent sending
 * - Notification status tracking
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { orderIds, markAsCompleted, markAsFailed, markAsPending } = body;

        if (!Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json(
                { success: false, message: "orderIds array is required and cannot be empty" },
                { status: 400 }
            );
        }

        console.log(`Bulk resend initiated for ${orderIds.length} orders`);
        if (markAsCompleted) console.log('🔄 Mark as completed mode enabled');
        if (markAsFailed) console.log('🔄 Mark as failed mode enabled');
        if (markAsPending) console.log('🔄 Mark as pending mode enabled');

        // Fetch all transactions
        const fetchPromises = orderIds.map(orderId => getTransactionByOrderId(orderId));
        const transactions = await Promise.all(fetchPromises);

        // Update transaction statuses if flags are set
        if (markAsCompleted || markAsFailed || markAsPending) {
            const { updateTransaction } = await import('@/lib/actions/transaction.actions');
            
            for (const tx of transactions) {
                if (!tx) continue;
                
                try {
                    if (markAsCompleted && tx.odrStatus !== 'completed') {
                        const result = await updateTransaction(tx.$id, {
                            odrStatus: 'completed',
                            paidAmount: tx.amount,
                            unPaidAmount: 0,
                        });
                        if (result.success) {
                            tx.odrStatus = 'completed';
                            tx.paidAmount = tx.amount;
                            tx.unPaidAmount = 0;
                            console.log(`✅ Updated ${tx.odrId} to completed`);
                        }
                    } else if (markAsFailed && !['completed', 'failed', 'canceled'].includes(tx.odrStatus)) {
                        const result = await updateTransaction(tx.$id, {
                            odrStatus: 'failed',
                        });
                        if (result.success) {
                            tx.odrStatus = 'failed';
                            console.log(`❌ Updated ${tx.odrId} to failed`);
                        }
                    } else if (markAsPending) {
                        const result = await updateTransaction(tx.$id, {
                            odrStatus: 'pending',
                        });
                        if (result.success) {
                            tx.odrStatus = 'pending';
                            console.log(`🔄 Updated ${tx.odrId} to pending`);
                        }
                    }
                } catch (error) {
                    console.error(`Failed to update status for ${tx.odrId}:`, error);
                }
            }
        }

        // Filter valid transactions
        const validTransactions = transactions.filter((tx, idx) => {
            if (!tx) {
                console.warn(`Transaction not found for order: ${orderIds[idx]}`);
                return false;
            }
            if (!tx.urlCallBack) {
                console.warn(`No callback URL for order: ${tx.odrId}`);
                return false;
            }
            // Only send for final statuses (unless markAsPending, which doesn't send notifications)
            const finalStatuses = ['completed', 'failed', 'canceled'];
            if (!finalStatuses.includes(tx.odrStatus)) {
                console.warn(`Order ${tx.odrId} has non-final status: ${tx.odrStatus}`);
                return false;
            }
            return true;
        });

        if (validTransactions.length === 0) {
            return NextResponse.json(
                { success: false, message: "No valid transactions found with callback URLs and final statuses" },
                { status: 400 }
            );
        }

        console.log(`Found ${validTransactions.length} valid transactions for webhook notifications`);

        // Convert transactions to WebhookOrderData format
        const orders = validTransactions.map(tx => ({
            odrId: tx.odrId,
            merchantOrdId: tx.merchantOrdId || '',
            orderType: tx.odrType as 'deposit' | 'withdraw',
            odrStatus: tx.odrStatus,
            bankReceiveNumber: tx.bankReceiveNumber || '',
            bankReceiveOwnerName: tx.bankReceiveOwnerName || '',
            amount: tx.paidAmount || 0,
            url_callback: tx.urlCallBack!,
            apiKey: tx.account?.apiKey || '',
            transactionId: tx.$id, // For notification status updates
        }));

        // Send webhooks using centralized function
        // This handles batch/legacy mode per order type automatically
        const webhookResults = await sendWebhookNotifications(orders, 'bulk-resend');

        // Return results
        return NextResponse.json({
            success: webhookResults.success,
            message: `Processed ${webhookResults.total} orders: ${webhookResults.successful} successful, ${webhookResults.failed} failed`,
            mode: webhookResults.mode,
            results: {
                total: webhookResults.total,
                successful: webhookResults.successful,
                failed: webhookResults.failed,
                errors: webhookResults.errors
            }
        });

    } catch (error) {
        console.error('Error processing bulk resend webhook request:', error);
        return NextResponse.json(
            {
                success: false,
                message: `Internal server error: ${error instanceof Error ? error.message : String(error)}`
            },
            { status: 500 }
        );
    }
}
