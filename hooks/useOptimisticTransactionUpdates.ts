import { useCallback, useRef, useState } from "react";
import { updateTransactionStatus } from "@/lib/actions/transaction.actions";
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

interface UseOptimisticUpdatesOptions {
  onTransactionUpdate: (transaction: Transaction | null) => void;
  onSuccessfulUpdate: (transaction: Transaction, newStatus: string) => void;
  onUpdateError: (transaction: Transaction, error: string) => void;
}

interface OptimisticOperation {
  transactionId: string;
  originalStatus: string;
  targetStatus: string;
  timestamp: number;
}

export function useOptimisticTransactionUpdates({
  onTransactionUpdate,
  onSuccessfulUpdate,
  onUpdateError,
}: UseOptimisticUpdatesOptions) {
  const { toast } = useToast();
  const [updatingTransactions, setUpdatingTransactions] = useState<Set<string>>(new Set());
  const pendingOperationsRef = useRef<Map<string, OptimisticOperation>>(new Map());

  // Track optimistic updates to prevent conflicts
  const addOptimisticOperation = useCallback((
    transactionId: string,
    originalStatus: string,
    targetStatus: string
  ) => {
    const operation: OptimisticOperation = {
      transactionId,
      originalStatus,
      targetStatus,
      timestamp: Date.now(),
    };
    
    pendingOperationsRef.current.set(transactionId, operation);
    setUpdatingTransactions(prev => new Set(prev).add(transactionId));
    
    console.log(`[Optimistic] Started operation ${transactionId}: ${originalStatus} → ${targetStatus}`);
  }, []);

  // Remove optimistic operation when completed
  const removeOptimisticOperation = useCallback((transactionId: string) => {
    pendingOperationsRef.current.delete(transactionId);
    setUpdatingTransactions(prev => {
      const newSet = new Set(prev);
      newSet.delete(transactionId);
      return newSet;
    });
    
    console.log(`[Optimistic] Completed operation ${transactionId}`);
  }, []);

  // Check if transaction has pending optimistic update
  const hasPendingUpdate = useCallback((transactionId: string) => {
    return pendingOperationsRef.current.has(transactionId);
  }, []);

  // Get pending operation details
  const getPendingOperation = useCallback((transactionId: string) => {
    return pendingOperationsRef.current.get(transactionId);
  }, []);

  // Optimistic status update with rollback capability
  const updateStatusOptimistically = useCallback(async (
    transaction: Transaction,
    newStatus: "completed" | "failed"
  ): Promise<boolean> => {
    // Prevent multiple concurrent updates on same transaction
    if (hasPendingUpdate(transaction.$id)) {
      console.log(`[Optimistic] Skipping - transaction ${transaction.$id} already has pending update`);
      toast({
        variant: "destructive",
        description: "Please wait for the current update to complete",
      });
      return false;
    }

    // Confirmation dialog
    if (!confirm(
      `Are you sure you want to mark transaction ${transaction.odrId} as ${newStatus}?`
    )) {
      return false;
    }

    const originalStatus = transaction.odrStatus;
    
    // Add to tracking
    addOptimisticOperation(transaction.$id, originalStatus, newStatus);

    // 1. Immediate optimistic update
    const optimisticTransaction: Transaction = {
      ...transaction,
      odrStatus: newStatus,
      isTransitioning: true, // Visual indicator
    };
    
    onTransactionUpdate(optimisticTransaction);
    
    console.log(`[Optimistic] UI updated optimistically: ${transaction.odrId} → ${newStatus}`);

    try {
      // 2. Server update
      const result = await updateTransactionStatus(transaction.$id, newStatus);

      // Validate server response
      if (result && typeof result === "object") {
        if ("success" in result) {
          if (!result.success) {
            throw new Error(result.message || "Failed to update transaction status");
          }
        } else if (!("$id" in result)) {
          throw new Error("Invalid response format");
        }
      } else {
        throw new Error("Invalid response from server");
      }

      // 3. Success - confirm optimistic update
      const confirmedTransaction: Transaction = {
        ...optimisticTransaction,
        isTransitioning: false, // Remove visual indicator
      };
      
      onTransactionUpdate(confirmedTransaction);
      onSuccessfulUpdate(confirmedTransaction, newStatus);
      
      console.log(`[Optimistic] Server confirmed: ${transaction.odrId} → ${newStatus}`);
      
      toast({
        variant: "default",
        description: `Transaction ${transaction.odrId} marked as ${newStatus}`,
      });

      return true;

    } catch (error) {
      console.error(`[Optimistic] Server error for ${transaction.odrId}:`, error);

      // 4. Error - rollback optimistic update
      const rollbackTransaction: Transaction = {
        ...transaction,
        odrStatus: originalStatus,
        isTransitioning: false,
      };
      
      onTransactionUpdate(rollbackTransaction);
      
      const errorMessage = error instanceof Error ? error.message : "Failed to update transaction status";
      onUpdateError(rollbackTransaction, errorMessage);
      
      toast({
        variant: "destructive",
        description: errorMessage,
      });

      console.log(`[Optimistic] Rolled back: ${transaction.odrId} → ${originalStatus}`);
      
      return false;

    } finally {
      // 5. Cleanup tracking
      removeOptimisticOperation(transaction.$id);
    }
  }, [
    hasPendingUpdate,
    addOptimisticOperation,
    removeOptimisticOperation,
    onTransactionUpdate,
    onSuccessfulUpdate,
    onUpdateError,
    toast,
  ]);

  // Batch status update for multiple transactions (future enhancement)
  const updateMultipleStatusOptimistically = useCallback(async (
    transactions: Transaction[],
    newStatus: "completed" | "failed"
  ): Promise<{ successful: Transaction[]; failed: Transaction[] }> => {
    const results = {
      successful: [] as Transaction[],
      failed: [] as Transaction[],
    };

    // Process transactions in parallel with optimistic updates
    const promises = transactions.map(async (transaction) => {
      const success = await updateStatusOptimistically(transaction, newStatus);
      if (success) {
        results.successful.push(transaction);
      } else {
        results.failed.push(transaction);
      }
    });

    await Promise.allSettled(promises);
    
    console.log(`[Optimistic] Batch update completed: ${results.successful.length} successful, ${results.failed.length} failed`);
    
    return results;
  }, [updateStatusOptimistically]);

  // Cleanup stale operations (cleanup after 30 seconds)
  const cleanupStaleOperations = useCallback(() => {
    const now = Date.now();
    const staleThreshold = 30000; // 30 seconds
    
    const staleOperations: string[] = [];
    
    pendingOperationsRef.current.forEach((operation, transactionId) => {
      if (now - operation.timestamp > staleThreshold) {
        staleOperations.push(transactionId);
      }
    });

    staleOperations.forEach(transactionId => {
      console.warn(`[Optimistic] Cleaning up stale operation: ${transactionId}`);
      removeOptimisticOperation(transactionId);
    });

    return staleOperations.length;
  }, [removeOptimisticOperation]);

  return {
    updateStatusOptimistically,
    updateMultipleStatusOptimistically,
    updatingTransactions,
    hasPendingUpdate,
    getPendingOperation,
    cleanupStaleOperations,
    pendingOperationsCount: () => pendingOperationsRef.current.size,
  };
} 