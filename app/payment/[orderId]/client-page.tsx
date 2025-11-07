"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Image from "next/image";
import { Download } from "lucide-react";
import { appConfig } from "@/lib/appconfig";
import {
  calculatePaymentTimeRemaining,
  formatDateTime,
  getEffectivePaymentStatus,
} from "@/lib/utils";
import { subscribeToCollection } from "@/lib/client/appwriteSubcriptions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import {
  subscribeToOrderChanges,
  fetchOrderStatus,
} from "@/lib/client/supabase-client"; // CLIENT-SIDE module
import { BackupOrder } from "@/lib/supabase-backup"; // Type only

// Define TypeScript interfaces
interface PaymentData {
  odrId: string;
  merchantOrdId?: string;
  odrStatus: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
  amount: number;
  timestamp: string;
  qrCode: string | null; // Either direct URL or base64 image data
  urlSuccess?: string;
  urlFailed?: string;
  urlCanceled?: string;
  urlCallBack?: string;
  merchantName?: string;
  merchantlogoUrl?: string;
}

interface ApiResponse {
  success: boolean;
  message?: string;
  data?: PaymentData;
  clientOnlyMode?: boolean; // Flag to indicate Supabase realtime should be used
}

interface TransactionDocument {
  $id?: string;
  odrId: string;
  odrStatus: string;
  urlSuccess?: string;
  urlFailed?: string;
  urlCanceled?: string;
}

// Helper function to detect if QR code is base64 data
function isBase64Image(str: string): boolean {
  // Check if it starts with data URL format
  if (str.startsWith("data:image/")) {
    return true;
  }

  // Check if it's a URL (starts with http/https)
  if (str.startsWith("http://") || str.startsWith("https://")) {
    return false;
  }

  // For other cases, check if it looks like base64 (long string with base64 characters)
  return str.length > 100 && /^[A-Za-z0-9+/]+=*$/.test(str);
}

// Helper function to download QR code as image
function downloadQRCode(qrCodeData: string, orderId: string): void {
  try {
    if (isBase64Image(qrCodeData)) {
      // For base64 data, create a download link
      const link = document.createElement("a");
      link.href = qrCodeData;
      link.download = `QR_${orderId}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      // For URL data, fetch and download
      fetch(qrCodeData)
        .then((response) => response.blob())
        .then((blob) => {
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `QR_${orderId}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
        })
        .catch((error) => {
          console.error("Failed to download QR code:", error);
          alert("Không thể tải xuống QR code. Vui lòng thử lại.");
        });
    }
  } catch (error) {
    console.error("Error downloading QR code:", error);
    alert("Không thể tải xuống QR code. Vui lòng thử lại.");
  }
}

