"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/appwrite/appwrite-client";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import type { RealtimeResponseEvent } from "appwrite";

// Optimized hooks
import { useOptimizedWithdrawList } from "@/hooks/useOptimizedWithdrawList";

// Components
import WithdrawHeader from "@/components/withdraw-list/WithdrawHeader";
import TransactionCard from "@/components/withdraw-list/TransactionCard";
import SkeletonCard from "@/components/withdraw-list/SkeletonCard";
import TransactorDashboard from "@/components/withdraw-list/TransactorDashboard";

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

export default function WithdrawListPageOptimized() {
  // Use the unified optimized hook
  const {
    // State
    userRole,
    userId,
    userDocId,
    transaction,
    totalPendingCount,
    suspiciousCount,
    completedTodayCount,
    loading,
    isReloading,
    error,
    cacheStats,

    // Actions
    handleStatusUpdate,
    handleRefresh,
    handleRealtimeUpdate,
    canUpdateStatus,

    // Sub-hooks
    paymentValidation,
    optimisticUpdates,
    cache,

    // Performance monitoring
    getPerformanceMetrics,
  } = useOptimizedWithdrawList();

  // Real-time connection state
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [shouldReconnect, setShouldReconnect] = useState(false);

  // Refs for connection monitoring
  const connectionCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastEventTimeRef = useRef<Date>(new Date());
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const userRoleRef = useRef<string>("");
  const userDocIdRef = useRef<string | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    userRoleRef.current = userRole;
    userDocIdRef.current = userDocId;
  }, [userRole, userDocId]);

  // Connection monitoring
  const startConnectionMonitoring = useCallback(() => {
    if (connectionCheckIntervalRef.current) {
      clearInterval(connectionCheckIntervalRef.current);
    }

    connectionCheckIntervalRef.current = setInterval(() => {
      const isOnline = navigator.onLine;

      if (!isOnline) {
        console.log("[RT-Optimized] Browser reports offline");
        setIsRealtimeConnected(false);
        return;
      }

      const now = new Date();
      const timeSinceLastEvent =
        now.getTime() - lastEventTimeRef.current.getTime();

      if (timeSinceLastEvent > 60000) {
        // 1 minute
        console.log(
          `[RT-Optimized] No events for ${Math.round(
            timeSinceLastEvent / 1000
          )}s, considering disconnected`
        );
        setIsRealtimeConnected(false);
        setShouldReconnect(true);
        return;
      }

      console.log(
        `[RT-Optimized] Connection healthy - Last event: ${Math.round(
          timeSinceLastEvent / 1000
        )}s ago`
      );
    }, 15000); // Check every 15 seconds
  }, []);

  // Update last event time
  const updateLastEventTime = useCallback(() => {
    lastEventTimeRef.current = new Date();
    setIsRealtimeConnected(true);
  }, []);

  // Store function refs to avoid dependency issues
  const handleRealtimeUpdateRef = useRef(handleRealtimeUpdate);
  const cacheRef = useRef(cache);

  // Keep refs updated
  useEffect(() => {
    handleRealtimeUpdateRef.current = handleRealtimeUpdate;
    cacheRef.current = cache;
  }, [handleRealtimeUpdate, cache]);

  // Enhanced real-time subscription setup
  const setupRealtimeSubscription = useCallback(() => {
    // Clean up existing subscription
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    const currentUserRole = userRoleRef.current;
    const currentUserDocId = userDocIdRef.current;

    if (!currentUserRole) {
      return;
    }

    try {
      console.log("[RT-Optimized] Setting up enhanced real-time subscription");

      const unsubscribe = client.subscribe(
        `databases.${appwriteConfig.databaseId}.collections.${appwriteConfig.odrtransCollectionId}.documents`,
        (response: RealtimeResponseEvent<Transaction>) => {
          updateLastEventTime();
          setIsRealtimeConnected(true);

          const eventType = response.events[0];
          const document = response.payload;

          // Only process withdraw transactions
          if (document.odrType !== "withdraw") return;

          console.log(
            `[RT-Optimized] Received event: ${eventType} for transaction ${document.odrId}`
          );

          // Check if transaction belongs to current user
          const belongsToCurrentUser = (() => {
            if (
              currentUserRole === "admin" ||
              currentUserRole === "transactor"
            ) {
              return true;
            }

            if (currentUserRole === "transassistant") {
              if (document.users && currentUserDocId) {
                let assignedUserDocId: string | null = null;

                if (typeof document.users === "string") {
                  assignedUserDocId = document.users;
                } else if (
                  typeof document.users === "object" &&
                  document.users.$id
                ) {
                  assignedUserDocId = document.users.$id as string;
                }

                return assignedUserDocId === currentUserDocId;
              }
              return false;
            }

            return false;
          })();

          if (!belongsToCurrentUser) {
            console.log(
              `[RT-Optimized] Ignoring event for transaction not assigned to current user`
            );
            return;
          }

          // Handle different event types intelligently
          if (eventType.includes(".update")) {
            // Transaction was updated - use optimized real-time handler
            console.log(
              `[RT-Optimized] Transaction updated, using smart reload logic`
            );
            handleRealtimeUpdateRef.current(document);
          } else if (eventType.includes(".create")) {
            // New transaction created - might need counts update
            console.log(
              `[RT-Optimized] New transaction created, updating counts`
            );
            // Only update counts, don't switch to new transaction immediately
            cacheRef.current.invalidatePattern("counts_.*");
          } else if (eventType.includes(".delete")) {
            // Transaction deleted - update counts
            console.log(`[RT-Optimized] Transaction deleted, updating counts`);
            cacheRef.current.invalidatePattern("counts_.*");
          }
        }
      );

      unsubscribeRef.current = unsubscribe;
      setIsRealtimeConnected(true);
      updateLastEventTime();
      startConnectionMonitoring();
      console.log("[RT-Optimized] Enhanced real-time subscription established");
    } catch (error) {
      console.error(
        "[RT-Optimized] Error setting up real-time subscription:",
        error
      );
      setIsRealtimeConnected(false);

      if (connectionCheckIntervalRef.current) {
        clearInterval(connectionCheckIntervalRef.current);
        connectionCheckIntervalRef.current = null;
      }
    }
  }, [updateLastEventTime, startConnectionMonitoring]);

  // Handle reconnection
  useEffect(() => {
    if (shouldReconnect && userRole) {
      console.log("[RT-Optimized] Reconnection triggered");
      setShouldReconnect(false);

      const reconnectTimeout = setTimeout(() => {
        if (unsubscribeRef.current) {
          unsubscribeRef.current();
          unsubscribeRef.current = null;
        }
        setupRealtimeSubscription();
      }, 2000);

      return () => clearTimeout(reconnectTimeout);
    }
  }, [shouldReconnect, userRole, setupRealtimeSubscription]);

  // Setup real-time subscription when user data is ready
  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    const handleOnline = () => {
      console.log("[RT-Optimized] Browser went online");
      setIsRealtimeConnected(true);
      setShouldReconnect(true);
    };

    const handleOffline = () => {
      console.log("[RT-Optimized] Browser went offline");
      setIsRealtimeConnected(false);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    if (userRole && userId) {
      timeoutId = setTimeout(() => {
        setupRealtimeSubscription();
      }, 1000);
    }

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (connectionCheckIntervalRef.current) {
        clearInterval(connectionCheckIntervalRef.current);
        connectionCheckIntervalRef.current = null;
      }
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
        setIsRealtimeConnected(false);
      }
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [userRole, userId, setupRealtimeSubscription]);

  // Show loading state while determining user role
  if (!userRole) {
    return (
      <section className="min-h-screen w-full flex flex-col">
        <div className="flex w-full flex-1 flex-col gap-8 px-5 sm:px-8 py-7 lg:py-12">
          <div className="flex items-center justify-center min-h-[400px]">
            <div className="text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
              <p className="text-gray-500">Loading...</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Show TransactorDashboard for transactor role
  if (userRole === "transactor") {
    return (
      <section className="min-h-screen w-full flex flex-col">
        <div className="flex w-full flex-1 flex-col gap-8 px-5 sm:px-8 py-7 lg:py-12">
          <TransactorDashboard />
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen w-full flex flex-col">
      <div className="flex w-full flex-1 flex-col gap-8 px-5 sm:px-8 py-7 lg:py-12">
        <WithdrawHeader
          totalPendingCount={totalPendingCount}
          suspiciousTransactionCount={suspiciousCount}
          completedTodayCount={completedTodayCount}
          userRole={userRole}
          assigningTransactions={new Set()}
          loading={loading}
          onBulkAssignment={() => {}} // Disabled for single transaction mode
        />

        {/* Enhanced Connection Status with Performance Metrics */}
        <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg p-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  isRealtimeConnected
                    ? "bg-green-500 animate-pulse"
                    : "bg-red-500 animate-ping"
                }`}
              ></div>
              <span
                className={`text-sm ${
                  isRealtimeConnected
                    ? "text-gray-600"
                    : "text-red-600 font-medium"
                }`}
              >
                {isRealtimeConnected
                  ? "Realtime Live"
                  : "Realtime Disconnected"}
              </span>
            </div>

            {/* Simple Status Indicator */}
            {optimisticUpdates.updatingTransactions.size > 0 && (
              <div className="flex items-center gap-2 text-xs text-blue-600">
                <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                <span>
                  {optimisticUpdates.updatingTransactions.size} updating...
                </span>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {/* Removed manual cache button */}

            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={loading || isReloading}
              className="border-gray-300 text-gray-700 hover:bg-gray-100"
            >
              {loading || isReloading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Refresh
            </Button>
          </div>
        </div>

        <div className="w-full">
          {loading && !transaction ? (
            <SkeletonCard index={0} />
          ) : error && !transaction ? (
            <div className="text-center py-8 text-gray-500">{error}</div>
          ) : !transaction && !loading ? (
            <div className="text-center py-12 text-gray-500">
              <div className="mb-2">
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
          ) : transaction ? (
            <div
              className={`transition-opacity duration-300 ${
                isReloading ? "opacity-0" : "opacity-100"
              }`}
            >
              <TransactionCard
                transaction={transaction}
                index={0}
                userRole={userRole}
                updatingTransactions={optimisticUpdates.updatingTransactions}
                paymentIds={paymentValidation.paymentIds}
                validatingPayment={paymentValidation.validatingPayment}
                paymentValidationResults={
                  paymentValidation.paymentValidationResults
                }
                validatedTransactions={paymentValidation.validatedTransactions}
                processingPayments={paymentValidation.processingPayments}
                justProcessedTransactions={
                  paymentValidation.justProcessedTransactions
                }
                showTransactionActions={
                  paymentValidation.showTransactionActions
                }
                canUpdateStatus={canUpdateStatus}
                onStatusUpdate={handleStatusUpdate}
                onPaymentIdChange={paymentValidation.handlePaymentIdChange}
                onToggleTransactionActions={
                  paymentValidation.toggleTransactionActions
                }
                onValidatePaymentId={paymentValidation.validatePaymentId}
                onProcessPayment={paymentValidation.processPayment}
                onResetValidationState={paymentValidation.resetValidationState}
              />
            </div>
          ) : null}
        </div>

        {/* Developer Debug Panel (Development Only) */}
        {process.env.NODE_ENV === "development" && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs">
            <details>
              <summary className="cursor-pointer font-medium">
                🔧 Developer Debug Panel
              </summary>
              <div className="mt-2 space-y-1">
                <div>
                  Cache Hit Ratio:{" "}
                  {getPerformanceMetrics().cacheHitRatio.toFixed(1)}% (
                  {cacheStats.hits}H/{cacheStats.misses}M)
                </div>
                <div>
                  Cache Entries: {getPerformanceMetrics().cacheSize}(
                  {Math.round(cacheStats.memoryUsage / 1024)}KB)
                </div>
                <div>
                  Optimistic Updates:{" "}
                  {getPerformanceMetrics().pendingOptimisticOperations}
                </div>
                <div>
                  Real-time:{" "}
                  {isRealtimeConnected ? "Connected" : "Disconnected"}
                </div>
                <div>
                  Reloading:{" "}
                  {getPerformanceMetrics().isReloading ? "Yes" : "No"}
                </div>
                <div className="pt-2 border-t border-yellow-300">
                  <button
                    onClick={() => cache.cleanup()}
                    className="px-2 py-1 bg-yellow-200 rounded text-yellow-800 hover:bg-yellow-300"
                  >
                    Force Cache Cleanup
                  </button>
                </div>
              </div>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}
