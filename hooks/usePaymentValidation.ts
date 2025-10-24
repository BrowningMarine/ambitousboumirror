import { useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { Transaction } from "./useWithdrawals";

export interface PaymentValidationResponse {
  error: number;
  message: string;
  alreadyProcessed?: boolean;
  data?: {
    id: number;
    tid: string;
    description: string;
    amount: number;
    when: string;
    corresponsiveName: string;
    corresponsiveAccount: string;
    corresponsiveBankName: string;
    [key: string]: unknown;
  };
  validation?: {
    extractedOrderId?: string;
    expectedOrderId?: string;
    orderIdMatch?: boolean;
    expectedAmount?: number;
    actualAmount?: number;
    amountMatch?: boolean;
    isDebitTransaction?: boolean;
    isValid?: boolean;
  };
}

interface UsePaymentValidationState {
  paymentIds: Record<string, string>;
  validatingPayment: Set<string>;
  paymentValidationResults: Record<string, PaymentValidationResponse | null>;
  validatedTransactions: Set<string>;
  processingPayments: Set<string>;
  justProcessedTransactions: Set<string>;
  showTransactionActions: Set<string>;
}

interface UsePaymentValidationActions {
  handlePaymentIdChange: (transactionId: string, value: string) => void;
  toggleTransactionActions: (transactionId: string) => void;
  validatePaymentId: (transaction: Transaction, paymentId: string) => Promise<void>;
  processPayment: (transaction: Transaction, paymentId: string) => Promise<void>;
  resetValidationState: (transactionId: string) => void;
}

export function usePaymentValidation(): UsePaymentValidationState & UsePaymentValidationActions {
  const { toast } = useToast();
  
  // State
  const [paymentIds, setPaymentIds] = useState<Record<string, string>>({});
  const [validatingPayment, setValidatingPayment] = useState<Set<string>>(new Set());
  const [paymentValidationResults, setPaymentValidationResults] = useState<
    Record<string, PaymentValidationResponse | null>
  >({});
  const [validatedTransactions, setValidatedTransactions] = useState<Set<string>>(new Set());
  const [processingPayments, setProcessingPayments] = useState<Set<string>>(new Set());
  const [justProcessedTransactions, setJustProcessedTransactions] = useState<Set<string>>(new Set());
  const [showTransactionActions, setShowTransactionActions] = useState<Set<string>>(new Set());

  // Handle payment ID input change
  const handlePaymentIdChange = useCallback((transactionId: string, value: string) => {
    setPaymentIds((prev) => ({
      ...prev,
      [transactionId]: value,
    }));
  }, []);

  // Toggle transaction actions visibility
  const toggleTransactionActions = useCallback((transactionId: string) => {
    setShowTransactionActions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(transactionId)) {
        newSet.delete(transactionId);
        // Clear validation results when hiding
        setPaymentValidationResults((prevResults) => ({
          ...prevResults,
          [transactionId]: null,
        }));
        setPaymentIds((prevIds) => ({
          ...prevIds,
          [transactionId]: "",
        }));
      } else {
        newSet.add(transactionId);
      }
      return newSet;
    });
  }, []);

  // Reset validation state for a transaction
  const resetValidationState = useCallback((transactionId: string) => {
    setPaymentValidationResults((prev) => ({
      ...prev,
      [transactionId]: null,
    }));
    setPaymentIds((prev) => ({
      ...prev,
      [transactionId]: "",
    }));
  }, []);

  // Validate payment ID with API
  const validatePaymentId = useCallback(
    async (transaction: Transaction, paymentId: string) => {
      if (!paymentId.trim()) {
        toast({
          variant: "destructive",
          description: "Please enter a payment ID",
        });
        return;
      }

      // Add transaction to validating set
      setValidatingPayment((prev) => new Set(prev).add(transaction.$id));

      try {
        // Step 1: Only validate the payment (no auto-processing)
        const response = await fetch(
          `/api/validate-payment?paymentId=${encodeURIComponent(
            paymentId
          )}&orderId=${encodeURIComponent(transaction.odrId)}&amount=${
            transaction.unPaidAmount
          }&transactionType=withdraw`,
          {
            method: "GET",
          }
        );

        // Handle non-200 responses
        if (response.status !== 200) {
          let errorMessage = `There is no payment with this payment ID: ${paymentId}`;

          if (response.status === 500) {
            errorMessage = `Server error when checking payment ID. Please try again later or contact support.`;
          } else if (response.status === 401 || response.status === 403) {
            errorMessage = `Authorization error. Please check API key configuration.`;
          }

          toast({
            variant: "destructive",
            description: errorMessage,
          });

          // Store failed validation result
          setPaymentValidationResults((prev) => ({
            ...prev,
            [transaction.$id]: null,
          }));

          return;
        }

        // Parse the validation response
        let validationResult: PaymentValidationResponse & {
          validation?: {
            extractedOrderId?: string;
            expectedOrderId?: string;
            orderIdMatch?: boolean;
            expectedAmount?: number;
            amountMatch?: boolean;
            isValid?: boolean;
          };
        };

        try {
          validationResult = await response.json();
        } catch (parseError) {
          console.error("Error parsing API response:", parseError);
          toast({
            variant: "destructive",
            description: "Error parsing payment validation response",
          });

          // Clear validation result on parse error
          setPaymentValidationResults((prev) => ({
            ...prev,
            [transaction.$id]: null,
          }));

          return;
        }

        // Store validation result
        setPaymentValidationResults((prev) => ({
          ...prev,
          [transaction.$id]: validationResult,
        }));

        // If no payment data found, show error and exit
        if (validationResult.error !== 0 || !validationResult.data) {
          toast({
            variant: "destructive",
            description: `There is no payment with this payment ID: ${paymentId}`,
          });
          return;
        }

        // Show success message for validation
        toast({
          variant: "default",
          description: "Payment validated successfully! Review details and choose action.",
        });
      } catch (error) {
        console.error("Error validating payment:", error);
        toast({
          variant: "destructive",
          description: "Network or server error. Please check your connection and try again.",
        });

        // Clear validation result on error
        setPaymentValidationResults((prev) => ({
          ...prev,
          [transaction.$id]: null,
        }));
      } finally {
        // Remove transaction from validating set
        setValidatingPayment((prev) => {
          const newSet = new Set(prev);
          newSet.delete(transaction.$id);
          return newSet;
        });
      }
    },
    [toast]
  );

  // Process payment after staff confirmation
  const processPayment = useCallback(
    async (transaction: Transaction, paymentId: string) => {
      if (!paymentId.trim()) {
        toast({
          variant: "destructive",
          description: "Please enter a payment ID",
        });
        return;
      }

      // Prevent processing of already processed payments
      if (paymentValidationResults[transaction.$id]?.alreadyProcessed) {
        toast({
          variant: "destructive",
          description: "Cannot process: This payment was already successfully processed.",
        });
        return;
      }

      // Confirmation for Force Process (only Order ID mismatches now)
      const validationResult = paymentValidationResults[transaction.$id];

      if (
        validationResult &&
        !validationResult.validation?.orderIdMatch &&
        !validationResult.alreadyProcessed
      ) {
        const confirmMessage = `⚠️ Force Process Confirmation

        Order ID mismatch detected:
        • Expected Order ID: ${validationResult?.validation?.expectedOrderId}
        • Found in Payment: ${validationResult?.validation?.extractedOrderId || "None"}

        Order ID: ${transaction.odrId}
        Payment ID: ${paymentId}
        Amount: ${transaction.unPaidAmount.toLocaleString()} VND

        Are you certain this payment belongs to this order?

        Click OK to proceed or Cancel to abort.`;

        if (!confirm(confirmMessage)) {
          toast({
            variant: "default",
            description: "Force Process cancelled by user",
          });
          return;
        }
      }

      // Add transaction to processing set
      setProcessingPayments((prev) => new Set(prev).add(transaction.$id));

      try {
        // Call the processing API endpoint
        const processResponse = await fetch("/api/validate-payment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            paymentId,
            orderId: transaction.odrId,
            expectedAmount: transaction.unPaidAmount,
            transactionType: "withdraw",
          }),
        });

        // Parse the processing response
        const processResult = await processResponse.json();

        if (processResponse.ok && processResult.success) {
          // Success - mark as processed and show success message
          toast({
            variant: "default",
            description: `Payment processed successfully! Transaction ID: ${processResult.transactionId}`,
          });

          // Mark this transaction as validated AND just processed
          setValidatedTransactions((prev) => new Set(prev).add(transaction.$id));
          setJustProcessedTransactions((prev) => new Set(prev).add(transaction.$id));

          // Auto-hide transaction actions after successful processing
          setTimeout(() => {
            setShowTransactionActions((prev) => {
              const newSet = new Set(prev);
              newSet.delete(transaction.$id);
              return newSet;
            });
          }, 3000);
        } else {
          // Error processing payment
          let errorMessage = processResult.message || "Failed to process payment";

          if (processResult.status === "duplicated") {
            errorMessage = "This payment has already been processed";
            // Mark as validated for UI purposes
            setValidatedTransactions((prev) => new Set(prev).add(transaction.$id));
          } else {
            // For actual errors, show the error message
            toast({
              variant: "destructive",
              description: errorMessage,
            });
          }
        }
      } catch (processError) {
        console.error("Error processing payment:", processError);
        toast({
          variant: "destructive",
          description: "Server error processing payment. Please try again.",
        });
      } finally {
        // Remove transaction from processing set
        setProcessingPayments((prev) => {
          const newSet = new Set(prev);
          newSet.delete(transaction.$id);
          return newSet;
        });
      }
    },
    [toast, paymentValidationResults]
  );

  return {
    // State
    paymentIds,
    validatingPayment,
    paymentValidationResults,
    validatedTransactions,
    processingPayments,
    justProcessedTransactions,
    showTransactionActions,
    
    // Actions
    handlePaymentIdChange,
    toggleTransactionActions,
    validatePaymentId,
    processPayment,
    resetValidationState,
  };
} 