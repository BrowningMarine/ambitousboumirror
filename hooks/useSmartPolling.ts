import { useState, useEffect, useCallback, useRef } from 'react';
import { getTransactionsByUserPaginated } from '@/lib/actions/transaction.actions';
import { Models } from 'node-appwrite';

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

interface Transaction extends Models.Document {
  $id: string;
  odrId: string;
  odrStatus: string;
}

interface SmartPollingOptions {
  userId: string;
  userRole: string;
  filters: TransactionFilters;
  pagination: { page: number; limit: number };
  enabled: boolean;
  onDataUpdate: (data: TransactionResponse) => void;
  onStatusChange?: (changes: TransactionStatusChange[]) => void;
}

interface TransactionStatusChange {
  transactionId: string;
  oldStatus: string;
  newStatus: string;
  timestamp: Date;
}

interface PollingState {
  isPolling: boolean;
  lastPollTime: Date | null;
  errorCount: number;
  backoffDelay: number;
}

export function useSmartPolling({
  userId,
  userRole,
  filters,
  pagination,
  enabled,
  onDataUpdate,
  onStatusChange,
}: SmartPollingOptions) {
  const [pollingState, setPollingState] = useState<PollingState>({
    isPolling: false,
    lastPollTime: null,
    errorCount: 0,
    backoffDelay: 5000, // Start with 5 seconds
  });

  // Store previous transaction states to detect changes
  const previousTransactionsRef = useRef<Map<string, string>>(new Map());
  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isActiveRef = useRef(true);

  // Dynamic polling interval based on context
  const getPollingInterval = useCallback(() => {
    // More frequent polling for critical statuses
    const hasCriticalTransactions = filters.status === 'processing' || filters.status === 'pending';
    
    // Adaptive intervals based on activity level
    if (hasCriticalTransactions) {
      return Math.min(5000 + (pollingState.errorCount * 2000), 30000); // 5-30s
    } else {
      return Math.min(15000 + (pollingState.errorCount * 5000), 120000); // 15-120s
    }
  }, [filters.status, pollingState.errorCount]);

  // Smart polling function that detects changes efficiently
  const performPoll = useCallback(async () => {
    if (!enabled || !isActiveRef.current) return;

    setPollingState(prev => ({ ...prev, isPolling: true }));

    try {
      // Fetch current data
      const response = await getTransactionsByUserPaginated(
        userId,
        userRole,
        pagination.page,
        pagination.limit,
        filters
      );

      if (response?.documents) {
        // Detect status changes
        const statusChanges: TransactionStatusChange[] = [];
        const currentStates = new Map<string, string>();

                          response.documents.forEach((doc) => {
           const transaction = doc as Transaction;
           const transactionId = transaction.$id;
           const currentStatus = transaction.odrStatus;
           const previousStatus = previousTransactionsRef.current.get(transactionId);

          currentStates.set(transactionId, currentStatus);

          // Detect status change
          if (previousStatus && previousStatus !== currentStatus) {
            statusChanges.push({
              transactionId,
              oldStatus: previousStatus,
              newStatus: currentStatus,
              timestamp: new Date(),
            });
          }
        });

        // Update stored states
        previousTransactionsRef.current = currentStates;

        // Notify about changes
        if (statusChanges.length > 0 && onStatusChange) {
          onStatusChange(statusChanges);
        }

        // Update data
        onDataUpdate(response);

        // Reset error count on successful poll
        setPollingState(prev => ({
          ...prev,
          isPolling: false,
          lastPollTime: new Date(),
          errorCount: 0,
          backoffDelay: 5000,
        }));
      }
    } catch (error) {
      console.error('Smart polling error:', error);
      
      setPollingState(prev => ({
        ...prev,
        isPolling: false,
        errorCount: prev.errorCount + 1,
        backoffDelay: Math.min(prev.backoffDelay * 1.5, 60000), // Max 1 minute
      }));
    }
  }, [userId, userRole, pagination, filters, enabled, onDataUpdate, onStatusChange]);

  // Setup polling loop
  const startPolling = useCallback(() => {
    if (!enabled || !isActiveRef.current) return;

    const scheduleNextPoll = () => {
      const interval = getPollingInterval();
      
      pollTimeoutRef.current = setTimeout(async () => {
        await performPoll();
        scheduleNextPoll(); // Schedule next poll after current one completes
      }, interval);
    };

    scheduleNextPoll();
  }, [enabled, getPollingInterval, performPoll]);

  // Stop polling
  const stopPolling = useCallback(() => {
    if (pollTimeoutRef.current) {
      clearTimeout(pollTimeoutRef.current);
      pollTimeoutRef.current = null;
    }
  }, []);

  // Setup polling when dependencies change
  useEffect(() => {
    if (enabled) {
      startPolling();
    } else {
      stopPolling();
    }

    return () => {
      stopPolling();
    };
  }, [enabled, startPolling, stopPolling]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isActiveRef.current = false;
      stopPolling();
    };
  }, [stopPolling]);

  // Manual refresh function
  const refreshNow = useCallback(async () => {
    stopPolling();
    await performPoll();
    startPolling();
  }, [stopPolling, performPoll, startPolling]);

  return {
    pollingState,
    refreshNow,
    startPolling,
    stopPolling,
  };
} 