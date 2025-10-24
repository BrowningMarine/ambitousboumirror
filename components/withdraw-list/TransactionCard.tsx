import React, { memo } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, X, RefreshCw, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import CopyButton from "@/components/CopyButton";
import QRCodeDisplay, { RibbonType } from "@/components/QRCodeCard";
import RandomizeIcons from "@/components/RandomizeIcons";
import { Transaction } from "@/hooks/useWithdrawals";
import { PaymentValidationResponse } from "@/hooks/usePaymentValidation";

interface TransactionCardProps {
  transaction: Transaction;
  index: number;
  userRole: string;
  updatingTransactions: Set<string>;
  paymentIds: Record<string, string>;
  validatingPayment: Set<string>;
  paymentValidationResults: Record<string, PaymentValidationResponse | null>;
  validatedTransactions: Set<string>;
  processingPayments: Set<string>;
  justProcessedTransactions: Set<string>;
  showTransactionActions: Set<string>;
  canUpdateStatus: (transaction: Transaction) => boolean;
  onStatusUpdate: (
    transaction: Transaction,
    newStatus: "completed" | "failed"
  ) => void;
  onPaymentIdChange: (transactionId: string, value: string) => void;
  onToggleTransactionActions: (transactionId: string) => void;
  onValidatePaymentId: (
    transaction: Transaction,
    paymentId: string
  ) => Promise<void>;
  onProcessPayment: (
    transaction: Transaction,
    paymentId: string
  ) => Promise<void>;
  onResetValidationState: (transactionId: string) => void;
}

// Get ribbon type based on merchantOrdId
const getRibbonType = (merchantOrdId?: string): RibbonType => {
  if (!merchantOrdId) return null;

  const orderId = merchantOrdId.toUpperCase();

  if (orderId.includes("TEST")) return "test";
  if (orderId.includes("DISCOUNT")) return "discount";
  if (orderId.includes("TRENDING")) return "trending";
  if (orderId.includes("SPECIAL")) return "special";

  return null;
};

// Format currency
const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
  }).format(amount);
};

// Get status badge color
const getStatusColor = (status: string) => {
  switch (status) {
    case "pending":
      return "bg-yellow-100 text-yellow-800";
    case "processing":
      return "bg-blue-100 text-blue-800";
    case "completed":
      return "bg-green-100 text-green-800";
    case "failed":
      return "bg-red-100 text-red-800";
    case "canceled":
      return "bg-gray-100 text-gray-800";
    default:
      return "bg-gray-100 text-gray-800";
  }
};

// Helper function to format user display
const formatUserDisplay = (user: Record<string, unknown>): string => {
  if (
    typeof user.firstName === "string" &&
    typeof user.lastName === "string" &&
    user.firstName &&
    user.lastName
  ) {
    return `${user.firstName} ${user.lastName}`;
  }

  if (typeof user.email === "string" && user.email) {
    return user.email;
  }

  if (typeof user.userId === "string" && user.userId) {
    return user.userId;
  }

  if (typeof user.$id === "string" && user.$id) {
    return user.$id;
  }

  return "Unknown User";
};

// Memoized QR component
const LazyQRCode = memo(function LazyQRCode({
  transaction,
}: {
  transaction: Transaction;
}) {
  const t = useTranslations("transactions");
  
  return (
    <QRCodeDisplay
      sourceType="vietqr"
      bankCode={transaction.bankCode}
      accountNumber={transaction.bankReceiveNumber}
      amount={transaction.unPaidAmount}
      additionalInfo={transaction.odrId}
      width={160}
      height={160}
      status={transaction.odrStatus}
      bankName={transaction.bankReceiveName}
      unavailableMessage={t("qrNotAvailable")}
      ribbon={getRibbonType(transaction.merchantOrdId)}
      blur={transaction.isSuspicious}
      blurByDefault={transaction.isSuspicious}
      warningText={transaction.isSuspicious ? t("suspiciousIp") : undefined}
      showHideToggle={transaction.isSuspicious}
      hideMessage={
        transaction.isSuspicious ? t("hideQrCode") : t("hideQrCode")
      }
      showMessage={
        transaction.isSuspicious ? t("revealSuspiciousQr") : t("showQrCode")
      }
    />
  );
});

const MemoizedRandomizeIcons = memo(RandomizeIcons);

