import { useEffect, useRef, useCallback } from "react";
import { client } from "@/lib/appwrite/appwrite-client";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { RealtimeResponseEvent } from "appwrite";
import { Transaction } from "./useWithdrawals";

interface UseRealtimeSubscriptionOptions {
  userRole: string;
  userId: string | null;
  transactions: Transaction[];
  limit: number;
  onTransactionsUpdate: React.Dispatch<React.SetStateAction<Transaction[]>>;
  onSetHasMore: React.Dispatch<React.SetStateAction<boolean>>;
  onRefreshTotalCount: () => Promise<void>;
  reloadAssignedTransactions: () => Promise<void>;
}

interface UseRealtimeSubscriptionResult {
  setupSubscription: () => void;
  cleanupSubscription: () => void;
}

export function useRealtimeSubscription({
  userRole,
  userId,
  transactions,
  limit,
  onTransactionsUpdate,
  onSetHasMore,
  onRefreshTotalCount,
  reloadAssignedTransactions,
}: UseRealtimeSubscriptionOptions): UseRealtimeSubscriptionResult {
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const removedIdsRef = useRef<Set<string>>(new Set());

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

  const setupSubscription = useCallback(() => {
    try {
      // Subscribe to transaction updates
      const unsubscribe = client.subscribe(
        `databases.${appwriteConfig.databaseId}.collections.${appwriteConfig.odrtransCollectionId}.documents`,
        (response: RealtimeResponseEvent<Transaction>) => {
          const eventType = response.events[0];
          const document = response.payload;

          // Only process withdraw transactions
          if (document.odrType === "withdraw") {
            // For transassistant users, check if they are assigned to this transaction
            if (userRole === "transassistant") {
              const isAssignedToUser = (() => {
                // If users is a string (document ID), we can't determine if this user is assigned
                if (typeof document.users === "string") {
                  // Reload data to check if this transaction is assigned to this user
                  setTimeout(() => reloadAssignedTransactions(), 100);
                  return false;
                }

                // If users is an object with userId, check if it matches current user
                if (document.users && typeof document.users === "object") {
                  if (document.users.userId === userId) {
                    return true;
                  }
                }

                return false;
              })();

              // For transassistant users, only show transactions assigned to them
              if (!isAssignedToUser) {
                // If the transaction is being assigned to this user or updated with this user,
                // we need to detect that and update our view
                if (eventType.endsWith(".update")) {
                  // Reload data to check for newly assigned transactions
                  setTimeout(() => reloadAssignedTransactions(), 100);
                }

                // Skip processing this transaction further
                return;
              }
            }

            // Handle transaction assignment event for transactors
            if (userRole === "transactor" && eventType.endsWith(".update")) {
              // If we're a transactor and the transaction was just updated,
              // check if it's being assigned to someone (users field changed)
              if (document.users) {
                // This transaction is now assigned to someone, find and remove it with animation
                onTransactionsUpdate((prev) => {
                  const transactionExists = prev.some((t) => t.$id === document.$id);
                  if (transactionExists) {
                    // Mark for transition first, then remove from main list
                    return prev.map((t) =>
                      t.$id === document.$id ? { ...t, isTransitioning: true } : t
                    );
                  }
                  return prev;
                });

                // Remove after animation
                setTimeout(() => {
                  onTransactionsUpdate((prev) =>
                    prev.filter((t) => t.$id !== document.$id)
                  );

                  // Update count immediately after removing
                  onRefreshTotalCount();
                }, 200);
              }
            }

            // Update total count when there are any changes
            if (
              eventType.endsWith(".create") ||
              eventType.endsWith(".update") ||
              eventType.endsWith(".delete")
            ) {
              // For status changes that remove transactions from pending, delay the count update
              const isStatusChangeToNonPending =
                eventType.endsWith(".update") && document.odrStatus !== "pending";
              const delay = isStatusChangeToNonPending ? 350 : 50;

              setTimeout(() => {
                onRefreshTotalCount();

                // If we have a create event, check if we need to re-enable hasMore
                if (eventType.endsWith(".create") && document.odrStatus === "pending") {
                  onSetHasMore(true);
                }
              }, delay);
            }

            // For create events, check if it's a new transaction we should add to the top
            if (eventType.endsWith(".create") && document.odrStatus === "pending") {
              // Only add if we're showing the first page of transactions
              if (transactions.length <= limit) {
                onTransactionsUpdate((prev) => {
                  // Make sure it's not already in the list
                  if (prev.some((t) => t.$id === document.$id)) {
                    return prev;
                  }

                  // Add new transaction with fade-in effect
                  const newTransaction = {
                    ...document,
                    isTransitioning: false,
                  };

                  // Find the correct position to insert based on creation date
                  const updatedTransactions = [...prev];
                  const insertIndex = updatedTransactions.findIndex(
                    (t) => new Date(t.$createdAt) > new Date(document.$createdAt)
                  );

                  // If no position found, add to the end
                  if (insertIndex === -1) {
                    updatedTransactions.push(newTransaction);
                  } else {
                    // Insert at the correct position
                    updatedTransactions.splice(insertIndex, 0, newTransaction);
                  }

                  return removeDuplicates(updatedTransactions);
                });
              }
            }
            // Handle update events for existing transactions
            else if (eventType.endsWith(".update")) {
              // Check if this is a transaction we previously removed
              const wasRemoved = removedIdsRef.current.has(document.$id);

              // If status changed to pending and it was previously removed, just remove from tracking
              if (document.odrStatus === "pending" && wasRemoved) {
                removedIdsRef.current.delete(document.$id);
              }

              // Handle status changes for transactions in the current list
              onTransactionsUpdate((prev) => {
                // Check if this transaction already exists in our list
                const existingTransaction = prev.find((t) => t.$id === document.$id);

                if (existingTransaction) {
                  // If status changed to non-pending, mark for transition and removal
                  if (document.odrStatus !== "pending") {
                    return prev.map((t) =>
                      t.$id === document.$id ? { ...document, isTransitioning: true } : t
                    );
                  } else {
                    // If status is pending, just update it
                    return prev.map((t) => (t.$id === document.$id ? document : t));
                  }
                }
                return prev;
              });

              // If status is not pending, remove after animation and track it
              if (document.odrStatus !== "pending") {
                // Track this ID as removed
                removedIdsRef.current.add(document.$id);

                setTimeout(() => {
                  onTransactionsUpdate((prev) =>
                    prev.filter((t) => t.$id !== document.$id)
                  );

                  // Update total count after removing the transaction
                  setTimeout(() => {
                    onRefreshTotalCount();
                  }, 100);
                }, 200);
              }
            } else if (eventType.endsWith(".delete")) {
              // Mark for transition first, then remove from main list
              onTransactionsUpdate((prev) =>
                prev.map((t) =>
                  t.$id === document.$id ? { ...t, isTransitioning: true } : t
                )
              );

              // Remove after animation
              setTimeout(() => {
                onTransactionsUpdate((prev) =>
                  prev.filter((t) => t.$id !== document.$id)
                );

                // Remove from tracking if it was there
                removedIdsRef.current.delete(document.$id);
              }, 200);
            }
          }
        }
      );

      unsubscribeRef.current = unsubscribe;
    } catch (error) {
      console.error("Error setting up realtime subscription:", error);
    }
  }, [
    userRole,
    userId,
    transactions.length,
    limit,
    onTransactionsUpdate,
    onSetHasMore,
    onRefreshTotalCount,
    reloadAssignedTransactions,
    removeDuplicates,
  ]);

  const cleanupSubscription = useCallback(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
  }, []);

  // Setup subscription with 2-second delay for better initial loading performance
  useEffect(() => {
    const timer = setTimeout(() => {
      setupSubscription();
    }, 2000);

    return () => {
      clearTimeout(timer);
      cleanupSubscription();
    };
  }, [setupSubscription, cleanupSubscription]);

  return {
    setupSubscription,
    cleanupSubscription,
  };
} 