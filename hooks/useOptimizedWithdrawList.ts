import { useState, useCallback, useEffect, useRef } from "react";
import { getLoggedInUser } from "@/lib/actions/user.actions";
import { useOptimizedWithdrawReload } from "./useOptimizedWithdrawReload";
import { useOptimisticTransactionUpdates } from "./useOptimisticTransactionUpdates";
import { useSmartCaching } from "./useSmartCaching";
import { usePaymentValidation } from "./usePaymentValidation";

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

interface OptimizedWithdrawListState {
  // User state
  userRole: string;
  userId: string | null;
  userDocId: string | null;
  
  // Transaction state
  transaction: Transaction | null;
  totalPendingCount: number;
  suspiciousCount: number;
  completedTodayCount: number;
  
  // Loading states
  loading: boolean;
  isReloading: boolean;
  error: string;
  
  // Cache stats
  cacheStats: {
    hits: number;
    misses: number;
    entries: number;
    memoryUsage: number;
  };
}

export function useOptimizedWithdrawList() {
  // Initialize hooks
  const cache = useSmartCaching();
  const paymentValidation = usePaymentValidation();

  // Track if initial load has been triggered
  const initialLoadTriggeredRef = useRef(false);

  // Main state
  const [state, setState] = useState<OptimizedWithdrawListState>({
    userRole: "",
    userId: null,
    userDocId: null,
    transaction: null,
    totalPendingCount: 0,
    suspiciousCount: 0,
    completedTodayCount: 0,
    loading: true,
    isReloading: false,
    error: "",
    cacheStats: { hits: 0, misses: 0, entries: 0, memoryUsage: 0 },
  });

  // Update callbacks for optimized reload hook
  const handleTransactionUpdate = useCallback((transaction: Transaction | null) => {
    setState(prev => ({ ...prev, transaction }));
  }, []);

  const handleCountsUpdate = useCallback((counts: {
    totalPending: number;
    suspicious: number;
    completedToday: number;
  }) => {
    setState(prev => ({
      ...prev,
      totalPendingCount: counts.totalPending,
      suspiciousCount: counts.suspicious,
      completedTodayCount: counts.completedToday,
    }));
  }, []);

  const handleLoadingChange = useCallback((loading: boolean) => {
    setState(prev => ({ ...prev, loading }));
  }, []);

  const handleReloadingChange = useCallback((isReloading: boolean) => {
    setState(prev => ({ ...prev, isReloading }));
  }, []);

  const handleError = useCallback((error: string) => {
    setState(prev => ({ ...prev, error }));
  }, []);

  // Initialize optimized reload hook
  const reloadManager = useOptimizedWithdrawReload({
    userRole: state.userRole,
    userId: state.userId,
    onTransactionUpdate: handleTransactionUpdate,
    onCountsUpdate: handleCountsUpdate,
    onLoadingChange: handleLoadingChange,
    onReloadingChange: handleReloadingChange,
    onError: handleError,
  });

  // Update callbacks for optimistic updates hook
  const handleSuccessfulUpdate = useCallback((transaction: Transaction, newStatus: string) => {
    console.log(`[Optimized] Transaction ${transaction.odrId} successfully updated to ${newStatus}`);
    
    // Invalidate relevant cache entries
    cache.invalidatePattern(`counts_.*`);
    cache.invalidate(`transaction_${transaction.$id}`);
    
    // Use super fast reload for instant next transaction loading (no counts, uses cache)
    reloadManager.superFastReload();
    
    // Update counts in background after a short delay (non-blocking)
    setTimeout(() => {
      reloadManager.countsOnlyReload();
    }, 100);
  }, [cache, reloadManager]);

  const handleUpdateError = useCallback((transaction: Transaction, error: string) => {
    console.error(`[Optimized] Error updating transaction ${transaction.odrId}:`, error);
    
    // Could trigger a smart reload to ensure data consistency
    setTimeout(() => {
      reloadManager.smartReload();
    }, 1000);
  }, [reloadManager]);

  // Initialize optimistic updates hook
  const optimisticUpdates = useOptimisticTransactionUpdates({
    onTransactionUpdate: handleTransactionUpdate,
    onSuccessfulUpdate: handleSuccessfulUpdate,
    onUpdateError: handleUpdateError,
  });



  // Check if user can update transaction status
  const canUpdateStatus = useCallback((transaction: Transaction) => {
    if (state.userRole === "admin") return true;
    if (state.userRole !== "transactor" && state.userRole !== "transassistant") return false;
    if (transaction.odrStatus !== "pending") return false;
    return true;
  }, [state.userRole]);

  // Enhanced status update with optimistic updates
  const handleStatusUpdate = useCallback(async (
    transaction: Transaction,
    newStatus: "completed" | "failed"
  ) => {
    return await optimisticUpdates.updateStatusOptimistically(transaction, newStatus);
  }, [optimisticUpdates]);

  // Handle real-time transaction updates
  const handleRealtimeUpdate = useCallback((updatedTransaction: Transaction) => {
    console.log(`[Optimized] Real-time update received for transaction ${updatedTransaction.odrId}`);
    
    // Update cache with new transaction data
    cache.setCached(`transaction_${updatedTransaction.$id}`, updatedTransaction, 120000);
    
    // Use smart reload to determine best action
    reloadManager.smartReload(updatedTransaction);
  }, [cache, reloadManager]);

  // Manual refresh with cache invalidation
  const handleRefresh = useCallback(async () => {
    // Clear relevant cache entries
    cache.invalidatePattern(`counts_.*`);
    if (state.transaction) {
      cache.invalidate(`transaction_${state.transaction.$id}`);
    }
    
    await reloadManager.manualRefresh();
  }, [cache, reloadManager, state.transaction]);

  // Cache monitoring and cleanup
  const handleCacheCleanup = useCallback(() => {
    const cleaned = cache.cleanup();
    console.log(`[Optimized] Cache cleanup removed ${cleaned} expired entries`);
    return cleaned;
  }, [cache]);

  // Initialize on mount - only run once
  useEffect(() => {
    let isMounted = true;
    
    const initializeData = async () => {
      try {
        setState(prev => ({ ...prev, loading: true, error: "" }));

        const user = await getLoggedInUser();

        if (!isMounted) return;

        if (!user) {
          window.location.href = "/sign-in";
          return;
        }

        // Check role permissions first
        if (
          user.role !== "admin" &&
          user.role !== "transactor" &&
          user.role !== "transassistant"
        ) {
          window.location.href = "/";
          return;
        }

        // Update state with user info
        setState(prev => ({
          ...prev,
          userRole: user.role,
          userId: user.userId,
        }));

        // Get cached user document ID for transassistant role
        if (user.role === "transassistant") {
          try {
            const docId = await cache.getUserDocIdCached(user.userId);
            if (isMounted) {
              setState(prev => ({ ...prev, userDocId: docId }));
            }
          } catch (error) {
            console.error("Error getting user document ID:", error);
          }
        }

        // User data loading complete
        if (isMounted) {
          setState(prev => ({ ...prev, loading: false }));
        }

      } catch (error) {
        console.error("Error loading user data:", error);
        if (isMounted) {
          setState(prev => ({ 
            ...prev, 
            error: "Failed to load user data",
            loading: false 
          }));
        }
      }
    };

    initializeData();

    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only once on mount - cache is accessed but not as dependency

  // Load initial transaction data once user is loaded and reloadManager is ready
  useEffect(() => {
    console.log(`[Optimized] Transaction loading check - Role: ${state.userRole}, UserId: ${state.userId}, Loading: ${state.loading}, Error: ${state.error}, InitialTriggered: ${initialLoadTriggeredRef.current}`);
    
    if (state.userRole && state.userId && !state.loading && !state.error && !initialLoadTriggeredRef.current) {
      console.log(`[Optimized] Triggering initial transaction load`);
      initialLoadTriggeredRef.current = true;
      
      // Add a small delay to ensure reloadManager is properly initialized
      const timer = setTimeout(() => {
        reloadManager.fullReload();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [state.userRole, state.userId, state.loading, state.error, reloadManager]);

  // Update cache stats periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setState(prev => ({
        ...prev,
        cacheStats: cache.stats,
      }));
    }, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, [cache.stats]); // Remove cache.stats dependency to prevent infinite loop

  // Performance monitoring
  const getPerformanceMetrics = useCallback(() => {
    return {
      cacheHitRatio: cache.getCacheHitRatio(),
      cacheSize: cache.getCacheSize(),
      pendingOptimisticOperations: optimisticUpdates.pendingOperationsCount(),
      isReloading: reloadManager.isReloading(),
    };
  }, [cache, optimisticUpdates, reloadManager]);

  return {
    // State
    ...state,
    
    // Actions
    handleStatusUpdate,
    handleRefresh,
    handleRealtimeUpdate,
    canUpdateStatus,
    
    // Payment validation (pass-through)
    paymentValidation,
    
    // Cache management
    cache: {
      stats: state.cacheStats,
      cleanup: handleCacheCleanup,
      invalidate: cache.invalidate,
      invalidatePattern: cache.invalidatePattern,
      clearAll: cache.clearAll,
    },
    
    // Optimistic updates
    optimisticUpdates: {
      updatingTransactions: optimisticUpdates.updatingTransactions,
      hasPendingUpdate: optimisticUpdates.hasPendingUpdate,
      cleanupStaleOperations: optimisticUpdates.cleanupStaleOperations,
    },
    
    // Performance monitoring
    getPerformanceMetrics,
    
    // Advanced reload options
    reloadManager: {
      smartReload: reloadManager.smartReload,
      countsOnlyReload: reloadManager.countsOnlyReload,
      fullReload: reloadManager.fullReload,
    },
  };
} 