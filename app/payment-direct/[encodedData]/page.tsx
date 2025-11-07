import { Suspense } from "react";
import ClientOnlyPaymentPage from "./client-page";
import Loading from "./loading";
import { decryptPaymentData, validatePaymentDataAge } from "@/lib/payment-encoder";

// Disable Next.js caching for this dynamic route
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Server component - decrypt and validate quickly
async function PaymentPageContent({ params }: { params: { encodedData: string } }) {
  const { encodedData } = await params;

  try {
    // Quick decryption (no async operations)
    const paymentData = decryptPaymentData(encodedData);
    
    // Quick validation (no async operations)
    const isValid = validatePaymentDataAge(paymentData, 86400);
    
    if (!isValid) {
      return (
        <ClientOnlyPaymentPage
          initialData={{
            success: false,
            message: 'Liên kết thanh toán đã hết hạn (quá 24 giờ). Vui lòng tạo đơn hàng mới.'
          }}
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
      />
    );

  } catch {
    // No logging - just return error fast
    return (
      <ClientOnlyPaymentPage
        initialData={{
          success: false,
          message: 'Liên kết thanh toán không hợp lệ. Vui lòng kiểm tra lại đường dẫn.'
        }}
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