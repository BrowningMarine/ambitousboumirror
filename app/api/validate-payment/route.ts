import { extractOrderIdFromPaymentDescription } from '@/lib/utils';
import { NextResponse } from 'next/server';
import { logWebhookTransaction } from '@/utils/webhook';
import { updateBankBalance } from '@/lib/actions/bank.actions';
import { proccessTransactionPayment } from '@/lib/actions/transaction.actions';
import {
  createBankTransactionEntry,
  checkDuplicateTransaction,
  checkProcessedTransaction,
  findExistingTransaction,
  findBankByAccountNumber,
  updateBankTransactionEntryStatus,
  updateBankTransactionEntry,
  findAvailableTransactionByPortalId,
  TransactionStatus,
  TransactionType,
  BankTransactionEntryData
} from '@/lib/actions/bankTransacionEntry.action';
import { 
  validateSecretAgentPayment, 
  SecretAgentValidationRequest 
} from '@/lib/actions/secretAgentActions';

// The API keys are safely stored as environment variables on the server
const CASSOFLOW_MASTER_API_KEY = process.env.CASSOFLOW_MASTER_API_KEY || '';
const SEPAY_MASTER_API_KEY = process.env.SEPAY_MASTER_API_KEY || '';

// Interface for normalized payment data
interface NormalizedPaymentData {
  id: number;
  tid: string;
  description: string;
  amount: number;
  when: string;
  corresponsiveName: string;
  corresponsiveAccount: string;
  corresponsiveBankName: string;
  bankSubAccId: string;
  cusumBalance?: number;
}

// Function to normalize payment data from different API response formats
function normalizePaymentData(data: Record<string, unknown>, portal: string = 'cassoflow'): NormalizedPaymentData | null {
  // Sepay format
  if (portal === 'sepay' && data.status === 200 && data.data) {
    const paymentData = data.data as Record<string, unknown>;
    return {
      id: paymentData.id as number,
      tid: paymentData.transaction_id as string,
      description: paymentData.transaction_content as string,
      amount: paymentData.amount_in as number || paymentData.amount_out as number,
      when: paymentData.transaction_date as string,
      corresponsiveName: (paymentData.account_name as string) || '',
      corresponsiveAccount: (paymentData.account_number as string) || '',
      corresponsiveBankName: (paymentData.bank_brand_name as string) || '',
      bankSubAccId: (paymentData.account_number as string) || '',
      cusumBalance: paymentData.balance as number
    };
  }
  // Casso format - Check if it's the debit format (has 'data' wrapper and error field)
  else if (portal === 'cassoflow' && data.error === 0 && data.data) {
    const paymentData = data.data as Record<string, unknown>;
    return {
      id: paymentData.id as number,
      tid: paymentData.tid as string,
      description: paymentData.description as string,
      amount: paymentData.amount as number,
      when: paymentData.when as string,
      corresponsiveName: (paymentData.corresponsiveName as string) || '',
      corresponsiveAccount: (paymentData.corresponsiveAccount as string) || '',
      corresponsiveBankName: (paymentData.corresponsiveBankName as string) || '',
      bankSubAccId: (paymentData.bankSubAccId as string) || (paymentData.bank_sub_acc_id as string) || '',
      cusumBalance: paymentData.cusumBalance as number || paymentData.cusum_balance as number
    };
  } 
  // Casso credit format (direct fields, no error wrapper)
  else if (portal === 'cassoflow' && data.transaction_id) {
    return {
      id: data.transaction_id as number,
      tid: data.transaction_tid as string,
      description: data.transaction_description as string,
      amount: data.transaction_amount as number,
      when: data.tranaction_when as string, // Note: API has typo "tranaction_when"
      corresponsiveName: (data.transaction_corresponsive_name as string) || '',
      corresponsiveAccount: (data.transaction_corresponsive_account as string) || '',
      corresponsiveBankName: (data.transaction_corresponsive_bank_name as string) || '',
      bankSubAccId: (data.bank_sub_acc_id as string) || '',
      cusumBalance: data.transaction_cusum_balance as number
    };
  }
  
  return null;
}

/**
 * GET method for validating payment IDs
 */
