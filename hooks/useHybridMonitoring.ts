import { useState, useEffect, useCallback, useRef } from 'react';
import { client } from '@/lib/appwrite/appwrite-client';
import { appwriteConfig } from '@/lib/appwrite/appwrite-config';
import { Models } from 'node-appwrite';
import { useSmartPolling } from './useSmartPolling';

interface HybridMonitoringOptions {
  userId: string;
  userRole: string;
  filters: TransactionFilters;
  pagination: { page: number; limit: number };
  enabled: boolean;
  onDataUpdate: (data: TransactionResponse) => void;
  onStatusChange?: (changes: TransactionStatusChange[]) => void;
  criticalStatuses?: string[];
}

interface TransactionFilters {
  status: string;
  type: string;
  orderId: string;
  merchantOrdId: string;
  dateFrom: string | undefined;
  dateTo: string | undefined;
  amount: {
    min: string;
    max: string;
  };
}

interface TransactionResponse {
  documents: Models.Document[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface TransactionStatusChange {
  transactionId: string;
  oldStatus: string;
  newStatus: string;
  timestamp: Date;
}

interface Transaction extends Models.Document {
  $id: string;
  odrId: string;
  odrStatus: string;
  odrType: string;
  users?: { userId: string };
}

export function useHybridMonitoring({
  userId,
  userRole,
  filters,
  pagination,
  enabled,
  onDataUpdate,
  onStatusChange,
  criticalStatuses = ['processing', 'pending']
}: HybridMonitoringOptions) {
  const [realtimeIds, setRealtimeIds] = useState<Set<string>>(new Set());
  const [isRealtimeActive, setIsRealtimeActive] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const realtimeIdsRef = useRef(realtimeIds);
  
  // Keep ref in sync with state
  useEffect(() => {
    realtimeIdsRef.current = realtimeIds;
  }, [realtimeIds]);
  
  // Determine if we should use real-time vs polling
  const shouldUseRealtime = criticalStatuses.includes(filters.status) && pagination.page === 1;
  const maxRealtimeTransactions = 5; // Limit real-time to first 5 critical transactions

  // Enhanced data update handler
  const handleDataUpdate = useCallback((data: TransactionResponse) => {
    // Update real-time monitoring list based on current transactions
    const currentShouldUseRealtime = criticalStatuses.includes(filters.status) && pagination.page === 1;
    if (currentShouldUseRealtime) {
      const criticalTransactionIds = data.documents
        .slice(0, maxRealtimeTransactions) // Only monitor top N transactions
        .filter(doc => {
          const transaction = doc as Transaction;
          return criticalStatuses.includes(transaction.odrStatus);
        })
        .map(doc => doc.$id);

      setRealtimeIds(new Set(criticalTransactionIds));
    }
    onDataUpdate(data);
  }, [criticalStatuses, filters.status, pagination.page, onDataUpdate]);

  // Smart polling for non-critical or pagination > 1
  const {
    pollingState,
    refreshNow: refreshPolling,
  } = useSmartPolling({
    userId,
    userRole,
    filters,
    pagination,
    enabled: enabled && !shouldUseRealtime,
    onDataUpdate: handleDataUpdate,
    onStatusChange,
  });

  // Lightweight real-time subscription for critical transactions only
  const setupRealtimeSubscription = useCallback(() => {
    const currentShouldUseRealtime = criticalStatuses.includes(filters.status) && pagination.page === 1;
    if (!currentShouldUseRealtime || !enabled) return;

    // Clean up existing subscription
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    try {
      console.log('[Hybrid] Setting up lightweight real-time for critical transactions');

      const unsubscribe = client.subscribe(
        `databases.${appwriteConfig.databaseId}.collections.${appwriteConfig.odrtransCollectionId}.documents`,
        (response) => {
          const document = response.payload as Transaction;
          const eventType = response.events[0];

          // Quick filters to minimize processing
          if (!criticalStatuses.includes(document.odrStatus)) return;
          if (document.odrType !== 'withdraw') return;

          // For transassistant users, only monitor assigned transactions
          if (userRole === 'transassistant') {
            const isAssigned = document.users?.userId === userId;
            const isNewPending = eventType.endsWith('.create') && document.odrStatus === 'pending';
            if (!isAssigned && !isNewPending) return;
          }

          // Only process if we're monitoring this transaction OR it's a new critical transaction
          const isMonitored = realtimeIdsRef.current.has(document.$id);
          const isNewCritical = eventType.endsWith('.create') && criticalStatuses.includes(document.odrStatus);

          if (isMonitored || (isNewCritical && realtimeIdsRef.current.size < maxRealtimeTransactions)) {
            // Notify about status change
            if (onStatusChange && eventType.endsWith('.update')) {
              onStatusChange([{
                transactionId: document.$id,
                oldStatus: 'unknown', // We don't track previous state in real-time
                newStatus: document.odrStatus,
                timestamp: new Date(),
              }]);
            }

            // For status changes to non-critical, remove from real-time monitoring
            if (!criticalStatuses.includes(document.odrStatus)) {
              setRealtimeIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(document.$id);
                return newSet;
              });
            }

            // Trigger a lightweight refresh (only fetch first page)
            if (pagination.page === 1) {
              refreshPolling();
            }
          }
        }
      );

      unsubscribeRef.current = unsubscribe;
      setIsRealtimeActive(true);

    } catch (error) {
      console.error('[Hybrid] Error setting up real-time subscription:', error);
      setIsRealtimeActive(false);
    }
  }, [enabled, criticalStatuses, userRole, userId, pagination.page, onStatusChange, refreshPolling, filters.status]);

  // Setup subscription when needed
  useEffect(() => {
    const currentShouldUseRealtime = criticalStatuses.includes(filters.status) && pagination.page === 1;
    
    if (currentShouldUseRealtime) {
      setupRealtimeSubscription();
    } else {
      // Clean up real-time subscription
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      setIsRealtimeActive(false);
      setRealtimeIds(new Set());
    }

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [criticalStatuses, filters.status, pagination.page, setupRealtimeSubscription]);

  // Manual refresh that works for both modes
  const refreshNow = useCallback(async () => {
    // Always use polling refresh since it handles both modes
    refreshPolling();
  }, [refreshPolling]);

  return {
    // Current monitoring state
    isRealtimeActive,
    realtimeTransactionCount: realtimeIds.size,
    pollingState,
    
    // Control functions
    refreshNow,
    
    // Mode information
    currentMode: (criticalStatuses.includes(filters.status) && pagination.page === 1) ? 'realtime' : 'polling',
    efficiency: {
      realtimeConnections: isRealtimeActive ? 1 : 0, // Only 1 connection regardless of transaction count
      pollingInterval: pollingState.lastPollTime ? 'adaptive' : 'inactive',
      costLevel: (criticalStatuses.includes(filters.status) && pagination.page === 1) ? 'medium' : 'low',
    }
  };
} 