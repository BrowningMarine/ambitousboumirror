"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { getLoggedInUser } from "@/lib/actions/user.actions";
import { updateTransactionStatus } from "@/lib/actions/transaction.actions";
import {
  assignWithdrawalToUser,
  fetchAllUnassignedWithdrawals,
  getCompletedTodayCount,
} from "@/lib/actions/withdraw.actions";

import { Loader2, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

// Custom Hooks
import { useWithdrawals, Transaction } from "@/hooks/useWithdrawals";
import { usePaymentValidation } from "@/hooks/usePaymentValidation";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useOptimizedRealtimeSubscription } from "@/hooks/useOptimizedRealtimeSubscription";

// Components
import WithdrawHeader from "@/components/withdraw-list/WithdrawHeader";
import TransactionCard from "@/components/withdraw-list/TransactionCard";
import SkeletonCard from "@/components/withdraw-list/SkeletonCard";

export default function WithdrawListPageOptimized() {
  // User state
  const [userRole, setUserRole] = useState<string>("");
  const [userId, setUserId] = useState<string | null>(null);
  const [userDocId, setUserDocId] = useState<string | null>(null);
  const [assigningTransactions, setAssigningTransactions] = useState<
    Set<string>
  >(new Set());
  const [updatingTransactions, setUpdatingTransactions] = useState<Set<string>>(
    new Set()
  );
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [newOrdersAvailable, setNewOrdersAvailable] = useState(0);
  const [completedTodayCount, setCompletedTodayCount] = useState(0);

  const limit = 10;

  // Create refs to store volatile state to prevent infinite loops
  const transactionsRef = useRef<Transaction[]>([]);
  const userRoleRef = useRef<string>("");
  const userIdRef = useRef<string | null>(null);
  const userDocIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize hooks
  const withdrawals = useWithdrawals(limit);
  const paymentValidation = usePaymentValidation();
  const {
    transactions,
    loading,
    loadingMore,
    isPreloading,
    hasMore,
    error,
    skeletonCount,
    totalPendingCount,
    setTransactions,
    fetchInitialData,
    refreshTotalCount,
  } = withdrawals;

  // Keep refs in sync with state to prevent stale closures
  useEffect(() => {
    transactionsRef.current = transactions;
  }, [transactions]);

  useEffect(() => {
    userRoleRef.current = userRole;
  }, [userRole]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    userDocIdRef.current = userDocId;
  }, [userDocId]);

  // Extract removeDuplicates function to stable ref to avoid ESLint warning
  const removeDuplicatesRef = useRef(withdrawals.removeDuplicates);

  // Keep removeDuplicates ref up to date
  useEffect(() => {
    removeDuplicatesRef.current = withdrawals.removeDuplicates;
  }, [withdrawals.removeDuplicates]);

  // Filter and memoize display transactions with maximum 10 rows limit
  const displayTransactions = useMemo(() => {
    // Use the removeDuplicates function from ref
    const deduplicated = removeDuplicatesRef.current(transactions);
    const filtered = deduplicated.filter(
      (t) => t.odrStatus === "pending" || t.isTransitioning
    );

    // Limit to maximum 10 rows
    return filtered.slice(0, 10);
  }, [transactions]);

  // Infinite scroll setup with 10 row limit
  const { loaderRef } = useInfiniteScroll({
    hasMore: hasMore && displayTransactions.length < 10, // Prevent loading more if already at 10 rows
    loading,
    loadingMore,
    isPreloading,
    transactions,
    totalPendingCount,
    limit,
    onLoadMore: (pageNum, append, preload) => {
      // Only load more if we haven't reached the 10 row limit
      if (userRole && userId && displayTransactions.length < 10) {
        withdrawals.fetchMoreTransactions(
          pageNum,
          append,
          preload,
          userRole,
          userId
        );
      }
    },
  });

  // Get top 3 transactions for selective real-time subscription
  const topThreeTransactions = useMemo(() => {
    return displayTransactions.slice(0, 3);
  }, [displayTransactions]);

  // Handle real-time updates for top 3 transactions
  const handleTransactionUpdate = useCallback(
    (updatedTransaction: Transaction) => {
      //console.log(`[Page] Updating transaction ${updatedTransaction.$id}`);
      setTransactions((prev) =>
        prev.map((t) =>
          t.$id === updatedTransaction.$id ? updatedTransaction : t
        )
      );
    },
    [setTransactions]
  );

  const handleTransactionRemoved = useCallback(
    (transactionId: string) => {
      //console.log(`[Page] Removing transaction ${transactionId} - auto-loading next order`);

      setTransactions((prev) => {
        const filtered = prev.filter((t) => t.$id !== transactionId);
        //console.log(`[Page] Transactions after removal: ${filtered.length}, need to maintain flow`);
        return filtered;
      });

      // Clear any existing timeout to prevent multiple auto-fetches
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }

      // Simple delayed auto-loading to prevent system overflow
      timeoutRef.current = setTimeout(async () => {
        const currentUserRole = userRoleRef.current;
        const currentUserId = userIdRef.current;
        const currentTransactions = transactionsRef.current;

        if (currentUserRole && currentUserId) {
          //console.log(`[Page] Auto-fetch: maintaining flow (optimized delay)`);

          try {
            // Get current page size and fetch next batch to backfill
            const currentCount = currentTransactions.length - 1; // -1 because we removed one
            const nextPage = Math.floor(currentCount / limit) + 1;

            await withdrawals.fetchMoreTransactions(
              nextPage,
              true, // append = true to add to existing list
              false, // not preload
              currentUserRole,
              currentUserId
            );

            await refreshTotalCount(currentUserRole, currentUserId);

            //console.log(`[Page] Auto-fetch completed - flow maintained`);
          } catch (error) {
            console.error("Error in auto-fetch:", error);
          }
        }

        // Clear timeout ref after completion
        timeoutRef.current = null;
      }, 1500); // 1.5 second delay to reduce system load
    },
    [setTransactions, refreshTotalCount, withdrawals]
  ); // Removed volatile dependencies

  // Handle new incoming orders - check if assigned to current user
  const handleNewTransactionReceived = useCallback(
    (newTransaction: Transaction) => {
      const currentUserRole = userRoleRef.current;
      const currentUserId = userIdRef.current;
      const currentUserDocId = userDocIdRef.current;

      // Check if this new order is assigned to current user
      const isAssignedToCurrentUser = (() => {
        if (currentUserRole === "admin" || currentUserRole === "transactor") {
          return true; // Admins and transactors see all orders
        }

        if (currentUserRole === "transassistant") {
          // Check if this transaction is assigned to the current user's document ID
          if (newTransaction.users && currentUserDocId) {
            let assignedUserDocId: string | null = null;

            // Handle both string (document ID) and object (full document) cases
            if (typeof newTransaction.users === "string") {
              assignedUserDocId = newTransaction.users;
            } else if (
              typeof newTransaction.users === "object" &&
              newTransaction.users.$id
            ) {
              // If it's an object, extract the $id field
              assignedUserDocId = newTransaction.users.$id as string;
            }

            if (assignedUserDocId) {
              return assignedUserDocId === currentUserDocId;
            }
          }

          return false;
        }

        return false;
      })();

      if (isAssignedToCurrentUser) {
        // For assigned orders, add to the end of current list to maintain ASC order
        setTransactions((prev) => {
          // Check if already exists to avoid duplicates
          if (prev.some((t) => t.$id === newTransaction.$id)) {
            return prev;
          }

          // Add to end since it's newer (ASC order by created date)
          const updated = [...prev, newTransaction];
          return removeDuplicatesRef.current(updated);
        });

        // Show assignment notification
        console.log(
          `✅ New order assigned: ${newTransaction.odrId} (Added to your queue)`
        );
      } else {
        // Track new orders available for other users
        setNewOrdersAvailable((prev) => prev + 1);

        // Show general notification
        console.log(
          `🆕 New withdrawal order received: ${newTransaction.odrId} (Not assigned to you)`
        );
      }

      // Always update total count
      if (currentUserRole && currentUserId) {
        refreshTotalCount(currentUserRole, currentUserId);
      }
    },
    [refreshTotalCount, setNewOrdersAvailable, setTransactions]
  ); // Removed volatile dependencies

  // Fetch completed today count
  const fetchCompletedTodayCount = useCallback(
    async (userRole: string, userId: string) => {
      try {
        const result = await getCompletedTodayCount(
          userRole === "transassistant" ? userId : null
        );
        if (result.success && result.count !== undefined) {
          setCompletedTodayCount(result.count);
        }
      } catch (error) {
        console.error("Error fetching completed today count:", error);
      }
    },
    []
  );

  const handleRefreshNeeded = useCallback(async () => {
    const currentUserRole = userRoleRef.current;
    const currentUserId = userIdRef.current;

    if (!currentUserRole || !currentUserId) return;

    try {
      // Fetch fresh top transactions to replace removed ones
      await fetchInitialData(currentUserRole, currentUserId);
      await refreshTotalCount(currentUserRole, currentUserId);
      await fetchCompletedTodayCount(currentUserRole, currentUserId);
      // Reset new orders counter since we've refreshed
      setNewOrdersAvailable(0);
    } catch (error) {
      console.error("Error refreshing transactions:", error);
    }
  }, [
    fetchInitialData,
    refreshTotalCount,
    fetchCompletedTodayCount,
    setNewOrdersAvailable,
  ]); // Removed volatile dependencies

  // Setup optimized real-time subscription for top 3 transactions
  // For transassistant users, wait until userDocId is loaded to ensure proper assignment checking
  const shouldSetupSubscription =
    userRole !== "transassistant" ||
    (userRole === "transassistant" && userDocId);

  useOptimizedRealtimeSubscription({
    userRole: shouldSetupSubscription ? userRole : "",
    userId: shouldSetupSubscription ? userId : null,
    topTransactions: topThreeTransactions,
    onTransactionUpdate: handleTransactionUpdate,
    onTransactionRemoved: handleTransactionRemoved,
    onNewTransactionReceived: handleNewTransactionReceived,
    onRefreshNeeded: handleRefreshNeeded,
  });

  // Manual refresh function
  const manualRefresh = useCallback(async () => {
    await handleRefreshNeeded();
    // Also refresh completed today count
    const currentUserRole = userRoleRef.current;
    const currentUserId = userIdRef.current;
    if (currentUserRole && currentUserId) {
      await fetchCompletedTodayCount(currentUserRole, currentUserId);
    }
  }, [handleRefreshNeeded, fetchCompletedTodayCount]);

  // Load user data
  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await getLoggedInUser();

        if (!user) {
          window.location.href = "/sign-in";
          return;
        }

        setUserRole(user.role);
        setUserId(user.userId);

        // Check role permissions
        if (
          user.role !== "admin" &&
          user.role !== "transactor" &&
          user.role !== "transassistant"
        ) {
          window.location.href = "/";
          return;
        }

        // Get user document ID for transassistant role (needed for proper assignment checking)
        if (user.role === "transassistant") {
          try {
            // Import the function to get user document ID
            const { getUserDocumentId } = await import(
              "@/lib/actions/user.actions"
            );
            const docId = await getUserDocumentId(user.userId);
            setUserDocId(docId);
          } catch (error) {
            console.error("Error getting user document ID:", error);
          }
        }

        // Start fetching data
        await fetchInitialData(user.role, user.userId);
        await fetchCompletedTodayCount(user.role, user.userId);
      } catch (error) {
        console.error("Error fetching user data:", error);
      }
    };

    fetchUser();
  }, [fetchInitialData, fetchCompletedTodayCount]);

  // Cleanup on component unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      // Clear any pending timeouts
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  // Handle scroll for back-to-top button
  useEffect(() => {
    const handleScroll = () => {
      const scrollContainer = document.querySelector(".flex-1.overflow-y-auto");
      const scrollY = scrollContainer
        ? scrollContainer.scrollTop
        : window.scrollY ||
          document.documentElement.scrollTop ||
          document.body.scrollTop;
      setShowBackToTop(scrollY > 200);
    };

    // Find the main scroll container
    const scrollContainer = document.querySelector(".flex-1.overflow-y-auto");

    // Add listeners to both the container and window as fallback
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", handleScroll);
    }
    window.addEventListener("scroll", handleScroll);
    document.addEventListener("scroll", handleScroll);

    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", handleScroll);
      }
      window.removeEventListener("scroll", handleScroll);
      document.removeEventListener("scroll", handleScroll);
    };
  }, []);

  // Back to top function
  const scrollToTop = useCallback(() => {
    try {
      // Target the main scroll container from the layout
      const scrollContainer = document.querySelector(".flex-1.overflow-y-auto");

      if (scrollContainer) {
        scrollContainer.scrollTo({
          top: 0,
          behavior: "smooth",
        });
      } else {
        // Fallback to window/document scroll
        window.scrollTo({
          top: 0,
          behavior: "smooth",
        });

        document.documentElement.scrollTo({
          top: 0,
          behavior: "smooth",
        });
      }

      // Additional fallback after a short delay
      setTimeout(() => {
        const container = document.querySelector(".flex-1.overflow-y-auto");
        if (container) {
          container.scrollTop = 0;
        }
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }, 100);
    } catch {
      // Emergency fallback
      window.scrollTo(0, 0);
    }
  }, []);

  // Check if the current user can update status
  const canUpdateStatus = useCallback(
    (transaction: Transaction) => {
      const currentUserRole = userRoleRef.current;
      if (currentUserRole === "admin") return true;
      if (
        currentUserRole !== "transactor" &&
        currentUserRole !== "transassistant"
      )
        return false;
      if (transaction.odrStatus !== "pending") return false;
      return true;
    },
    [] // No dependencies - uses ref for stable access
  );

  // Handle status update with optimistic UI updates
  const handleStatusUpdate = useCallback(
    async (transaction: Transaction, newStatus: "completed" | "failed") => {
      if (
        !confirm(
          `Are you sure you want to mark transaction ${transaction.odrId} as ${newStatus}?`
        )
      ) {
        return;
      }

      setUpdatingTransactions((prev) => new Set(prev).add(transaction.$id));

      // Optimistic update
      setTransactions((prev) =>
        prev.map((t) =>
          t.$id === transaction.$id
            ? { ...t, odrStatus: newStatus, isTransitioning: true }
            : t
        )
      );

      try {
        const result = await updateTransactionStatus(
          transaction.$id,
          newStatus
        );

        if (result && typeof result === "object") {
          if ("success" in result) {
            if (!result.success) {
              throw new Error(
                result.message || "Failed to update transaction status"
              );
            }
          } else if (!("$id" in result)) {
            throw new Error("Invalid response format");
          }
        } else {
          throw new Error("Invalid response from server");
        }

        // Remove transaction after successful update
        setTimeout(() => {
          setTransactions((prev) =>
            prev.filter((t) => t.$id !== transaction.$id)
          );
          manualRefresh(); // Refresh to update counts
        }, 300);
      } catch (error) {
        console.error("Error updating transaction status:", error);

        // Revert optimistic update
        setTransactions((prev) =>
          prev.map((t) =>
            t.$id === transaction.$id
              ? { ...transaction, isTransitioning: false }
              : t
          )
        );

        console.error(
          "Failed to update transaction status:",
          error instanceof Error ? error.message : "Unknown error"
        );
      } finally {
        setUpdatingTransactions((prev) => {
          const newSet = new Set(prev);
          newSet.delete(transaction.$id);
          return newSet;
        });
      }
    },
    [setTransactions, manualRefresh]
  );

  // Handle bulk assignment
  const handleBulkAssignment = useCallback(async () => {
    const currentUserRole = userRoleRef.current;
    const currentUserId = userIdRef.current;

    try {
      // Quick fetch to get count and confirm action
      const unassignedWithdrawalsResult = await fetchAllUnassignedWithdrawals({
        transassistantId:
          currentUserRole === "transassistant" ? currentUserId : null,
      });

      if (
        !unassignedWithdrawalsResult.success ||
        !unassignedWithdrawalsResult.data
      ) {
        throw new Error(
          unassignedWithdrawalsResult.message ||
            "Failed to fetch unassigned withdrawals"
        );
      }

      const unassignedTransactions =
        unassignedWithdrawalsResult.data as Transaction[];

      if (unassignedTransactions.length === 0) {
        console.log("All pending transactions are already assigned to users.");
        return;
      }

      if (
        !confirm(
          `Are you sure you want to assign ${unassignedTransactions.length} unassigned withdrawal(s) to users? This will run in the background so you can continue viewing orders.`
        )
      ) {
        return;
      }

      // Set loading state and show initial toast
      setAssigningTransactions(new Set(["bulk-assignment"]));

      console.log(
        `Starting background assignment of ${unassignedTransactions.length} withdrawals...`
      );

      // Run the assignment process in the background
      const backgroundAssignment = async () => {
        let successCount = 0;
        let failureCount = 0;
        const totalCount = unassignedTransactions.length;

        try {
          // Process assignments in batches to avoid overwhelming the system
          const batchSize = 10;
          const batches = [];
          for (let i = 0; i < unassignedTransactions.length; i += batchSize) {
            batches.push(unassignedTransactions.slice(i, i + batchSize));
          }

          for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
            const batch = batches[batchIndex];

            const assignmentPromises = batch.map(async (transaction) => {
              try {
                const assignedUserId = await assignWithdrawalToUser(
                  transaction.$id
                );
                if (assignedUserId) {
                  successCount++;
                  return { success: true, transaction, assignedUserId };
                } else {
                  failureCount++;
                  return {
                    success: false,
                    transaction,
                    error: "No available users",
                  };
                }
              } catch (error) {
                failureCount++;
                return { success: false, transaction, error };
              }
            });

            await Promise.all(assignmentPromises);

            // Show progress every 3 batches or at the end
            const processed = successCount + failureCount;
            if (
              (batchIndex + 1) % 3 === 0 ||
              batchIndex === batches.length - 1
            ) {
              console.log(
                `Progress: ${processed}/${totalCount} assignments processed (${successCount} successful)`
              );
            }

            // Small delay between batches to prevent rate limiting
            if (batchIndex < batches.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 300));
            }
          }

          // Refresh data after bulk assignment
          if (currentUserRole && currentUserId) {
            await manualRefresh();
          }

          // Final completion toast
          if (successCount > 0 && failureCount === 0) {
            console.log(
              `✅ Background assignment completed! Successfully assigned all ${successCount} withdrawal(s) to users.`
            );
          } else if (successCount > 0 && failureCount > 0) {
            console.log(
              `✅ Background assignment completed! Assigned ${successCount} withdrawal(s) successfully. ${failureCount} failed.`
            );
          } else {
            console.error(
              `❌ Background assignment failed. ${failureCount} withdrawal(s) could not be assigned. No available users or system error.`
            );
          }
        } catch {
          console.error(
            "❌ Background assignment failed due to system error. Please try again."
          );
        } finally {
          // Clear loading state
          setAssigningTransactions(new Set());
        }
      };

      // Start background process (non-blocking)
      backgroundAssignment();

      // Clear immediate loading state so user can continue using the UI
      setTimeout(() => {
        // Keep a minimal indicator that assignment is running
        setAssigningTransactions(new Set(["background"]));
      }, 1000);
    } catch {
      console.error("Failed to start bulk assignment. Please try again.");
      setAssigningTransactions(new Set());
    }
  }, [manualRefresh]); // Removed volatile dependencies - using refs instead

  // Count suspicious transactions
  const suspiciousTransactionCount = useMemo(() => {
    return displayTransactions.filter((t) => t.isSuspicious).length;
  }, [displayTransactions]);

  // Memoize header props to prevent unnecessary re-renders
  const headerProps = useMemo(
    () => ({
      totalPendingCount,
      suspiciousTransactionCount,
      completedTodayCount,
      userRole,
      assigningTransactions,
      loading,
      onBulkAssignment: handleBulkAssignment,
    }),
    [
      totalPendingCount,
      suspiciousTransactionCount,
      completedTodayCount,
      userRole,
      assigningTransactions,
      loading,
      handleBulkAssignment,
    ]
  );

  return (
    <section className="min-h-screen w-full flex flex-col">
      <div className="flex w-full flex-1 flex-col gap-8 px-5 sm:px-8 py-7 lg:py-12 custom-scrollbar overflow-y-auto">
        <WithdrawHeader {...headerProps} />
        {/* Real-time Status Indicator */}
        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-lg p-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            <span className="text-sm text-green-700">
              ⚡ Optimized Flow: Top 3 batched monitoring + Auto-load
            </span>
            <span className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded">
              {topThreeTransactions.length} active
            </span>
            {newOrdersAvailable > 0 && (
              <span className="text-xs text-orange-600 bg-orange-100 px-2 py-1 rounded animate-pulse">
                {newOrdersAvailable} new (not assigned to you)
              </span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={manualRefresh}
            disabled={loading}
            className="border-green-300 text-green-700 hover:bg-green-100"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Refresh All
          </Button>
        </div>

        <div className="w-full">
          {loading && transactions.length === 0 ? (
            // Show skeleton cards for initial loading
            <div className="grid grid-cols-1 gap-6">
              {Array.from({ length: 5 }, (_, i) => (
                <SkeletonCard key={`initial-skeleton-${i}`} index={i} />
              ))}
            </div>
          ) : error && transactions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">{error}</div>
          ) : displayTransactions.length === 0 && !loading ? (
            // Empty state when no transactions
            <div className="text-center py-12 text-gray-500">
              <div className="mb-4">
                <svg
                  className="mx-auto h-12 w-12 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                No pending withdrawals
              </h3>
              <p className="text-gray-500">
                No pending withdrawal transactions found
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-6">
                {displayTransactions.map((transaction, index) => (
                  <div
                    key={`${transaction.$id}-${transaction.odrId}`}
                    className={`
                    ${
                      index < 3
                        ? "ring-2 ring-green-200 ring-offset-2 bg-green-50/30 rounded-lg p-1"
                        : ""
                    }
                  `}
                  >
                    {index < 3 && (
                      <div className="flex items-center gap-1 mb-2 px-2">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        <span className="text-xs text-green-600 font-medium">
                          🔄 Position {index + 1} - Continuous flow
                        </span>
                      </div>
                    )}
                    <TransactionCard
                      key={`card-${transaction.$id}-${transaction.odrId}`}
                      transaction={transaction}
                      index={index}
                      userRole={userRole}
                      updatingTransactions={updatingTransactions}
                      paymentIds={paymentValidation.paymentIds}
                      validatingPayment={paymentValidation.validatingPayment}
                      paymentValidationResults={
                        paymentValidation.paymentValidationResults
                      }
                      validatedTransactions={
                        paymentValidation.validatedTransactions
                      }
                      processingPayments={paymentValidation.processingPayments}
                      justProcessedTransactions={
                        paymentValidation.justProcessedTransactions
                      }
                      showTransactionActions={
                        paymentValidation.showTransactionActions
                      }
                      canUpdateStatus={canUpdateStatus}
                      onStatusUpdate={handleStatusUpdate}
                      onPaymentIdChange={
                        paymentValidation.handlePaymentIdChange
                      }
                      onToggleTransactionActions={
                        paymentValidation.toggleTransactionActions
                      }
                      onValidatePaymentId={paymentValidation.validatePaymentId}
                      onProcessPayment={paymentValidation.processPayment}
                      onResetValidationState={
                        paymentValidation.resetValidationState
                      }
                    />
                  </div>
                ))}
              </div>

              {/* Loading indicators for infinite scroll */}
              {loadingMore && (
                <div className="grid grid-cols-1 gap-6">
                  {Array.from({ length: skeletonCount }, (_, i) => (
                    <SkeletonCard key={`skeleton-${i}`} index={i} />
                  ))}
                </div>
              )}

              {/* Traditional loading spinner for initial load */}
              {loading && transactions.length > 0 && !loadingMore && (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}

              {/* Subtle preloading indicator */}
              {isPreloading && !loadingMore && (
                <div className="flex justify-center py-2">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                </div>
              )}

              {/* Intersection observer target - only show if under 10 row limit */}
              {hasMore && !loading && displayTransactions.length < 10 && (
                <div ref={loaderRef} className="h-10" />
              )}

              {/* Maximum rows reached indicator */}
              {displayTransactions.length >= 10 && (
                <div className="text-center py-6 text-amber-600 border-t mt-6 bg-amber-50 rounded-lg">
                  <p className="font-medium">Maximum 10 rows displayed</p>
                  <p className="text-sm mt-1">
                    Showing {displayTransactions.length} transactions (refresh
                    to see latest)
                  </p>
                </div>
              )}

              {/* No more transactions indicator - only show if under limit and no more data */}
              {!hasMore &&
                !loading &&
                displayTransactions.length > 0 &&
                displayTransactions.length < 10 &&
                totalPendingCount <= displayTransactions.length && (
                  <div className="text-center py-6 text-gray-500 border-t mt-6">
                    <p>All transactions loaded</p>
                    {totalPendingCount === 0 ? (
                      <p className="text-sm mt-1">
                        No pending transactions available
                      </p>
                    ) : (
                      <p className="text-sm mt-1">
                        Showing {displayTransactions.length} of{" "}
                        {totalPendingCount} total pending transactions
                      </p>
                    )}
                  </div>
                )}
            </>
          )}
        </div>
      </div>

      {/* Back to Top Button */}
      {showBackToTop && (
        <Button
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-[9999] rounded-full w-14 h-14 shadow-2xl bg-blue-600 hover:bg-blue-700 text-white border-2 border-white transition-all duration-300 hover:scale-110 cursor-pointer"
          size="lg"
          style={{ pointerEvents: "auto" }}
        >
          <ChevronUp className="h-6 w-6" />
        </Button>
      )}
    </section>
  );
}
