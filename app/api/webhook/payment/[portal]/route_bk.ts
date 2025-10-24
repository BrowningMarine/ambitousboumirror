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

interface Props {
  params: {
    portal: string
  }
}

interface CassoflowTransaction {
  id: number;
  tid: string;
  description: string;
  amount: number;
  cusum_balance: number;
  when: string;
  bank_sub_acc_id: string;
  subAccId: string;
  bankName: string;
  bankAbbreviation: string;
  virtualAccount: string;
  virtualAccountName: string;
  corresponsiveName: string;
  corresponsiveAccount: string;
  corresponsiveBankId: string;
  corresponsiveBankName: string;
}

interface CassoflowPayload {
  error: number;
  data: CassoflowTransaction[];
}

interface WebhookResult {
  id: number | string;
  status: TransactionStatus;
  message: string;
  bankId?: string;
  odrId?: string | null;
  amount?: number;
}

// Define a specific type for transaction processing errors  
interface TransactionProcessingError {
  id: number | string;
  error: string;
  accountNumber?: string;
  transactionId?: string;
  odrId?: string;
  details?: Record<string, unknown>;
}

// Function to extract valid order ID from description  
function extractOrderId(description: string): string | null {
  if (!description) return null;

  //console.log("Attempting to extract order ID from:", description);  

  // First, look for the specific pattern ABO + 8 digits + 7 alphanumeric characters  
  // This will find ABO202504263FOTM9N in your example  
  const orderIdPattern = /ABO\d{8}[A-Z0-9]{7}/;
  const match = description.match(orderIdPattern);

  if (match) {
    //console.log("Found order ID with standard pattern:", match[0]);  
    return match[0];
  }

  // Second, try to find ABO followed by any characters  
  const aboPattern = /ABO[A-Z0-9\-]+/;
  const aboMatch = description.match(aboPattern);

  if (aboMatch) {
    // Clean up the result - remove any trailing non-alphanumeric characters  
    const cleanedId = aboMatch[0].split(/[-\s]/)[0];
    //console.log("Found ABO order ID:", cleanedId);  
    return cleanedId;
  }

  // Third, check if there's a reference code that might be an order ID   
  // Look for patterns like common reference prefixes in the middle of text  
  if (description.includes("ABO")) {
    // Extract text after "ABO" up to a space or delimiter  
    const parts = description.split("ABO");
    if (parts.length > 1) {
      const potentialId = "ABO" + parts[1].trim().split(/[\s\-]/)[0];
      //console.log("Extracted potential order ID after ABO:", potentialId);  
      return potentialId;
    }
  }

  // Last resort - just check if the first word looks like an order reference  
  const words = description.split(/\s+/);
  for (const word of words) {
    // Look for a word that's at least 10 characters (likely to be an ID)  
    if (word.length >= 10 && /^[A-Z0-9\-]+$/.test(word)) {
      //console.log("Using word as potential order ID:", word);  
      return word;
    }
  }

  //console.log("No order ID found in description");  
  return null;
}