export default function ClientPaymentPage({
  initialData,
  orderId,
}: {
  initialData: ApiResponse;
  orderId: string;
}) {
  // Memoize initial error state
  const error = useMemo(
    () =>
      !initialData.success
        ? initialData.message || "Tải dữ liệu đơn hàng thất bại"
        : null,
    [initialData.success, initialData.message]
  );

  // Payment data from initial data
  const [paymentData, setPaymentData] = useState<PaymentData | null>(
    initialData.success && initialData.data ? initialData.data : null
  );

  // Initialize effective status using the utility function - memoized
  const [effectiveStatus, setEffectiveStatus] = useState<string>(() => {
    if (initialData.success && initialData.data) {
      return getEffectivePaymentStatus(
        initialData.data.odrStatus,
        initialData.data.timestamp
      );
    }
    return "processing";
  });

  // Set initial time left using the utility function - memoized
  const [timeLeft, setTimeLeft] = useState<number>(() => {
    if (initialData.success && initialData.data && initialData.data.timestamp) {
      const { secondsLeft } = calculatePaymentTimeRemaining(
        initialData.data.timestamp
      );
      return secondsLeft;
    }
    return 0;
  });

  const [copySuccess, setCopySuccess] = useState<string | null>(null);
  const [statusChanged, setStatusChanged] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  // Use ref for subscription to avoid state updates and re-renders
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Optimized subscription handler with useCallback
  const handleTransactionUpdate = useCallback(
    (updatedTransaction: TransactionDocument) => {
      // Check if this is our order
      if (updatedTransaction.odrId === orderId) {
        // Payment status has updated
        if (updatedTransaction.odrStatus !== paymentData?.odrStatus) {
          // Update our state with new status
          setPaymentData((prevData) => {
            if (!prevData) return null;

            return {
              ...prevData,
              odrStatus: updatedTransaction.odrStatus,
            };
          });

          // If the status was changed to pending, we should still show as expired
          // since the original timestamp is old
          if (updatedTransaction.odrStatus === "pending") {
            // Keep the effective status as expired
            setEffectiveStatus("expired");
          } else {
            // For other status changes, use the actual status
            setEffectiveStatus(updatedTransaction.odrStatus);
          }

          // Set notification based on new status
          setStatusChanged(true);

          if (updatedTransaction.odrStatus === "completed") {
            setStatusMessage("Thanh toán đã hoàn thành thành công!");
          } else if (updatedTransaction.odrStatus === "failed") {
            setStatusMessage("Thanh toán đã thất bại. Vui lòng thử lại.");
          } else if (updatedTransaction.odrStatus === "canceled") {
            setStatusMessage("Thanh toán đã bị hủy.");
          } else if (updatedTransaction.odrStatus === "pending") {
            setStatusMessage(
              "Đơn hàng đã được cập nhật, nhưng đã hết thời gian thanh toán."
            );
          }
        }
      }
    },
    [orderId, paymentData?.odrStatus]
  );

  // Set up or tear down real-time subscription based on payment status
  useEffect(() => {
    // Only set up subscription if payment is in processing status
    if (
      (paymentData?.odrStatus === "processing" ||
        paymentData?.odrStatus === "pending") &&
      orderId &&
      !unsubscribeRef.current
    ) {
      // Check if we should use Supabase realtime (client-only mode)
      if (initialData.clientOnlyMode) {
        // Subscribe to Supabase realtime for this order
        const unsubscribe = subscribeToOrderChanges(
          orderId,
          (updatedOrder: BackupOrder) => {
            // Order status changed in Supabase
            if (updatedOrder.odr_status !== paymentData?.odrStatus) {
              setPaymentData((prevData) => {
                if (!prevData) return null;

                return {
                  ...prevData,
                  odrStatus: updatedOrder.odr_status,
                };
              });

              // Update effective status
              if (updatedOrder.odr_status === "pending") {
                setEffectiveStatus("expired");
              } else {
                setEffectiveStatus(updatedOrder.odr_status);
              }

              // Set notification based on new status
              setStatusChanged(true);

              if (updatedOrder.odr_status === "completed") {
                setStatusMessage("Thanh toán đã hoàn thành thành công!");
              } else if (updatedOrder.odr_status === "failed") {
                setStatusMessage("Thanh toán đã thất bại. Vui lòng thử lại.");
              } else if (updatedOrder.odr_status === "canceled") {
                setStatusMessage("Thanh toán đã bị hủy.");
              } else if (updatedOrder.odr_status === "pending") {
                setStatusMessage(
                  "Đơn hàng đã được cập nhật, nhưng đã hết thời gian thanh toán."
                );
              }
            }
          }
        );

        unsubscribeRef.current = unsubscribe;
      } else {
        // Subscribe to Appwrite realtime (normal mode)
        const unsubscribe = subscribeToCollection<TransactionDocument>(
          appwriteConfig.databaseId,
          appwriteConfig.odrtransCollectionId,
          undefined,
          handleTransactionUpdate,
          undefined
        );

        unsubscribeRef.current = unsubscribe;
      }
    }
    // If payment is no longer processing/pending but we have an active subscription, unsubscribe
    else if (
      paymentData?.odrStatus !== "processing" &&
      paymentData?.odrStatus !== "pending" &&
      unsubscribeRef.current
    ) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    // Clean up subscription when component unmounts
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [
    orderId,
    paymentData?.odrStatus,
    handleTransactionUpdate,
    initialData.clientOnlyMode,
  ]);

  // Track if we're on the client side to prevent hydration mismatch
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Fetch current order status from Supabase if in client-only mode
  useEffect(() => {
    if (!initialData.clientOnlyMode || !orderId || !paymentData) return;

    console.log("📥 [Payment] Fetching current status for order:", orderId);

    fetchOrderStatus(orderId)
      .then((currentStatus) => {
        if (currentStatus) {
          console.log(
            "✅ [Payment] Current status from DB:",
            currentStatus.odr_status
          );

          // Update payment data with current status from database
          if (currentStatus.odr_status !== paymentData.odrStatus) {
            setPaymentData((prevData) => {
              if (!prevData) return null;
              return {
                ...prevData,
                odrStatus: currentStatus.odr_status,
              };
            });

            // Update effective status based on current database status
            setEffectiveStatus(
              getEffectivePaymentStatus(
                currentStatus.odr_status,
                paymentData.timestamp
              )
            );
          }
        }
      })
      .catch((error) => {
        console.error("❌ [Payment] Failed to fetch current status:", error);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, initialData.clientOnlyMode]); // Run when order ID or mode changes

  // Reset state when orderId or initialData changes (navigation between different orders)
  useEffect(() => {
    if (initialData.success && initialData.data) {
      setPaymentData(initialData.data);
      setEffectiveStatus(
        getEffectivePaymentStatus(
          initialData.data.odrStatus,
          initialData.data.timestamp
        )
      );

      if (initialData.data.timestamp) {
        const { secondsLeft } = calculatePaymentTimeRemaining(
          initialData.data.timestamp
        );
        setTimeLeft(secondsLeft);
      } else {
        setTimeLeft(0);
      }

      // Reset notification states
      setStatusChanged(false);
      setStatusMessage(null);
      setCopySuccess(null);
    } else {
      setPaymentData(null);
      setEffectiveStatus("processing");
      setTimeLeft(0);
      setStatusChanged(false);
      setStatusMessage(null);
      setCopySuccess(null);
    }
  }, [orderId, initialData]);

  // Optimized countdown timer using the utility function
  useEffect(() => {
    // Clear any existing timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (paymentData?.odrStatus === "processing" && paymentData.timestamp) {
      // Initial calculation to make sure we're in sync
      const { secondsLeft } = calculatePaymentTimeRemaining(
        paymentData.timestamp
      );
      setTimeLeft(secondsLeft);

      // If already expired, update the status to expired
      // (only if still in processing - completed/failed orders should keep their status)
      if (secondsLeft <= 0) {
        setEffectiveStatus("expired");
        return; // Don't set up timer if already expired
      }

      timerRef.current = setInterval(() => {
        const { secondsLeft, isExpired } = calculatePaymentTimeRemaining(
          paymentData.timestamp
        );
        setTimeLeft(secondsLeft);

        // Check if payment just expired
        if (isExpired) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          setEffectiveStatus("expired");
        }
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [paymentData?.odrStatus, paymentData?.timestamp]);

  // Optimized copy function with useCallback
  const copyToClipboard = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopySuccess(field);
    setTimeout(() => setCopySuccess(null), 2000);
  }, []);

  // Memoized format time left as MM:SS
  const formatTimeLeft = useMemo(() => {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds
      .toString()
      .padStart(2, "0")}`;
  }, [timeLeft]);

  // Memoize formatted amount to prevent recalculation
  // Use consistent formatting between server and client to avoid hydration errors
  const formattedAmount = useMemo(() => {
    if (!paymentData) return "";
    // Always use vi-VN locale for consistent formatting
    return (
      new Intl.NumberFormat("vi-VN", {
        style: "decimal",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(paymentData.amount) + " VND"
    );
  }, [paymentData]);

  // Memoize formatted timestamp
  // Use consistent formatting between server and client to avoid hydration errors
  const formattedTimestamp = useMemo(() => {
    if (!paymentData) return "";
    // Always use the same formatting approach
    return formatDateTime(paymentData.timestamp, "vi-VN").dateTime;
  }, [paymentData]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Clean up subscription
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      // Clean up timer
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // Handle error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-lg">
          <div className="text-center mb-6">
            <svg
              className="mx-auto h-16 w-16 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h1 className="mt-4 text-2xl font-bold text-red-600">Lỗi!!!</h1>
          </div>
          <p className="text-gray-700 text-center mb-6">{error}</p>
          <div className="text-center">
            <button
              className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 shadow-md transition duration-200"
              onClick={() => window.location.reload()}
            >
              Hãy thử lại
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!paymentData) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-lg">
          <div className="text-center mb-6">
            <svg
              className="mx-auto h-16 w-16 text-yellow-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <h1 className="mt-4 text-2xl font-bold text-yellow-600">
              Không có thông tin thanh toán!!!
            </h1>
          </div>
          <p className="text-gray-700 text-center">
            Không tìm thấy thông tin đơn hàng.
          </p>
        </div>
      </div>
    );
  }

  // Special case for expired payments
  //console.log('effectiveStatus', effectiveStatus);
  if (effectiveStatus === "expired") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Logo and Header */}
          <div className="bg-gradient-to-r from-red-600 to-red-800 px-6 py-6 text-white text-center">
            <div className="mb-2">
              <Image
                src={paymentData.merchantlogoUrl || appConfig.icon}
                alt="Payment Logo"
                width={200}
                height={100}
                style={{ width: "auto", height: "auto" }}
                className="mx-auto"
                priority
              />
            </div>
            <h1 className="text-2xl font-bold">Thanh toán hết hạn!!!</h1>
          </div>

          {/* Expired Content */}
          <div className="px-6 py-8 text-center">
            <svg
              className="mx-auto h-20 w-20 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>

            <h2 className="mt-4 text-xl font-bold text-gray-800">
              Đơn đã quá hạn!
            </h2>
            <p className="mt-2 text-gray-600">
              Thông tin thanh toán cho đơn này đã kết thúc.
            </p>

            <div className="mt-2 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">Mã đơn hàng</p>
              <p className="text-gray-800 font-medium">{paymentData.odrId}</p>

              <p className="mt-3 text-sm text-gray-500">Số tiền</p>
              <p className="text-gray-800 font-medium">{formattedAmount}</p>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-3 bg-gray-100 text-center text-xs text-gray-500">
            <p>© 2025 {paymentData.merchantName} | Protected and Encrypted</p>
          </div>
        </div>
      </div>
    );
  }

  // Then check actual payment status
  if (paymentData.odrStatus === "completed") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Completed UI content... */}
          <div className="bg-gradient-to-r from-green-600 to-green-800 px-6 py-6 text-white text-center">
            <div className="mb-2">
              <Image
                src={paymentData.merchantlogoUrl || appConfig.icon}
                alt="Payment Logo"
                width={200}
                height={100}
                style={{ width: "auto", height: "auto" }}
                className="mx-auto"
                priority
              />
            </div>
            <h1 className="text-2xl font-bold">Thanh toán thành công!!!</h1>
          </div>

          {/* Completed Content */}
          <div className="px-6 py-8 text-center">
            <svg
              className="mx-auto h-20 w-20 text-green-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>

            <h2 className="mt-4 text-xl font-bold text-gray-800">
              Đơn đã được thanh toán!
            </h2>
            <p className="mt-2 text-gray-600">
              Cảm ơn bạn đã hoàn tất thanh toán.
            </p>

            <div className="mt-2 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">Mã đơn hàng</p>
              <p className="text-gray-800 font-medium">{paymentData.odrId}</p>

              <p className="mt-3 text-sm text-gray-500">Số tiền</p>
              <p className="text-gray-800 font-medium">
                {new Intl.NumberFormat("vi-VN", {
                  style: "currency",
                  currency: "VND",
                }).format(paymentData.amount)}
              </p>

              <p className="mt-3 text-sm text-gray-500">Thời gian thanh toán</p>
              <p className="text-gray-800 font-medium">{formattedTimestamp}</p>
            </div>

            {paymentData.urlSuccess && (
              <div className="mt-6">
                <button
                  onClick={() =>
                    (window.location.href = paymentData.urlSuccess as string)
                  }
                  className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 shadow-md transition duration-200"
                >
                  Quay lại trang mua hàng
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 bg-gray-100 text-center text-xs text-gray-500">
            <p>© 2025 {paymentData.merchantName} | Protected and Encrypted</p>
          </div>
        </div>
      </div>
    );
  }

  // Special UI for failed payments
  if (paymentData.odrStatus === "failed") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Failed UI content... */}
          <div className="bg-gradient-to-r from-red-600 to-red-800 px-6 py-6 text-white text-center">
            <div className="mb-2">
              <Image
                src={paymentData.merchantlogoUrl || appConfig.icon}
                alt="Payment Logo"
                width={200}
                height={100}
                style={{ width: "auto", height: "auto" }}
                className="mx-auto"
                priority
              />
            </div>
            <h1 className="text-2xl font-bold">Thanh toán thất bại!!!</h1>
          </div>

          {/* Failed Content */}
          <div className="px-6 py-8 text-center">
            <svg
              className="mx-auto h-20 w-20 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>

            <h2 className="mt-4 text-xl font-bold text-gray-800">
              Thanh toán không thành công!
            </h2>
            <p className="mt-2 text-gray-600">
              Đã xảy ra lỗi trong quá trình thanh toán.
            </p>

            <div className="mt-2 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">Mã đơn hàng</p>
              <p className="text-gray-800 font-medium">{paymentData.odrId}</p>

              <p className="mt-3 text-sm text-gray-500">Số tiền</p>
              <p className="text-gray-800 font-medium">
                {new Intl.NumberFormat("vi-VN", {
                  style: "currency",
                  currency: "VND",
                }).format(paymentData.amount)}
              </p>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-3 bg-gray-100 text-center text-xs text-gray-500">
            <p>© 2025 {paymentData.merchantName} | Protected and Encrypted</p>
          </div>
        </div>
      </div>
    );
  }

  if (paymentData.odrStatus === "canceled") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-lg overflow-hidden">
          <div className="bg-gradient-to-r from-yellow-500 to-yellow-700 px-6 py-6 text-white text-center">
            <div className="mb-2">
              <Image
                src={paymentData.merchantlogoUrl || appConfig.icon}
                alt="Payment Logo"
                width={200}
                height={100}
                style={{ width: "auto", height: "auto" }}
                className="mx-auto"
                priority
              />
            </div>
            <h1 className="text-2xl font-bold">Thanh toán đã bị hủy!!!</h1>
          </div>

          <div className="px-6 py-8 text-center">
            <svg
              className="mx-auto h-20 w-20 text-yellow-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>

            <h2 className="mt-4 text-xl font-bold text-gray-800">
              Đơn hàng đã bị hủy!
            </h2>
            <p className="mt-2 text-gray-600">Đơn hàng này đã bị hủy.</p>

            <div className="mt-2 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-500">Mã đơn hàng</p>
              <p className="text-gray-800 font-medium">{paymentData.odrId}</p>

              <p className="mt-3 text-sm text-gray-500">Số tiền</p>
              <p className="text-gray-800 font-medium">
                {new Intl.NumberFormat("vi-VN", {
                  style: "currency",
                  currency: "VND",
                }).format(paymentData.amount)}
              </p>
            </div>
          </div>

          <div className="px-6 py-3 bg-gray-100 text-center text-xs text-gray-500">
            <p>© 2025 {paymentData.merchantName} | Protected and Encrypted</p>
          </div>
        </div>
      </div>
    );
  }

  // Normal payment page for processing payments
  return (
    <>
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
        {/* Status notification when status changes */}
        {statusChanged && statusMessage && (
          <div
            className={`w-full max-w-md mb-4 p-4 rounded-lg ${
              paymentData.odrStatus === "completed"
                ? "bg-green-100 border border-green-400 text-green-700"
                : paymentData.odrStatus === "failed"
                ? "bg-red-100 border border-red-400 text-red-700"
                : "bg-yellow-100 border border-yellow-400 text-yellow-700"
            }`}
          >
            <div className="flex items-center">
              {paymentData.odrStatus === "completed" ? (
                <svg
                  className="w-5 h-5 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M5 13l4 4L19 7"
                  ></path>
                </svg>
              ) : (
                <svg
                  className="w-5 h-5 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  ></path>
                </svg>
              )}
              <p className="font-medium">{statusMessage}</p>
            </div>
          </div>
        )}

        <div className="w-full max-w-md bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Logo and Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-800 px-6 py-6 text-white text-center">
            <div className="mb-2">
              <Image
                src={paymentData.merchantlogoUrl || appConfig.icon}
                alt="Payment Logo"
                width={200}
                height={100}
                style={{ width: "auto", height: "auto" }}
                className="mx-auto"
                priority
              />
            </div>
            {/* Timer for processing payments */}
            <div className="mt-3 bg-white bg-opacity-20 rounded-lg p-3 inline-block">
              <p className="text-sm">Thời gian còn lại:</p>
              <p className="text-2xl font-bold">
                {isClient ? formatTimeLeft : "--:--"}
              </p>
            </div>
          </div>

          {/* Status Badge */}
          <div className="relative px-6 py-4">
            <div className="absolute -top-5 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded-full font-bold text-sm bg-yellow-500 text-white">
              PROCESSING
            </div>
          </div>

          {/* Amount */}
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50">
            <div className="text-center">
              <p className="text-gray-500">Số tiền</p>
              <p className="text-3xl font-bold text-gray-800 mt-1">
                {isClient
                  ? new Intl.NumberFormat("vi-VN", {
                      style: "currency",
                      currency: "VND",
                    }).format(paymentData.amount)
                  : `${paymentData.amount.toLocaleString()} VND`}
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Ngày tạo:{" "}
                {isClient
                  ? formatDateTime(paymentData.timestamp, "vi-VN").dateTime
                  : new Date(paymentData.timestamp).toISOString().split("T")[0]}
              </p>
            </div>
          </div>

          {/* Bank Information */}
          <div className="px-6 py-4 border-t border-gray-100">
            <h2 className="font-bold text-lg mb-4 text-gray-800">
              Thông tin chuyển khoản
            </h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Ngân hàng</p>
                <p className="font-medium text-gray-800">
                  {paymentData.bankName}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-500">Tên chủ tài khoản</p>
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-800">
                    {paymentData.accountName}
                  </p>
                  <button
                    onClick={() =>
                      copyToClipboard(paymentData.accountName, "name")
                    }
                    className="text-blue-500 hover:text-blue-700"
                  >
                    {copySuccess === "name" ? (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M5 13l4 4L19 7"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-sm text-gray-500">Số tài khoản</p>
              <div className="flex items-center mt-1">
                <div className="flex-grow px-4 py-3 bg-gray-100 rounded-lg font-medium text-gray-800">
                  {paymentData.accountNumber}
                </div>
                <button
                  onClick={() =>
                    copyToClipboard(paymentData.accountNumber, "number")
                  }
                  className="ml-2 px-3 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  {copySuccess === "number" ? "Đã sao chép!" : "Sao chép"}
                </button>
              </div>
            </div>
            <div className="mt-4">
              <p className="text-sm text-gray-500">Nội dung thanh toán</p>
              <div className="flex items-center mt-1">
                <div className="flex-grow px-4 py-3 bg-gray-100 rounded-lg font-medium text-gray-800">
                  {paymentData.odrId}
                </div>
                <button
                  onClick={() => copyToClipboard(paymentData.odrId, "text")}
                  className="ml-2 px-3 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
                >
                  {copySuccess === "text" ? "Đã sao chép!" : "Sao chép"}
                </button>
              </div>
            </div>
          </div>

          {/* QR Code */}
          {paymentData.qrCode && (
            <div className="px-6 py-4 border-t border-gray-100 text-center">
              <h2 className="font-bold text-lg mb-3 text-gray-800">
                Mã QR thanh toán
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                Scan mã QR này bằng app banking điện thoại
              </p>

              <div className="flex justify-center">
                <div className="border-2 border-gray-200 p-2 rounded-lg bg-white inline-block">
                  <Image
                    src={paymentData.qrCode}
                    alt="Payment QR Code"
                    width={200}
                    height={200}
                    className="mx-auto"
                    priority
                  />
                </div>
              </div>

              {/* Download QR Button */}
              <div className="mt-4">
                <button
                  onClick={() =>
                    paymentData.qrCode &&
                    downloadQRCode(paymentData.qrCode, paymentData.odrId)
                  }
                  className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors duration-200 flex items-center gap-2 mx-auto"
                >
                  <Download className="w-4 h-4" />
                  Tải xuống
                </button>
              </div>
            </div>
          )}

          {/* Instructions */}
          <div className="px-6 py-4 border-t border-gray-100 bg-blue-50">
            <h3 className="font-bold text-red-500 mb-3">Lưu ý:</h3>
            <ol className="list-decimal list-inside text-sm text-gray-700 space-y-2">
              <li>
                Nếu{" "}
                <span className="font-bold">không thể sử dụng mã QR code</span>{" "}
                vui lòng{" "}
                <span className="font-bold">
                  sao chép tài khoản & nội dung thanh toán.
                </span>
              </li>
              <li>
                Bạn vui lòng{" "}
                <span className="font-bold">kiểm tra kỹ thông tin</span> trước
                khi thực hiện bất kỳ thao tác nào. Chúng tôi{" "}
                <span className="font-bold">không chịu trách nhiệm</span> về
                tính xác thực thông tin chuyển khoản.
              </li>
              <li>
                Trong khi chuyển khoản{" "}
                <span className="font-bold">không làm mới trình duyệt.</span>
              </li>
            </ol>
          </div>

          {/* Footer */}
          <div className="px-6 py-3 bg-gray-100 text-center text-xs text-gray-500">
            <p>© 2025 {paymentData.merchantName} | Protected and Encrypted</p>
          </div>
        </div>
      </div>
    </>
  );
}
