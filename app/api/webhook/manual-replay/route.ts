import { NextRequest, NextResponse } from "next/server";
import { updateBankBalance } from "@/lib/actions/bank.actions";
import { proccessTransactionPayment, getTransactionByOrderId } from "@/lib/actions/transaction.actions";
import {
  createBankTransactionEntry,
  checkDuplicateTransaction,
  findBankByAccountNumber,
  updateBankTransactionEntryStatus,
  TransactionStatus,
  TransactionType,
  BankTransactionEntryData
} from "@/lib/actions/bankTransacionEntry.action";
import { log } from "@/lib/logger";

interface ManualWebhookRequest {
  // Transaction details from banking app verification
  transactionId: string; // Unique transaction ID from bank
  orderId?: string; // Order ID (ABO...) if known
  amount: number; // Transaction amount
  description: string; // Transaction description
  bankAccountNumber: string; // Bank account number
  bankName?: string; // Bank name
  transactionDate?: string; // Transaction date (ISO string)
  transactionType: 'credit' | 'debit'; // Transaction type
  
  // Manual verification details
  verifiedBy: string; // User who verified this manually
  verificationNotes?: string; // Additional notes
  balanceAfter?: number; // Balance after transaction (if available)
  
  // Security
  adminKey: string; // Admin key for security
}

interface ManualWebhookResult {
  success: boolean;
  transactionId: string;
  orderId?: string | null;
  status: TransactionStatus;
  message: string;
  bankId?: string;
  amount?: number;
  verifiedBy: string;
}

// Helper function to extract order ID from description
function extractOrderId(description: string): string | null {
  if (!description) return null;

  // First, look for the specific pattern ABO + 8 digits + 7 alphanumeric characters  
  const orderIdPattern = /ABO\d{8}[A-Z0-9]{7}/;
  const match = description.match(orderIdPattern);

  if (match) {
    return match[0];
  }

  // Second, try to find ABO followed by any characters  
  const aboPattern = /ABO[A-Z0-9\-]+/;
  const aboMatch = description.match(aboPattern);

  if (aboMatch) {
    // Clean up the result - remove any trailing non-alphanumeric characters  
    return aboMatch[0].split(/[-\s]/)[0];
  }

  return null;
}

