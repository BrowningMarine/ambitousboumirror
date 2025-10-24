import { useCallback, useRef } from "react";
import { fetchSingleWithdrawalWithCounts, fetchNextWithdrawalFast } from "@/lib/actions/withdraw.actions";
import { useToast } from "@/hooks/use-toast";

interface Transaction {
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

interface UseOptimizedReloadOptions {
  userRole: string;
  userId: string | null;
  onTransactionUpdate: (transaction: Transaction | null) => void;
  onCountsUpdate: (counts: {
    totalPending: number;
    suspicious: number;
    completedToday: number;
  }) => void;
  onLoadingChange: (loading: boolean) => void;
  onReloadingChange: (reloading: boolean) => void;
  onError: (error: string) => void;
}

export function useOptimizedWithdrawReload({
  userRole,
  userId,
  onTransactionUpdate,
  onCountsUpdate,
  onLoadingChange,
  onReloadingChange,
  onError,
}: UseOptimizedReloadOptions) {
  const { toast } = useToast();
  const lastTransactionRef = useRef<Transaction | null>(null);
  const isReloadingRef = useRef(false);
  
  // Cache user document ID to avoid repeated lookups
  const cachedUserDocIdRef = useRef<string | null>(null);

  // Full reload - for initial load or when transaction changes
  const fullReload = useCallback(async (showFadeEffect = false) => {
    try {
      if (showFadeEffect) {
        onReloadingChange(true);
        isReloadingRef.current = true;
      } else {
        onLoadingChange(true);
      }
      onError("");

      const result = await fetchSingleWithdrawalWithCounts({
        sortByCreatedAt: "asc",
        transassistantId: userRole === "transassistant" ? userId : null,
      });

      if (!result.success) {
        throw new Error(result.message || "Failed to fetch withdrawal data");
      }

      // Cache user document ID if we're a transassistant (extract from transaction data)
      if (userRole === "transassistant" && result.data && result.data.length > 0) {
        const transaction = result.data[0];
        if (transaction.users && typeof transaction.users === "string") {
          cachedUserDocIdRef.current = transaction.users;
          console.log("[Optimized] Cached user document ID for faster subsequent loads");
        }
      }

      // Update transaction
      if (result.data && result.data.length > 0) {
        const newTransaction = result.data[0] as Transaction;
        lastTransactionRef.current = newTransaction;
        onTransactionUpdate(newTransaction);
        onError("");
      } else {
        lastTransactionRef.current = null;
        onTransactionUpdate(null);
        onError("No pending withdrawals found");
      }

      // Update counts
      onCountsUpdate({
        totalPending: result.totalCount || 0,
        suspicious: result.suspiciousCount || 0,
        completedToday: result.completedTodayCount || 0,
      });

    } catch (error) {
      console.error("Error in full reload:", error);
      onError("Failed to load withdrawal data");
      toast({
        variant: "destructive",
        description: "Failed to load withdrawal data",
      });
    } finally {
      if (showFadeEffect) {
        // Add delay for fade effect - REDUCED from 500ms to 150ms
        setTimeout(() => {
          onReloadingChange(false);
          isReloadingRef.current = false;
        }, 150);
      } else {
        onLoadingChange(false);
      }
    }
  }, [userRole, userId, onTransactionUpdate, onCountsUpdate, onLoadingChange, onReloadingChange, onError, toast]);

  // Counts-only reload - for when we just need updated statistics
  const countsOnlyReload = useCallback(async () => {
    try {
      // Don't show loading states for count-only updates
      const result = await fetchSingleWithdrawalWithCounts({
        sortByCreatedAt: "asc",
        transassistantId: userRole === "transassistant" ? userId : null,
      });

      if (result.success) {
        // Only update counts, keep existing transaction
        onCountsUpdate({
          totalPending: result.totalCount || 0,
          suspicious: result.suspiciousCount || 0,
          completedToday: result.completedTodayCount || 0,
        });

        console.log("[Optimized] Updated counts only - no transaction reload needed");
      }
    } catch (error) {
      console.error("Error in counts-only reload:", error);
      // Fallback to full reload on error
      await fullReload(true);
    }
  }, [userRole, userId, onCountsUpdate, fullReload]);

  // Smart reload - decides what type of reload is needed
  const smartReload = useCallback(async (
    updatedTransaction?: Transaction,
    reloadType: "full" | "counts" | "smart" = "smart"
  ) => {
    // Prevent concurrent reloads
    if (isReloadingRef.current) {
      console.log("[Optimized] Skipping reload - already in progress");
      return;
    }

    if (reloadType === "full") {
      await fullReload(true);
      return;
    }

    if (reloadType === "counts") {
      await countsOnlyReload();
      return;
    }

    // Smart decision making
    const currentTransaction = lastTransactionRef.current;

    if (!updatedTransaction) {
      // No transaction provided, do full reload
      await fullReload(true);
      return;
    }

    if (!currentTransaction || updatedTransaction.$id !== currentTransaction.$id) {
      // Different transaction or no current transaction, full reload needed
      console.log("[Optimized] Different transaction detected, full reload needed");
      await fullReload(true);
      return;
    }

    // Same transaction updated
    if (updatedTransaction.odrStatus !== currentTransaction.odrStatus) {
      // Status changed - this might affect our pending queue
      if (updatedTransaction.odrStatus !== "pending") {
        // Transaction left pending status, need new transaction + updated counts
        console.log("[Optimized] Transaction left pending status, full reload needed");
        await fullReload(true);
      } else {
        // Transaction entered pending status (rare), just update counts
        console.log("[Optimized] Transaction entered pending status, counts reload");
        await countsOnlyReload();
      }
    } else {
      // Same transaction, same status - just field updates (amount, bank details, etc.)
      // Update transaction in place, no reload needed
      console.log("[Optimized] Transaction field updated, optimistic update");
      lastTransactionRef.current = updatedTransaction;
      onTransactionUpdate(updatedTransaction);
    }
  }, [fullReload, countsOnlyReload, onTransactionUpdate]);

  // Manual refresh function
  const manualRefresh = useCallback(async () => {
    await fullReload(true);
  }, [fullReload]);

  // Instant reload for status updates - no fade effects, no delays
  const instantReload = useCallback(async () => {
    try {
      // Prevent concurrent reloads
      if (isReloadingRef.current) {
        console.log("[Optimized] Skipping instant reload - already in progress");
        return;
      }

      isReloadingRef.current = true;
      onError("");

      const result = await fetchSingleWithdrawalWithCounts({
        sortByCreatedAt: "asc",
        transassistantId: userRole === "transassistant" ? userId : null,
      });

      if (!result.success) {
        throw new Error(result.message || "Failed to fetch withdrawal data");
      }

      // Update transaction immediately
      if (result.data && result.data.length > 0) {
        const newTransaction = result.data[0] as Transaction;
        lastTransactionRef.current = newTransaction;
        onTransactionUpdate(newTransaction);
        onError("");
      } else {
        lastTransactionRef.current = null;
        onTransactionUpdate(null);
        onError("No pending withdrawals found");
      }

      // Update counts
      onCountsUpdate({
        totalPending: result.totalCount || 0,
        suspicious: result.suspiciousCount || 0,
        completedToday: result.completedTodayCount || 0,
      });

    } catch (error) {
      console.error("Error in instant reload:", error);
      onError("Failed to load withdrawal data");
    } finally {
      // No delays - instant completion
      isReloadingRef.current = false;
    }
  }, [userRole, userId, onTransactionUpdate, onCountsUpdate, onError]);

  // Super fast reload - only next transaction, no counts, uses cache
  const superFastReload = useCallback(async () => {
    try {
      // Prevent concurrent reloads
      if (isReloadingRef.current) {
        console.log("[Optimized] Skipping super fast reload - already in progress");
        return;
      }

      isReloadingRef.current = true;
      onError("");

      // Use fast fetch with cached user doc ID
      const result = await fetchNextWithdrawalFast({
        sortByCreatedAt: "asc",
        transassistantId: userRole === "transassistant" ? userId : null,
        cachedUserDocId: cachedUserDocIdRef.current,
      });

      if (!result.success) {
        throw new Error(result.message || "Failed to fetch withdrawal data");
      }

      // Cache user doc ID if returned (for next time)
      if (result.userDocId && userRole === "transassistant") {
        cachedUserDocIdRef.current = result.userDocId;
        console.log("[Optimized] Updated cached user document ID from fast fetch");
      }

      // Update transaction immediately
      if (result.data && result.data.length > 0) {
        const newTransaction = result.data[0] as Transaction;
        lastTransactionRef.current = newTransaction;
        onTransactionUpdate(newTransaction);
        onError("");
        console.log("[Optimized] Super fast reload completed - transaction updated immediately");
      } else {
        lastTransactionRef.current = null;
        onTransactionUpdate(null);
        onError("No pending withdrawals found");
      }

      // Note: No counts update - we only fetch the next transaction for speed

    } catch (error) {
      console.error("Error in super fast reload:", error);
      onError("Failed to load withdrawal data");
    } finally {
      // No delays - instant completion
      isReloadingRef.current = false;
    }
  }, [userRole, userId, onTransactionUpdate, onError]);

  return {
    fullReload,
    countsOnlyReload,
    smartReload,
    manualRefresh,
    instantReload,
    superFastReload,
    isReloading: () => isReloadingRef.current,
  };
} 