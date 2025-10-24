"use client";

import { DynamicTable } from "@/components/DynamicTable";
import { Badge } from "@/components/ui/badge";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { subscribeToCollectionDocuments } from "@/lib/client/appwriteSubcriptions";
import {
  cn,
  formatAmount,
  formatDateTime,
  type FormattedDateResult,
} from "@/lib/utils";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Eye } from "lucide-react";
import { appConfig } from "@/lib/appconfig";

import { transactionCategoryStyles } from "@/constants";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import Link from "next/link";
import { Switch } from "@/components/ui/switch";

// Define the Transaction interface
interface Transaction {
  $id: string;
  odrId: string;
  merchantOrdId?: string;
  odrType: "deposit" | "withdraw";
  odrStatus: "processing" | "pending" | "completed" | "canceled" | "failed";
  bankId: string;
  bankName?: string;
  amount: number;
  paidAmount: number;
  unPaidAmount: number;
  positiveAccount: string;
  negativeAccount: string;
  qrCode?: string | null;
  $createdAt: string;
  $updatedAt: string;
  // Add the formatted date fields
  formattedCreatedAt?: FormattedDateResult;
  formattedUpdatedAt?: FormattedDateResult;
  bankReceiveNumber?: string;
  bankReceiveOwnerName?: string;
  isSentCallbackNotification?: boolean | null;
  urlCallBack?: string;
  account?: { apiKey?: string };
}

