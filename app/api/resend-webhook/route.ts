import { NextRequest, NextResponse } from "next/server";
import { sendWebhookNotification } from "@/utils/webhook";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { getTransactionByOrderId, updateTransactionStatus } from "@/lib/actions/transaction.actions";

// POST /api/resend-webhook - Endpoint to resend webhook notifications
export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { callbackUrl, apiKey, data, transactionId, orderId, updateStatusToFailed, markAsCompleted, markAsPending } = body;
        
        // Support both old format and new format
        const targetOrderId = orderId || data?.odrId;
        console.log(`Manual resend initiated for order ${targetOrderId || 'unknown'}`);

        // If we have orderId but no other data, fetch the transaction
        if (targetOrderId && !callbackUrl) {
            return await handleOrderBasedResend(targetOrderId, updateStatusToFailed, markAsCompleted, markAsPending);
        }

        // Validate required fields
        if (!callbackUrl) {
            return NextResponse.json(
                { success: false, message: "Callback URL is required" },
                { status: 400 }
            );
        }

        if (!data || !data.odrId) {
            return NextResponse.json(
                { success: false, message: "Transaction data is required" },
                { status: 400 }
            );
        }

        // Send the webhook notification
        const result = await sendWebhookNotification(callbackUrl, data, apiKey, true, 'manual-resend');

        // If successful and we have a transaction ID, update the notification status
        if (result.success && transactionId) {
            try {
                const { dbManager } = await import('@/lib/database/connection-manager');

                // Use optimized database manager for non-blocking write operations
                await dbManager.updateDocument(
                    appwriteConfig.databaseId,
                    appwriteConfig.odrtransCollectionId,
                    transactionId,
                    { isSentCallbackNotification: true },
                    `update-notification-status:${data.odrId || transactionId}`
                );

                console.log(`Updated isSentCallbackNotification=true for transaction ${transactionId} (${data.odrId || 'unknown'})`);
            } catch (updateError) {
                console.error('Error updating notification status:', updateError);
                // Continue with the response even if update fails
            }
        }

        // Return the result
        if (result.success) {
            return NextResponse.json({
                success: true,
                message: "Webhook notification sent successfully",
                details: result
            });
        } else {
            return NextResponse.json({
                success: false,
                message: result.message,
                details: result
            }, { status: 500 });
        }
    } catch (error) {
        console.error('Error processing resend webhook request:', error);
        return NextResponse.json(
            {
                success: false,
                message: `Internal server error: ${error instanceof Error ? error.message : String(error)}`
            },
            { status: 500 }
        );
    }
}

