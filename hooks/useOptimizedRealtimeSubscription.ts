import { useEffect, useCallback, useRef } from "react";
import { client } from "@/lib/appwrite/appwrite-client";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import type { RealtimeResponseEvent } from "appwrite";
import { Transaction } from "@/hooks/useWithdrawals";

interface UseOptimizedRealtimeSubscriptionOptions {
  userRole: string;
  userId: string | null;
  topTransactions: Transaction[]; // Only the top 3 transactions
  onTransactionUpdate: (updatedTransaction: Transaction) => void;
  onTransactionRemoved: (transactionId: string) => void;
  onNewTransactionReceived: (newTransaction: Transaction) => void;
  onRefreshNeeded: () => void;
}

interface UseOptimizedRealtimeSubscriptionResult {
  setupSubscription: () => void;
  cleanupSubscription: () => void;
}

export function useOptimizedRealtimeSubscription({
  userRole,
  userId,
  topTransactions,
  onTransactionUpdate,
  onTransactionRemoved,
  onNewTransactionReceived,
  onRefreshNeeded,
}: UseOptimizedRealtimeSubscriptionOptions): UseOptimizedRealtimeSubscriptionResult {
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const subscribedIdsRef = useRef<Set<string>>(new Set());
  const eventQueueRef = useRef<Array<{ transaction: Transaction; eventType: string; timestamp: number }>>([]);
  const processingRef = useRef<boolean>(false);
  const lastProcessTimeRef = useRef<number>(0);

  // Batch processing to reduce overhead
  const processBatchedEvents = useCallback(() => {
    if (processingRef.current || eventQueueRef.current.length === 0) {
      return;
    }

    processingRef.current = true;
    const now = Date.now();
    
    // Prevent processing too frequently (max once per 500ms)
    if (now - lastProcessTimeRef.current < 500) {
      processingRef.current = false;
      return;
    }

    try {
      const events = [...eventQueueRef.current];
      eventQueueRef.current = [];
      lastProcessTimeRef.current = now;

      //console.log(`[Optimized RT] Processing ${events.length} batched events`);

      // Group events by transaction ID to process latest only
      const latestEvents = new Map<string, typeof events[0]>();
      events.forEach(event => {
        const existing = latestEvents.get(event.transaction.$id);
        if (!existing || event.timestamp > existing.timestamp) {
          latestEvents.set(event.transaction.$id, event);
        }
      });

      // Process deduplicated events
      latestEvents.forEach(({ transaction, eventType }) => {
        const isMonitoredTransaction = subscribedIdsRef.current.has(transaction.$id);

        if (eventType === "create" && transaction.odrStatus === "pending") {
          onNewTransactionReceived(transaction);
        } else if (isMonitoredTransaction) {
          if (eventType === "update") {
            if (transaction.odrStatus !== "pending") {
              onTransactionRemoved(transaction.$id);
              subscribedIdsRef.current.delete(transaction.$id);
              setTimeout(() => onRefreshNeeded(), 300);
            } else {
              onTransactionUpdate(transaction);
            }
          } else if (eventType === "delete") {
            onTransactionRemoved(transaction.$id);
            subscribedIdsRef.current.delete(transaction.$id);
            setTimeout(() => onRefreshNeeded(), 300);
          }
        }
      });
    } catch (error) {
      console.error("[Optimized RT] Error processing batched events:", error);
    } finally {
      processingRef.current = false;
    }
  }, [onTransactionUpdate, onTransactionRemoved, onNewTransactionReceived, onRefreshNeeded]);

  // Setup optimized subscription with minimal filters
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
      // Get top 3 transaction IDs for targeted monitoring
      const topIds = topTransactions.slice(0, 3).map(t => t.$id);
      subscribedIdsRef.current = new Set(topIds);

      //console.log(`[Optimized RT] Setting up efficient subscription for ${topIds.length} transactions`);

      // Subscribe with minimal processing - just queue events
      const unsubscribe = client.subscribe(
        `databases.${appwriteConfig.databaseId}.collections.${appwriteConfig.odrtransCollectionId}.documents`,
        (response: RealtimeResponseEvent<Transaction>) => {
          const eventType = response.events[0];
          const document = response.payload;

          // Quick filters to reduce processing overhead
          if (document.odrType !== "withdraw") return;

          // For transassistant users, quick assignment check
          if (userRole === "transassistant") {
            // Note: document.users is a document ID string, not an object
            // We'll let the page component handle the proper assignment check with userDocId
            const isNewPending = eventType.endsWith(".create") && document.odrStatus === "pending";
            const isUpdate = eventType.endsWith(".update");
            
            // Allow new pending orders and updates to assigned orders
            if (!isNewPending && !isUpdate) return;
          }



          // Queue event for batch processing instead of immediate processing
          const eventData = {
            transaction: document,
            eventType: eventType.split('.').pop() || 'unknown',
            timestamp: Date.now()
          };

          eventQueueRef.current.push(eventData);

          // Trigger batch processing (debounced)
          setTimeout(processBatchedEvents, 100);
        }
      );

      unsubscribeRef.current = unsubscribe;

      // Setup periodic batch processing fallback
      const batchInterval = setInterval(() => {
        if (eventQueueRef.current.length > 0) {
          processBatchedEvents();
        }
      }, 1000);

      // Store interval for cleanup
      const originalUnsubscribe = unsubscribe;
      unsubscribeRef.current = () => {
        originalUnsubscribe();
        clearInterval(batchInterval);
      };

      //console.log(`[Optimized RT] Efficient subscription active for ${topIds.length} transactions`);
    } catch (error) {
      console.error("[Optimized RT] Error setting up optimized subscription:", error);
    }
  }, [userRole, userId, topTransactions, processBatchedEvents]);

  const cleanupSubscription = useCallback(() => {
    if (unsubscribeRef.current) {
      //console.log("[Optimized RT] Cleaning up optimized subscription");
      unsubscribeRef.current();
      unsubscribeRef.current = null;
      subscribedIdsRef.current.clear();
      eventQueueRef.current = [];
      processingRef.current = false;
    }
  }, []);

  // Setup subscription with reduced frequency updates
  useEffect(() => {
    const timer = setTimeout(() => {
      setupSubscription();
    }, 2000); // Longer delay to reduce rapid re-subscriptions

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