import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { Query } from "appwrite";
import ClientPaymentPage from "./client-page";
import { getAccount } from "@/lib/actions/account.actions";
import { Suspense } from "react";
import Loading from "./loading";
import { DatabaseOptimizer } from "@/lib/database-optimizer";
import { DatabaseQueryOptimizer } from "@/lib/database-query-optimizer";
import { log } from "@/lib/logger";

// Disable Next.js caching for this dynamic route
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Environment variables
const ORDER_TRANS_COLLECTION_ID = appwriteConfig.odrtransCollectionId;
const BANKS_COLLECTION_ID = appwriteConfig.banksCollectionId;

// Interfaces for type safety
interface OrderDocument {
  odrId: string;
  merchantOrdId?: string;
  odrStatus: string;
  odrType: "deposit" | "withdraw";
  bankId: string;
  amount: number;
  $createdAt: string;
  qrCode?: string | null;
  urlSuccess?: string;
  urlFailed?: string;
  urlCanceled?: string;
  urlCallBack?: string;
  bankReceiveNumber?: string;
  bankReceiveOwnerName?: string;
  account?: { publicTransactionId: string };
}

interface BankDocument {
  bankName: string;
  accountNumber: string;
  ownerName: string;
}

interface AccountDocument {
  accountName: string;
  logoUrl: string;
}

