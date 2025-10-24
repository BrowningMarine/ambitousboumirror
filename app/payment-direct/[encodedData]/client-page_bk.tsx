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
import type { PaymentData } from "@/lib/payment-encoder";
import { generateClientQR } from "@/lib/client-qr-generator";
import { subscribeToOrderChanges, fetchOrderStatus } from "@/lib/supabase-client";
import { BackupOrder } from "@/lib/supabase-backup";

// Define TypeScript interfaces
interface ApiResponse {
  success: boolean;
  message?: string;
  data?: PaymentData;
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
      const link = document.createElement('a');
      link.href = qrCodeData;
      link.download = `QR_${orderId}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      // For URL data, fetch and download
      fetch(qrCodeData)
        .then(response => response.blob())
        .then(blob => {
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `QR_${orderId}.png`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
        })
        .catch(error => {
          console.error('Failed to download QR code:', error);
          alert('Không thể tải xuống QR code. Vui lòng thử lại.');
        });
    }
  } catch (error) {
    console.error('Error downloading QR code:', error);
    alert('Không thể tải xuống QR code. Vui lòng thử lại.');
  }
}

export default function ClientOnlyPaymentPage({
  initialData,
  encodedData, // eslint-disable-line @typescript-eslint/no-unused-vars
}: {
  initialData: ApiResponse;
  encodedData: string;
}) {
  // Memoize initial error state
  const error = useMemo(
    () =>
      !initialData.success
        ? initialData.message || "Tải dữ liệu đơn hàng thất bại"
        : null,
    [initialData.success, initialData.message]
  );

  // Payment data from initial data - now with realtime updates
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
  const [generatedQR, setGeneratedQR] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);

  // Use ref for subscription to avoid state updates and re-renders
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Track if we're on the client side to prevent hydration mismatch
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Fetch current order status from database on mount
  useEffect(() => {
    if (!paymentData?.odrId) return;

    const orderId = paymentData.odrId;
    const currentStatus = paymentData.odrStatus;
    const timestamp = paymentData.timestamp;

    console.log('📥 [Payment-Direct] Fetching current status for order:', orderId);
    
    fetchOrderStatus(orderId).then((dbStatus) => {
      if (dbStatus) {
        console.log('✅ [Payment-Direct] Current status from DB:', dbStatus.odr_status);
        
        // Update payment data with current status from database
        if (dbStatus.odr_status !== currentStatus) {
          setPaymentData((prevData) => {
            if (!prevData) return null;
            return {
              ...prevData,
              odrStatus: dbStatus.odr_status,
            };
          });

          // Update effective status based on current database status
          setEffectiveStatus(getEffectivePaymentStatus(
            dbStatus.odr_status,
            timestamp
          ));
        }
      }
    }).catch((error) => {
      console.error('❌ [Payment-Direct] Failed to fetch current status:', error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentData?.odrId]); // Only run once when order ID is available

  // Set up Supabase realtime subscription for order status updates
  useEffect(() => {
    // Only subscribe if we have payment data and it's in processing/pending status
    if (
      paymentData?.odrId &&
      (paymentData.odrStatus === "processing" || paymentData.odrStatus === "pending") &&
      !unsubscribeRef.current
    ) {
      console.log('🔔 [Payment-Direct] Subscribing to Supabase realtime for order:', paymentData.odrId);
      
      // Subscribe to Supabase realtime for this order
      const unsubscribe = subscribeToOrderChanges(
        paymentData.odrId,
        (updatedOrder: BackupOrder) => {
          console.log('✅ [Payment-Direct] Received realtime update:', updatedOrder);
          
          // Order status changed in Supabase
          if (updatedOrder.odr_status !== paymentData.odrStatus) {
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
        },
        (error) => {
          console.error('❌ [Payment-Direct] Supabase realtime error:', error);
        }
      );

      unsubscribeRef.current = unsubscribe;
    }
    // If payment is no longer processing/pending but we have an active subscription, unsubscribe
    else if (
      paymentData?.odrStatus !== "processing" &&
      paymentData?.odrStatus !== "pending" &&
      unsubscribeRef.current
    ) {
      console.log('🔕 [Payment-Direct] Unsubscribing from realtime (status changed)');
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    // Clean up subscription when component unmounts
    return () => {
      if (unsubscribeRef.current) {
        console.log('🔕 [Payment-Direct] Unsubscribing from realtime (unmount)');
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [paymentData?.odrId, paymentData?.odrStatus]);

  // Optimized countdown timer using the utility function
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;

    if (paymentData?.odrStatus === "processing" && paymentData.timestamp) {
      // Initial calculation to make sure we're in sync
      const { secondsLeft } = calculatePaymentTimeRemaining(
        paymentData.timestamp
      );
      setTimeLeft(secondsLeft);

      // If already expired, update the status
      if (secondsLeft <= 0) {
        setEffectiveStatus("expired");
        return; // Don't set up timer if already expired
      }

      timer = setInterval(() => {
        const { secondsLeft, isExpired } = calculatePaymentTimeRemaining(
          paymentData.timestamp
        );
        setTimeLeft(secondsLeft);

        // Check if payment just expired
        if (isExpired) {
          if (timer) {
            clearInterval(timer);
          }
          setEffectiveStatus("expired");
        }
      }, 1000);
    }

    return () => {
      if (timer) {
        clearInterval(timer);
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
    return new Intl.NumberFormat("vi-VN", {
      style: "decimal",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(paymentData.amount) + " VND";
  }, [paymentData]);

  // Memoize formatted timestamp
  // Use consistent formatting between server and client to avoid hydration errors
  const formattedTimestamp = useMemo(() => {
    if (!paymentData) return "";
    // Always use the same formatting approach
    return formatDateTime(paymentData.timestamp, "vi-VN").dateTime;
  }, [paymentData]);

  // Generate QR code using QRLocal-compatible client-side generator
  useEffect(() => {
    // Only generate QR if we don't have one from server and we have bank info
    if (!paymentData?.qrCode && paymentData?.bankBinCode && paymentData?.accountNumber && isClient) {
      setQrLoading(true);
      
      generateClientQR({
        bankBin: paymentData.bankBinCode,
        accountNumber: paymentData.accountNumber,
        amount: Math.floor(paymentData.amount),
        orderId: paymentData.odrId
      })
        .then(result => {
          if (result.success && result.qrDataURL) {
            setGeneratedQR(result.qrDataURL);
          } else {
            console.error('QR generation failed:', result.message);
          }
        })
        .catch(error => {
          console.error('QR generation error:', error);
        })
        .finally(() => {
          setQrLoading(false);
        });
    }
  }, [paymentData, isClient]);

  // Use the generated QR or the one from server
  const qrCodeUrl = useMemo(() => {
    if (!paymentData) return null;
    
    // If QR code is provided from server, use it
    if (paymentData.qrCode) {
      return paymentData.qrCode;
    }
    
    // Use client-generated QR
    if (generatedQR) {
      return generatedQR;
    }
    
    // Fallback to VietQR URL if generation is in progress or failed
    if (paymentData.bankBinCode && paymentData.accountNumber) {
      const qrTemplate = appConfig.qrTemplateCode;
      return `https://img.vietqr.io/image/${paymentData.bankBinCode}-${paymentData.accountNumber}-${qrTemplate}.png?amount=${Math.floor(paymentData.amount)}&addInfo=${encodeURIComponent(paymentData.odrId)}&accountName=${encodeURIComponent(paymentData.accountName || '')}`;
    }
    
    return null;
  }, [paymentData, generatedQR]);

  // Use merchant logo from appConfig if not provided
  const merchantLogo = useMemo(() => {
    if (!paymentData) return appConfig.icon;
    return paymentData.merchantLogoUrl || appConfig.icon;
  }, [paymentData]);

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
  if (effectiveStatus === "expired") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Logo and Header */}
          <div className="bg-gradient-to-r from-red-600 to-red-800 px-6 py-6 text-white text-center">
            <div className="mb-2">
              <Image
                src={merchantLogo}
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
          <div className="bg-gradient-to-r from-green-600 to-green-800 px-6 py-6 text-white text-center">
            <div className="mb-2">
              <Image
                src={merchantLogo}
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
              <p className="text-gray-800 font-medium">{formattedAmount}</p>

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
          <div className="bg-gradient-to-r from-red-600 to-red-800 px-6 py-6 text-white text-center">
            <div className="mb-2">
              <Image
                src={merchantLogo}
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
              <p className="text-gray-800 font-medium">{formattedAmount}</p>
            </div>
          </div>

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
                src={merchantLogo}
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
              <p className="text-gray-800 font-medium">{formattedAmount}</p>
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
      {/* Status Change Notification */}
      {statusChanged && statusMessage && (
        <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in">
          <div className="bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2">
            <svg
              className="w-6 h-6"
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
            <span>{statusMessage}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-100 p-4">
        <div className="w-full max-w-md bg-white rounded-xl shadow-lg overflow-hidden">
          {/* Logo and Header */}
          <div className="bg-gradient-to-r from-blue-600 to-blue-800 px-6 py-6 text-white text-center">
            <div className="mb-2">
              <Image
                src={merchantLogo}
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
                {formattedAmount}
              </p>
              <p className="text-sm text-gray-500 mt-2">
                Ngày tạo: {formattedTimestamp}
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
                      copyToClipboard(paymentData.accountName!, "name")
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
                    copyToClipboard(paymentData.accountNumber!, "number")
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
          {(qrCodeUrl || qrLoading) && (
            <div className="px-6 py-4 border-t border-gray-100 text-center">
              <h2 className="font-bold text-lg mb-3 text-gray-800">
                Mã QR thanh toán
              </h2>
              <p className="text-sm text-gray-600 mb-4">
                Scan mã QR này bằng app banking điện thoại
              </p>

              <div className="flex justify-center">
                <div className="border-2 border-gray-200 p-2 rounded-lg bg-white inline-block">
                  {qrLoading ? (
                    <div className="w-[200px] h-[200px] flex items-center justify-center">
                      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
                    </div>
                  ) : qrCodeUrl ? (
                    <Image
                      src={qrCodeUrl}
                      alt="Payment QR Code"
                      width={200}
                      height={200}
                      className="mx-auto"
                      priority
                    />
                  ) : null}
                </div>
              </div>

              {/* Download QR Button */}
              {qrCodeUrl && !qrLoading && (
                <div className="mt-4">
                  <button
                    onClick={() => downloadQRCode(qrCodeUrl, paymentData.odrId)}
                    className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors duration-200 flex items-center gap-2 mx-auto"
                  >
                    <Download className="w-4 h-4" />
                    Tải xuống
                  </button>
                </div>
              )}
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
              {/* <li className="text-yellow-600 font-bold">
                ⚠️ Trang này hoạt động độc lập và không cập nhật trạng thái thanh toán tự động. 
                Vui lòng kiểm tra email hoặc thông báo callback từ hệ thống.
              </li> */}
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
