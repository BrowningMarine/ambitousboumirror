import { Suspense } from "react";
import ClientOnlyPaymentPage from "./client-page";
import Loading from "./loading";
import { decryptPaymentData, validatePaymentDataAge } from "@/lib/payment-encoder";
import { log } from "@/lib/logger";

// Disable Next.js caching for this dynamic route
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function PaymentPageContent({ params }: { params: { encodedData: string } }) {
  const { encodedData } = await params;

  try {
    // Decrypt the payment data from URL
    const paymentData = decryptPaymentData(encodedData);
    
    // Validate data age (24 hours max)
    const isValid = validatePaymentDataAge(paymentData, 86400);
    
    if (!isValid) {
      await log.warn('Expired encoded payment data accessed', {
        odrId: paymentData.odrId,
        merchantId: paymentData.merchantId,
        timestamp: paymentData.timestamp
      });
      
      return (
        <ClientOnlyPaymentPage
          initialData={{
            success: false,
            message: 'Liên kết thanh toán đã hết hạn (quá 24 giờ). Vui lòng tạo đơn hàng mới.'
          }}
          encodedData={encodedData}
        />
      );
    }

    return (
      <ClientOnlyPaymentPage
        key={paymentData.odrId}
        initialData={{
          success: true,
          data: paymentData
        }}
        encodedData={encodedData}
      />
    );

  } catch (error) {
    await log.error('Failed to decrypt payment data', error instanceof Error ? error : new Error(String(error)), {
      encodedData: encodedData.substring(0, 50) + '...' // Log only first 50 chars for security
    });

    return (
      <ClientOnlyPaymentPage
        initialData={{
          success: false,
          message: 'Liên kết thanh toán không hợp lệ. Vui lòng kiểm tra lại đường dẫn.'
        }}
        encodedData={encodedData}
      />
    );
  }
}

export default async function PaymentPage({
  params,
}: {
  params: { encodedData: string };
}) {
  const { encodedData } = await params;

  return (
    <Suspense fallback={<Loading />}>
      <PaymentPageContent params={{ encodedData }} />
    </Suspense>
  );
}