// POST /api/webhook/payment - Receive payment updates from third-party  
export async function POST(
  request: NextRequest,
  context: Props
) {
  let respondMessage = "";
  const processingErrors: TransactionProcessingError[] = [];

  try {
    const params = await context.params;
    const portal = params.portal.toLowerCase();
    const payload = await request.text(); // Get raw payload  

    switch (portal) {
      case 'cassoflow':
        const VALIDAPIKEY = process.env.CASSOFLOW_WEBHOOK_APIKEY;
        const requestAPIKEY = request.headers.get('secure-token');

        // Validate API key  
        if (requestAPIKEY !== VALIDAPIKEY) {
          respondMessage = "Invalid API key";
          return NextResponse.json({ success: false, message: 'Invalid API key' }, { status: 401 });
        }
        //valid payload check
        if (!payload || payload.length === 0) {
          respondMessage = "Body required!";
          return NextResponse.json({ success: false, message: 'body required!' }, { status: 401 });
        }

        // Parse the payload  
        const payloadParsed = JSON.parse(payload) as CassoflowPayload;
        if (!payloadParsed || !payloadParsed.data || !Array.isArray(payloadParsed.data) || payloadParsed.data.length === 0) {
          respondMessage = "Invalid payload structure";
          return NextResponse.json({ success: false, message: 'Invalid payload structure' }, { status: 400 });
        }

        // Process each transaction in the payload  
        const results: WebhookResult[] = [];
        let successCount = 0;
        let failureCount = 0;
        let duplicateCount = 0;

        for (const transaction of payloadParsed.data) {
          try {
            // Check if Cassoflow already processed this transaction  
            const isDuplicate = await checkDuplicateTransaction('cassoflow', transaction.id.toString());
            if (isDuplicate) {
              results.push({
                id: transaction.id,
                status: 'duplicated',
                message: 'Transaction already processed'
              });
              duplicateCount++;
              continue;
            }

            // Extract proper order ID from description using the pattern  
            const odrId = extractOrderId(transaction.description);
            //console.log("Extracted order ID:", odrId);

            // Determine transaction type based on amount  
            const transactionType: TransactionType = transaction.amount < 0 ? 'debit' : 'credit';
            const transBankAccountNumber = transaction.bank_sub_acc_id || transaction.subAccId;
            if (!transBankAccountNumber) {
              results.push({
                id: transaction.id,
                status: 'failed',
                message: 'Bank account number not found in Cassoflow transfer'
              });
              failureCount++;
              processingErrors.push({
                id: transaction.id,
                error: 'Bank account number not found in Cassoflow transfer'
              });
              continue;
            }
            // get transactor bank account number  
            const bankResult = await findBankByAccountNumber(transBankAccountNumber);
            //console.log('Bank result:', bankResult);
            const transactorBank = bankResult.bank;

            //Create bank transaction first with pending status  
            const bankTransactionData: BankTransactionEntryData = {
              portalId: 'cassoflow',
              portalTransactionId: transaction.id.toString(),
              odrId: odrId || 'UNKNOWN', // Use 'UNKNOWN' if no order ID is found
              bankId: transactorBank?.$id,
              bankName: transaction.bankName || transactorBank?.bankName || '',
              bankAccountNumber: transBankAccountNumber,
              amount: Math.floor(transaction.amount), // Floor the amount to remove decimal places
              transactionType: transactionType,
              balanceAfter: Math.floor(transaction.cusum_balance), // Floor the balance as well
              transactionDate: transaction.when,
              rawPayload: JSON.stringify(transaction),
              status: 'pending',
              notes: !odrId
                ? 'Order ID not found in transaction description, recording transaction only'
                : (bankResult.success ? 'Bank found, processing transaction' : 'Bank not found in system')
            };

            // Create transaction entry first  
            const entryResult = await createBankTransactionEntry(bankTransactionData);

            if (!entryResult.success || !entryResult.entry) {
              results.push({
                id: transaction.id,
                status: 'failed',
                message: entryResult.message || 'Failed to create transaction entry'
              });
              failureCount++;
              processingErrors.push({
                id: transaction.id,
                error: entryResult.message || 'Failed to create transaction entry'
              });
              continue;
            }

            let finalStatus: TransactionStatus = 'pending';
            let finalNotes = '';

            // If no order ID was found, mark as recorded but don't process further
            if (!odrId) {
              finalStatus = 'unlinked' as TransactionStatus;
              finalNotes = 'Transaction recorded without order ID';

              // Update the transaction entry with final status
              try {
                await updateBankTransactionEntryStatus(
                  entryResult.entry.$id,
                  finalStatus,
                  finalNotes
                );
              } catch (updateError) {
                console.error(`Failed to update transaction ${transaction.id} status:`, updateError);
              }

              results.push({
                id: transaction.id,
                status: finalStatus,
                bankId: (bankResult.success && bankResult.bank) ? bankResult.bank.bankId : undefined,
                odrId: null,
                amount: Math.floor(transaction.amount),
                message: 'Transaction recorded without order ID'
              });

              // Count as success for recording purposes
              successCount++;
              continue;
            }

            // Now process the bank update if bank was found  
            if (bankResult.success && bankResult.bank) {
              // Update bank balance  
              const bankUpdateResult = await updateBankBalance(
                bankResult.bank.bankId,
                Math.abs(transaction.amount),
                true,
                true,
                transaction.amount > 0
              );

              // Set transaction status based on bank update result  
              finalStatus = bankUpdateResult.success ? 'processed' : 'failed';
              finalNotes = bankUpdateResult.success
                ? `Bank balance updated successfully. Previous: ${bankUpdateResult.previousBalance?.current}, New: ${bankUpdateResult.newBalance?.current}`
                : `Failed to update bank balance: ${bankUpdateResult.message || "Unknown error"}`;

              // For deposits with valid order IDs, process the payment  
              if (bankUpdateResult.success && Math.abs(transaction.amount) > 0 && odrId) {
                // Process the payment for this order  
                try {
                  const paymentResult = await proccessTransactionPayment(
                    odrId,
                    Math.abs(transaction.amount)
                  );
                  
                  // Check if this is an overpayment scenario
                  if (paymentResult.success && paymentResult.isOverpayment) {
                    // Transaction was already fully paid, so this is an overpayment
                    // Only set to 'available' if this is a deposit order (since available balance comes from credit transactions)
                    try {
                      const orderDetails = await getTransactionByOrderId(odrId);
                      if (orderDetails && orderDetails.odrType === 'deposit') {
                        finalStatus = 'available' as TransactionStatus;
                        finalNotes += ` | Order payment processing: Deposit transaction already fully paid, marked as available for redemption`;
                      } else {
                        // For withdraw orders or orders not found, keep as processed
                        finalStatus = 'duplicated' as TransactionStatus;
                        finalNotes += ` | Order payment processing: Transaction already fully paid (withdraw order - not marked as available)`;
                      }
                    } catch (orderError) {
                      console.error(`Error fetching order details for ${odrId}:`, orderError);
                      finalNotes += ` | Order payment processing: Transaction already fully paid (could not verify order type)`;
                    }
                  } else {
                    finalNotes += ` | Order payment processed: ${paymentResult.success ? 'Success' : `Failed error: ${paymentResult.message}`}`;
                  }
                } catch (paymentError) {
                  console.error(`Error processing payment for order ${odrId}:`, paymentError);
                  finalNotes += ` | Order payment processing error: ${paymentError instanceof Error ? paymentError.message : String(paymentError)}`;

                  // Log the specific error for debugging
                  processingErrors.push({
                    id: transaction.id,
                    error: `Payment processing error: ${paymentError instanceof Error ? paymentError.message : String(paymentError)}`,
                    transactionId: transaction.id.toString(),
                    odrId
                  });
                }
              }
            } else {
              // Bank not found  
              finalStatus = 'failed';
              finalNotes = `Bank with account number ${transaction.bank_sub_acc_id} not found in system`;
            }

            // Update the transaction entry with final status  
            try {
              await updateBankTransactionEntryStatus(
                entryResult.entry.$id,
                finalStatus,
                finalNotes
              );
            } catch (updateError) {
              console.error(`Failed to update transaction ${transaction.id} status:`, updateError);
              // Continue processing - we've already recorded the transaction  
            }

            // Add to results  
            results.push({
              id: transaction.id,
              status: finalStatus,
              bankId: (bankResult.success && bankResult.bank) ? bankResult.bank.bankId : undefined,
              odrId: odrId || null,
              amount: transaction.amount,
              message: `Transaction ${finalStatus === 'processed' ? 'processed successfully' : 
                      finalStatus === 'available' ? 'recorded as available for redemption' : 'failed'}`
            });

            // Update counters  
            if (finalStatus === 'processed' || finalStatus === 'available') {
              successCount++;
            } else {
              failureCount++;
              if (bankResult.success && bankResult.bank) {
                processingErrors.push({
                  id: transaction.id,
                  error: `Transaction failed: ${finalNotes}`,
                  details: { bankId: bankResult.bank.bankId }
                });
              } else {
                processingErrors.push({
                  id: transaction.id,
                  error: 'Bank account not found in system',
                  accountNumber: transaction.bank_sub_acc_id
                });
              }
            }
          } catch (error) {
            console.error(`Error processing transaction ${transaction.id}:`, error);
            failureCount++;

            processingErrors.push({
              id: transaction.id,
              error: `Exception during processing: ${error instanceof Error ? error.message : String(error)}`
            });

            results.push({
              id: transaction.id,
              status: 'failed',
              message: `Error processing transaction: ${error instanceof Error ? error.message : String(error)}`
            });
          }
        }
        // Create the log summary  
        respondMessage = `Processed ${payloadParsed.data.length} transactions: ${successCount} successful, ${failureCount} failed, ${duplicateCount} duplicates`;

        // Return the processing results  
        return NextResponse.json({
          success: true,
          message: respondMessage,
          results
        });

      default:
        return NextResponse.json({ success: false, message: 'Invalid portal name' }, { status: 400 });
    }

  } catch (error) {
    console.error('Error processing payment webhook:', error);
    return NextResponse.json(
      { success: false, message: 'Internal server error' },
      { status: 500 }
    );
  }
}