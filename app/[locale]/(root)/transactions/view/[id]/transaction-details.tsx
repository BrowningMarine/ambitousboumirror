"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useTranslations } from "next-intl";
import {
  formatAmount,
  formatDate,
  calculatePaymentTimeRemaining,
  formatDateTime,
} from "@/lib/utils";
import {
  Check,
  X,
  ArrowLeft,
  Clock,
  AlertTriangle,
  DownloadCloud,
  RefreshCw,
  Search,
} from "lucide-react";
import QRCodeDisplay from "@/components/QRCodeCard";
import BankTransactionsList from "@/components/BankTransactionsList";
import {
  getTransactionById,
  updateTransactionStatus,
} from "@/lib/actions/transaction.actions";
import { subscribeToCollectionDocuments } from "@/lib/client/appwriteSubcriptions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import type { BankTransactionDocument } from "@/lib/actions/bankTransacionEntry.action";
import { appConfig } from "@/lib/appconfig";

interface Transaction {
  $id: string;
  odrId: string;
  merchantOrdId?: string;
  odrType: "deposit" | "withdraw";
  odrStatus: "processing" | "pending" | "completed" | "canceled" | "failed";
  bankId: string;
  amount: number;
  paidAmount: number;
  unPaidAmount: number;
  positiveAccount: string;
  negativeAccount: string;
  qrCode?: string | null;
  $createdAt: string;
  $updatedAt: string;
  urlSuccess?: string;
  urlFailed?: string;
  urlCanceled?: string;
  urlCallBack?: string;
  // Additional fields that may be available from a detailed fetch
  bankName?: string;
  accountName?: string;
  accountNumber?: string;
  createdIp?: string;
  isSuspicious?: boolean;

  formattedCreatedAt?: {
    dateTime: string;
    dateDay: string;
    date: string;
    time: string;
  };
  formattedUpdatedAt?: {
    dateTime: string;
    dateDay: string;
    date: string;
    time: string;
  };
}

interface TransactionDetailsProps {
  transaction: Transaction;
  userRole: string;
  initialBankTransactions: BankTransactionDocument[];
  showAllTransactions: boolean;
}

// Add interface for payment validation response
interface PaymentValidationResponse {
  error: number;
  message: string;
  alreadyProcessed?: boolean;
  isAvailableRedemption?: boolean;
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
    secretAgentDetails?: {
      usedTransactionIds: number[];
      isExactMatch: boolean;
      isSumMatch: boolean;
      totalTransactions: number;
    };
  };
  secretAgentValidation?: {
    success: boolean;
    message: string;
    transactions: Array<{
      id: number; // SecretAgent uses this field for transaction ID
      id_bank?: string;
      created_at: string;
      amount: number;
      transactiondate: string;
      content: string;
      odrId: string;
      accountNumber: string | null;
      balance: number | null;
      trans_date?: string; // Additional SecretAgent field
      acc_num?: string; // Additional SecretAgent field
      bank_name?: string; // Additional SecretAgent field
      ref_acc_num?: string; // Additional SecretAgent field
      ref_acc_name?: string; // Additional SecretAgent field
    }>;
    validatedAmount: number;
    isExactMatch: boolean;
    isSumMatch: boolean;
    usedTransactionIds: (number | null)[];
  };
}

// Helper function to format transaction for display
const formatTransactionData = (
  transaction: Transaction | null
): Transaction | null => {
  if (!transaction) return null;

  const formattedTransaction = { ...transaction };
  if (
    !formattedTransaction.formattedCreatedAt &&
    formattedTransaction.$createdAt
  ) {
    formattedTransaction.formattedCreatedAt = formatDateTime(
      formattedTransaction.$createdAt
    );
  }
  if (
    !formattedTransaction.formattedUpdatedAt &&
    formattedTransaction.$updatedAt
  ) {
    formattedTransaction.formattedUpdatedAt = formatDateTime(
      formattedTransaction.$updatedAt
    );
  }
  return formattedTransaction;
};