// Handle order-based resend with optional status update
async function handleOrderBasedResend(orderId: string, updateStatusToFailed: boolean = false, markAsCompleted: boolean = false, markAsPending: boolean = false) {
    try {
        // Get transaction by order ID using existing function
        const transaction = await getTransactionByOrderId(orderId);
        
        if (!transaction) {
            return NextResponse.json(
                { success: false, message: `Transaction with order ID ${orderId} not found` },
                { status: 404 }
            );
        }

        // Check status update options
        const finalStatuses = ['completed', 'failed', 'canceled'];
        const shouldUpdateToFailed = updateStatusToFailed && !finalStatuses.includes(transaction.odrStatus);
        const shouldMarkCompleted = markAsCompleted && transaction.odrStatus !== 'completed';
        const shouldMarkPending = markAsPending && transaction.odrStatus !== 'pending';

        // Validate that only one status update option is selected
        const statusUpdateCount = [shouldUpdateToFailed, shouldMarkCompleted, shouldMarkPending].filter(Boolean).length;
        if (statusUpdateCount > 1) {
            return NextResponse.json(
                { success: false, message: `Cannot apply multiple status updates simultaneously for order ${orderId}` },
                { status: 400 }
            );
        }

        // Validate that only admin users can mark as completed or pending (server-side security check)
        if (shouldMarkCompleted || shouldMarkPending) {
            // Import user actions to verify admin role
            const { getLoggedInUser } = await import('@/lib/actions/user.actions');
            
            try {
                const currentUser = await getLoggedInUser();
                if (!currentUser) {
                    return NextResponse.json(
                        { success: false, message: `Authentication required for status updates` },
                        { status: 401 }
                    );
                }
                
                if (shouldMarkCompleted && currentUser.role !== 'admin' && currentUser.role !== 'transactor') {
                    return NextResponse.json(
                        { success: false, message: `Access denied: Only admin/transactor users can mark transactions as completed` },
                        { status: 403 }
                    );
                }
                
                if (shouldMarkPending && currentUser.role !== 'admin') {
                    return NextResponse.json(
                        { success: false, message: `Access denied: Only admin users can update transaction status to pending` },
                        { status: 403 }
                    );
                }
            } catch (authError) {
                console.error('Error verifying user role for status updates:', authError);
                return NextResponse.json(
                    { success: false, message: `Authentication error: Unable to verify admin privileges` },
                    { status: 401 }
                );
            }
        }

        let updatedTransaction = transaction;
        
        // Update status to failed if requested and not in final status
        if (shouldUpdateToFailed) {
            // CRITICAL VALIDATION: Check if there are any bank transaction entries for this order
            // This prevents marking transactions as failed when actual bank payments exist
            // Using optimized database manager with retry logic and circuit breaker
            try {
                const { dbManager } = await import('@/lib/database/connection-manager');
                const { Query } = await import('node-appwrite');
                
                // Use optimized database manager for non-blocking read operations
                const bankEntries = await dbManager.listDocuments(
                    appwriteConfig.databaseId,
                    appwriteConfig.bankTransactionEntryCollectionId,
                    [
                        Query.equal('odrId', orderId),
                        Query.limit(1) // We only need to know if at least one exists
                    ],
                    `bank-entry-validation:${orderId}` // Operation name for monitoring
                );
                
                if (bankEntries.total > 0) {
                    console.warn(`Cannot mark transaction ${orderId} as failed: Found ${bankEntries.total} bank transaction entry(ies) indicating actual payment received`);
                    return NextResponse.json(
                        { 
                            success: false, 
                            message: `Cannot mark order ${orderId} as failed: Bank transaction entry exists (${bankEntries.total} record(s) found). This indicates payment was received. Please verify the transaction status before updating.`,
                            reason: 'bank_entry_exists',
                            bankEntriesCount: bankEntries.total
                        },
                        { status: 400 }
                    );
                }
                
                console.log(`Validation passed: No bank transaction entries found for order ${orderId}, proceeding with failed status update`);
            } catch (validationError) {
                console.error(`Error checking bank transaction entries for order ${orderId}:`, validationError);
                
                // Check if it's a circuit breaker error
                const isCircuitBreakerError = validationError instanceof Error && 
                    validationError.message.includes('circuit breaker is open');
                
                return NextResponse.json(
                    { 
                        success: false, 
                        message: isCircuitBreakerError 
                            ? `Database temporarily unavailable. Please try again in a moment.`
                            : `Failed to validate bank transaction entries: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
                        reason: isCircuitBreakerError ? 'circuit_breaker_open' : 'validation_error'
                    },
                    { status: isCircuitBreakerError ? 503 : 500 }
                );
            }
            
            console.log(`Updating transaction ${orderId} status from ${transaction.odrStatus} to failed`);
            const updateResult = await updateTransactionStatus(transaction.$id, 'failed');
            
            if (updateResult.success && updateResult.data) {
                updatedTransaction = updateResult.data;
                console.log(`Successfully updated transaction ${orderId} to failed status`);
            } else {
                console.error(`Failed to update transaction ${orderId} status:`, updateResult.message);
                return NextResponse.json(
                    { success: false, message: `Failed to update transaction status: ${updateResult.message}` },
                    { status: 500 }
                );
            }
        }
        // Update to completed if requested and not already completed
        else if (shouldMarkCompleted) {
            console.log(`Marking transaction ${orderId} as completed: updating amounts and status`);
            
            try {
                // Import the proccessTransactionPayment function for proper completion
                const { proccessTransactionPayment } = await import('@/lib/actions/transaction.actions');
                
                // Calculate the amount needed to complete the transaction
                const amountToComplete = transaction.amount - (transaction.paidAmount || 0);
                
                if (amountToComplete > 0) {
                    // Use the existing transaction completion function which handles everything properly
                    // Note: proccessTransactionPayment already sends webhook notification and updates isSentCallbackNotification
                    const completionResult = await proccessTransactionPayment(transaction.odrId, amountToComplete);
                    
                    if (completionResult.success && completionResult.data) {
                        updatedTransaction = completionResult.data;
                        console.log(`Successfully marked transaction ${orderId} as completed using proccessTransactionPayment`);
                        
                        // Return early since proccessTransactionPayment already sent the webhook notification
                        return NextResponse.json({
                            success: true,
                            message: `Transaction marked as completed and notification sent successfully for order ${orderId}`,
                            statusUpdated: true,
                            markedAsCompleted: true,
                            finalStatus: false,
                            details: { success: true, message: "Transaction completed and webhook sent" }
                        });
                    } else {
                        console.error(`Failed to complete transaction ${orderId}:`, completionResult.message);
                        return NextResponse.json(
                            { success: false, message: `Failed to mark transaction as completed: ${completionResult.message}` },
                            { status: 500 }
                        );
                    }
                } else {
                    // Transaction is already fully paid, just update status
                    const { updateTransactionStatus } = await import('@/lib/actions/transaction.actions');
                    const statusResult = await updateTransactionStatus(transaction.$id, 'completed');
                    
                    if (statusResult.success && statusResult.data) {
                        updatedTransaction = statusResult.data;
                        console.log(`Successfully updated transaction ${orderId} status to completed`);
                        // Continue to send webhook notification since updateTransactionStatus sends webhook too
                    } else {
                        console.error(`Failed to update transaction ${orderId} status:`, statusResult.message);
                        return NextResponse.json(
                            { success: false, message: `Failed to update transaction status: ${statusResult.message}` },
                            { status: 500 }
                        );
                    }
                }
                
            } catch (updateError) {
                console.error(`Failed to mark transaction ${orderId} as completed:`, updateError);
                return NextResponse.json(
                    { success: false, message: `Failed to mark transaction as completed: ${updateError instanceof Error ? updateError.message : String(updateError)}` },
                    { status: 500 }
                );
            }
        }
        // Update to pending if requested and not already pending (Admin only)
        else if (shouldMarkPending) {
            console.log(`Admin updating transaction ${orderId} status from ${transaction.odrStatus} to pending`);
            const updateResult = await updateTransactionStatus(transaction.$id, 'pending');
            
            if (updateResult.success && updateResult.data) {
                updatedTransaction = updateResult.data;
                console.log(`Successfully updated transaction ${orderId} to pending status`);
                
                // Return early for pending status since it's not a final status and no notification should be sent
                return NextResponse.json({
                    success: true,
                    message: `Transaction status updated to pending successfully for order ${orderId}. No notification sent as pending is not a final status.`,
                    statusUpdated: true,
                    markedAsPending: true,
                    finalStatus: false,
                    details: { success: true, message: "Transaction status updated to pending" }
                });
            } else {
                console.error(`Failed to update transaction ${orderId} status to pending:`, updateResult.message);
                return NextResponse.json(
                    { success: false, message: `Failed to update transaction status to pending: ${updateResult.message}` },
                    { status: 500 }
                );
            }
        }
        else if (updateStatusToFailed && finalStatuses.includes(transaction.odrStatus)) {
            console.log(`Transaction ${orderId} is already in final status ${transaction.odrStatus}, skipping status update`);
        }
        else if (markAsCompleted && transaction.odrStatus === 'completed') {
            console.log(`Transaction ${orderId} is already completed, skipping status update`);
        }

        // Check if transaction has callback URL
        if (!updatedTransaction.urlCallBack) {
            return NextResponse.json(
                { success: false, message: `Transaction ${orderId} has no callback URL configured` },
                { status: 400 }
            );
        }

        // Only send notifications for transactions with final statuses
        if (!finalStatuses.includes(updatedTransaction.odrStatus)) {
            return NextResponse.json(
                { success: false, message: `Cannot send notification for transaction ${orderId} with status '${updatedTransaction.odrStatus}'. Notifications are only sent for completed, failed, or canceled transactions.` },
                { status: 400 }
            );
        }

        // Create webhook data
        const webhookData = {
            odrId: updatedTransaction.odrId,
            merchantOrdId: updatedTransaction.merchantOrdId || '',
            orderType: updatedTransaction.odrType,
            odrStatus: updatedTransaction.odrStatus,
            bankReceiveNumber: updatedTransaction.bankReceiveNumber || '',
            bankReceiveOwnerName: updatedTransaction.bankReceiveOwnerName || '',
            amount: updatedTransaction.paidAmount || 0,
        };

        // Get merchant API key if available
        const merchantApiKey = updatedTransaction.account?.apiKey || '';

        // Send webhook notification
        const result = await sendWebhookNotification(
            updatedTransaction.urlCallBack,
            webhookData,
            merchantApiKey,
            true,
            'bulk-resend-notification'
        );

        // Update notification status if successful
        if (result.success) {
            try {
                const { dbManager } = await import('@/lib/database/connection-manager');
                
                // Use optimized database manager for non-blocking write operations
                await dbManager.updateDocument(
                    appwriteConfig.databaseId,
                    appwriteConfig.odrtransCollectionId,
                    updatedTransaction.$id,
                    { isSentCallbackNotification: true },
                    `update-notification-status:${orderId}`
                );
                console.log(`Updated isSentCallbackNotification=true for transaction ${orderId}`);
            } catch (updateError) {
                console.error('Error updating notification status:', updateError);
                // Continue with success response even if update fails
            }
        }

        const responseMessage = shouldUpdateToFailed 
            ? `Transaction status updated to failed and notification sent successfully for order ${orderId}`
            : shouldMarkCompleted
            ? `Transaction marked as completed and notification sent successfully for order ${orderId}`
            : `Notification sent successfully for order ${orderId}`;

        return NextResponse.json({
            success: result.success,
            message: result.success ? responseMessage : result.message,
            statusUpdated: shouldUpdateToFailed || shouldMarkCompleted,
            markedAsCompleted: shouldMarkCompleted,
            finalStatus: finalStatuses.includes(transaction.odrStatus),
            details: result
        });

    } catch (error) {
        console.error(`Error in handleOrderBasedResend for order ${orderId}:`, error);
        return NextResponse.json(
            {
                success: false,
                message: `Error processing order ${orderId}: ${error instanceof Error ? error.message : String(error)}`
            },
            { status: 500 }
        );
    }
} 