export async function GET(request: Request) {
  // Extract the payment ID and expected values from the query parameters
  const url = new URL(request.url);
  const paymentId = url.searchParams.get('paymentId');
  const expectedOrderId = url.searchParams.get('orderId');
  const expectedAmountStr = url.searchParams.get('amount');
  const transactionType = url.searchParams.get('transactionType'); // 'deposit' or 'withdraw'
  const portal = url.searchParams.get('portal') || 'cassoflow'; // Default to cassoflow
  const expectedAmount = expectedAmountStr ? parseInt(expectedAmountStr, 10) : 0;

  // Payment ID is optional - if not provided, we'll auto-detect using odrId
  if (!paymentId && !expectedOrderId) {
    return NextResponse.json(
      { error: 1, message: 'Either Payment ID or Order ID is required' },
      { status: 400 }
    );
  }

  try {
    // FIRST: Check if this payment ID exists as an available bank transaction entry
    const availableTransactionResult = await findAvailableTransactionByPortalId(portal, paymentId || '');
    
    if (availableTransactionResult.success && availableTransactionResult.entry) {
      // Found an available transaction entry, use it for validation
      const availableEntry = availableTransactionResult.entry;
      
      // Extract order ID from the available transaction's notes or description
      let extractedOrderId: string | null = null;
      try {
        const rawPayload = availableEntry.rawPayload ? JSON.parse(availableEntry.rawPayload) : null;
        if (rawPayload && rawPayload.description) {
          extractedOrderId = extractOrderIdFromPaymentDescription(rawPayload.description);
        }
      } catch {
        // Could not parse raw payload for available transaction
      }
      
      // Handle both deposit and withdraw orders
      const actualAmount = Math.floor(availableEntry.amount);
      const isDebitTransaction = actualAmount < 0;
      
      // Determine expected amount and validation based on transaction type
      let expectedFinalAmount: number;
      let amountMatch: boolean;
      let isCorrectTransactionType: boolean;
      
      if (transactionType === 'withdraw') {
        // For withdraw orders: expect negative amount (debit transaction)
        expectedFinalAmount = -Math.abs(expectedAmount);
        amountMatch = actualAmount === expectedFinalAmount;
        isCorrectTransactionType = isDebitTransaction;
      } else if (transactionType === 'deposit') {
        // For deposit orders: expect positive amount (credit transaction)
        expectedFinalAmount = Math.abs(expectedAmount);
        amountMatch = actualAmount === expectedFinalAmount;
        isCorrectTransactionType = !isDebitTransaction;
      } else {
        // Default to withdraw behavior for backward compatibility
        expectedFinalAmount = -Math.abs(expectedAmount);
        amountMatch = actualAmount === expectedFinalAmount;
        isCorrectTransactionType = isDebitTransaction;
      }
      
      // Create response for available transaction
      const availableResponse = {
        error: 0,
        message: 'success',
        data: {
          id: parseInt(availableEntry.portalTransactionId),
          tid: availableEntry.portalTransactionId,
          description: extractedOrderId ? `Available redemption for ${extractedOrderId}` : 'Available for redemption',
          amount: availableEntry.amount,
          when: availableEntry.transactionDate,
          corresponsiveName: 'Payment Bank Owner Name',
          corresponsiveAccount: availableEntry.bankAccountNumber,
          corresponsiveBankName: availableEntry.bankName,
          bank_sub_acc_id: availableEntry.bankAccountNumber,
          cusum_balance: availableEntry.balanceAfter || 0
        },
        alreadyProcessed: false, // Available transactions are not considered processed
        isAvailableRedemption: true, // Flag to indicate this is from available balance
        validation: {
          extractedOrderId,
          expectedOrderId,
          orderIdMatch: Boolean(expectedOrderId && extractedOrderId === expectedOrderId),
          expectedAmount: expectedFinalAmount,
          actualAmount,
          amountMatch: Boolean(amountMatch),
          isDebitTransaction: Boolean(isDebitTransaction),
          isValid: false
        }
      };
      
      // Set overall validation status for available redemption
      // Only require amount match and correct transaction type (order ID doesn't need to match for redemptions)
      availableResponse.validation.isValid = 
        availableResponse.validation.amountMatch && isCorrectTransactionType;
      
      return NextResponse.json(availableResponse);
    }

    // SECOND: Try SecretAgent validation (for secretagent portal or when enabled)
    if (portal === 'secretagent' || !paymentId) {
      try {
        const secretAgentRequest: SecretAgentValidationRequest = {
          paymentId: paymentId || undefined,
          odrId: expectedOrderId || '',
          expectedAmount: expectedAmount,
          odrType: (transactionType as 'deposit' | 'withdraw') || 'deposit'
        };

        const secretAgentValidation = await validateSecretAgentPayment(secretAgentRequest);
        
        if (secretAgentValidation.success) {
          // Create response with Supabase validation data
          const firstTransaction = secretAgentValidation.transactions.length > 0 ? secretAgentValidation.transactions[0] : null;
          const secretAgentResponse = {
            error: 0,
            message: secretAgentValidation.message,
            data: firstTransaction ? {
              id: firstTransaction.id || 0,
              tid: (firstTransaction.id || 0).toString(),
              description: firstTransaction.content || '',
              amount: secretAgentValidation.validatedAmount * (transactionType === 'withdraw' ? -1 : 1),
              when: firstTransaction.transactiondate || '',
              corresponsiveName: `SecretAgent Bank Owner Name`,
              corresponsiveAccount: firstTransaction.acc_num || firstTransaction.accountNumber || '',
              corresponsiveBankName: 'SecretAgent Bank Name'
            } : null,
            validation: {
              extractedOrderId: expectedOrderId,
              expectedOrderId: expectedOrderId,
              orderIdMatch: true, // Always true for Supabase since we search by odrId
              expectedAmount: expectedAmount,
              actualAmount: secretAgentValidation.validatedAmount,
              amountMatch: secretAgentValidation.isExactMatch || secretAgentValidation.isSumMatch,
              isDebitTransaction: transactionType === 'withdraw',
              isValid: true,
              secretAgentDetails: {
                usedTransactionIds: secretAgentValidation.usedTransactionIds,
                isExactMatch: secretAgentValidation.isExactMatch,
                isSumMatch: secretAgentValidation.isSumMatch,
                totalTransactions: secretAgentValidation.transactions.length
              }
            },
            secretAgentValidation: secretAgentValidation
          };

          return NextResponse.json(secretAgentResponse);
        } else if (paymentId) {
          // If Supabase validation failed but we have a paymentId, try other portals
        } else {
          // No paymentId and Supabase validation failed
          return NextResponse.json(
            { error: 1, message: secretAgentValidation.message },
            { status: 404 }
          );
        }
      } catch (secretAgentError) {
        if (!paymentId) {
          // If no paymentId provided and Supabase fails, return error
          return NextResponse.json(
            { error: 1, message: `SecretAgent validation failed: ${secretAgentError instanceof Error ? secretAgentError.message : 'Unknown error'}` },
            { status: 500 }
          );
        }
        // If paymentId provided, continue to other portal validation
      }
    }

    // THIRD: If no available transaction found, proceed with external API call
    let response: Response;

    if (portal === 'sepay') {
      if (!SEPAY_MASTER_API_KEY) {
        return NextResponse.json(
          { error: 1, message: 'Sepay API token not configured' },
          { status: 500 }
        );
      }

      // Make the request to the Sepay API
      response = await fetch(`https://my.sepay.vn/userapi/transactions/details/${paymentId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${SEPAY_MASTER_API_KEY}`,
          'Content-Type': 'application/json'
        }
      });
    } else {
      // Default to Cassoflow
      if (!CASSOFLOW_MASTER_API_KEY) {
        return NextResponse.json(
          { error: 1, message: 'Cassoflow API key not configured' },
          { status: 500 }
        );
      }

      // Ensure API key has the correct format with 'Apikey ' prefix
      let authHeader = CASSOFLOW_MASTER_API_KEY;
      if (authHeader && !authHeader.startsWith('Apikey ')) {
        authHeader = `Apikey ${authHeader}`;
      }

      // Make the request to the Casso API
      response = await fetch(`https://oauth.casso.vn/v2/transactions/${paymentId}`, {
        method: 'GET',
        headers: {
          'Authorization': authHeader
        }
      });
    }

    // If the API returns an error, forward it with appropriate status
    if (!response.ok) {
      let errorMessage = 'There is no payment with this payment ID';
      
      if (response.status === 500) {
        errorMessage = 'Server error when checking payment ID';
      } else if (response.status === 401 || response.status === 403) {
        errorMessage = 'Authorization error with payment provider';
      }

      return NextResponse.json(
        { error: 1, message: errorMessage },
        { status: response.status }
      );
    }

    // Parse the successful response
    const data = await response.json();
    
    // Normalize the payment data to handle both debit and credit formats
    const normalizedPayment = normalizePaymentData(data, portal);
    
    if (normalizedPayment) {
      // Check if this payment ID has already been successfully processed in our system
      const isAlreadyProcessed = await checkProcessedTransaction(portal, paymentId.toString());
      
      // Extract order ID from the payment description
      const extractedOrderId = extractOrderIdFromPaymentDescription(normalizedPayment.description);
      
      // Handle both deposit and withdraw orders
      const actualAmount = Math.floor(normalizedPayment.amount);
      const isDebitTransaction = actualAmount < 0;
      
      // Determine expected amount and validation based on transaction type
      let expectedFinalAmount: number;
      let amountMatch: boolean;
      let isCorrectTransactionType: boolean;
      
      if (transactionType === 'withdraw') {
        // For withdraw orders: expect negative amount (debit transaction)
        expectedFinalAmount = -Math.abs(expectedAmount);
        amountMatch = actualAmount === expectedFinalAmount;
        isCorrectTransactionType = isDebitTransaction;
      } else if (transactionType === 'deposit') {
        // For deposit orders: expect positive amount (credit transaction)
        expectedFinalAmount = Math.abs(expectedAmount);
        amountMatch = actualAmount === expectedFinalAmount;
        isCorrectTransactionType = !isDebitTransaction;
      } else {
        // Default to withdraw behavior for backward compatibility
        expectedFinalAmount = -Math.abs(expectedAmount);
        amountMatch = actualAmount === expectedFinalAmount;
        isCorrectTransactionType = isDebitTransaction;
      }
      
      // Create enhanced response with validation details
      const enhancedResponse = {
        error: 0,
        message: 'success',
        data: {
          id: normalizedPayment.id,
          tid: normalizedPayment.tid,
          description: normalizedPayment.description,
          amount: normalizedPayment.amount,
          when: normalizedPayment.when,
          corresponsiveName: normalizedPayment.corresponsiveName,
          corresponsiveAccount: normalizedPayment.corresponsiveAccount,
          corresponsiveBankName: normalizedPayment.corresponsiveBankName,
          bank_sub_acc_id: normalizedPayment.bankSubAccId,
          cusum_balance: normalizedPayment.cusumBalance || 0
        },
        alreadyProcessed: Boolean(isAlreadyProcessed),
        validation: {
          extractedOrderId,
          expectedOrderId,
          orderIdMatch: Boolean(expectedOrderId && extractedOrderId === expectedOrderId),
          expectedAmount: expectedFinalAmount,
          actualAmount,
          amountMatch: Boolean(amountMatch),
          isDebitTransaction: Boolean(isDebitTransaction),
          isValid: false
        }
      };
      
      // Set overall validation status (but only if not already processed)
      // Must have correct transaction type, exact amount match, and order ID match
      enhancedResponse.validation.isValid = 
        !isAlreadyProcessed && 
        enhancedResponse.validation.orderIdMatch && 
        enhancedResponse.validation.amountMatch &&
        isCorrectTransactionType;
      
      return NextResponse.json(enhancedResponse);
    }
    
    // Return error if we couldn't normalize the data
    return NextResponse.json(
      { error: 1, message: 'Invalid payment data format' },
      { status: 400 }
    );
  } catch {
    return NextResponse.json(
      { error: 1, message: 'Failed to validate payment' },
      { status: 500 }
    );
  }
}

