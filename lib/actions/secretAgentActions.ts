// Types for Supabase banktransaction table response
export interface SecretAgentBankTransaction {
  id: number; // SecretAgent specific field for transaction ID
  id_bank?: string; 
  created_at: string;
  amount: number;
  trans_date?: string; // Alternative date field
  transactiondate: string;
  content: string;
  odrId: string;
  odr_id?: string; // Alternative field name
  odrType: "deposit" | "withdraw";
  odr_type?: "deposit" | "withdraw"; // Alternative field name
  accountNumber: string | null;
  acc_num?: string; // SecretAgent specific field for account number
  balance: number | null;
  bank_name?: string; // Additional SecretAgent fields
  ref_acc_num?: string;
  ref_acc_name?: string;
}

export interface SecretAgentValidationRequest {
  paymentId?: string; // Optional payment ID
  odrId: string; // Required order ID
  expectedAmount: number; // Expected amount for validation
  odrType: "deposit" | "withdraw"; // Order type
}

export interface SecretAgentValidationResult {
  success: boolean;
  message: string;
  transactions: SecretAgentBankTransaction[];
  validatedAmount: number;
  isExactMatch: boolean;
  isSumMatch: boolean;
  usedTransactionIds: number[];
}

/**
 * Validate payment using SecretAgent banktransaction table
 * Can use either paymentId or auto-detect using odrId
 */
