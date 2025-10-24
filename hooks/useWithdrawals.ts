import { useState, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import {
  fetchPendingWithdrawals,
  getWithdrawalsTotalCount,
} from "@/lib/actions/withdraw.actions";

export interface Transaction {
  $id: string;
  $createdAt: string;
  odrId: string;
  merchantOrdId: string;
  odrType: "withdraw";
  odrStatus: "pending" | "processing" | "completed" | "canceled" | "failed";
  amount: number;
  unPaidAmount: number;
  bankCode?: string;
  bankReceiveNumber?: string;
  bankReceiveOwnerName?: string;
  bankReceiveName?: string;
  qrCode?: string | null;
  createdIp?: string;
  isSuspicious?: boolean;
  isTransitioning?: boolean;
  users?: string | Record<string, unknown>;
}

interface UseWithdrawalsState {
  transactions: Transaction[];
  totalPendingCount: number;
  loading: boolean;
  loadingCount: boolean;
  loadingMore: boolean;
  isPreloading: boolean;
  hasMore: boolean;
  error: string | null;
  skeletonCount: number;
}

interface UseWithdrawalsActions {
  fetchInitialData: (role: string, userId: string) => Promise<void>;
  fetchMoreTransactions: (pageNum: number, append?: boolean, preload?: boolean, userRole?: string, userId?: string) => Promise<void>;
  refreshTotalCount: (userRole?: string, userId?: string) => Promise<void>;
  setTransactions: React.Dispatch<React.SetStateAction<Transaction[]>>;
  setHasMore: React.Dispatch<React.SetStateAction<boolean>>;
  setTotalPendingCount: React.Dispatch<React.SetStateAction<number>>;
  removeDuplicates: (transactions: Transaction[]) => Transaction[];
}

export function useWithdrawals(limit: number = 10): UseWithdrawalsState & UseWithdrawalsActions {
  const { toast } = useToast();
  
  // State
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totalPendingCount, setTotalPendingCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [loadingCount, setLoadingCount] = useState<boolean>(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isPreloading, setIsPreloading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skeletonCount, setSkeletonCount] = useState(3);

  // Refs
  const latestCreatedAtRef = useRef<string | null>(null);

  // Helper function to remove duplicates
  const removeDuplicates = useCallback((transactions: Transaction[]): Transaction[] => {
    const uniqueIds = new Set<string>();
    return transactions.filter((transaction) => {
      if (uniqueIds.has(transaction.$id)) {
        return false;
      }
      uniqueIds.add(transaction.$id);
      return true;
    });
  }, []);

  // Fetch initial data
  const fetchInitialData = useCallback(
    async (role: string, userId: string) => {
      try {
        setLoading(true);
        setError(null);

        // Fetch both transactions and count in parallel
        const fetchTransactionsPromise = fetchPendingWithdrawals({
          page: 1,
          limit,
          sortByCreatedAt: "asc",
          transassistantId: role === "transassistant" ? userId : null,
        });

        const fetchCountPromise = getWithdrawalsTotalCount(
          role === "transassistant" ? userId : null
        );

        const [transactionResult, countResult] = await Promise.all([
          fetchTransactionsPromise,
          fetchCountPromise,
        ]);

        // Handle transaction result
        if (!transactionResult.success || !transactionResult.data) {
          throw new Error(
            transactionResult.message || "Failed to fetch withdrawals"
          );
        }

        const fetchedTransactions = transactionResult.data;

        setHasMore(fetchedTransactions.length >= limit);

        // Update latest creation date
        if (fetchedTransactions.length > 0) {
          const lastTransaction = fetchedTransactions[fetchedTransactions.length - 1];
          latestCreatedAtRef.current = lastTransaction.$createdAt;
        }

        setTransactions(fetchedTransactions as Transaction[]);

        // Handle count result
        if (countResult.success && countResult.count !== undefined) {
          setTotalPendingCount(countResult.count);
        }

        setError(null);
      } catch (error) {
        console.error("Error in initial data fetch:", error);
        setError("Failed to load withdrawal data");
        toast({
          variant: "destructive",
          description: "Failed to load withdrawal data",
        });
      } finally {
        setLoading(false);
        setLoadingCount(false);
      }
    },
    [limit, toast]
  );

  // Fetch more transactions for infinite scroll
  const fetchMoreTransactions = useCallback(
    async (pageNum: number, append = false, preload = false, userRole?: string, userId?: string) => {
      try {
        // Set appropriate loading state
        if (append && !preload) {
          setLoadingMore(true);
        } else if (preload) {
          setIsPreloading(true);
        } else {
          setLoading(true);
        }

        const result = await fetchPendingWithdrawals({
          page: pageNum,
          limit,
          sortByCreatedAt: "asc",
          transassistantId: userRole === "transassistant" ? userId : null,
        });

        if (!result.success || !result.data) {
          throw new Error(result.message || "Failed to fetch withdrawals");
        }

        const fetchedTransactions = result.data;

        setHasMore(fetchedTransactions.length >= limit);

        // Update latest creation date
        if (fetchedTransactions.length > 0) {
          const lastTransaction = fetchedTransactions[fetchedTransactions.length - 1];
          if (
            !latestCreatedAtRef.current ||
            new Date(lastTransaction.$createdAt) > new Date(latestCreatedAtRef.current)
          ) {
            latestCreatedAtRef.current = lastTransaction.$createdAt;
          }
        }

        setTransactions((prev) => {
          const newTransactions = append
            ? [...prev, ...(fetchedTransactions as Transaction[])]
            : (fetchedTransactions as Transaction[]);

          return removeDuplicates(newTransactions);
        });

        if (fetchedTransactions.length === 0 && pageNum === 1) {
          setError("No withdraw transactions found");
        } else {
          setError(null);
        }

        // Adjust skeleton count based on fetched data
        if (append && fetchedTransactions.length > 0) {
          setSkeletonCount(Math.min(fetchedTransactions.length, 3));
        }
      } catch (error) {
        console.error("Error fetching withdraw transactions:", error);
        setError("Failed to load withdrawal data");
        toast({
          variant: "destructive",
          description: "Failed to load withdrawal data",
        });
      } finally {
        // Clear appropriate loading state
        if (append && !preload) {
          setLoadingMore(false);
        } else if (preload) {
          setIsPreloading(false);
        } else {
          setLoading(false);
        }
      }
    },
    [limit, removeDuplicates, toast]
  );

  // Refresh total count
  const refreshTotalCount = useCallback(async (userRole?: string, userId?: string) => {
    try {
      setLoadingCount(true);
      const result = await getWithdrawalsTotalCount(
        userRole === "transassistant" ? userId : null
      );
      if (result.success && result.count !== undefined) {
        setTotalPendingCount(result.count);
      }
    } catch (error) {
      console.error("Error fetching total pending count:", error);
    } finally {
      setLoadingCount(false);
    }
  }, []);

  return {
    // State
    transactions,
    totalPendingCount,
    loading,
    loadingCount,
    loadingMore,
    isPreloading,
    hasMore,
    error,
    skeletonCount,
    
    // Actions
    fetchInitialData,
    fetchMoreTransactions,
    refreshTotalCount,
    setTransactions,
    setHasMore,
    setTotalPendingCount,
    removeDuplicates,
  };
} 