/**
 * POST method for manually processing payments
 */
export async function POST(request: Request) {
  try {
    // Parse the request body
    const body = await request.json();
    const { 
      paymentId, 
      orderId,
      expectedAmount,
      transactionType: orderType = 'withdraw', // Default to withdraw for backward compatibility
      portal = 'cassoflow' // Default to cassoflow
    } = body;

    if ((!paymentId && !orderId) || !expectedAmount) {
      return NextResponse.json(
        { success: false, message: 'Either Payment ID or Order ID, and expected amount are required' },
        { status: 400 }
      );
    }

    // 1. First check if this payment ID exists as an available bank transaction entry
    const availableTransactionResult = await findAvailableTransactionByPortalId(portal, paymentId || '');
    
    let paymentData: NormalizedPaymentData | undefined;
    let isFromAvailableRedemption = false;
    
    if (availableTransactionResult.success && availableTransactionResult.entry) {
      // Use the available transaction entry data
      isFromAvailableRedemption = true;
      const availableEntry = availableTransactionResult.entry;
      
      // Convert available entry to normalized payment data format
      paymentData = {
        id: parseInt(availableEntry.portalTransactionId),
        tid: availableEntry.portalTransactionId,
        description: availableEntry.notes || 'Available for redemption',
        amount: availableEntry.amount,
        when: availableEntry.transactionDate,
        corresponsiveName: 'Payment Bank Owner Name',
        corresponsiveAccount: availableEntry.bankAccountNumber,
        corresponsiveBankName: availableEntry.bankName,
        bankSubAccId: availableEntry.bankAccountNumber,
        cusumBalance: availableEntry.balanceAfter || 0
      };
    } else {
      // 1b. Try Supabase validation and processing (for secretagent portal or when no paymentId)
      if (portal === 'secretagent' || !paymentId) {
        try {
          const secretAgentRequest: SecretAgentValidationRequest = {
            paymentId: paymentId || undefined,
            odrId: orderId,
            expectedAmount: expectedAmount,
            odrType: orderType as 'deposit' | 'withdraw'
          };

          const secretAgentValidation = await validateSecretAgentPayment(secretAgentRequest);
          
          if (secretAgentValidation.success && secretAgentValidation.transactions.length > 0) {
            // Use Supabase validation result for processing
            const primaryTransaction = secretAgentValidation.transactions[0];
            
            paymentData = {
              id: primaryTransaction.id || 0,
              tid: (primaryTransaction.id || 0).toString(),
              description: primaryTransaction.content || '',
              amount: secretAgentValidation.validatedAmount * (orderType === 'withdraw' ? -1 : 1),
              when: primaryTransaction.transactiondate || primaryTransaction.trans_date || '',
              corresponsiveName: 'SecretAgent Bank Owner Name',
              corresponsiveAccount: primaryTransaction.acc_num || primaryTransaction.accountNumber || '',
              corresponsiveBankName: primaryTransaction.bank_name || 'SecretAgent Bank Name',
              bankSubAccId: primaryTransaction.acc_num || primaryTransaction.accountNumber || '',
              cusumBalance: primaryTransaction.balance || 0
            };
            
            // Skip to processing (don't fetch from external API)
            isFromAvailableRedemption = false; // Mark as external since we're creating new bank entries
          } else if (!paymentId) {
            // No paymentId and Supabase validation failed
            return NextResponse.json({
              success: false,
              message: secretAgentValidation.message || 'No matching transactions found in SecretAgent data',
              status: 'failed'
            });
          } else {
            // SecretAgent validation failed, trying external APIs
          }
        } catch (secretAgentError) {
          if (!paymentId) {
            return NextResponse.json({
              success: false,
              message: `SecretAgent processing failed: ${secretAgentError instanceof Error ? secretAgentError.message : 'Unknown error'}`,
              status: 'failed'
            });
          }
          // If paymentId provided, continue to external API validation
        }
      }

      // 1c. If no available transaction found and no Supabase success, fetch from external API
      if (!paymentData) {
        let response: Response;

        if (portal === 'sepay') {
          if (!SEPAY_MASTER_API_KEY) {
            return NextResponse.json(
              { success: false, message: 'Sepay API token not configured' },
              { status: 500 }
            );
          }

        response = await fetch(`https://my.sepay.vn/userapi/transactions/details/${paymentId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${SEPAY_MASTER_API_KEY}`,
            'Content-Type': 'application/json'
          }
        });
      } else {
        // Default to Cassoflow
        if (!CASSOFLOW_MASTER_API_KEY) {
          return NextResponse.json(
            { success: false, message: 'Cassoflow API key not configured' },
            { status: 500 }
          );
        }

        // Ensure API key has the correct format with 'Apikey ' prefix
        let authHeader = CASSOFLOW_MASTER_API_KEY;
        if (authHeader && !authHeader.startsWith('Apikey ')) {
          authHeader = `Apikey ${authHeader}`;
        }

        response = await fetch(`https://oauth.casso.vn/v2/transactions/${paymentId}`, {
          method: 'GET',
          headers: {
            'Authorization': authHeader
          }
        });
      }

      if (!response.ok) {
        return NextResponse.json(
          { success: false, message: `Failed to fetch payment details: ${response.statusText}` },
          { status: response.status }
        );
      }

      const data = await response.json();
      
      // Normalize the payment data to handle both debit and credit formats
      const normalizedData = normalizePaymentData(data, portal);
      
      if (!normalizedData) {
        return NextResponse.json(
          { success: false, message: 'Invalid payment data returned from provider' },
          { status: 400 }
        );
      }
      
      paymentData = normalizedData;
      }
    }

    // Ensure we have payment data before proceeding
    if (!paymentData) {
      return NextResponse.json({
        success: false,
        message: 'No valid payment data found from any source',
        status: 'failed'
      });
    }

    // 1.5. Validate amount and transaction type based on order type
    const actualAmount = Math.floor(paymentData.amount);
    const isDebitTransaction = actualAmount < 0;
    
    // Determine expected amount and validation based on order type
    let expectedFinalAmount: number;
    let amountMatch: boolean;
    let isCorrectTransactionType: boolean;
    
    if (orderType === 'withdraw') {
      // For withdraw orders: expect negative amount (debit transaction)
      expectedFinalAmount = -Math.abs(expectedAmount);
      amountMatch = actualAmount === expectedFinalAmount;
      isCorrectTransactionType = isDebitTransaction;
      
      if (!isCorrectTransactionType) {
        return NextResponse.json({
          success: false,
          message: `Invalid transaction type: Withdraw orders must be debit transactions (negative amount). Found: ${actualAmount}`,
          status: 'failed'
        });
      }
    } else if (orderType === 'deposit') {
      // For deposit orders: expect positive amount (credit transaction)
      expectedFinalAmount = Math.abs(expectedAmount);
      amountMatch = actualAmount === expectedFinalAmount;
      isCorrectTransactionType = !isDebitTransaction;
      
      if (!isCorrectTransactionType) {
        return NextResponse.json({
          success: false,
          message: `Invalid transaction type: Deposit orders must be credit transactions (positive amount). Found: ${actualAmount}`,
          status: 'failed'
        });
      }
    } else {
      // Default to withdraw behavior for backward compatibility
      expectedFinalAmount = -Math.abs(expectedAmount);
      amountMatch = actualAmount === expectedFinalAmount;
      isCorrectTransactionType = isDebitTransaction;
      
      if (!isCorrectTransactionType) {
        return NextResponse.json({
          success: false,
          message: `Invalid transaction type: Orders must be debit transactions (negative amount). Found: ${actualAmount}`,
          status: 'failed'
        });
      }
    }
    
    if (!amountMatch) {
      return NextResponse.json({
        success: false,
        message: `Amount mismatch: Expected ${expectedFinalAmount}, but found ${actualAmount}. Exact amount match is required.`,
        status: 'failed'
      });
    }

    // 2. Check processing eligibility based on source
    let isAlreadyProcessed = false;
    let existsAsUnlinked = false;
    
    if (isFromAvailableRedemption) {
      // For available redemptions, we can always process (they're specifically marked as available)
    } else {
      // For external API transactions, check if already processed
      // SKIP this check for SecretAgent portal as it uses different validation logic
      if (portal !== 'secretagent') {
        isAlreadyProcessed = await checkProcessedTransaction(portal, paymentId.toString());
        if (isAlreadyProcessed) {
          console.error(`SECURITY: Attempt to process already processed payment: PaymentID ${paymentId}, OrderID ${orderId}`);
          return NextResponse.json({
            success: false,
            message: 'SECURITY VIOLATION: This payment has already been successfully processed. Processing is not allowed for already processed payments.',
            status: 'duplicated'
          });
        }
      } else {
        // For SecretAgent, we rely on its own validation logic to prevent duplicates
      }

      // Check if this transaction exists but is unlinked (allow processing)
      existsAsUnlinked = await checkDuplicateTransaction(portal, paymentId.toString());
      if (existsAsUnlinked && !isAlreadyProcessed) {
        // Processing existing unlinked transaction
      }
    }

    // 2.5. Extract order ID from payment description for logging purposes
    const extractedOrderId = extractOrderIdFromPaymentDescription(paymentData.description);

    // 3. Determine transaction type based on amount  
    const transactionType: TransactionType = paymentData.amount < 0 ? 'debit' : 'credit';
    const transBankAccountNumber = paymentData.bankSubAccId;
    if (!transBankAccountNumber) {
      return NextResponse.json({
        success: false, 
        message: 'Bank account number not found in payment data',
        status: 'failed'
      });
    }

    // 4. Find the bank account in the system
    const bankResult = await findBankByAccountNumber(transBankAccountNumber);
    const transactorBank = bankResult.bank;

    // 5. Handle bank transaction entry based on source
    let entryResult;
    
    if (isFromAvailableRedemption && availableTransactionResult.entry) {
      // For available redemptions, update the existing entry to link it to the order
      entryResult = await updateBankTransactionEntry(
        availableTransactionResult.entry.$id,
        {
          status: 'pending', // Will be updated to 'processed' later if successful
          odrId: orderId,
          notes: `${availableTransactionResult.entry.notes || ''} | Redeemed for Order ID: ${orderId}. Manually processed by staff`
        }
      );
    } else {
      // For external API transactions, create or update as before
      const bankTransactionData: BankTransactionEntryData = {
        portalId: portal,
        portalTransactionId: paymentId.toString(),
        odrId: orderId, // Use the manually provided order ID
        bankId: transactorBank?.$id,
        bankName: transactorBank?.bankName || '',
        bankAccountNumber: transBankAccountNumber,
        amount: Math.floor(paymentData.amount), // Floor the amount to remove decimal places
        transactionType: transactionType,
        balanceAfter: Math.floor(paymentData.cusumBalance || 0), // Floor the balance as well
        transactionDate: paymentData.when,
        rawPayload: JSON.stringify(paymentData),
        status: 'pending',
        notes: 'Manually processed payment by staff'
      };

      // Check if transaction already exists and update it, or create new one
      if (existsAsUnlinked && !isAlreadyProcessed) {
        // Find and update existing unlinked transaction
        const existingResult = await findExistingTransaction(portal, paymentId.toString());
        if (existingResult.success && existingResult.entry) {
          // Update the existing transaction with the new order ID and notes
          entryResult = await updateBankTransactionEntry(
            existingResult.entry.$id,
            {
              status: 'pending',
              odrId: orderId,
              notes: `${existingResult.entry.notes || ''} | Updated with Order ID: ${orderId}. Manually processed payment by staff`
            }
          );
        } else {
          // Fallback to creating new entry if we can't find the existing one
          entryResult = await createBankTransactionEntry(bankTransactionData);
        }
      } else {
        // Create new transaction entry  
        entryResult = await createBankTransactionEntry(bankTransactionData);
      }
    }

    if (!entryResult.success || !entryResult.entry) {
      return NextResponse.json({ 
        success: false, 
        message: entryResult.message || 'Failed to create/update transaction entry',
        status: 'failed'
      });
    }

    let finalStatus: TransactionStatus = 'pending';
    let finalNotes = '';
    let processResult = null;

    // 6. Process the bank update and payment processing
    if (isFromAvailableRedemption) {
      // For available redemptions, skip bank balance update (already done when original overpayment was processed)
      // Just process the payment to the order
      finalStatus = 'processed';
      finalNotes = 'Available balance redemption - no bank balance update needed';
      
      // Process the payment directly
      try {
        processResult = await proccessTransactionPayment(
          orderId,
          Math.abs(paymentData.amount)
        );
        finalNotes += ` | Order payment processed: ${processResult.success ? 'Success' : `Failed error: ${processResult.message}`}`;
        
        if (!processResult.success) {
          finalStatus = 'failed';
        }
      } catch (paymentError) {
        finalNotes += ` | Order payment processing error: ${paymentError instanceof Error ? paymentError.message : String(paymentError)}`;
        finalStatus = 'failed';
      }
    } else if (bankResult.success && bankResult.bank) {
      // For external API transactions, update bank balance first
      const bankUpdateResult = await updateBankBalance(
        bankResult.bank.bankId,
        Math.abs(paymentData.amount),
        true,
        true,
        paymentData.amount > 0
      );

      // Set transaction status based on bank update result  
      finalStatus = bankUpdateResult.success ? 'processed' : 'failed';
      finalNotes = bankUpdateResult.success
        ? `Bank balance updated successfully. Previous: ${bankUpdateResult.previousBalance?.current}, New: ${bankUpdateResult.newBalance?.current}`
        : `Failed to update bank balance: ${bankUpdateResult.message || "Unknown error"}`;

      // 7. For valid transactions, always process the payment using the manually provided order ID
      // Staff has already confirmed this payment belongs to this order
      if (bankUpdateResult.success && Math.abs(paymentData.amount) > 0) {
        try {
          processResult = await proccessTransactionPayment(
            orderId,
            Math.abs(paymentData.amount)
          );
          finalNotes += ` | Order payment processed: ${processResult.success ? 'Success' : `Failed error: ${processResult.message}`}`;
          
          // Log if there was an Order ID mismatch but staff forced it
          if (extractedOrderId && extractedOrderId !== orderId) {
            finalNotes += ` | Note: Order ID mismatch (extracted: ${extractedOrderId}, provided: ${orderId}) - Staff confirmed`;
          }
        } catch (paymentError) {
          finalNotes += ` | Order payment processing error: ${paymentError instanceof Error ? paymentError.message : String(paymentError)}`;
          finalStatus = 'failed';
        }
      }
    } else {
      // Bank not found  
      finalStatus = 'failed';
      finalNotes = `Bank with account number ${transBankAccountNumber} not found in system`;
    }

    // Update the transaction entry with final status
    try {
      await updateBankTransactionEntryStatus(
        entryResult.entry.$id,
        finalStatus,
        finalNotes
      );
    } catch {
      // Continue processing - we've already recorded the transaction
    }

    // 8. Log the manual processing action
    await logWebhookTransaction({
      success: finalStatus === 'processed',
      message: `Manual payment processing: ${finalStatus === 'processed' ? 'success' : 'failed'}`,
      status: finalStatus,
      orderId: orderId,
      data: JSON.stringify({
        paymentId,
        amount: paymentData.amount,
        bankAccountNumber: transBankAccountNumber,
        notes: finalNotes,
        isAvailableRedemption: isFromAvailableRedemption
      }),
      source: isFromAvailableRedemption ? 'available-balance-redemption' : 'manual-payment-processing'
    });

    // 9. Return the result
    return NextResponse.json({
      success: finalStatus === 'processed',
      message: finalNotes,
      status: finalStatus,
      transactionId: entryResult.entry.$id,
      paymentId,
      orderId,
      amount: paymentData.amount,
      processResult,
      isAvailableRedemption: isFromAvailableRedemption
    });
  } catch (error) {
    // Log the error
    await logWebhookTransaction({
      success: false,
      message: `Error in manual payment processing: ${error instanceof Error ? error.message : String(error)}`,
      status: 'error',
      data: JSON.stringify({
        error: error instanceof Error ? error.stack : String(error)
      }),
      source: 'manual-payment-processing'
    });
    
    return NextResponse.json(
      { success: false, message: 'Server error processing payment' },
      { status: 500 }
    );
  }
} 