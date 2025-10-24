"use server";

// Define the Transaction interface based on Supabase schema
interface SupabaseTransaction {
  id: number;
  chat_id: number;
  entryType: "in" | "out" | "pay";
  amount: number;
  entryExchangeRate?: number;
  entryFee?: number;
  updatedReason?: string;
  updatedByUser?: string;
  updatedAt?: string;
  createdByUser: string;
  createdAt: string;
}

// API Response interfaces
interface ApiResponse {
  status: boolean;
  message: string;
  data: SupabaseTransaction[];
  pagination: {
    total_count: number;
    current_page: number;
    total_pages: number;
    limit: number;
    offset: number;
    has_next: boolean;
    has_previous: boolean;
  };
  filters: {
    chat_id: string;
    entryType?: string;
    from_date?: string;
    to_date?: string;
    date?: string;
    order_by: string;
    order: string;
  };
}

// Filter interface
interface TransactionFilters {
  entryType: string;
  fromDate: string;
  toDate: string;
  orderBy: string;
  order: string;
  search: string;
}

// Parameters interface for the server action
interface FetchTransactionsParams {
  chatId: string;
  currentPage: number;
  pageSize: number;
  filters: TransactionFilters;
}

export async function fetchTransbotTransactionsSecure(params: FetchTransactionsParams): Promise<ApiResponse> {
  const { chatId, currentPage, pageSize, filters } = params;

  // Validate chat_id is a number
  if (!chatId.trim() || isNaN(Number(chatId))) {
    throw new Error('Chat ID must be a valid number');
  }

  try {
    // Get environment variables from server-side (secure)
    const SUPABASE_FUNCTION_URL = process.env.NEXT_PUBLIC_SUPABASE_FUNCTION_URL;
    const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_FUNCTION_ANON_KEY;

    if (!SUPABASE_FUNCTION_URL || !SUPABASE_ANON_KEY) {
      console.error('Missing environment variables:', { 
        hasUrl: !!SUPABASE_FUNCTION_URL, 
        hasKey: !!SUPABASE_ANON_KEY 
      });
      throw new Error('Missing Supabase configuration');
    }

    // Build query parameters
    const params_obj = new URLSearchParams({
      chat_id: chatId,
      limit: pageSize === -1 ? "999999" : pageSize.toString(),
      page: currentPage.toString(),
      order_by: filters.orderBy,
      order: filters.order,
    });

    // Add optional filters
    if (filters.entryType && filters.entryType !== "all") {
      params_obj.append("entryType", filters.entryType);
    }

    // If no dates are set, default to today
    const today = new Date().toISOString().split("T")[0];
    const fromDate = filters.fromDate || today;
    const toDate = filters.toDate || today;

    params_obj.append("from_date", fromDate);
    params_obj.append("to_date", toDate);

    const url = `${SUPABASE_FUNCTION_URL}?${params_obj}`;

    // Make the API request from server-side
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      // Try to get the error message from the response
      let errorMessage = `HTTP error! status: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData.error || errorData.message) {
          errorMessage = errorData.error || errorData.message;
        }
      } catch (e) {
        // If we can't parse the error response, use the status
        console.error("Could not parse error response:", e);
      }
      throw new Error(errorMessage);
    }

    const data: ApiResponse = await response.json();

    if (!data.status) {
      throw new Error(data.message || "Failed to fetch transactions");
    }

    return data;

  } catch (error) {
    console.error('Error fetching transactions:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to fetch transactions');
  }
}

// Additional server action for creating transactions via API
export async function createTransbotTransaction(transactionData: Partial<SupabaseTransaction>) {
  try {
    const SUPABASE_FUNCTION_URL = process.env.NEXT_PUBLIC_SUPABASE_FUNCTION_URL;
    const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_FUNCTION_ANON_KEY;

    if (!SUPABASE_FUNCTION_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Missing Supabase configuration');
    }

    const response = await fetch(SUPABASE_FUNCTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(transactionData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (!data.status) {
      throw new Error(data.message || "Failed to create transaction");
    }

    return data;

  } catch (error) {
    console.error('Error creating transaction:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to create transaction');
  }
}

// Additional server action for updating transactions via API
export async function updateTransbotTransaction(id: number, updates: Partial<SupabaseTransaction>) {
  try {
    const SUPABASE_FUNCTION_URL = process.env.NEXT_PUBLIC_SUPABASE_FUNCTION_URL;
    const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_FUNCTION_ANON_KEY;

    if (!SUPABASE_FUNCTION_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Missing Supabase configuration');
    }

    const response = await fetch(SUPABASE_FUNCTION_URL, {
      method: "POST", // Your edge function uses POST for both create and update
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id, ...updates }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (!data.status) {
      throw new Error(data.message || "Failed to update transaction");
    }

    return data;

  } catch (error) {
    console.error('Error updating transaction:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to update transaction');
  }
}

// Additional server action for deleting transactions via API
export async function deleteTransbotTransaction(id: number, chatId: string) {
  try {
    const SUPABASE_FUNCTION_URL = process.env.NEXT_PUBLIC_SUPABASE_FUNCTION_URL;
    const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_FUNCTION_ANON_KEY;

    if (!SUPABASE_FUNCTION_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Missing Supabase configuration');
    }

    const url = `${SUPABASE_FUNCTION_URL}/${id}?chat_id=${chatId}`;

    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (!data.status) {
      throw new Error(data.message || "Failed to delete transaction");
    }

    return data;

  } catch (error) {
    console.error('Error deleting transaction:', error);
    throw new Error(error instanceof Error ? error.message : 'Failed to delete transaction');
  }
}