async function getPaymentData(orderId: string) {
  const requestStartTime = performance.now();

  // Centralized request tracking - single comprehensive log per request
  const paymentViewLog = {
    timestamp: new Date().toISOString(),
    endpoint: `GET /payment/${orderId}`,
    orderId: orderId,
    request: {
      cacheStrategy: "no-cache",
      useReadReplica: true,
    },
    order: {
      found: false,
      odrType: "",
      odrStatus: "",
      merchantId: "",
      amount: 0,
      source: "", // 'supabase' or 'appwrite'
    },
    queries: {
      orderLookup: { success: false, timeMs: 0 },
      bankInfo: { success: false, timeMs: 0, cached: false },
      accountInfo: { success: false, timeMs: 0, cached: false },
    },
    performance: {
      totalTimeMs: 0,
      orderLookupMs: 0,
      parallelQueriesMs: 0,
    },
    result: {
      success: false,
      message: "",
    },
  };

  try {
    // Standard Appwrite processing with automatic Supabase fallback
    paymentViewLog.order.source = "appwrite";

    // Pre-warm read-only client for optimal performance (fire and forget)
    void DatabaseOptimizer.getReadOnlyClient();

    // Execute order lookup with optimized query - DISABLE SERVER-SIDE CACHING for payment-specific data
    const orderLookupStart = performance.now();
    const orderResult = await DatabaseQueryOptimizer.executeOptimizedQuery(
      ORDER_TRANS_COLLECTION_ID,
      [
        Query.equal("odrId", orderId),
        Query.equal("odrType", "deposit"), // Only load deposit orders
        Query.limit(1),
      ],
      {
        useCache: false, // Disable cache to prevent cross-client data leakage
        useReadReplica: true,
      }
    );
    paymentViewLog.performance.orderLookupMs =
      performance.now() - orderLookupStart;
    paymentViewLog.queries.orderLookup = {
      success: true,
      timeMs: paymentViewLog.performance.orderLookupMs,
    };

    if (!orderResult || orderResult.documents.length === 0) {
      paymentViewLog.result = { success: false, message: "Payment not found" };
      return { success: false, message: "Payment not found" };
    }

    const order = orderResult.documents[0] as OrderDocument;
    paymentViewLog.order = {
      found: true,
      odrType: order.odrType,
      odrStatus: order.odrStatus,
      merchantId: order.account?.publicTransactionId || "unknown",
      amount: order.amount,
      source: "appwrite",
    };

    // Parallel execution of dependent queries
    const parallelStart = performance.now();
    const parallelQueries = [];

    // 1. Bank info lookup (only if deposit) - Get fresh bank data without caching
    if (order.odrType === "deposit") {
      parallelQueries.push(
        DatabaseQueryOptimizer.executeOptimizedQuery(
          BANKS_COLLECTION_ID,
          [Query.equal("bankId", [order.bankId]), Query.limit(1)],
          {
            useCache: false, // Disable cache to always get fresh bank information
            useReadReplica: true,
          }
        ).then((result) => ({ type: "bank", result }))
      );
    } else {
      parallelQueries.push(
        Promise.resolve({ type: "bank", result: { documents: [] } })
      );
    }

    // 2. Account info lookup - DISABLE SERVER-SIDE CACHING for merchant-specific data
    const accountId = order.account?.publicTransactionId;
    if (accountId) {
      parallelQueries.push(
        getAccount(accountId).then((result) => ({ type: "account", result })) // Direct call without server-side caching to prevent cross-client data
      );
    } else {
      parallelQueries.push(Promise.resolve({ type: "account", result: null }));
    }

    // Execute all queries in parallel for maximum speed
    const parallelResults = await Promise.all(parallelQueries);
    paymentViewLog.performance.parallelQueriesMs =
      performance.now() - parallelStart;

    // Process results
    const bankResult = parallelResults.find((r) => r.type === "bank")?.result;
    const merchantAccountInfos = parallelResults.find(
      (r) => r.type === "account"
    )?.result;

    const bankInfo =
      (bankResult as { documents: BankDocument[] })?.documents?.[0] || null;

    // Update query success status
    paymentViewLog.queries.bankInfo = {
      success: !!bankInfo || order.odrType !== "deposit",
      timeMs: paymentViewLog.performance.parallelQueriesMs,
      cached: false, // Bank info is no longer cached
    };
    paymentViewLog.queries.accountInfo = {
      success: !!merchantAccountInfos,
      timeMs: paymentViewLog.performance.parallelQueriesMs,
      cached: false,
    };

    paymentViewLog.performance.totalTimeMs =
      performance.now() - requestStartTime;
    paymentViewLog.result = {
      success: true,
      message: "Payment data retrieved successfully",
    };

    return {
      success: true,
      data: {
        odrId: order.odrId,
        merchantOrdId: order.merchantOrdId || "",
        odrStatus: order.odrStatus,
        bankName: order.odrType === "deposit" ? bankInfo?.bankName || "" : "",
        accountNumber:
          order.odrType === "deposit"
            ? bankInfo?.accountNumber || ""
            : order.bankReceiveNumber || "",
        accountName:
          order.odrType === "deposit"
            ? bankInfo?.ownerName || ""
            : order.bankReceiveOwnerName || "",
        amount: order.amount,
        timestamp: order.$createdAt,
        qrCode: order.qrCode || null,
        urlSuccess: order.urlSuccess || "",
        urlFailed: order.urlFailed || "",
        urlCanceled: order.urlCanceled || "",
        urlCallBack: order.urlCallBack || "",
        merchantName:
          (merchantAccountInfos as AccountDocument)?.accountName || "",
        merchantlogoUrl:
          (merchantAccountInfos as AccountDocument)?.logoUrl || "",
      },
    };
  } catch (error) {
    paymentViewLog.performance.totalTimeMs =
      performance.now() - requestStartTime;
    paymentViewLog.result = {
      success: false,
      message:
        error instanceof Error ? error.message : "Unknown error occurred",
    };
    return { success: false, message: "Error fetching payment data" };
  } finally {
    // Single comprehensive log per payment view request using BetterStack
    await log.info("Payment View Request", {
      requestId: `payment_${orderId}_${Date.now()}`,
      endpoint: paymentViewLog.endpoint,
      orderId: paymentViewLog.orderId,
      request: paymentViewLog.request,
      order: paymentViewLog.order,
      queries: paymentViewLog.queries,
      performance: paymentViewLog.performance,
      result: paymentViewLog.result,
      timestamp: paymentViewLog.timestamp,
    });
  }
}

async function PaymentPageContent({ params }: { params: { orderId: string } }) {
  const { orderId } = await params;

  // Warmup cache for payment page to improve subsequent loads
  const cacheWarmupPromise = DatabaseOptimizer.warmupCache([
    {
      key: `bank_info_cache_warmup`,
      fetcher: async () => {
        // Pre-load common bank data for faster subsequent requests
        return [];
      },
    },
  ]).catch(() => {
    // Ignore warmup errors, don't block page load
  });

  // Get payment data (this is the critical path)
  const paymentData = await getPaymentData(orderId);

  // Don't wait for cache warmup (fire and forget)
  void cacheWarmupPromise;

  return (
    <ClientPaymentPage
      key={orderId}
      initialData={paymentData}
      orderId={orderId}
    />
  );
}

export default async function PaymentPage({
  params,
}: {
  params: { orderId: string };
}) {
  const { orderId } = await params;

  return (
    <Suspense fallback={<Loading />}>
      <PaymentPageContent params={{ orderId }} />
    </Suspense>
  );
}
