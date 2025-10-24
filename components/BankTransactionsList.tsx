"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatAmount, formatDateTime } from "@/lib/utils";
import { useTranslations } from "next-intl";
import {
  RefreshCw,
  ExternalLink,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type {
  BankTransactionDocument,
  TransactionStatus,
} from "@/lib/actions/bankTransacionEntry.action";

interface BankTransactionsListProps {
  orderId: string;
  orderStatus: "pending" | "processing" | "completed" | "failed" | "canceled";
  userRole: string;
  showAllTransactions?: boolean;
  initialTransactions: BankTransactionDocument[];
}

// Status badge styling
const getStatusBadge = (
  status: TransactionStatus,
  t: (key: string) => string
) => {
  const statusConfig = {
    pending: {
      variant: "warning" as const,
      icon: Clock,
      color: "text-yellow-600",
    },
    processed: {
      variant: "success" as const,
      icon: CheckCircle,
      color: "text-green-600",
    },
    failed: {
      variant: "danger" as const,
      icon: XCircle,
      color: "text-red-600",
    },
    duplicated: {
      variant: "urgent" as const,
      icon: AlertTriangle,
      color: "text-orange-600",
    },
    unlinked: {
      variant: "default" as const,
      icon: AlertTriangle,
      color: "text-gray-600",
    },
    available: {
      variant: "info" as const,
      icon: CheckCircle,
      color: "text-blue-600",
    },
  };

  const config = statusConfig[status] || statusConfig.pending;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className="flex items-center gap-1">
      <Icon className={`w-3 h-3 ${config.color}`} />
      {t(status)}
    </Badge>
  );
};

// Transaction type badge
const getTransactionTypeBadge = (
  type: "credit" | "debit",
  t: (key: string) => string
) => {
  return (
    <Badge variant={type === "credit" ? "success" : "info"}>
      {type === "credit" ? t("credit") : t("debit")}
    </Badge>
  );
};

