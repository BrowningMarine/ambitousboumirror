import { useEffect, useCallback, useRef } from "react";
import { client } from "@/lib/appwrite/appwrite-client";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import type { RealtimeResponseEvent } from "appwrite";
import { Transaction } from "@/hooks/useWithdrawals";

interface UseSelectiveRealtimeSubscriptionOptions {
  userRole: string;
  userId: string | null;
  topTransactions: Transaction[]; // Only the top 3 transactions
  onTransactionUpdate: (updatedTransaction: Transaction) => void;
  onTransactionRemoved: (transactionId: string) => void;
  onNewTransactionReceived: (newTransaction: Transaction) => void; // New callback for incoming orders
  onRefreshNeeded: () => void; // When we need to refresh to get new top 3
}

interface UseSelectiveRealtimeSubscriptionResult {
  setupSubscription: () => void;
  cleanupSubscription: () => void;
}

export function useSelectiveRealtimeSubscription({
  userRole,
  userId,
  topTransactions,
  onTransactionUpdate,
  onTransactionRemoved,
  onNewTransactionReceived,
  onRefreshNeeded,
}: UseSelectiveRealtimeSubscriptionOptions): UseSelectiveRealtimeSubscriptionResult {
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const subscribedIdsRef = useRef<Set<string>>(new Set());

  const setupSubscription = useCallback(() => {
    // Clean up existing subscription
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    if (!userRole || !userId) {
      return;
    }

    try {
      // Get top 3 transaction IDs for detailed monitoring
      const topIds = topTransactions.slice(0, 3).map(t => t.$id);
      subscribedIdsRef.current = new Set(topIds);

      console.log(`[Selective RT] Subscribing to top ${topIds.length} transactions + new orders:`, topIds);

      // Subscribe to the entire collection to catch both existing top 3 and new incoming orders
      const unsubscribe = client.subscribe(
        `databases.${appwriteConfig.databaseId}.collections.${appwriteConfig.odrtransCollectionId}.documents`,
        (response: RealtimeResponseEvent<Transaction>) => {
          const eventType = response.events[0];
          const document = response.payload;

          // Only process withdraw transactions
          if (document.odrType !== "withdraw") {
            return;
          }

          // For transassistant users, check if they are assigned to this transaction
          if (userRole === "transassistant") {
            const isAssignedToUser = (() => {
              // If users is a string (document ID), we can't determine assignment easily
              if (typeof document.users === "string") {
                return false; // Will trigger refresh to check assignment
              }

              // If users is an object with userId, check if it matches current user
              if (document.users && typeof document.users === "object") {
                return document.users.userId === userId;
              }

              return false;
            })();

            // For transassistant users, only process transactions assigned to them OR new pending transactions
            if (!isAssignedToUser && !(eventType.endsWith(".create") && document.odrStatus === "pending")) {
              // If transaction was updated and might be newly assigned, trigger refresh
              if (eventType.endsWith(".update")) {
                console.log(`[Selective RT] Transaction ${document.$id} might be newly assigned, triggering refresh`);
                onRefreshNeeded();
              }
              return;
            }
          }

          // Handle CREATE events for new incoming orders
          if (eventType.endsWith(".create") && document.odrStatus === "pending") {
            console.log(`[Selective RT] New incoming order detected: ${document.$id}`);
            onNewTransactionReceived(document);
            return;
          }

          // Handle UPDATE/DELETE events only for our monitored top 3 transactions
          const isMonitoredTransaction = subscribedIdsRef.current.has(document.$id);
          
          if (isMonitoredTransaction) {
            console.log(`[Selective RT] Processing ${eventType} for monitored transaction ${document.$id}`);

            if (eventType.endsWith(".update")) {
              // If status changed to non-pending, this transaction will be removed
              if (document.odrStatus !== "pending") {
                console.log(`[Selective RT] Monitored transaction ${document.$id} status changed to ${document.odrStatus}, removing`);
                onTransactionRemoved(document.$id);
                
                // Remove from our subscription tracking
                subscribedIdsRef.current.delete(document.$id);
                
                // Trigger refresh to get new top transactions
                setTimeout(() => {
                  onRefreshNeeded();
                }, 500);
              } else {
                // Still pending, just update it
                onTransactionUpdate(document);
              }
            } else if (eventType.endsWith(".delete")) {
              console.log(`[Selective RT] Monitored transaction ${document.$id} deleted`);
              onTransactionRemoved(document.$id);
              
              // Remove from our subscription tracking
              subscribedIdsRef.current.delete(document.$id);
              
              // Trigger refresh to get new top transactions
              setTimeout(() => {
                onRefreshNeeded();
              }, 500);
            }
          } else {
            // For non-monitored transactions, we only care about status changes that might affect counts
            if (eventType.endsWith(".update") || eventType.endsWith(".delete")) {
              // Any status change might affect the total pending count
              console.log(`[Selective RT] Non-monitored transaction changed, might affect counts`);
              // We don't need to do anything specific here as the count will be updated when needed
            }
          }
        }
      );

      unsubscribeRef.current = unsubscribe;

      console.log(`[Selective RT] Subscription setup complete for ${topIds.length} transactions + new orders`);
    } catch (error) {
      console.error("[Selective RT] Error setting up realtime subscription:", error);
    }
  }, [userRole, userId, topTransactions, onTransactionUpdate, onTransactionRemoved, onNewTransactionReceived, onRefreshNeeded]);

  const cleanupSubscription = useCallback(() => {
    if (unsubscribeRef.current) {
      console.log("[Selective RT] Cleaning up subscription");
      unsubscribeRef.current();
      unsubscribeRef.current = null;
      subscribedIdsRef.current.clear();
    }
  }, []);

  // Setup subscription whenever top transactions change
  useEffect(() => {
    const timer = setTimeout(() => {
      setupSubscription();
    }, 1000); // Small delay to avoid rapid re-subscriptions

    return () => {
      clearTimeout(timer);
    };
  }, [setupSubscription]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupSubscription();
    };
  }, [cleanupSubscription]);

  return {
    setupSubscription,
    cleanupSubscription,
  };
} 