// Manual webhook processing (similar to main webhook but with manual verification)
async function processManualWebhook(request: ManualWebhookRequest): Promise<ManualWebhookResult> {
  const processingStartTime = performance.now();
  
  try {
    // Validate required fields
    if (!request.transactionId || !request.amount || !request.bankAccountNumber || !request.verifiedBy) {
      return {
        success: false,
        transactionId: request.transactionId || 'UNKNOWN',
        status: 'failed',
        message: 'Missing required fields: transactionId, amount, bankAccountNumber, verifiedBy',
        verifiedBy: request.verifiedBy || 'UNKNOWN'
      };
    }

    // Extract order ID from description or use provided orderId
    const odrId = request.orderId || extractOrderId(request.description);
    
    // Check for duplicates using manual transaction ID
    const isDuplicate = await checkDuplicateTransaction('manual-replay', request.transactionId);
    if (isDuplicate) {
      return {
        success: false,
        transactionId: request.transactionId,
        orderId: odrId,
        status: 'duplicated',
        message: 'Transaction already processed via manual replay',
        verifiedBy: request.verifiedBy
      };
    }

    // Find bank by account number
    const bankResult = await findBankByAccountNumber(request.bankAccountNumber);
    if (!bankResult.success || !bankResult.bank) {
      return {
        success: false,
        transactionId: request.transactionId,
        orderId: odrId,
        status: 'failed',
        message: bankResult.message || 'Bank account not found',
        verifiedBy: request.verifiedBy
      };
    }

    // Create bank transaction entry for manual replay
    const bankTransactionData: BankTransactionEntryData = {
      portalId: 'manual-replay',
      portalTransactionId: request.transactionId,
      odrId: odrId || 'UNKNOWN',
      bankId: bankResult.bank.$id,
      bankName: request.bankName || bankResult.bank.bankName || '',
      bankAccountNumber: request.bankAccountNumber,
      amount: Math.floor(Math.abs(request.amount)), // Ensure positive amount
      transactionType: request.transactionType as TransactionType,
      balanceAfter: request.balanceAfter ? Math.floor(request.balanceAfter) : 0,
      transactionDate: request.transactionDate || new Date().toISOString(),
      rawPayload: JSON.stringify({
        ...request,
        source: 'manual-replay',
        timestamp: new Date().toISOString()
      }),
      status: 'pending',
      notes: `Manual replay by ${request.verifiedBy}. ${!odrId ? 'Order ID not found in description' : 'Processing payment'}`
    };

    const entryResult = await createBankTransactionEntry(bankTransactionData);
    if (!entryResult.success || !entryResult.entry) {
      return {
        success: false,
        transactionId: request.transactionId,
        orderId: odrId,
        status: 'failed',
        message: entryResult.message || 'Failed to create transaction entry',
        verifiedBy: request.verifiedBy
      };
    }

    let finalStatus: TransactionStatus = 'pending';
    let finalNotes = `Manual replay by ${request.verifiedBy}`;

    // Handle transactions without order ID
    if (!odrId) {
      finalStatus = 'unlinked' as TransactionStatus;
      finalNotes += '. Transaction recorded without order ID';

      try {
        await updateBankTransactionEntryStatus(entryResult.entry.$id, finalStatus, finalNotes);
        
        await log.info(`Manual Webhook Replay - Unlinked Transaction ${request.transactionId}`, {
          transactionId: request.transactionId,
          orderId: null,
          amount: request.amount,
          description: request.description,
          bankInfo: {
            bankId: bankResult.bank.bankId,
            bankName: request.bankName || bankResult.bank.bankName || '',
            accountNumber: request.bankAccountNumber,
            balanceAfter: request.balanceAfter || 0
          },
          manualVerification: {
            verifiedBy: request.verifiedBy,
            verificationNotes: request.verificationNotes || 'No additional notes',
            processingTime: Math.round((performance.now() - processingStartTime) * 100) / 100
          },
          summary: {
            success: true,
            isManualReplay: true,
            reason: 'Manual replay - no order ID found',
            timestamp: new Date().toISOString()
          }
        });
      } catch (updateError) {
        console.error('Status update error for manual transaction:', request.transactionId, updateError);
      }

      return {
        success: true,
        transactionId: request.transactionId,
        orderId: null,
        status: finalStatus,
        bankId: bankResult.bank.bankId,
        amount: Math.floor(Math.abs(request.amount)),
        message: 'Transaction recorded without order ID (manual replay)',
        verifiedBy: request.verifiedBy
      };
    }

    // Process payment for transactions with order ID
    const [bankUpdateResult, paymentResult] = await Promise.all([
      // Update bank balance (only for credit transactions)
      request.transactionType === 'credit' 
        ? updateBankBalance(
            bankResult.bank.bankId,
            Math.abs(request.amount),
            true,
            true,
            true // is credit
          )
        : Promise.resolve({ success: true, message: 'Debit transaction - no balance update needed' }),
      
      // Process payment
      odrId && Math.abs(request.amount) > 0
        ? proccessTransactionPayment(odrId, Math.abs(request.amount))
        : Promise.resolve({ success: false, message: 'No valid order ID or amount' })
    ]);

    // Determine final status
    finalStatus = bankUpdateResult.success ? 'processed' : 'failed';
    finalNotes = `Manual replay by ${request.verifiedBy}. `;
    
         if (bankUpdateResult.success) {
       finalNotes += `Bank balance updated successfully.`;
       if ('previousBalance' in bankUpdateResult && 'newBalance' in bankUpdateResult && 
           bankUpdateResult.previousBalance && bankUpdateResult.newBalance) {
         finalNotes += ` Previous: ${bankUpdateResult.previousBalance.current}, New: ${bankUpdateResult.newBalance.current}`;
       }
    } else {
      finalNotes += `Failed to update bank balance: ${bankUpdateResult.message || "Unknown error"}`;
    }

    // Handle payment processing results
    if (bankUpdateResult.success && paymentResult.success) {
      if ('isOverpayment' in paymentResult && paymentResult.isOverpayment) {
        try {
          const orderDetails = await getTransactionByOrderId(odrId);
          finalStatus = orderDetails && orderDetails.odrType === 'deposit' 
            ? 'available' as TransactionStatus
            : 'duplicated' as TransactionStatus;
          
          finalNotes += ` | Order payment: ${
            orderDetails && orderDetails.odrType === 'deposit' 
              ? 'Already fully paid, marked as available for redemption'
              : 'Already fully paid (withdraw order)'
          }`;
        } catch (orderError) {
          console.error('Overpayment processing error:', request.transactionId, orderError);
          finalStatus = 'available' as TransactionStatus;
          finalNotes += ` | Order payment: Already fully paid, marked as available`;
        }
      } else {
        finalNotes += ` | Order payment: Success`;
      }
    } else if (paymentResult.message) {
      finalNotes += ` | Order payment: Failed - ${paymentResult.message}`;
    }

    // Update final status
    try {
      await updateBankTransactionEntryStatus(entryResult.entry.$id, finalStatus, finalNotes);
    } catch (updateError) {
      console.error('Status update error for manual transaction:', request.transactionId, updateError);
    }

    const processingTime = performance.now() - processingStartTime;
    
    // Log successful manual replay
    await log.info(`Manual Webhook Replay - Transaction ${request.transactionId} (Order: ${odrId})`, {
      transactionId: request.transactionId,
      orderId: odrId,
      amount: request.amount,
      description: request.description,
      bankInfo: {
        bankId: bankResult.bank.bankId,
        bankName: request.bankName || bankResult.bank.bankName || '',
        accountNumber: request.bankAccountNumber,
        balanceAfter: request.balanceAfter || 0
      },
      processingResults: {
        status: finalStatus,
        processingTime: Math.round(processingTime * 100) / 100,
        bankUpdateSuccess: bankUpdateResult.success,
        paymentProcessSuccess: paymentResult.success,
        notes: finalNotes
      },
      manualVerification: {
        verifiedBy: request.verifiedBy,
        verificationNotes: request.verificationNotes || 'No additional notes',
        transactionType: request.transactionType
      },
      summary: {
        success: finalStatus === 'processed' || finalStatus === 'available',
        isManualReplay: true,
        timestamp: new Date().toISOString()
      }
    });

    return {
      success: true,
      transactionId: request.transactionId,
      orderId: odrId,
      status: finalStatus,
      bankId: bankResult.bank.bankId,
      amount: Math.floor(Math.abs(request.amount)),
      message: `Transaction ${finalStatus === 'processed' ? 'processed successfully' : 
                finalStatus === 'available' ? 'recorded as available' : 'processed with issues'} (manual replay)`,
      verifiedBy: request.verifiedBy
    };

  } catch (error) {
    const processingTime = performance.now() - processingStartTime;
    
    await log.error(`Manual Webhook Replay Failed - Transaction ${request.transactionId}`, 
      error instanceof Error ? error : new Error(String(error)), 
      {
        transactionId: request.transactionId,
        orderId: request.orderId || extractOrderId(request.description),
        amount: request.amount,
        verifiedBy: request.verifiedBy,
        processingTime: Math.round(processingTime * 100) / 100,
        timestamp: new Date().toISOString()
      });

    return {
      success: false,
      transactionId: request.transactionId,
      orderId: request.orderId || null,
      status: 'failed',
      message: `Error in manual replay: ${error instanceof Error ? error.message : String(error)}`,
      verifiedBy: request.verifiedBy
    };
  }
}