export default function BankTransactionsList({
  orderId,
  orderStatus,
  userRole,
  showAllTransactions = false,
  initialTransactions,
}: BankTransactionsListProps) {
  const { toast } = useToast();
  const t = useTranslations("transactions");
  const [bankTransactions, setBankTransactions] =
    useState<BankTransactionDocument[]>(initialTransactions);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Filter transactions based on user role
  const filteredTransactions = showAllTransactions 
    ? bankTransactions // Admin/Transactor: show all statuses
    : bankTransactions.filter(transaction => {
        // Regular users: filter by transaction status based on order status
        if (orderStatus === "pending" || orderStatus === "processing") {
          return transaction.status === "pending";
        } else if (orderStatus === "completed") {
          return transaction.status === "processed"; // Bank transactions use "processed" for completed orders
        } else {
          // For failed/canceled orders, show all related transactions
          return true;
        }
      });

  // Initialize with server-fetched data
  useEffect(() => {
    setBankTransactions(initialTransactions);
  }, [initialTransactions]);

  // Server action for refreshing data
  const refreshBankTransactions = async () => {
    try {
      const response = await fetch(
        `/api/bank-transactions/${orderId}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error("Failed to fetch transactions");
      }

      const data = await response.json();
      if (data.success && data.entries) {
        setBankTransactions(data.entries);
        setError(null);
      } else {
        setError(data.message || "Failed to fetch bank transactions");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);

    try {
      await refreshBankTransactions();
      toast({
        title: t("transactionsRefreshed"),
        description: t("bankTransactionsUpdated"),
        variant: "default",
      });
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to refresh transactions";
      setError(errorMessage);
      toast({
        title: t("refreshFailed"),
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  };

  // Handle copy portal ID
  const handleCopyPortalId = async (portalTransactionId: string) => {
    try {
      await navigator.clipboard.writeText(portalTransactionId);
      toast({
        title: t("portalIdCopied"),
        description: t("portalIdCopiedToClipboard", {
          portalId: portalTransactionId,
        }),
        variant: "default",
      });
    } catch (err) {
      console.error("Failed to copy portal ID:", err);
      // Fallback for older browsers
      try {
        const textArea = document.createElement("textarea");
        textArea.value = portalTransactionId;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);
        toast({
          title: t("portalIdCopied"),
          description: t("portalIdCopiedToClipboard", {
            portalId: portalTransactionId,
          }),
          variant: "default",
        });
      } catch {
        toast({
          title: t("copyFailed"),
          description: t("unableToCopyPortalId"),
          variant: "destructive",
        });
      }
    }
  };

  // Handle view raw data
  const handleViewRawData = (transaction: BankTransactionDocument) => {
    if (transaction.rawPayload) {
      console.log(
        "Raw Payload for transaction:",
        transaction.portalTransactionId
      );

      try {
        const parsedPayload = JSON.parse(transaction.rawPayload);
        console.log(JSON.stringify(parsedPayload, null, 2));

        // Create a new window to display the raw data
        const newWindow = window.open(
          "",
          "_blank",
          "width=800,height=600,scrollbars=yes,resizable=yes"
        );
        if (newWindow) {
          newWindow.document.write(`
            <html>
              <head>
                <title>${t("rawTransactionData")} - ${
            transaction.portalTransactionId
          }</title>
                <style>
                  body { 
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                    padding: 20px; 
                    background: #f5f5f5; 
                    margin: 0;
                  }
                  .container {
                    max-width: 100%;
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
                    overflow: hidden;
                  }
                  .header {
                    background: #2563eb;
                    color: white;
                    padding: 20px;
                  }
                  .header h1 {
                    margin: 0;
                    font-size: 24px;
                  }
                  .info {
                    padding: 20px;
                    border-bottom: 1px solid #e5e7eb;
                  }
                  .info-row {
                    display: flex;
                    margin-bottom: 10px;
                  }
                  .info-label {
                    font-weight: bold;
                    width: 200px;
                    color: #374151;
                  }
                  .info-value {
                    color: #6b7280;
                    font-family: monospace;
                  }
                  pre { 
                    background: #f8fafc; 
                    padding: 20px; 
                    margin: 0;
                    white-space: pre-wrap;
                    word-wrap: break-word;
                    font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
                    font-size: 14px;
                    line-height: 1.5;
                    overflow-x: auto;
                  }
                  .copy-btn {
                    background: #10b981;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 4px;
                    cursor: pointer;
                    margin: 10px;
                  }
                  .copy-btn:hover {
                    background: #059669;
                  }
                </style>
              </head>
              <body>
                <div class="container">
                  <div class="header">
                    <h1>${t("rawTransactionData")}</h1>
                  </div>
                  <div class="info">
                    <div class="info-row">
                      <span class="info-label">${t(
                        "portalTransactionId"
                      )}:</span>
                      <span class="info-value">${
                        transaction.portalTransactionId
                      }</span>
                    </div>
                    <div class="info-row">
                      <span class="info-label">${t("bankName")}:</span>
                      <span class="info-value">${transaction.bankName}</span>
                    </div>
                    <div class="info-row">
                      <span class="info-label">${t("totalAmount")}:</span>
                      <span class="info-value">${formatAmount(
                        transaction.amount
                      )}</span>
                    </div>
                    <div class="info-row">
                      <span class="info-label">${t("transactionStatus")}:</span>
                      <span class="info-value">${
                        transaction.status || "pending"
                      }</span>
                    </div>
                    <button class="copy-btn" onclick="navigator.clipboard.writeText(document.querySelector('pre').textContent)">
                      ${t("copyRawData")}
                    </button>
                  </div>
                  <pre>${JSON.stringify(parsedPayload, null, 2)}</pre>
                </div>
              </body>
            </html>
          `);
          newWindow.document.close();

          toast({
            title: t("rawDataOpened"),
            description: t("rawTransactionDataOpened"),
            variant: "default",
          });
        } else {
          toast({
            title: t("popupBlocked"),
            description: t("enablePopupsToViewRawData"),
            variant: "destructive",
          });
        }
      } catch (parseErr) {
        console.error("Error parsing raw payload:", parseErr);
        toast({
          title: t("parseError"),
          description: t("unableToParseRawData"),
          variant: "destructive",
        });
      }
    } else {
      console.log("No raw payload available for this transaction");
      toast({
        title: t("noRawData"),
        description: t("noRawPayloadAvailable"),
        variant: "destructive",
      });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <CardTitle className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-lg font-semibold">{t("bankTransactions")}</span>
            <div className="flex items-center gap-2">
              <Badge variant="default" className="text-xs">
                {bankTransactions.length}
              </Badge>
              {showAllTransactions && (
                <Badge variant="info" className="text-xs">{t("allStatuses")}</Badge>
              )}
            </div>
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="flex items-center justify-center gap-2 w-full sm:w-auto py-2"
          >
            <RefreshCw
              className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
            />
            <span className="text-sm">{t("refresh")}</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-2 text-red-700">
              <XCircle className="w-4 h-4" />
              <span className="font-medium">
                {t("errorLoadingTransactions")}
              </span>
            </div>
            <p className="text-red-600 text-sm mt-1">{error}</p>
          </div>
        )}

        {filteredTransactions.length === 0 && !error ? (
          <div className="text-center py-8 text-gray-500">
            <AlertTriangle className="w-8 h-8 mx-auto mb-2 text-gray-400" />
            <p className="font-medium">{t("noBankTransactionsFound")}</p>
            <p className="text-sm">
              {showAllTransactions
                ? t("noTransactionsCreatedYet")
                : orderStatus === "pending" || orderStatus === "processing"
                ? t("waitingForPaymentProcessed")
                : t("noTransactionsLinked")}
            </p>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {filteredTransactions.map((transaction, index) => (
              <div
                key={transaction.$id}
                className="border border-gray-200 rounded-lg p-3 sm:p-4 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                {/* Transaction header - Responsive layout */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-3 space-y-2 sm:space-y-0">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <span className="font-medium text-sm text-gray-600">
                      {t("transaction")} #{index + 1}
                    </span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {getStatusBadge(transaction.status || "pending", t)}
                      {getTransactionTypeBadge(transaction.transactionType, t)}
                    </div>
                  </div>
                  <div className="text-left sm:text-right">
                    <div
                      className={`font-bold text-lg sm:text-lg md:text-xl ${
                        transaction.transactionType === "credit"
                          ? "text-green-600"
                          : "text-red-600"
                      }`}
                    >
                      {transaction.transactionType === "credit" ? "+" : "-"}
                      {formatAmount(Math.abs(transaction.amount))}
                    </div>
                  </div>
                </div>

                {/* Responsive information layout - Grid on desktop, stacked on mobile */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
                  {/* Bank Name */}
                  <div className="flex flex-col">
                    <span className="font-medium text-gray-700 text-xs mb-1">
                      {t("bankName")}
                    </span>
                    <p className="text-gray-600 font-medium">
                      {transaction.bankName}
                    </p>
                  </div>

                  {/* Account */}
                  <div className="flex flex-col">
                    <span className="font-medium text-gray-700 text-xs mb-1">
                      {t("account")}
                    </span>
                    <p className="text-gray-600 font-mono text-sm">
                      {transaction.bankAccountNumber}
                    </p>
                  </div>

                  {/* Portal */}
                  <div className="flex flex-col">
                    <span className="font-medium text-gray-700 text-xs mb-1">
                      {t("portal")}
                    </span>
                    <p className="text-gray-600 capitalize">
                      {transaction.portalId}
                    </p>
                  </div>

                  {/* Portal Transaction ID - Spans multiple columns on larger screens */}
                  <div className="flex flex-col md:col-span-2 lg:col-span-2">
                    <span className="font-medium text-gray-700 text-xs mb-1">
                      {t("portalTransaction")}
                    </span>
                    <p className="text-gray-600 font-mono break-all text-sm bg-gray-100 px-2 py-1 rounded">
                      {transaction.portalTransactionId}
                    </p>
                  </div>

                  {/* Processing Date */}
                  {transaction.processingDate && (
                    <div className="flex flex-col lg:col-span-1">
                      <span className="font-medium text-gray-700 text-xs mb-1">
                        {t("processed")}
                      </span>
                      <p className="text-gray-600 text-sm">
                        {formatDateTime(transaction.processingDate).dateTime}
                      </p>
                    </div>
                  )}
                </div>

                {/* Admin/Transactor actions - Responsive layout */}
                {(userRole === "admin" || userRole === "transactor") && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-3 pt-3 border-t border-gray-200">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex items-center justify-center gap-1 w-full sm:w-auto text-xs sm:text-sm py-1.5 sm:py-2"
                      onClick={() =>
                        handleCopyPortalId(transaction.portalTransactionId)
                      }
                    >
                      <ExternalLink className="w-3 h-3 sm:w-4 sm:h-4" />
                      <span>{t("copyPortalId")}</span>
                    </Button>
                    {transaction.rawPayload && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex items-center justify-center gap-1 w-full sm:w-auto text-xs sm:text-sm py-1.5 sm:py-2"
                        onClick={() => handleViewRawData(transaction)}
                      >
                        <span>{t("viewRawData")}</span>
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