export default function TransactionDetails({
  transaction: initialTransaction,
  userRole,
  initialBankTransactions,
  showAllTransactions,
}: TransactionDetailsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations("transactions");
  const [isUpdating, setIsUpdating] = useState(false);

  // Store transaction data in state with formatted dates
  const [transaction, setTransaction] = useState<Transaction>(
    formatTransactionData(initialTransaction) as Transaction
  );

  // Store transaction expiration status
  const [isExpired, setIsExpired] = useState<boolean>(false);
  const [timeRemaining, setTimeRemaining] = useState<string>("");
  // Track if component is mounted to avoid state updates after unmounting
  const isMounted = useRef(true);

  // Payment validation states
  const [paymentId, setPaymentId] = useState<string>("");
  const [validatingPayment, setValidatingPayment] = useState<boolean>(false);
  const [paymentValidationResult, setPaymentValidationResult] =
    useState<PaymentValidationResponse | null>(null);
  const [showPaymentValidation, setShowPaymentValidation] =
    useState<boolean>(false);
  const [processingPayment, setProcessingPayment] = useState<boolean>(false);
  const [refreshingTransaction, setRefreshingTransaction] =
    useState<boolean>(false);
  const [selectedPortal, setSelectedPortal] = useState<string>("cassoflow");
  // Get environment variables
  const DATABASE_ID = appwriteConfig.databaseId || "";
  const ODRTRANS_COLLECTION_ID = appwriteConfig.odrtransCollectionId || "";

  // Subscribe to real-time updates using the existing function
  useEffect(() => {
    // Use the existing subscribeToCollectionDocuments function for efficient subscription
    const unsubscribe = subscribeToCollectionDocuments<Transaction>(
      DATABASE_ID,
      ODRTRANS_COLLECTION_ID,
      [transaction.$id], // Subscribe to this single document
      (updatedDoc) => {
        if (isMounted.current) {
          setTransaction(formatTransactionData(updatedDoc) as Transaction);
        }
      }
    );

    // Cleanup subscription and set isMounted to false on unmount
    return () => {
      isMounted.current = false;
      unsubscribe();
    };
  }, [transaction.$id, DATABASE_ID, ODRTRANS_COLLECTION_ID]);

  // Calculate and update time remaining
  useEffect(() => {
    // Only run the timer for processing transactions
    if (transaction.odrStatus !== "processing") {
      setIsExpired(true);
      setTimeRemaining("");
      return () => {}; // No cleanup needed
    }

    // Initial calculation
    const calculateTime = () => {
      if (!transaction.$createdAt) return;

      const { formattedTime, isExpired: expired } =
        calculatePaymentTimeRemaining(transaction.$createdAt);

      if (isMounted.current) {
        setTimeRemaining(formattedTime);
        setIsExpired(expired);
      }
    };

    // Calculate initially
    calculateTime();

    // Set up interval only if not expired
    const timeCheckInterval = setInterval(() => {
      if (!transaction.$createdAt) return;

      const { isExpired: nowExpired } = calculatePaymentTimeRemaining(
        transaction.$createdAt
      );

      if (nowExpired) {
        // If just expired, update the UI
        if (!isExpired && isMounted.current) {
          setIsExpired(true);
          setTimeRemaining("Expired");
          // We don't need to refresh here as the subscription will update if status changes
        }
        clearInterval(timeCheckInterval);
      } else {
        calculateTime();
      }
    }, 1000);

    return () => clearInterval(timeCheckInterval);
  }, [transaction.$createdAt, transaction.odrStatus, isExpired]);

  // Clear validation results when portal changes
  useEffect(() => {
    setPaymentValidationResult(null);
    setPaymentId("");
  }, [selectedPortal]);

  // Handle status update
  const handleStatusUpdate = useCallback(
    async (newStatus: "completed" | "failed" | "canceled") => {
      if (!confirm(t("confirmStatusUpdate", { status: newStatus }))) {
        return;
      }

      setIsUpdating(true);
      try {
        const result = await updateTransactionStatus(
          transaction.$id,
          newStatus
        );

        // Handle the server response
        if (result && typeof result === "object") {
          if ("success" in result) {
            if (result.success) {
              // If we have data, update the transaction
              if (result.data) {
                // Explicitly cast to Transaction type to satisfy TypeScript
                const transactionData = result.data as unknown as Transaction;
                setTransaction(
                  formatTransactionData(transactionData) as Transaction
                );
              } else {
                // If no data but success is true, refresh the transaction
                const refreshedData = await getTransactionById(transaction.$id);
                if (refreshedData) {
                  const typedTransaction = refreshedData as Transaction;
                  setTransaction(
                    formatTransactionData(typedTransaction) as Transaction
                  );
                }
              }

              toast({
                description:
                  result.message ||
                  t("transactionStatusUpdated", { status: newStatus }),
              });
            } else {
              throw new Error(result.message || t("failedToUpdateStatus"));
            }
          } else if ("$id" in result) {
            // Direct transaction object
            setTransaction(
              formatTransactionData(result as Transaction) as Transaction
            );

            toast({
              description: t("transactionStatusUpdated", { status: newStatus }),
            });
          } else {
            throw new Error("Invalid response format");
          }
        } else {
          throw new Error("Invalid response from server");
        }
      } catch (error) {
        console.error("Error updating transaction status:", error);
        toast({
          variant: "destructive",
          description:
            error instanceof Error ? error.message : t("failedToUpdateStatus"),
        });
      } finally {
        setIsUpdating(false);
      }
    },
    [toast, transaction.$id, t]
  );

  // Check if the current user can update status
  const canUpdateStatus = useCallback(() => {
    if (userRole === "admin") return true;

    if (userRole !== "transactor") return false;

    if (
      transaction.odrStatus === "completed" ||
      transaction.odrStatus === "failed" ||
      transaction.odrStatus === "canceled"
    )
      return false;

    // Only processing transactions can be updated
    if (transaction.odrType === "withdraw") {
      if (transaction.odrStatus !== "pending") return false;
    } else {
      return true;
    }

    // Transactor can only update if transaction is expired
    if (userRole === "transactor") {
      return isExpired;
    }

    return false;
  }, [transaction.odrStatus, userRole, isExpired, transaction.odrType]);

  // Refresh transaction data manually
  const refreshTransaction = useCallback(async () => {
    setRefreshingTransaction(true);
    try {
      const refreshedData = await getTransactionById(transaction.$id);
      if (refreshedData) {
        // Explicitly cast to Transaction type to satisfy TypeScript
        const typedTransaction = refreshedData as unknown as Transaction;
        setTransaction(formatTransactionData(typedTransaction) as Transaction);
        toast({ description: t("transactionDataRefreshed") });
      }
    } catch (error) {
      console.error("Error refreshing transaction:", error);
      toast({
        variant: "destructive",
        description: t("failedToRefreshData"),
      });
    } finally {
      setRefreshingTransaction(false);
    }
  }, [transaction.$id, toast, t]);

  // Handler for receipt download
  const downloadReceipt = useCallback(() => {
    toast({
      description: t("downloadingReceipt"),
    });
    // Implement receipt download logic here
  }, [toast, t]);

  // Auto-validate using order ID (for SecretAgent)
  const autoValidatePayment = useCallback(async () => {
    setValidatingPayment(true);

    try {
      // For SecretAgent, we can auto-validate using just the order ID
      const expectedAmount =
        transaction.odrType === "withdraw"
          ? transaction.unPaidAmount
          : transaction.unPaidAmount;

      // Auto-validation without payment ID
      const response = await fetch(
        `/api/validate-payment?orderId=${encodeURIComponent(
          transaction.odrId
        )}&amount=${expectedAmount}&transactionType=${
          transaction.odrType
        }&portal=${selectedPortal}`,
        {
          method: "GET",
        }
      );

      // Handle non-200 responses
      if (response.status !== 200) {
        let errorMessage = t("noTransactionsFoundForOrder", {
          orderId: transaction.odrId,
        });

        if (response.status === 500) {
          errorMessage = t("serverErrorPaymentId");
        } else if (response.status === 401 || response.status === 403) {
          errorMessage = t("authorizationError");
        }

        toast({
          variant: "destructive",
          description: errorMessage,
        });

        setPaymentValidationResult(null);
        return;
      }

      // Parse the validation response
      let validationResult: PaymentValidationResponse;

      try {
        validationResult = await response.json();
      } catch (parseError) {
        console.error("Error parsing API response:", parseError);
        toast({
          variant: "destructive",
          description: t("errorParsingPaymentValidation"),
        });

        setPaymentValidationResult(null);
        return;
      }

      // Store validation result
      setPaymentValidationResult(validationResult);

      // If no payment data found, show error and exit
      if (validationResult.error !== 0 || !validationResult.data) {
        toast({
          variant: "destructive",
          description: t("noTransactionsFoundForOrder", {
            orderId: transaction.odrId,
          }),
        });
        return;
      }

      // Show success message for validation
      toast({
        variant: "default",
        description: validationResult.validation?.secretAgentDetails
          ?.isExactMatch
          ? t("exactTransactionFound")
          : validationResult.validation?.secretAgentDetails?.isSumMatch
          ? t("multipleTransactionsSum", {
              count:
                validationResult.validation.secretAgentDetails
                  .totalTransactions || 1,
            })
          : t("paymentValidatedSuccessfully"),
      });
    } catch (error) {
      console.error("Error auto-validating payment:", error);
      toast({
        variant: "destructive",
        description: t("networkError"),
      });

      setPaymentValidationResult(null);
    } finally {
      setValidatingPayment(false);
    }
  }, [
    toast,
    transaction.odrId,
    transaction.unPaidAmount,
    transaction.odrType,
    selectedPortal,
    t,
  ]);

  // Validate payment ID with API
  const validatePaymentId = useCallback(
    async (paymentIdToValidate: string) => {
      if (!paymentIdToValidate.trim() && selectedPortal !== "secretagent") {
        toast({
          variant: "destructive",
          description: t("pleaseEnterPaymentId"),
        });
        return;
      }

      // For SecretAgent, allow auto-validation if no payment ID provided
      if (!paymentIdToValidate.trim() && selectedPortal === "secretagent") {
        return autoValidatePayment();
      }

      setValidatingPayment(true);

      try {
        //console.log('Attempting to validate payment ID:', paymentIdToValidate);

        // Determine expected amount based on transaction type
        // For withdraws: expect negative amount, for deposits: expect positive amount
        const expectedAmount =
          transaction.odrType === "withdraw"
            ? transaction.unPaidAmount // This should be positive, API will make it negative
            : transaction.unPaidAmount; // This should be positive for deposits

        // Step 1: Only validate the payment (no auto-processing)
        const response = await fetch(
          `/api/validate-payment?paymentId=${encodeURIComponent(
            paymentIdToValidate
          )}&orderId=${encodeURIComponent(
            transaction.odrId
          )}&amount=${expectedAmount}&transactionType=${
            transaction.odrType
          }&portal=${selectedPortal}`,
          {
            method: "GET",
          }
        );

        // Handle non-200 responses
        if (response.status !== 200) {
          let errorMessage = t("noPaymentWithId", {
            paymentId: paymentIdToValidate,
          });

          if (response.status === 500) {
            errorMessage = t("serverErrorPaymentId");
          } else if (response.status === 401 || response.status === 403) {
            errorMessage = t("authorizationError");
          }

          toast({
            variant: "destructive",
            description: errorMessage,
          });

          setPaymentValidationResult(null);
          return;
        }

        // Parse the validation response
        let validationResult: PaymentValidationResponse;

        try {
          validationResult = await response.json();
          //console.log('validationResult', validationResult);
        } catch (parseError) {
          console.error("Error parsing API response:", parseError);
          toast({
            variant: "destructive",
            description: t("errorParsingResponse"),
          });

          setPaymentValidationResult(null);
          return;
        }

        // Store validation result
        setPaymentValidationResult(validationResult);

        // If no payment data found, show error and exit
        if (validationResult.error !== 0 || !validationResult.data) {
          toast({
            variant: "destructive",
            description: t("noPaymentWithId", {
              paymentId: paymentIdToValidate,
            }),
          });
          return;
        }

        // Show success message for validation
        const isRedemption =
          validationResult.isAvailableRedemption &&
          transaction.odrType === "deposit";
        toast({
          variant: "default",
          description: isRedemption
            ? t("availableBalanceFound")
            : t("paymentValidatedSuccessfully"),
        });
      } catch (error) {
        console.error("Error validating payment:", error);
        toast({
          variant: "destructive",
          description: t("networkError"),
        });

        setPaymentValidationResult(null);
      } finally {
        setValidatingPayment(false);
      }
    },
    [
      toast,
      transaction.odrId,
      transaction.unPaidAmount,
      transaction.odrType,
      selectedPortal,
      autoValidatePayment,
      t,
    ]
  );

  // Process payment after staff confirmation
  const processPayment = useCallback(
    async (paymentIdToProcess: string) => {
      // For SecretAgent auto-validation, extract payment ID from validation result
      let effectivePaymentId = paymentIdToProcess.trim();

      // If no manual payment ID provided, try to extract from validation result
      if (!effectivePaymentId && paymentValidationResult) {
        // Try multiple sources for transaction ID based on portal
        if (selectedPortal === "secretagent") {
          // SecretAgent specific extraction - check id first (SecretAgent uses this field)
          if (
            paymentValidationResult.secretAgentValidation?.transactions?.[0]?.id
          ) {
            effectivePaymentId =
              paymentValidationResult.secretAgentValidation.transactions[0].id.toString();
          } else if (
            paymentValidationResult.data?.id &&
            paymentValidationResult.data.id !== 0
          ) {
            effectivePaymentId = paymentValidationResult.data.id.toString();
          } else if (
            paymentValidationResult.secretAgentValidation?.transactions?.[0]?.id
          ) {
            effectivePaymentId =
              paymentValidationResult.secretAgentValidation.transactions[0].id.toString();
          } else if (
            paymentValidationResult.validation?.secretAgentDetails
              ?.usedTransactionIds?.[0]
          ) {
            effectivePaymentId =
              paymentValidationResult.validation.secretAgentDetails.usedTransactionIds[0].toString();
          }
        } else {
          // For other portals (Cassoflow, Sepay), use the main data ID
          if (paymentValidationResult.data?.id) {
            effectivePaymentId = paymentValidationResult.data.id.toString();
          } else if (paymentValidationResult.data?.tid) {
            effectivePaymentId = paymentValidationResult.data.tid.toString();
          }
        }
      }

      if (!effectivePaymentId) {
        const errorMessage =
          selectedPortal === "secretagent"
            ? "Please enter a payment ID or use auto-validation first"
            : t("pleaseEnterPaymentId");

        toast({
          variant: "destructive",
          description: errorMessage,
        });
        return;
      }

      // Prevent processing of already processed payments
      if (paymentValidationResult?.alreadyProcessed) {
        toast({
          variant: "destructive",
          description: t("cannotProcessAlreadyProcessed"),
        });
        return;
      }

      // Confirmation for Force Process (only Order ID mismatches now, since amount and debit type must be exact)
      if (
        paymentValidationResult &&
        !paymentValidationResult.validation?.orderIdMatch &&
        !paymentValidationResult.alreadyProcessed
      ) {
        const confirmMessage = t("forceProcessConfirmation", {
          expectedOrderId:
            paymentValidationResult?.validation?.expectedOrderId || t("none"),
          extractedOrderId:
            paymentValidationResult?.validation?.extractedOrderId || t("none"),
          orderId: transaction.odrId,
          paymentId: effectivePaymentId,
          amount: transaction.unPaidAmount.toLocaleString(),
        });

        if (!confirm(confirmMessage)) {
          toast({
            variant: "default",
            description: t("forceProcessCancelled"),
          });
          return;
        }
      }

      setProcessingPayment(true);

      try {
        // Determine expected amount based on transaction type
        // For withdraws: expect negative amount, for deposits: expect positive amount
        const expectedAmount =
          transaction.odrType === "withdraw"
            ? transaction.unPaidAmount // This should be positive, API will make it negative
            : transaction.unPaidAmount; // This should be positive for deposits

        // Call the processing API endpoint
        const requestBody = {
          paymentId: effectivePaymentId,
          orderId: transaction.odrId,
          expectedAmount: expectedAmount,
          transactionType: transaction.odrType,
          portal: selectedPortal,
        };

        const processResponse = await fetch("/api/validate-payment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        // Parse the processing response
        const processResult = await processResponse.json();

        if (processResponse.ok && processResult.success) {
          // Success - show success message
          const isRedemption =
            processResult.isAvailableRedemption &&
            transaction.odrType === "deposit";
          toast({
            variant: "default",
            description: isRedemption
              ? t("availableBalanceRedeemed", {
                  transactionId: processResult.transactionId,
                })
              : t("paymentProcessedSuccessfully", {
                  transactionId: processResult.transactionId,
                }),
          });

          // Hide payment validation section after successful processing
          setTimeout(() => {
            setShowPaymentValidation(false);
            setPaymentValidationResult(null);
            setPaymentId("");
          }, 3000);
        } else {
          // Error processing payment
          let errorMessage =
            processResult.message || "Failed to process payment";

          if (processResult.status === "duplicated") {
            errorMessage = t("paymentAlreadyProcessed");
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
          description: t("serverErrorProcessingPayment"),
        });
      } finally {
        setProcessingPayment(false);
      }
    },
    [
      toast,
      transaction.odrId,
      transaction.unPaidAmount,
      transaction.odrType,
      paymentValidationResult,
      selectedPortal,
      t,
    ]
  );

  // Check if payment validation should be available
  const canValidatePayment = useCallback(() => {
    // Only allow for pending or processing transactions
    if (
      transaction.odrStatus !== "pending" &&
      transaction.odrStatus !== "processing"
    ) {
      return false;
    }

    // Only allow for admin, transactor, or transassistant roles
    if (
      userRole !== "admin" &&
      userRole !== "transactor" &&
      userRole !== "transassistant"
    ) {
      return false;
    }

    return true;
  }, [transaction.odrStatus, userRole]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Back button */}
      <div className="col-span-full mb-2">
        <Button
          variant="ghost"
          onClick={() => router.back()}
          className="flex items-center text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("backToTransactions")}
        </Button>
      </div>

      {/* Transaction Status Card */}
      <div className="bg-white rounded-lg border shadow-sm md:col-span-3">
        <div className="p-6 flex flex-col md:flex-row justify-between items-start md:items-center border-b">
          <div>
            <h2 className="text-xl font-bold mb-1">{t("transactionStatus")}</h2>
            <p className="text-gray-500">
              {t("lastUpdated")}:{" "}
              {transaction.formattedUpdatedAt
                ? transaction.formattedUpdatedAt.dateTime
                : formatDate(transaction.$updatedAt)}
            </p>
          </div>
          <div className="mt-4 md:mt-0 flex flex-col md:flex-row md:items-center gap-2">
            {/* Status Badge */}
            <Badge
              variant={
                transaction.odrStatus === "completed"
                  ? "success"
                  : transaction.odrStatus === "processing"
                  ? "warning"
                  : transaction.odrStatus === "failed"
                  ? "danger"
                  : "info"
              }
              className="capitalize text-base py-1 px-3 flex items-center"
            >
              {transaction.odrStatus === "completed" && (
                <Check className="mr-1 h-4 w-4" />
              )}
              {transaction.odrStatus === "processing" && (
                <Clock className="mr-1 h-4 w-4" />
              )}
              {transaction.odrStatus === "failed" && (
                <AlertTriangle className="mr-1 h-4 w-4" />
              )}
              {transaction.odrStatus === "canceled" && (
                <X className="mr-1 h-4 w-4" />
              )}
              {t(transaction.odrStatus)}
            </Badge>

            {/* Display expired badge if needed */}
            {isExpired && transaction.odrStatus === "processing" && (
              <Badge variant="danger" className="flex items-center text-base">
                <AlertTriangle className="mr-1 h-4 w-4" />
                {t("expired")}
              </Badge>
            )}

            {/* Refresh button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={refreshTransaction}
              className="p-1 h-8 w-8"
              title={t("refresh")}
              disabled={refreshingTransaction}
            >
              <RefreshCw
                className={`h-4 w-4 ${
                  refreshingTransaction ? "animate-spin" : ""
                }`}
              />
              <span className="sr-only">{t("refresh")}</span>
            </Button>
          </div>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <div>
            <p className="text-sm text-gray-500 mb-1">{t("orderId")}</p>
            <p className="font-medium">{transaction.odrId}</p>
          </div>

          {transaction.merchantOrdId && (
            <div>
              <p className="text-sm text-gray-500 mb-1">
                {t("merchantOrderID")}
              </p>
              <p className="font-medium">{transaction.merchantOrdId}</p>
            </div>
          )}

          <div>
            <p className="text-sm text-gray-500 mb-1">{t("transactionType")}</p>
            <Badge
              variant={transaction.odrType === "deposit" ? "default" : "info"}
              className="capitalize"
            >
              {t(transaction.odrType)}
            </Badge>
          </div>

          <div>
            <p className="text-sm text-gray-500 mb-1">{t("totalAmount")}</p>
            <p className="text-lg font-bold">
              {formatAmount(transaction.amount)}
            </p>
          </div>

          <div>
            <p className="text-sm text-gray-500 mb-1">{t("paidAmount")}</p>
            <p className="font-medium text-green-600">
              {formatAmount(transaction.paidAmount)}
            </p>
          </div>

          <div>
            <p className="text-sm text-gray-500 mb-1">{t("unpaidAmount")}</p>
            <p className="font-medium text-red-600">
              {formatAmount(transaction.unPaidAmount)}
            </p>
          </div>

          <div>
            <p className="text-sm text-gray-500 mb-1">{t("createdAt")}</p>
            <p className="font-medium">
              {transaction.formattedCreatedAt
                ? transaction.formattedCreatedAt.dateTime
                : formatDate(transaction.$createdAt)}
            </p>
          </div>

          {/* Display IP Address information if available */}
          {transaction.createdIp && (
            <div>
              <p className="text-sm text-gray-500 mb-1">{t("createdIp")}</p>
              <div className="flex items-center">
                <p
                  className={`font-medium ${
                    transaction.isSuspicious ? "text-red-600" : ""
                  }`}
                >
                  {transaction.createdIp}
                </p>
                {transaction.isSuspicious && (
                  <Badge variant="danger" className="ml-2 text-xs">
                    {t("suspicious")}
                  </Badge>
                )}
              </div>
            </div>
          )}

          {/* Show payment time remaining for processing orders that haven't expired */}
          {transaction.odrStatus === "processing" && !isExpired && (
            <div>
              <p className="text-sm text-gray-500 mb-1">
                {t("paymentTimeRemaining")}
              </p>
              <p className="font-medium">{timeRemaining}</p>
            </div>
          )}

          {/* Show expired notice for processing orders that have expired */}
          {transaction.odrStatus === "processing" && isExpired && (
            <div>
              <p className="text-sm text-gray-500 mb-1">{t("paymentStatus")}</p>
              <p className="font-medium text-red-600">
                {t("paymentWindowExpired")}
              </p>
            </div>
          )}

          {/* Display payment window information */}
          {transaction.odrStatus === "processing" && (
            <div>
              <p className="text-sm text-gray-500 mb-1">{t("paymentWindow")}</p>
              <p className="font-medium">
                {Math.floor(appConfig.paymentWindowSeconds / 60)} {t("minutes")}
              </p>
            </div>
          )}

          {/* Webhook URLs */}
          {transaction.urlCallBack && (
            <div className="md:col-span-2 lg:col-span-4">
              <p className="text-sm text-gray-500 mb-1">{t("callbackUrl")}</p>
              <p className="text-sm text-blue-600 break-all font-mono">
                {transaction.urlCallBack}
              </p>
            </div>
          )}

          {transaction.urlSuccess && (
            <div className="md:col-span-2 lg:col-span-4">
              <p className="text-sm text-gray-500 mb-1">{t("successUrl")}</p>
              <p className="text-sm text-blue-600 break-all font-mono">
                {transaction.urlSuccess}
              </p>
            </div>
          )}

          {transaction.urlFailed && (
            <div className="md:col-span-2 lg:col-span-4">
              <p className="text-sm text-gray-500 mb-1">{t("failedUrl")}</p>
              <p className="text-sm text-blue-600 break-all font-mono">
                {transaction.urlFailed}
              </p>
            </div>
          )}

          {transaction.urlCanceled && (
            <div className="md:col-span-2 lg:col-span-4">
              <p className="text-sm text-gray-500 mb-1">{t("canceledUrl")}</p>
              <p className="text-sm text-blue-600 break-all font-mono">
                {transaction.urlCanceled}
              </p>
            </div>
          )}
        </div>

        {/* Transaction Management Section - Only shown to admins/transactors when appropriate */}
        {canUpdateStatus() && (
          <div className="border-t bg-gradient-to-r from-slate-50 to-gray-50">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-1">
                    {t("transactionManagement")}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {t("processPaymentOrUpdateStatus")}
                  </p>
                </div>
                {isUpdating && (
                  <div className="flex items-center text-blue-600">
                    <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                    <span className="text-sm font-medium">
                      {t("updateting")}
                    </span>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Payment Validation Card */}
                {canValidatePayment() && (
                  <div className="lg:col-span-2 bg-white rounded-lg border border-gray-200 shadow-sm">
                    <div className="p-4 border-b border-gray-100">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center">
                          <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center mr-3">
                            <Check className="h-4 w-4 text-blue-600" />
                          </div>
                          <div>
                            <h4 className="font-medium text-gray-900">
                              {t("paymentValidation")}
                            </h4>
                            <p className="text-xs text-gray-500">
                              {t("validateAndProcessPayment")}
                            </p>
                          </div>
                        </div>
                        {showPaymentValidation && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowPaymentValidation(false);
                              setPaymentValidationResult(null);
                              setPaymentId("");
                            }}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>

                    <div className="p-4">
                      {!showPaymentValidation ? (
                        <Button
                          onClick={() => setShowPaymentValidation(true)}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                          disabled={isUpdating}
                        >
                          <AlertTriangle className="mr-2 h-4 w-4" />
                          {t("startPaymentValidation")}
                        </Button>
                      ) : (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <div className="space-y-3">
                              <div className="flex gap-2">
                                <Select
                                  value={selectedPortal}
                                  onValueChange={setSelectedPortal}
                                  disabled={
                                    validatingPayment ||
                                    processingPayment ||
                                    isUpdating
                                  }
                                >
                                  <SelectTrigger className="w-40">
                                    <SelectValue placeholder="Portal" />
                                  </SelectTrigger>
                                  <SelectContent className="bg-white">
                                    <SelectItem value="cassoflow">
                                      Cassoflow
                                    </SelectItem>
                                    <SelectItem value="sepay">Sepay</SelectItem>
                                    <SelectItem value="secretagent">
                                      SecretAgent
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                                <Input
                                  type="text"
                                  placeholder={
                                    selectedPortal === "secretagent"
                                      ? t("enterPaymentIdOptional")
                                      : t("enterPaymentId")
                                  }
                                  value={paymentId}
                                  onChange={(e) => setPaymentId(e.target.value)}
                                  className="flex-1"
                                  disabled={
                                    validatingPayment ||
                                    processingPayment ||
                                    isUpdating
                                  }
                                />
                                <Button
                                  onClick={() => validatePaymentId(paymentId)}
                                  variant="outline"
                                  disabled={
                                    validatingPayment ||
                                    processingPayment ||
                                    isUpdating ||
                                    (selectedPortal !== "secretagent" &&
                                      !paymentId.trim())
                                  }
                                >
                                  {validatingPayment ? (
                                    <RefreshCw className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Check className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>

                              {/* SecretAgent Auto-Validate Option */}
                              {selectedPortal === "secretagent" && (
                                <div className="flex gap-2">
                                  <Button
                                    onClick={autoValidatePayment}
                                    variant="default"
                                    className="flex-1 bg-blue-600 hover:bg-blue-700"
                                    disabled={
                                      validatingPayment ||
                                      processingPayment ||
                                      isUpdating
                                    }
                                  >
                                    {validatingPayment ? (
                                      <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                                    ) : (
                                      <Search className="h-4 w-4 mr-2" />
                                    )}
                                    {t("autoValidateUsingOrderId")}
                                  </Button>
                                </div>
                              )}
                            </div>
                            <div className="text-xs text-gray-500">
                              {selectedPortal === "cassoflow"
                                ? "Using Cassoflow API to validate payment"
                                : selectedPortal === "sepay"
                                ? "Using Sepay API to validate payment"
                                : "Using SecretAgent API to validate payment"}
                            </div>
                          </div>

                          {/* Payment validation results */}
                          {paymentValidationResult &&
                            paymentValidationResult.error === 0 &&
                            paymentValidationResult.data && (
                              <div className="space-y-3">
                                <div className="bg-gray-50 rounded-lg p-3">
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className="font-semibold text-gray-900">
                                        {paymentValidationResult.data.amount?.toLocaleString()}{" "}
                                        VND
                                      </div>
                                      <div className="text-sm text-gray-600">
                                        {paymentValidationResult.isAvailableRedemption &&
                                        transaction.odrType === "deposit" ? (
                                          <span className="text-purple-600 font-medium">
                                            {t("availableBalanceRedemption")}
                                          </span>
                                        ) : (
                                          paymentValidationResult.data
                                            .corresponsiveName && (
                                            <>
                                              {t("fromSender", {
                                                sender:
                                                  paymentValidationResult.data
                                                    .corresponsiveName,
                                              })}
                                            </>
                                          )
                                        )}
                                      </div>
                                    </div>
                                    <div
                                      className={`px-2 py-1 rounded-full text-xs font-medium ${
                                        paymentValidationResult.alreadyProcessed
                                          ? "bg-red-100 text-red-700"
                                          : paymentValidationResult.isAvailableRedemption &&
                                            transaction.odrType === "deposit"
                                          ? "bg-purple-100 text-purple-700"
                                          : paymentValidationResult.validation
                                              ?.isValid
                                          ? "bg-green-100 text-green-700"
                                          : "bg-yellow-100 text-yellow-700"
                                      }`}
                                    >
                                      {paymentValidationResult.alreadyProcessed
                                        ? t("processed")
                                        : paymentValidationResult.isAvailableRedemption &&
                                          transaction.odrType === "deposit"
                                        ? t("available")
                                        : paymentValidationResult.validation
                                            ?.isValid
                                        ? t("valid")
                                        : t("review")}
                                    </div>
                                  </div>
                                </div>

                                {/* Action buttons */}
                                {!paymentValidationResult.alreadyProcessed && (
                                  <div className="space-y-3">
                                    {/* Status explanation */}
                                    <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded">
                                      {paymentValidationResult.validation
                                        ?.isValid ? (
                                        <div className="text-green-700">
                                          ✅ {t("allValidationsPassed")}
                                        </div>
                                      ) : (
                                        <div>
                                          <div className="font-medium mb-1">
                                            ⚠️ {t("validationIssues")}
                                          </div>
                                          {!paymentValidationResult.validation
                                            ?.orderIdMatch && (
                                            <div>
                                              • {t("orderIdMismatch")} (
                                              {t("extracted")}:{" "}
                                              {paymentValidationResult
                                                .validation?.extractedOrderId ||
                                                t("none")}
                                              , {t("expected")}:{" "}
                                              {
                                                paymentValidationResult
                                                  .validation?.expectedOrderId
                                              }
                                              )
                                            </div>
                                          )}
                                          {!paymentValidationResult.validation
                                            ?.amountMatch && (
                                            <div>
                                              • {t("amountMismatch")} (
                                              {t("expected")}:{" "}
                                              {paymentValidationResult.validation?.expectedAmount?.toLocaleString()}
                                              , {t("found")}:{" "}
                                              {paymentValidationResult.validation?.actualAmount?.toLocaleString()}
                                              )
                                            </div>
                                          )}
                                          {transaction.odrType === "withdraw" &&
                                            !paymentValidationResult.validation
                                              ?.isDebitTransaction && (
                                              <div>
                                                • {t("wrongTransactionType")}(
                                                {t("expectedDebit")},
                                                {t("foundCredit")})
                                              </div>
                                            )}
                                          {transaction.odrType === "deposit" &&
                                            paymentValidationResult.validation
                                              ?.isDebitTransaction && (
                                              <div>
                                                • {t("wrongTransactionType")}(
                                                {t("expectedCredit")},
                                                {t("foundDebit")})
                                              </div>
                                            )}
                                        </div>
                                      )}
                                    </div>

                                    {/* Action buttons */}
                                    <div className="flex gap-2">
                                      {paymentValidationResult.isAvailableRedemption &&
                                      transaction.odrType === "deposit" ? (
                                        <div className="flex-1 space-y-2">
                                          <Button
                                            onClick={() =>
                                              processPayment(paymentId)
                                            }
                                            className="w-full bg-purple-600 hover:bg-purple-700"
                                            disabled={
                                              processingPayment || isUpdating
                                            }
                                          >
                                            {processingPayment ? (
                                              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                              <Check className="mr-2 h-4 w-4" />
                                            )}
                                            {t("redeemAvailableBalance")}
                                          </Button>
                                          <div className="text-xs text-purple-700 bg-purple-50 p-2 rounded space-y-1">
                                            <div className="font-semibold">
                                              💰{" "}
                                              {t("availableBalanceRedemption")}
                                            </div>
                                            <div>
                                              {t("availableBalanceExplanation")}
                                            </div>
                                            <div className="font-medium text-purple-800">
                                              {t(
                                                "noAdditionalTransferRequired"
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      ) : paymentValidationResult.validation
                                          ?.isValid ? (
                                        <Button
                                          onClick={() =>
                                            processPayment(paymentId)
                                          }
                                          className="flex-1 bg-green-600 hover:bg-green-700"
                                          disabled={
                                            processingPayment || isUpdating
                                          }
                                        >
                                          {processingPayment ? (
                                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                          ) : (
                                            <Check className="mr-2 h-4 w-4" />
                                          )}
                                          {t("processPayment")}
                                        </Button>
                                      ) : // Check if Force Process is allowed (correct transaction type and amount)
                                      (transaction.odrType === "withdraw" &&
                                          paymentValidationResult.validation
                                            ?.isDebitTransaction &&
                                          paymentValidationResult.validation
                                            ?.amountMatch) ||
                                        (transaction.odrType === "deposit" &&
                                          !paymentValidationResult.validation
                                            ?.isDebitTransaction &&
                                          paymentValidationResult.validation
                                            ?.amountMatch) ? (
                                        <Button
                                          onClick={() =>
                                            processPayment(paymentId)
                                          }
                                          className="flex-1 bg-orange-600 hover:bg-orange-700"
                                          disabled={
                                            processingPayment || isUpdating
                                          }
                                        >
                                          {processingPayment ? (
                                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                          ) : (
                                            <AlertTriangle className="mr-2 h-4 w-4" />
                                          )}
                                          {t("forceProcess")}
                                        </Button>
                                      ) : (
                                        <div className="flex-1 text-center py-2 text-sm text-red-600 bg-red-50 rounded">
                                          {t("cannotProcessInvalid")}
                                        </div>
                                      )}

                                      {!(
                                        paymentValidationResult.isAvailableRedemption &&
                                        transaction.odrType === "deposit"
                                      ) && (
                                        <Button
                                          variant="outline"
                                          onClick={() => {
                                            setPaymentValidationResult(null);
                                            setPaymentId("");
                                          }}
                                          disabled={
                                            processingPayment || isUpdating
                                          }
                                        >
                                          {t("cancel")}
                                        </Button>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Mark as Failed Card */}
                <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
                  <div className="p-4 border-b border-gray-100">
                    <div className="flex items-center">
                      <div className="w-8 h-8 bg-red-100 rounded-lg flex items-center justify-center mr-3">
                        <X className="h-4 w-4 text-red-600" />
                      </div>
                      <div>
                        <h4 className="font-medium text-gray-900">
                          {t("markAsFailed")}
                        </h4>
                        <p className="text-xs text-gray-500">
                          {t("unableToProcessTransaction")}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="p-4">
                    <Button
                      variant="destructive"
                      onClick={() => handleStatusUpdate("failed")}
                      className="light-btn w-full"
                      disabled={isUpdating}
                    >
                      {isUpdating ? (
                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <X className="mr-2 h-4 w-4" />
                      )}
                      {t("markAsFailed")}
                    </Button>
                    <p className="text-xs text-gray-500 mt-2 text-center">
                      {t("useIfPaymentValidationFails")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bank Information and Bank Transactions - Side by side on desktop */}
      <div className="md:col-span-3 grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bank Information with QR Code */}
        <div className="bg-white rounded-lg border shadow-sm">
          <div className="p-4 lg:p-6 border-b">
            <h2 className="text-lg font-bold">{t("bankInformation")}</h2>
          </div>

          <div className="p-4 lg:p-6">
            <div className="space-y-4">
              {/* Bank Details */}
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500 mb-1">{t("bankName")}</p>
                  <p className="font-medium capitalize">
                    {transaction.bankName || transaction.bankId}
                  </p>
                </div>

                {transaction.accountNumber && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">
                      {t("accountNumber")}
                    </p>
                    <p className="font-medium font-mono">
                      {transaction.accountNumber}
                    </p>
                  </div>
                )}

                {transaction.accountName && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">
                      {t("accountName")}
                    </p>
                    <p className="font-medium">{transaction.accountName}</p>
                  </div>
                )}

                <div>
                  <p className="text-sm text-gray-500 mb-1">
                    {t("positiveAccount")}
                  </p>
                  <p className="font-medium font-mono">
                    {transaction.positiveAccount}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-500 mb-1">
                    {t("negativeAccount")}
                  </p>
                  <p className="font-medium font-mono">
                    {transaction.negativeAccount}
                  </p>
                </div>
              </div>

              {/* QR Code */}
              {transaction.qrCode && (
                <div className="pt-4 border-t border-gray-200">
                  <div className="flex flex-col items-center">
                    <h3 className="font-medium text-gray-900 mb-4">
                      {t("paymentQrCode")}
                    </h3>
                    <QRCodeDisplay
                      sourceType="direct"
                      qrCodeUrl={transaction.qrCode}
                      bankCode={transaction.bankId}
                      accountNumber={transaction.accountNumber}
                      amount={transaction.amount}
                      additionalInfo={transaction.odrId}
                      width={180}
                      height={180}
                      status={transaction.odrStatus}
                      bankName={transaction.bankName}
                      showHideToggle={true}
                      blurByDefault={
                        transaction.odrType === "deposit" ||
                        transaction.isSuspicious
                      }
                      blur={transaction.isSuspicious}
                      warningText={
                        transaction.isSuspicious ? t("suspiciousIp") : undefined
                      }
                      scanInstructions={
                        transaction.odrStatus === "completed"
                          ? t("qrCodeSuccessMessage")
                          : t("qrCodeScanInstructions")
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bank Transactions List */}
        <div className="lg:flex lg:flex-col">
          <BankTransactionsList
            orderId={transaction.odrId}
            orderStatus={transaction.odrStatus}
            userRole={userRole}
            showAllTransactions={showAllTransactions}
            initialTransactions={initialBankTransactions}
          />
        </div>
      </div>

      {/* Action buttons for all users */}
      <div className="md:col-span-3 flex justify-end mt-2">
        <Button
          variant="outline"
          onClick={() => router.back()}
          className="mr-2"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("back")}
        </Button>

        {/* Only show download button for completed transactions */}
        {transaction.odrStatus === "completed" && (
          <Button
            variant="default"
            onClick={downloadReceipt}
            className="flex items-center"
          >
            <DownloadCloud className="mr-2 h-4 w-4" />
            {t("downloadReceipt")}
          </Button>
        )}
      </div>
    </div>
  );
}