// POST /api/webhook/manual-replay - Manually replay missed webhook payments
export async function POST(request: NextRequest) {
  const requestStartTime = performance.now();
  
  try {
    // Parse request body
    const body = await request.json() as ManualWebhookRequest;
    
    // Validate admin key for security
    const ADMIN_WEBHOOK_KEY = process.env.ADMIN_WEBHOOK_KEY;
    if (!ADMIN_WEBHOOK_KEY || body.adminKey !== ADMIN_WEBHOOK_KEY) {
      await log.warn('Manual Webhook Replay - Unauthorized Access Attempt', {
        providedKey: body.adminKey ? 'PROVIDED' : 'MISSING',
        timestamp: new Date().toISOString(),
        userAgent: request.headers.get('user-agent') || 'unknown',
        ip: request.headers.get('x-forwarded-for') || 'unknown'
      });
      
      return NextResponse.json(
        { success: false, message: 'Unauthorized - Invalid admin key' },
        { status: 401 }
      );
    }

    // Process the manual webhook
    const result = await processManualWebhook(body);
    
    const processingTime = performance.now() - requestStartTime;
    
    // Log the manual replay attempt
    await log.info('Manual Webhook Replay Request Completed', {
      success: result.success,
      transactionId: result.transactionId,
      orderId: result.orderId,
      status: result.status,
      verifiedBy: result.verifiedBy,
      processingTime: Math.round(processingTime * 100) / 100,
      requestDetails: {
        amount: body.amount,
        transactionType: body.transactionType,
        bankAccountNumber: body.bankAccountNumber,
        description: body.description
      },
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: result.success,
      message: result.message,
      data: {
        transactionId: result.transactionId,
        orderId: result.orderId,
        status: result.status,
        bankId: result.bankId,
        amount: result.amount,
        verifiedBy: result.verifiedBy
      },
      performance: {
        processingTime: Math.round(processingTime * 100) / 100
      }
    });

  } catch (error) {
    const processingTime = performance.now() - requestStartTime;
    
    await log.error('Manual Webhook Replay - Request Processing Failed', 
      error instanceof Error ? error : new Error(String(error)), 
      {
        processingTime: Math.round(processingTime * 100) / 100,
        timestamp: new Date().toISOString(),
        userAgent: request.headers.get('user-agent') || 'unknown'
      });

    return NextResponse.json(
      { 
        success: false, 
        message: 'Internal server error during manual replay',
        performance: {
          processingTime: Math.round(processingTime * 100) / 100
        }
      },
      { status: 500 }
    );
  }
} 