const TransactionCard: React.FC<TransactionCardProps> = ({
  transaction,
  index,
  updatingTransactions,
  paymentIds,
  validatingPayment,
  paymentValidationResults,
  validatedTransactions,
  processingPayments,
  justProcessedTransactions,
  showTransactionActions,
  canUpdateStatus,
  onStatusUpdate,
  onPaymentIdChange,
  onToggleTransactionActions,
  onValidatePaymentId,
  onProcessPayment,
  onResetValidationState,
}) => {
  const t = useTranslations("withdraw");

  return (
    <Card
      key={`${transaction.$id}-${transaction.odrId}`}
      data-index={index}
      className={`overflow-hidden transition-all duration-500 hover:shadow-lg border-l-4 border-l-blue-500 ${
        transaction.isTransitioning
          ? "opacity-0 transform translate-y-4"
          : "opacity-100 transform translate-y-0"
      }`}
    >
      <CardContent className="p-0">
        {/* Header Section */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 border-b">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-1">
              <h3 className="font-bold text-lg text-gray-800">
                #{index + 1}{" "}
                <span className="text-blue-600">{transaction.odrId}</span>
              </h3>
              <CopyButton
                text={transaction.odrId}
                tooltipText="Copy Order ID"
                tooltipSide="right"
              />
            </div>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(
                transaction.odrStatus
              )}`}
            >
              {transaction.odrStatus.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-1 text-sm text-gray-600">
            <span>{t("merchantOrderID") || "Merchant Ref ID"}:</span>
            <span className="font-medium">
              {transaction.merchantOrdId || "-"}
            </span>
            {transaction.merchantOrdId && (
              <CopyButton
                text={transaction.merchantOrdId}
                tooltipText="Copy Merchant ID"
                tooltipSide="right"
                size="sm"
                variant="ghost"
              />
            )}
          </div>
        </div>

        {/* Main Content Section - QR Code and Transaction Details */}
        <div className="p-4 flex flex-col md:flex-row gap-4">
          {/* QR Code Section - Left Side */}
          <div data-transaction-id={transaction.$id}>
            <LazyQRCode transaction={transaction} />
          </div>

          {/* Transaction Details Section - Right Side */}
          <div className="flex-1 space-y-4">
            {/* Amount Information */}
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="grid grid-cols-1 gap-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">
                    {t("amount") || "Amount"}:
                  </span>
                  <span className="font-bold text-lg text-green-600">
                    {formatCurrency(transaction.amount)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-600">
                    {t("unpaidAmount") || "Unpaid"}:
                  </span>
                  <span className="font-semibold text-amber-600">
                    {formatCurrency(transaction.unPaidAmount)}
                  </span>
                </div>
              </div>
            </div>

            {/* Reorganized layout with two columns */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Left Column - Bank Information */}
              <div className="space-y-3">
                <div>
                  <div className="mb-3">
                    <MemoizedRandomizeIcons
                      seed={transaction.odrId}
                      size={50}
                      className="text-blue-600"
                    />
                  </div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">
                    {t("bankAccount") || "Bank Account"}
                  </p>
                  <p className="font-medium text-gray-800">
                    {transaction.bankReceiveNumber || "-"}
                  </p>
                </div>

                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">
                    {t("accountName") || "Account Name"}
                  </p>
                  <p className="font-medium text-gray-800">
                    {transaction.bankReceiveOwnerName || "-"}
                  </p>
                </div>
              </div>

              {/* Right Column - Created At, IP, Assigned User */}
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">
                    {t("createdAt") || "Created At"}
                  </p>
                  <p className="font-medium text-gray-800 text-sm">
                    {new Date(transaction.$createdAt).toLocaleString()}
                  </p>
                </div>

                {/* IP Address display */}
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">
                    {t("createdIp") || "IP Address"}
                  </p>
                  <div
                    className={`font-medium text-sm ${
                      transaction.isSuspicious
                        ? "text-red-600"
                        : "text-gray-800"
                    }`}
                  >
                    {transaction.createdIp || "-"}
                    {transaction.isSuspicious && (
                      <span className="ml-2 text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
                        Suspicious
                      </span>
                    )}
                  </div>
                </div>

                {/* Display assigned user */}
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">
                    {t("assignedUser") || "Assigned To"}
                  </p>
                  <div className="font-medium text-sm text-gray-800">
                    {transaction.users ? (
                      <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
                        {typeof transaction.users === "object"
                          ? formatUserDisplay(transaction.users)
                          : transaction.users}
                      </span>
                    ) : (
                      <span className="text-gray-500">Unassigned</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Action buttons for pending transactions */}
        {canUpdateStatus(transaction) && (
          <div className="bg-gray-50 border-t p-4">
            {!showTransactionActions.has(transaction.$id) ? (
              // Show only the toggle button when actions are hidden
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => onToggleTransactionActions(transaction.$id)}
                  className="border-orange-500 text-orange-600 hover:bg-orange-50"
                  size="sm"
                >
                  <AlertTriangle className="mr-2 h-4 w-4" />
                  Validate Payment
                </Button>
              </div>
            ) : (
              // Show full transaction actions when expanded
              <>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-700 flex items-center">
                    <span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
                    Transaction Actions
                  </h4>
                  <Button
                    variant="ghost"
                    onClick={() => onToggleTransactionActions(transaction.$id)}
                    size="sm"
                    className="text-gray-500 hover:text-gray-700"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {updatingTransactions.has(transaction.$id) ? (
                  <div className="flex justify-center py-4">
                    <div className="flex flex-col items-center">
                      <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
                      <p className="mt-2 text-sm text-gray-600">
                        Updating status...
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        placeholder="Enter payment ID"
                        value={paymentIds[transaction.$id] || ""}
                        onChange={(e) =>
                          onPaymentIdChange(transaction.$id, e.target.value)
                        }
                        className="flex-1"
                        disabled={
                          validatingPayment.has(transaction.$id) ||
                          processingPayments.has(transaction.$id)
                        }
                      />
                      <Button
                        variant="outline"
                        onClick={() =>
                          onValidatePaymentId(
                            transaction,
                            paymentIds[transaction.$id] || ""
                          )
                        }
                        className="border-blue-500 text-blue-600 hover:bg-blue-50"
                        size="sm"
                        disabled={
                          validatingPayment.has(transaction.$id) ||
                          processingPayments.has(transaction.$id)
                        }
                      >
                        {validatingPayment.has(transaction.$id) ? (
                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="mr-2 h-4 w-4" />
                        )}
                        {validatingPayment.has(transaction.$id)
                          ? "Validating..."
                          : "Validate"}
                      </Button>
                    </div>

                    {/* Show payment validation status and action buttons */}
                    {paymentValidationResults[transaction.$id] && (
                      <>
                        {validatedTransactions.has(transaction.$id) ? (
                          <div className="text-xs text-white bg-green-500 p-2 rounded flex items-center justify-center mt-2">
                            <Check className="h-3 w-3 mr-1" />
                            {justProcessedTransactions.has(transaction.$id)
                              ? "Payment processed successfully!"
                              : "Payment was previously processed"}
                          </div>
                        ) : paymentValidationResults[transaction.$id]?.error ===
                            0 &&
                          paymentValidationResults[transaction.$id]?.data ? (
                          <div className="mt-3 space-y-3">
                            {/* Payment Info Card */}
                            <div className="bg-white border border-gray-200 rounded-lg p-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="text-lg font-semibold text-gray-900">
                                    {paymentValidationResults[
                                      transaction.$id
                                    ]?.data?.amount?.toLocaleString()}{" "}
                                    VND
                                  </div>
                                  <div className="text-sm text-gray-600">
                                    {paymentValidationResults[transaction.$id]
                                      ?.data?.corresponsiveName && (
                                      <>
                                        from{" "}
                                        {
                                          paymentValidationResults[
                                            transaction.$id
                                          ]?.data?.corresponsiveName
                                        }
                                      </>
                                    )}
                                  </div>
                                </div>
                                <div
                                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                                    paymentValidationResults[transaction.$id]
                                      ?.alreadyProcessed
                                      ? "bg-red-100 text-red-700"
                                      : paymentValidationResults[
                                          transaction.$id
                                        ]?.validation?.isValid
                                      ? "bg-green-100 text-green-700"
                                      : !paymentValidationResults[
                                          transaction.$id
                                        ]?.validation?.isDebitTransaction ||
                                        !paymentValidationResults[
                                          transaction.$id
                                        ]?.validation?.amountMatch
                                      ? "bg-red-100 text-red-700"
                                      : "bg-yellow-100 text-yellow-700"
                                  }`}
                                >
                                  {paymentValidationResults[transaction.$id]
                                    ?.alreadyProcessed
                                    ? "Already Processed"
                                    : paymentValidationResults[transaction.$id]
                                        ?.validation?.isValid
                                    ? "Perfect Match"
                                    : !paymentValidationResults[transaction.$id]
                                        ?.validation?.isDebitTransaction ||
                                      !paymentValidationResults[transaction.$id]
                                        ?.validation?.amountMatch
                                    ? "Invalid Transaction"
                                    : "Needs Review"}
                                </div>
                              </div>
                            </div>

                            {/* Action Buttons */}
                            {paymentValidationResults[transaction.$id]
                              ?.alreadyProcessed ? (
                              <div className="space-y-2">
                                <div className="flex gap-2">
                                  <Button
                                    variant="outline"
                                    onClick={() =>
                                      onResetValidationState(transaction.$id)
                                    }
                                    size="sm"
                                    disabled={processingPayments.has(
                                      transaction.$id
                                    )}
                                    className="w-full"
                                  >
                                    Cancel
                                  </Button>
                                </div>
                                <div className="text-xs text-red-600 bg-red-50 p-2 rounded space-y-1">
                                  <div className="font-semibold">
                                    ❌ PAYMENT ALREADY PROCESSED
                                  </div>
                                  <div>
                                    This payment was already successfully
                                    processed in the system.
                                  </div>
                                  <div className="font-semibold text-red-700 mt-1">
                                    Processing is not allowed for already
                                    processed payments.
                                  </div>
                                </div>
                              </div>
                            ) : paymentValidationResults[transaction.$id]
                                ?.validation?.isValid ? (
                              <Button
                                onClick={() =>
                                  onProcessPayment(
                                    transaction,
                                    paymentIds[transaction.$id] || ""
                                  )
                                }
                                className="w-full bg-green-600 hover:bg-green-700"
                                disabled={processingPayments.has(
                                  transaction.$id
                                )}
                              >
                                {processingPayments.has(transaction.$id) ? (
                                  <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <Check className="mr-2 h-4 w-4" />
                                )}
                                {processingPayments.has(transaction.$id)
                                  ? "Processing..."
                                  : "Process Payment"}
                              </Button>
                            ) : (
                              <div className="space-y-2">
                                {/* Only show Force Process if it's a debit transaction AND amount matches */}
                                {paymentValidationResults[transaction.$id]
                                  ?.validation?.isDebitTransaction &&
                                paymentValidationResults[transaction.$id]
                                  ?.validation?.amountMatch ? (
                                  <>
                                    <div className="flex gap-2">
                                      <Button
                                        onClick={() =>
                                          onProcessPayment(
                                            transaction,
                                            paymentIds[transaction.$id] || ""
                                          )
                                        }
                                        className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold"
                                        disabled={processingPayments.has(
                                          transaction.$id
                                        )}
                                      >
                                        {processingPayments.has(
                                          transaction.$id
                                        ) ? (
                                          <>
                                            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                            Processing...
                                          </>
                                        ) : (
                                          <>
                                            <AlertTriangle className="mr-2 h-4 w-4" />
                                            Force Process
                                          </>
                                        )}
                                      </Button>
                                      <Button
                                        variant="outline"
                                        onClick={() =>
                                          onResetValidationState(
                                            transaction.$id
                                          )
                                        }
                                        disabled={processingPayments.has(
                                          transaction.$id
                                        )}
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                    <div className="text-xs text-yellow-700 bg-yellow-50 p-2 rounded space-y-1">
                                      <div>⚠️ Validation Issues Detected:</div>
                                      {!paymentValidationResults[
                                        transaction.$id
                                      ]?.validation?.orderIdMatch && (
                                        <div>• Order ID mismatch</div>
                                      )}
                                      <div className="mt-1 font-medium">
                                        Use &quot;Force Process&quot; only if
                                        you&apos;re certain this payment belongs
                                        to this order.
                                      </div>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="flex gap-2">
                                      <Button
                                        variant="outline"
                                        onClick={() =>
                                          onResetValidationState(
                                            transaction.$id
                                          )
                                        }
                                        disabled={processingPayments.has(
                                          transaction.$id
                                        )}
                                        className="w-full"
                                      >
                                        Cancel
                                      </Button>
                                    </div>
                                    <div className="text-xs text-red-600 bg-red-50 p-2 rounded space-y-1">
                                      <div className="font-semibold">
                                        ❌ INVALID TRANSACTION
                                      </div>
                                      {!paymentValidationResults[
                                        transaction.$id
                                      ]?.validation?.isDebitTransaction && (
                                        <div>
                                          • Not a debit transaction (withdraw
                                          orders must have negative amounts)
                                        </div>
                                      )}
                                      {!paymentValidationResults[
                                        transaction.$id
                                      ]?.validation?.amountMatch && (
                                        <div>
                                          • Amount mismatch: Expected{" "}
                                          {paymentValidationResults[
                                            transaction.$id
                                          ]?.validation?.expectedAmount?.toLocaleString()}{" "}
                                          VND, Found{" "}
                                          {paymentValidationResults[
                                            transaction.$id
                                          ]?.validation?.actualAmount?.toLocaleString()}{" "}
                                          VND
                                        </div>
                                      )}
                                      <div className="font-semibold text-red-700 mt-1">
                                        Processing is not allowed for invalid
                                        transactions.
                                      </div>
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        ) : null}
                      </>
                    )}

                    {/* Add back the Mark as Failed button */}
                    <Button
                      variant="destructive"
                      onClick={() => onStatusUpdate(transaction, "failed")}
                      className="light-btn"
                      size="sm"
                      disabled={
                        validatingPayment.has(transaction.$id) ||
                        processingPayments.has(transaction.$id)
                      }
                    >
                      <X className="mr-2 h-4 w-4" />
                      Mark as Failed
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default memo(TransactionCard);