export async function validateSecretAgentPayment(
  request: SecretAgentValidationRequest
): Promise<SecretAgentValidationResult> {
  try {
    // Get SecretAgent credentials from environment
    const SECRET_AGENT_URL = process.env.SECRETAGENT_SUPABASE_URL;
    //const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const SECRET_AGENT_API_KEY = process.env.SECRETAGENT_API_KEY;

    if (!SECRET_AGENT_URL || !SECRET_AGENT_API_KEY) {
      throw new Error('Missing SecretAgent configuration or Secret Agent API key');
    }

    let secretAgentQuery: string;
    let transactions: SecretAgentBankTransaction[] = [];

    // Build query based on whether paymentId is provided
    if (request.paymentId) {
      // If paymentId is provided, query by specific ID
      secretAgentQuery = `${SECRET_AGENT_URL}/rest/v1/banktransaction?select=*&id=in.(${request.paymentId})`;
    } else {
      // If no paymentId, auto-detect using odrId and odrType
      secretAgentQuery = `${SECRET_AGENT_URL}/rest/v1/banktransaction?select=*&odr_id=eq.${encodeURIComponent(request.odrId)}&odr_type=eq.${request.odrType}`;
    }

    // Make request to Supabase
    const response = await fetch(secretAgentQuery, {
      method: 'GET',
      headers: {
        'apikey': SECRET_AGENT_API_KEY,
        'Authorization': `Bearer ${SECRET_AGENT_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`SecretAgent API error: ${response.status} ${response.statusText}`);
    }

    transactions = await response.json();

    // If no transactions found
    if (!transactions || transactions.length === 0) {
      return {
        success: false,
        message: request.paymentId 
          ? `No transaction found with payment ID: ${request.paymentId}`
          : `No transactions found for order ID: ${request.odrId} with type: ${request.odrType}`,
        transactions: [],
        validatedAmount: 0,
        isExactMatch: false,
        isSumMatch: false,
        usedTransactionIds: []
      };
    }

    // Sort transactions by amount descending to prioritize larger amounts first
    transactions.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

    const expectedAmount = Math.abs(request.expectedAmount);
    let validatedAmount = 0;
    let usedTransactionIds: number[] = [];

    // Strategy 1: Look for exact match (single transaction with sufficient amount)
    const exactMatch = transactions.find(tx => Math.abs(tx.amount) >= expectedAmount);
    
    if (exactMatch) {
      // Found a single transaction with enough amount
      validatedAmount = Math.abs(exactMatch.amount);
      usedTransactionIds = [exactMatch.id];
      
      return {
        success: true,
        message: `Validation successful: Found transaction with sufficient amount (${validatedAmount.toLocaleString()} VND)`,
        transactions: [exactMatch],
        validatedAmount,
        isExactMatch: true,
        isSumMatch: false,
        usedTransactionIds
      };
    }

    // Strategy 2: Sum multiple transactions to reach expected amount
    validatedAmount = 0;
    usedTransactionIds = [];
    
    for (const tx of transactions) {
      const txAmount = Math.abs(tx.amount);
      
      if (validatedAmount + txAmount <= expectedAmount) {
        validatedAmount += txAmount;
        usedTransactionIds.push(tx.id);
        
        // Check if we've reached the expected amount exactly
        if (validatedAmount === expectedAmount) {
          break;
        }
      }
    }

    // Check if sum is sufficient
    if (validatedAmount >= expectedAmount) {
      return {
        success: true,
        message: `Validation successful: Sum of ${usedTransactionIds.length} transactions (${validatedAmount.toLocaleString()} VND) covers expected amount`,
        transactions: transactions.filter(tx => usedTransactionIds.includes(tx.id)),
        validatedAmount,
        isExactMatch: false,
        isSumMatch: true,
        usedTransactionIds
      };
    }

    // Insufficient funds
    return {
      success: false,
      message: `Insufficient funds: Total available (${validatedAmount.toLocaleString()} VND) is less than required (${expectedAmount.toLocaleString()} VND)`,
      transactions,
      validatedAmount,
      isExactMatch: false,
      isSumMatch: false,
      usedTransactionIds
    };

  } catch (error) {
    console.error('SecretAgent validation error:', error);
    return {
      success: false,
      message: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      transactions: [],
      validatedAmount: 0,
      isExactMatch: false,
      isSumMatch: false,
      usedTransactionIds: []
    };
  }
}

/**
 * Create bank transaction entries for validated SecretAgent transactions
 */
export async function createBankTransactionFromSecretAgent(
  validationResult: SecretAgentValidationResult,
  bankId: string,
  bankAccountNumber: string,
  odrId: string
) {
  // Import the required actions
  const { createBankTransactionEntry } = await import('./bankTransacionEntry.action');
  
  const entries = [];
  
  for (const tx of validationResult.transactions) {
    const transactionType = tx.amount < 0 ? 'debit' : 'credit';
    
    const bankTransactionData = {
      portalId: 'secretagent',
      portalTransactionId: tx.id.toString(),
      odrId: odrId,
      bankId: bankId,
      bankName: 'SecretAgent default bank',
      bankAccountNumber: bankAccountNumber,
      amount: Math.floor(tx.amount),
      transactionType: transactionType as 'debit' | 'credit',
      balanceAfter: Math.floor(tx.balance || 0),
      transactionDate: tx.transactiondate,
      rawPayload: JSON.stringify(tx),
      status: 'processed' as const,
      notes: `Validated via SecretAgent API - Order ID: ${odrId}, Type: ${tx.odrType}`
    };

    try {
      const entryResult = await createBankTransactionEntry(bankTransactionData);
      if (entryResult.success) {
        entries.push(entryResult.entry);
      }
    } catch (error) {
      console.error(`Failed to create bank transaction entry for SecretAgent transaction ${tx.id}:`, error);
    }
  }
  
  return entries;
}

/**
 * Activate Secret Agent webhook
 * Sends POST request to Secret Agent webhook endpoint
 */
export async function activateSecretAgent(): Promise<{
  success: boolean;
  status?: string;
  message: string;
}> {
  try {
    const webhookUrl = `${process.env.SECRETAGENT_WEBHOOK_BASE_URL}/webhook/techcom`;
    const apiKey = process.env.SECRETAGENT_WEBHOOK_API_KEY;

    if (!apiKey) {
      return {
        success: false,
        status: 'alert',
        message: 'Secret Agent API key not configured. Please check environment variables.'
      };
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Authorization': apiKey,
        'Content-Type': 'application/json'
      },
      body: ''
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        status: 'alert',
        message: `Request failed with status ${response.status}: ${response.statusText}. Response: ${errorText}`
      };
    }

    const responseText = await response.text();

    let result;
    try {
      result = JSON.parse(responseText);
    } catch {
      return {
        success: false,
        status: 'alert',
        message: `Invalid JSON response from Secret Agent: ${responseText}`
      };
    }

    return {
      success: result.success || result.succes || false, // Handle both 'success' and 'succes' typo
      status: result.status || (result.success || result.succes ? 'success' : 'alert'),
      message: result.message || 'Unknown response from Secret Agent'
    };

  } catch (error) {
    return {
      success: false,
      status: 'alert',
      message: `Activation error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