// Define pagination state interface
interface PaginationState {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

// Define props interface for the component
interface TransactionTableProps {
  transactions: Transaction[];
  pagination: PaginationState;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}

interface CategoryBadgeProps {
  category: string;
}

const CategoryBadge = ({ category }: CategoryBadgeProps) => {
  const t = useTranslations("transactions");
  const { borderColor, backgroundColor, textColor, chipBackgroundColor } =
    transactionCategoryStyles[
      category as keyof typeof transactionCategoryStyles
    ] || transactionCategoryStyles.default;

  return (
    <div className={cn("category-badge", borderColor, chipBackgroundColor)}>
      <div className={cn("size-2 rounded-full", backgroundColor)} />
      <p className={cn("text-[12px] font-medium", textColor)}>{t(category)}</p>
    </div>
  );
};

// Define extended transaction type with timeState
interface EnhancedTransaction extends Transaction {
  timeState?: string | null;
  isUpdatingStatus?: boolean;
  isResendingNotification?: boolean;
}

function TimeElapsedCounter({ createdAt }: { createdAt: string }) {
  const t = useTranslations("transactions");
  const [timeText, setTimeText] = useState("");

  useEffect(() => {
    // Calculate and format time elapsed
    function updateTimeElapsed() {
      const created = new Date(createdAt);
      const now = new Date();
      const diffInMs = now.getTime() - created.getTime();

      const minutes = Math.floor(diffInMs / (1000 * 60));
      const hours = Math.floor(diffInMs / (1000 * 60 * 60));
      const days = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
      const months = Math.floor(diffInMs / (1000 * 60 * 60 * 24 * 30));
      const years = Math.floor(diffInMs / (1000 * 60 * 60 * 24 * 365));

      if (minutes < 1) {
        setTimeText(t("lessThanMinuteAgo"));
      } else if (minutes < 60) {
        setTimeText(
          minutes === 1
            ? t("minuteAgo", { minutes })
            : t("minutesAgo", { minutes })
        );
      } else if (hours < 24) {
        setTimeText(
          hours === 1 ? t("hourAgo", { hours }) : t("hoursAgo", { hours })
        );
      } else if (days < 30) {
        setTimeText(
          days === 1 ? t("dayAgo", { days }) : t("daysAgo", { days })
        );
      } else if (months < 12) {
        setTimeText(
          months === 1 ? t("monthAgo", { months }) : t("monthsAgo", { months })
        );
      } else {
        setTimeText(
          years === 1 ? t("yearAgo", { years }) : t("yearsAgo", { years })
        );
      }
    }

    // Calculate immediately
    updateTimeElapsed();

    // Then update every minute
    const timer = setInterval(updateTimeElapsed, 60000);

    // Clean up on unmount
    return () => clearInterval(timer);
  }, [createdAt, t]);

  return <span>{timeText}</span>;
}

export default function TransactionTable({
  transactions,
  pagination,
  onPageChange,
  onPageSizeChange,
}: TransactionTableProps) {
  const t = useTranslations("transactions");
  const locale = useLocale();

  // Map locale to proper format for Intl.DateTimeFormat
  const getDateLocale = (locale: string) => {
    switch (locale) {
      case "zh":
        return "zh-CN";
      case "vn":
        return "vi-VN";
      case "en":
        return "en-US";
      default:
        return locale;
    }
  };

  const dateLocale = getDateLocale(locale);
  // State for storing transactions with real-time updates
  const [realtimeTransactions, setRealtimeTransactions] =
    useState<Transaction[]>(transactions);
  // State for updated pagination to reflect new transactions
  const [localPagination, setLocalPagination] = useState(pagination);
  // References for managing subscriptions
  const unsubscribeRef = useRef<(() => void) | null>(null);
  // Ref to track transaction IDs we're already subscribed to
  const trackedTransactionIds = useRef<Set<string>>(new Set());
  // State to count new transactions (for the notification when not on page 1)
  const [newTransactionCount, setNewTransactionCount] = useState(0);
  // Cache for storing new transactions when not on page 1
  const newTransactionsCache = useRef<Transaction[]>([]);
  // Track transactions with pending notification
  const [resendingNotifications, setResendingNotifications] = useState<{
    [key: string]: boolean;
  }>({});

  // Helper function to determine transaction time state - memoized
  const getTransactionTimeState = useCallback((transaction: Transaction) => {
    // Skip non-processing transactions
    if (transaction.odrStatus !== "processing") return null;

    const createdAt = new Date(transaction.$createdAt);
    const now = new Date();
    const timeDifference = now.getTime() - createdAt.getTime();

    // Use appConfig.paymentWindowSeconds for payment window
    const paymentWindowMs = appConfig.paymentWindowSeconds * 1000;
    const warningThresholdMs = paymentWindowMs * 0.8; // 80% of payment window as warning

    if (timeDifference < warningThresholdMs) {
      return "normal";
    } else if (timeDifference < paymentWindowMs) {
      return "danger"; // In danger of expiring soon
    } else {
      return "expired"; // Already expired
    }
  }, []);

  // QR visibility state no longer needed with toggle switch implementation

  // Function to resend webhook notification
  const resendNotification = useCallback(
    async (transaction: Transaction) => {
      if (!transaction.urlCallBack || resendingNotifications[transaction.$id]) {
        return;
      }

      // Mark this transaction as being processed
      setResendingNotifications((prev) => ({
        ...prev,
        [transaction.$id]: true,
      }));

      try {
        toast.info(t("sendingNotification", { orderId: transaction.odrId }));

        // Client-side, we'll use fetch directly instead of the server action
        const response = await fetch("/api/resend-webhook", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            odrId: transaction.odrId,
            callbackUrl: transaction.urlCallBack,
            apiKey: transaction.account?.apiKey || "",
            transactionId: transaction.$id,
            data: {
              odrId: transaction.odrId,
              merchantOrdId: transaction.merchantOrdId || "",
              orderType: transaction.odrType,
              odrStatus: transaction.odrStatus,
              bankReceiveNumber: transaction.bankReceiveNumber || "",
              bankReceiveOwnerName: transaction.bankReceiveOwnerName || "",
              amount: transaction.paidAmount || 0,
            },
          }),
        });

        const result = await response.json();

        if (response.ok && result.success) {
          toast.success(
            t("notificationSentSuccess", { orderId: transaction.odrId })
          );

          // Update the transaction in state to show notification as sent
          setRealtimeTransactions((prev) =>
            prev.map((t) =>
              t.$id === transaction.$id
                ? { ...t, isSentCallbackNotification: true }
                : t
            )
          );
        } else {
          toast.error(
            t("notificationSendFailed", {
              error: result.message || "Unknown error",
            })
          );
        }
      } catch (error) {
        console.error("Error sending webhook notification:", error);
        toast.error(t("notificationSendError", { orderId: transaction.odrId }));
      } finally {
        // Clear the sending flag
        setResendingNotifications((prev) => ({
          ...prev,
          [transaction.$id]: false,
        }));
      }
    },
    [resendingNotifications]
  );

  // Function to update notification status
  const updateNotificationStatus = useCallback(
    async (transaction: Transaction, newStatus: boolean) => {
      if (resendingNotifications[transaction.$id]) {
        return;
      }

      // Mark this transaction as being processed
      setResendingNotifications((prev) => ({
        ...prev,
        [transaction.$id]: true,
      }));

      try {
        if (newStatus) {
          // If turning ON, resend notification
          await resendNotification(transaction);
        } else {
          // If turning OFF, update status to false
          toast.info(t("updatingStatus", { orderId: transaction.odrId }));

          const response = await fetch(
            "/api/webhook/update-notification-status",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                transactionId: transaction.$id,
                status: false,
              }),
            }
          );

          const result = await response.json();

          if (response.ok && result.success) {
            toast.success(
              t("statusUpdatedSuccess", { orderId: transaction.odrId })
            );

            // Update the transaction in state
            setRealtimeTransactions((prev) =>
              prev.map((t) =>
                t.$id === transaction.$id
                  ? { ...t, isSentCallbackNotification: false }
                  : t
              )
            );
          } else {
            toast.error(
              t("statusUpdateFailed", {
                error: result.message || "Unknown error",
              })
            );
          }
        }
      } catch (error) {
        console.error("Error updating notification status:", error);
        toast.error(t("statusUpdateError", { orderId: transaction.odrId }));
      } finally {
        // Clear the sending flag
        setResendingNotifications((prev) => ({
          ...prev,
          [transaction.$id]: false,
        }));
      }
    },
    [resendingNotifications, resendNotification]
  );

  // Process transactions with time state - memoized to avoid unnecessary calculations
  const processedTransactions = useMemo(() => {
    return realtimeTransactions.map((transaction) => {
      // Only calculate time state for processing transactions
      const timeState =
        transaction.odrStatus === "processing"
          ? getTransactionTimeState(transaction)
          : null;

      return {
        ...transaction,
        timeState,
        isUpdatingStatus: false,
        isResendingNotification:
          resendingNotifications[transaction.$id] || false,
      };
    });
  }, [realtimeTransactions, getTransactionTimeState, resendingNotifications]);

  // Update the state when transactions from props change (pagination or refresh)
  // or when returning to page 1 and there are cached transactions
  useEffect(() => {
    if (pagination.page === 1 && newTransactionsCache.current.length > 0) {
      // When returning to page 1, prepend cached transactions to the list
      const combinedTransactions = [
        ...newTransactionsCache.current,
        ...transactions,
      ].slice(0, pagination.limit);

      // Re-format dates with correct locale
      const localeFormattedTransactions = combinedTransactions.map(
        (transaction) => ({
          ...transaction,
          formattedCreatedAt: formatDateTime(
            transaction.$createdAt,
            dateLocale
          ),
          formattedUpdatedAt: formatDateTime(
            transaction.$updatedAt,
            dateLocale
          ),
        })
      );

      setRealtimeTransactions(localeFormattedTransactions);

      // Update local pagination to reflect the correct total
      setLocalPagination({
        ...pagination,
        total: pagination.total + newTransactionsCache.current.length,
        pages: Math.ceil(
          (pagination.total + newTransactionsCache.current.length) /
            pagination.limit
        ),
      });

      // Clear the cache and counter since we've now shown these transactions
      newTransactionsCache.current = [];
      setNewTransactionCount(0);
    } else {
      // For other page changes, just update with the server data
      // Re-format dates with correct locale
      const localeFormattedTransactions = transactions.map((transaction) => ({
        ...transaction,
        formattedCreatedAt: formatDateTime(transaction.$createdAt, dateLocale),
        formattedUpdatedAt: formatDateTime(transaction.$updatedAt, dateLocale),
      }));
      setRealtimeTransactions(localeFormattedTransactions);
      setLocalPagination(pagination);
    }
  }, [transactions, pagination, dateLocale]);

  // Create stable transaction IDs array to prevent infinite re-renders
  const transactionIds = useMemo(
    () => transactions.map((t) => t.$id).sort(),
    [transactions]
  );

  // Optimize subscription logic
  useEffect(() => {
    // Get IDs of visible transactions
    const visibleIds = transactionIds;

    // Track ALL visible transactions for real-time updates, not just processing/pending
    // This ensures we catch status changes to completed/failed/canceled states
    const realtimeTransactionIds = visibleIds;

    // Track all visible transactions in real-time
    trackedTransactionIds.current = new Set(realtimeTransactionIds);

    // Clean up previous subscription
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    const unsubscribeFunctions: Array<() => void> = [];

    // DISABLED: No longer subscribe to new transaction creation events
    // Users will see new transactions only when they refresh or change filters
    // This prevents the infinite refresh loop caused by real-time creation events

    // Subscribe to all visible transactions for real-time updates
    if (realtimeTransactionIds.length > 0) {
      unsubscribeFunctions.push(
        subscribeToCollectionDocuments<Transaction>(
          appwriteConfig.databaseId,
          appwriteConfig.odrtransCollectionId,
          realtimeTransactionIds,
          (updatedTransaction) => {
            // Update transaction in state
            setRealtimeTransactions((prev) =>
              prev.map((transaction) =>
                transaction.$id === updatedTransaction.$id
                  ? {
                      ...updatedTransaction,
                      formattedCreatedAt: formatDateTime(
                        updatedTransaction.$createdAt,
                        dateLocale
                      ),
                      formattedUpdatedAt: formatDateTime(
                        updatedTransaction.$updatedAt,
                        dateLocale
                      ),
                    }
                  : transaction
              )
            );

            // Keep all visible transactions tracked for real-time updates
            // This ensures notification status updates are received in real-time
          },
          (deletedTransactionId) => {
            // Handle real-time deletion of transactions
            setRealtimeTransactions((prev) =>
              prev.filter(
                (transaction) => transaction.$id !== deletedTransactionId
              )
            );

            // Update pagination to reflect the removal
            setLocalPagination((prev) => ({
              ...prev,
              total: Math.max(0, prev.total - 1),
              pages: Math.ceil(Math.max(0, prev.total - 1) / prev.limit),
            }));
          }
        )
      );
    }

    // Store unsubscribe function
    unsubscribeRef.current = () => {
      unsubscribeFunctions.forEach((unsubscribe) => unsubscribe());
    };

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [transactionIds.join(","), pagination.page, pagination.limit]);

  // Effect to automatically update expired transactions - DISABLED
  // This was causing rapid API calls in stats component
  // useEffect(() => {
  //   // Check each transaction in processed list
  //   processedTransactions.forEach((transaction) => {
  //     if (
  //       transaction.odrStatus === "processing" &&
  //       transaction.timeState === "expired" &&
  //       !transaction.isUpdatingStatus
  //     ) {
  //       handleExpiredTransaction(transaction);
  //     }
  //   });
  // }, [processedTransactions, handleExpiredTransaction]);

  // Effect to check if current page is empty and redirect to page 1 if needed
  useEffect(() => {
    // Only apply this logic if we're not already on page 1
    if (
      pagination.page > 1 &&
      processedTransactions.length === 0 &&
      transactions.length === 0
    ) {
      // If after updates the current page is empty, navigate to page 1
      onPageChange(1);
    }
  }, [processedTransactions, transactions, pagination.page, onPageChange]);

  // Smart update for time-sensitive items only when needed
  useEffect(() => {
    // Only set up if we have processing transactions
    const hasProcessingTransactions = processedTransactions.some(
      (t) => t.odrStatus === "processing"
    );

    if (!hasProcessingTransactions) return;

    // Function to check for transactions that need time state updates
    const checkTimeStateUpdates = () => {
      let needsUpdate = false;

      // Check each processing transaction
      processedTransactions.forEach((transaction) => {
        if (transaction.odrStatus !== "processing") return;

        const currentTimeState = transaction.timeState;
        const newTimeState = getTransactionTimeState(transaction);

        // If time state changed, mark for update
        if (currentTimeState !== newTimeState) {
          needsUpdate = true;
        }
      });

      // Only force update if needed
      if (needsUpdate) {
        setRealtimeTransactions((prev) => [...prev]); // Force update by creating new array reference
      }
    };

    // Set up interval to check - once per minute is sufficient
    const intervalId = setInterval(checkTimeStateUpdates, 60000);

    return () => {
      clearInterval(intervalId);
    };
  }, [processedTransactions, getTransactionTimeState]);

  // Define columns - memoized to prevent unnecessary re-creation
  const columns = useMemo(
    () => [
      {
        header: t("orderId"),
        cell: (transaction: EnhancedTransaction) => (
          <div className="flex flex-col">
            <span className="font-medium">{transaction.odrId}</span>
            {transaction.merchantOrdId && (
              <span className="text-sm text-gray-500">
                {t("ref")}: {transaction.merchantOrdId}
              </span>
            )}
          </div>
        ),
      },
      {
        header: t("type"),
        cell: (transaction: EnhancedTransaction) => (
          <Badge
            variant={transaction.odrType === "deposit" ? "success" : "danger"}
            className="capitalize"
          >
            {t(transaction.odrType)}
          </Badge>
        ),
      },
      {
        header: t("amount"),
        cell: (transaction: EnhancedTransaction) =>
          transaction.odrType === "withdraw" ? (
            <span className="font-medium text-red-500">
              {formatAmount(transaction.amount)}
            </span>
          ) : (
            <span className="font-medium text-green-500">
              {formatAmount(transaction.amount)}
            </span>
          ),
      },
      {
        header: t("paid"),
        cell: (transaction: EnhancedTransaction) => (
          <div className="flex flex-col">
            <span className="font-medium">
              {formatAmount(transaction.paidAmount)}
            </span>
            {transaction.unPaidAmount > 0 && (
              <span className="text-xs text-red-500">
                {t("unPaid")}: {formatAmount(transaction.unPaidAmount)}
              </span>
            )}
          </div>
        ),
      },
      {
        header: t("status"),
        cell: (transaction: EnhancedTransaction) => {
          // Get time state from processed transaction
          const timeState = transaction.timeState;

          return (
            <div className="flex flex-col gap-1">
              <CategoryBadge category={transaction.odrStatus} />

              {transaction.odrStatus === "processing" &&
                timeState === "danger" && <CategoryBadge category={"urgent"} />}

              {transaction.odrStatus === "processing" &&
                timeState === "expired" && (
                  <CategoryBadge category={"expired"} />
                )}
            </div>
          );
        },
      },
      {
        header: t("createdAt"),
        cell: (transaction: EnhancedTransaction) => {
          // Get time state
          const timeState = transaction.timeState;

          // Determine text color based on time state
          let timeTextColor = "text-blue-600";
          if (timeState === "danger") {
            timeTextColor = "text-amber-600";
          } else if (timeState === "expired") {
            timeTextColor = "text-red-600";
          }

          // Format the date with local timezone
          const { date, time } = formatDateTime(
            transaction.$createdAt,
            dateLocale
          );

          // Calculate time period between creation and update
          const createdAt = new Date(transaction.$createdAt);
          const updatedAt = new Date(transaction.$updatedAt);
          const timeDifference = updatedAt.getTime() - createdAt.getTime();
          const timePeriodInMinutes = Math.floor(timeDifference / (1000 * 60));
          const timePeriodInSeconds = Math.floor(timeDifference / 1000);

          // Format time period for display
          let timePeriodText = "";
          if (timePeriodInMinutes > 0) {
            timePeriodText = `${timePeriodInMinutes}m`;
          } else {
            timePeriodText = `${timePeriodInSeconds}s`;
          }

          return (
            <div className="flex flex-col">
              <span className="text-sm">{date}</span>
              <span className="text-xs text-gray-500">{time}</span>

              {/* Show age for processing transactions */}
              {transaction.odrStatus === "processing" && (
                <span className={`text-xs mt-1 font-medium ${timeTextColor}`}>
                  <TimeElapsedCounter createdAt={transaction.$createdAt} />
                </span>
              )}

              {/* Show time period between creation and update */}
              {transaction.$createdAt !== transaction.$updatedAt && (
                <span className="text-xs text-gray-500 mt-1">
                  {t("period")}: {timePeriodText}
                </span>
              )}
            </div>
          );
        },
      },
      {
        header: t("notification"),
        cell: (transaction: EnhancedTransaction) => {
          // Only show for completed, failed, or canceled transactions with callback URL
          if (
            !transaction.urlCallBack ||
            !(
              transaction.odrStatus === "completed" ||
              transaction.odrStatus === "failed" ||
              transaction.odrStatus === "canceled"
            )
          ) {
            return <span className="text-xs text-gray-400">-</span>;
          }

          return (
            <div className="flex items-center space-x-2">
              <div className="flex flex-col mr-2">
                <span className="text-[10px] text-gray-400">
                  {transaction.isSentCallbackNotification
                    ? t("sent")
                    : t("notSent")}
                </span>
              </div>
              <Switch
                checked={!!transaction.isSentCallbackNotification}
                onCheckedChange={(checked) =>
                  updateNotificationStatus(transaction, checked)
                }
                disabled={transaction.isResendingNotification}
                className={
                  transaction.isResendingNotification ? "opacity-50" : ""
                }
              />
              {transaction.isResendingNotification && (
                <svg
                  className="animate-spin h-4 w-4 text-primary"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
              )}
            </div>
          );
        },
      },
      {
        header: t("actions"),
        cell: (transaction: EnhancedTransaction) => (
          <div className="flex space-x-2">
            {/* Edit/Details Button */}
            <Link href={`/transactions/view/${transaction.odrId}`}>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                <Eye className="h-4 w-4" />
                <span className="sr-only">{t("edit")}</span>
              </Button>
            </Link>
          </div>
        ),
      },
    ],
    [t, updateNotificationStatus]
  );

  // Row styling based on status and time state - memoized
  const getTransactionRowClassName = useCallback(
    (transaction: EnhancedTransaction) => {
      if (transaction.odrStatus !== "processing") {
        // Standard status-based styling for non-processing transactions
        switch (transaction.odrStatus) {
          case "completed":
            return "bg-green-50 hover:bg-green-100";
          case "failed":
            return "bg-red-50 hover:bg-red-100";
          case "canceled":
            return "bg-gray-50 hover:bg-gray-100";
          default:
            return "";
        }
      }

      // For processing transactions, check time state
      const timeState = transaction.timeState;

      switch (timeState) {
        case "normal":
          return "hover:bg-gray-100"; // Normal processing style
        case "danger":
          return "bg-amber-50 border-l-4 border-amber-500 hover:bg-amber-100"; // Urgent style
        case "expired":
          return "bg-red-25 hover:bg-red-50";
        default:
          return "hover:bg-gray-100";
      }
    },
    []
  );

  // No longer need transaction modal with toggle switch implementation

  // Update the renderNewTransactionsNotification function
  const renderNewTransactionsNotification = () => {
    if (pagination.page !== 1 && newTransactionCount > 0) {
      return (
        <div className="bg-yellow-50 border border-yellow-300 rounded-md p-3 mb-4 flex justify-between items-center animate-pulse-strong shadow-md">
          <div className="flex items-center">
            <div className="h-3 w-3 rounded-full bg-yellow-500 mr-2 animate-ping"></div>
            <p className="text-yellow-700 font-medium">
              {t("newTransactionsAvailable", { count: newTransactionCount })}
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => onPageChange(1)}
            className="bg-yellow-500 hover:bg-yellow-600 text-white border-none"
          >
            {t("viewLatest")}
          </Button>
        </div>
      );
    }
    return null;
  };

  return (
    <>
      {renderNewTransactionsNotification()}
      <DynamicTable<EnhancedTransaction>
        data={processedTransactions}
        columns={columns}
        rowClassName={getTransactionRowClassName}
        pagination={true}
        pageSize={localPagination.limit}
        pageSizeOptions={[10, 20, 30, 50]}
        externalPagination={true}
        currentPage={localPagination.page}
        totalPages={localPagination.pages}
        totalItems={localPagination.total}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </>
  );
}
