"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import HeaderBox from "@/components/HeaderBox";
import { Button } from "@/components/ui/button";
import { Filter, CalendarIcon, Loader2, Download } from "lucide-react";
import UnauthorizedPage from "@/components/page";
import { getLoggedInUser } from "@/lib/actions/user.actions";
import TransactionTable from "./transaction-table";
import { Models } from "node-appwrite";
import { formatDateTime } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { User } from "@/types";
import {
  getTransactionsByUserPaginated,
  fixTransactionFailQr,
} from "@/lib/actions/transaction.actions";
import { cn } from "@/lib/utils";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { zhCN, vi, Locale } from "date-fns/locale";
import { toast } from "sonner";

// Type definitions
interface Transaction extends Models.Document {
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
  // Add formatted date field for consistency
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
  // Add time state for processing transactions
  timeState?: "normal" | "danger" | "expired";
}

// Define filter interface
interface TransactionFilters {
  status: string;
  type: string;
  orderId: string;
  merchantOrdId: string;
  dateFrom: Date | undefined;
  dateTo: Date | undefined;
  amount: {
    min: string;
    max: string;
  };
}

// Define pagination state interface
interface PaginationState {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

// Define the return type of your API
interface TransactionResponse {
  documents: Transaction[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export const dynamic = "force-dynamic";

export default function TransactionsPage() {
  const t = useTranslations("transactions");
  const tcommon = useTranslations("common");
  const currentLocale = useLocale();
  const [dateLocale, setDateLocale] = useState<Locale | undefined>(undefined);

  // Utility function to convert local date to UTC date at 00:00:00
  const toUTCDate = (localDate: Date): Date => {
    const year = localDate.getFullYear();
    const month = localDate.getMonth();
    const day = localDate.getDate();
    return new Date(Date.UTC(year, month, day, 0, 0, 0));
  };

  // Format date for display with time zone info
  const formatDateForServer = useCallback(
    (date: Date | undefined): string | undefined => {
      if (!date) return undefined;

      // Convert to UTC date and format as YYYY-MM-DD
      const utcDate = toUTCDate(date);
      return utcDate.toISOString().split("T")[0];
    },
    []
  );

  useEffect(() => {
    // Set the date locale based on the current locale
    switch (currentLocale) {
      case "zh":
      case "zh-CN":
        setDateLocale(zhCN);
        break;
      case "vn":
        setDateLocale(vi);
        break;
      // Add other cases as needed
      default:
        setDateLocale(undefined);
    }
  }, [currentLocale]);
  const [loading, setLoading] = useState(true);
  const [loggedInUser, setLoggedInUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string>("");
  const [filterActive, setFilterActive] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0,
  });

  // Store unsubscribe function
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Initialize filters state
  const [filters, setFilters] = useState<TransactionFilters>({
    status: "processing",
    type: "all",
    orderId: "",
    merchantOrdId: "",
    dateFrom: undefined,
    dateTo: undefined,
    amount: {
      min: "",
      max: "",
    },
  });

  // Add a new state for local filter values
  const [localFilters, setLocalFilters] = useState<TransactionFilters>({
    status: "processing",
    type: "all",
    orderId: "",
    merchantOrdId: "",
    dateFrom: undefined,
    dateTo: undefined,
    amount: {
      min: "",
      max: "",
    },
  });

  // Add fix QR code state
  const [isFixingQRCodes, setIsFixingQRCodes] = useState(false);
  const [fixQRResult, setFixQRResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Add state for export loading
  const [isExporting, setIsExporting] = useState(false);

  // Function to fetch paginated data with filters
  const fetchTransactions = useCallback(
    async (
      page: number,
      limit: number,
      filters: TransactionFilters
    ): Promise<TransactionResponse> => {
      if (!loggedInUser)
        return { documents: [], total: 0, page, limit, pages: 0 };

      try {
        // Create a cache key based on parameters
        const cacheKey = `transactions-${JSON.stringify({
          userId: loggedInUser.$id,
          role: userRole,
          page,
          limit,
          filters,
        })}`;

        // Check browser storage for cached data
        if (typeof window !== "undefined") {
          try {
            const cachedData = localStorage.getItem(cacheKey);
            const cachedTimestamp = localStorage.getItem(
              `${cacheKey}-timestamp`
            );

            if (cachedData && cachedTimestamp) {
              const timestamp = parseInt(cachedTimestamp, 10);
              const now = Date.now();
              const cacheAge = now - timestamp;

              // For completed/canceled/failed transactions, cache for longer (5 minutes)
              // For processing/pending, cache for shorter time (10 seconds)
              const maxCacheAge =
                filters.status === "processing" || filters.status === "pending"
                  ? 10 * 1000 // 10 seconds for active transactions
                  : 5 * 60 * 1000; // 5 minutes for completed transactions

              if (cacheAge < maxCacheAge) {
                return JSON.parse(cachedData) as TransactionResponse;
              }
            }
          } catch (error) {
            // If there's any issue with localStorage, just ignore and fetch fresh data
            console.error("Cache error:", error);
          }
        }

        // Convert date filters to UTC format for server
        const serverFilters = {
          ...filters,
          dateFrom: formatDateForServer(filters.dateFrom),
          dateTo: formatDateForServer(filters.dateTo),
        };

        //console.log("Client filters:", filters);
        //console.log("Server filters:", serverFilters);

        const response = await getTransactionsByUserPaginated(
          loggedInUser.$id,
          userRole,
          page,
          limit,
          serverFilters
        );

        // Process response to include formatted dates
        if (response?.documents) {
          response.documents = response.documents.map((doc) => {
            const transaction = doc as unknown as Transaction;
            return {
              ...transaction,
              formattedCreatedAt: formatDateTime(transaction.$createdAt),
              formattedUpdatedAt: formatDateTime(transaction.$updatedAt),
            };
          });
        }

        // Cache the response
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem(cacheKey, JSON.stringify(response));
            localStorage.setItem(
              `${cacheKey}-timestamp`,
              Date.now().toString()
            );
          } catch (error) {
            // Ignore storage errors
            console.error("Cache storage error:", error);
          }
        }

        return response as TransactionResponse;
      } catch (error) {
        console.error("Error fetching transactions:", error);
        return { documents: [], total: 0, page, limit, pages: 0 };
      }
    },
    [loggedInUser, userRole, formatDateForServer]
  );

  // Optimize SWR configuration
  const {
    data: transactionData,
    error,
    mutate: refreshTransactions,
    isValidating,
  } = useSWR(
    // Only create cache key when user is loaded
    loggedInUser
      ? [
          `transactions-${pagination.page}-${pagination.limit}`,
          filters,
          userRole,
        ]
      : null,
    () => fetchTransactions(pagination.page, pagination.limit, filters),
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      dedupingInterval: 5000, // Increase to 5 seconds to reduce function calls
      focusThrottleInterval: 10000, // Add throttle interval of 10 seconds
      onSuccess: (data: TransactionResponse) => {
        setPagination({
          page: data.page,
          limit: data.limit,
          total: data.total,
          pages: data.pages,
        });
      },
    }
  );

  // Memoize current transactions to avoid unnecessary re-renders
  const transactions = useMemo(() => {
    // Explicitly cast the documents to Transaction[] type
    return (transactionData?.documents || []) as Transaction[];
  }, [transactionData]);

  // Load user data
  useEffect(() => {
    // Store the current unsubscribe function for cleanup
    let currentUnsubscribe: (() => void) | null = null;

    const fetchUser = async () => {
      try {
        setLoading(true);
        const user = await getLoggedInUser();

        if (!user) {
          window.location.href = "/sign-in";
          return;
        }

        setLoggedInUser(user as User);
        setUserRole(user.role);
      } catch (error) {
        console.error("Error fetching user data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();

    // Save current unsubscribe function
    currentUnsubscribe = unsubscribeRef.current;

    // Create a cleanup function that uses the captured value
    return () => {
      if (currentUnsubscribe) {
        currentUnsubscribe();
      }
    };
  }, []);

  // Update handlers to modify local state without triggering refresh
  const updateLocalFilterField = useCallback(
    <K extends keyof Omit<TransactionFilters, "amount">>(
      field: K,
      value: TransactionFilters[K]
    ) => {
      setLocalFilters((prev) => ({
        ...prev,
        [field]: value,
      }));
      // No debounced refresh here
    },
    []
  );

  const updateLocalAmountFilter = useCallback(
    (field: "min" | "max", value: string) => {
      setLocalFilters((prev) => ({
        ...prev,
        amount: {
          ...prev.amount,
          [field]: value,
        },
      }));
      // No debounced refresh here
    },
    []
  );

  // Apply filters function
  const applyFilters = useCallback(() => {
    // Copy local filters to actual filters
    setFilters(localFilters);
    setFilterActive(true);
    setPagination((prev) => ({
      ...prev,
      page: 1,
    }));
    setIsSheetOpen(false); // Close the filter panel
    // Now trigger just one refresh
    refreshTransactions();
  }, [localFilters, refreshTransactions]);

  // Reset filters function
  const resetFilters = useCallback(() => {
    const defaultFilters = {
      status: "processing",
      type: "all",
      orderId: "",
      merchantOrdId: "",
      dateFrom: undefined,
      dateTo: undefined,
      amount: {
        min: "",
        max: "",
      },
    };

    // Only refresh if filters are actually different from default
    const needsRefresh =
      filters.status !== defaultFilters.status ||
      filters.type !== defaultFilters.type ||
      filters.orderId !== defaultFilters.orderId ||
      filters.merchantOrdId !== defaultFilters.merchantOrdId ||
      filters.dateFrom !== defaultFilters.dateFrom ||
      filters.dateTo !== defaultFilters.dateTo ||
      filters.amount.min !== defaultFilters.amount.min ||
      filters.amount.max !== defaultFilters.amount.max;

    // Reset both states
    setLocalFilters(defaultFilters);
    setFilters(defaultFilters);
    setFilterActive(false);
    setPagination((prev) => ({
      ...prev,
      page: 1,
    }));

    // Only refresh if needed
    if (needsRefresh) {
      refreshTransactions();
    }
  }, [filters, refreshTransactions]);

  // Handle page change
  const handlePageChange = useCallback((newPage: number) => {
    setPagination((prev) => ({
      ...prev,
      page: newPage,
    }));
  }, []);

  // Handle page size change
  const handlePageSizeChange = useCallback(
    (newPageSize: number) => {
      setPagination((prev) => ({
        ...prev,
        limit: newPageSize,
        page: 1, // Reset to page 1 when changing page size
      }));
      refreshTransactions();
    },
    [refreshTransactions]
  );

  // Add this function near your other utility functions
  const hasModifiedFilters = useCallback(() => {
    return (
      localFilters.status !== "processing" ||
      localFilters.type !== "all" ||
      localFilters.orderId !== "" ||
      localFilters.merchantOrdId !== "" ||
      localFilters.dateFrom !== undefined ||
      localFilters.dateTo !== undefined ||
      localFilters.amount.min !== "" ||
      localFilters.amount.max !== ""
    );
  }, [localFilters]);

  // Add function to handle fixing QR codes
  const handleFixQRCodes = async () => {
    try {
      setIsFixingQRCodes(true);
      setFixQRResult(null);

      const result = await fixTransactionFailQr();

      setFixQRResult({
        success: result.success,
        message: result.message,
      });

      // If successful, refresh transactions
      if (result.success) {
        refreshTransactions();
      }
    } catch (error) {
      setFixQRResult({
        success: false,
        message: `Error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
    } finally {
      setIsFixingQRCodes(false);
    }
  };

  // Add function to export all filtered transactions to Excel
  const exportToExcel = useCallback(async () => {
    if (!loggedInUser) return;

    try {
      setIsExporting(true);

      // Fetch all pages of data with current filters
      const allTransactions = [];
      let currentPage = 1;
      let hasMorePages = true;

      while (hasMorePages) {
        const response = await getTransactionsByUserPaginated(
          loggedInUser.$id,
          userRole,
          currentPage,
          100, // Fetch in larger chunks for efficiency
          filters
        );

        if (response?.documents && response.documents.length > 0) {
          // Process response to include formatted dates
          const formattedTransactions = response.documents.map((doc) => {
            const transaction = doc as unknown as Transaction;
            const { date: createdDate, time: createdTime } = formatDateTime(
              transaction.$createdAt
            );
            const { date: updatedDate, time: updatedTime } = formatDateTime(
              transaction.$updatedAt
            );

            // Format data for Excel
            return {
              "Order ID": transaction.odrId,
              "Merchant Ref ID": transaction.merchantOrdId || "",
              Type: transaction.odrType,
              Status: transaction.odrStatus,
              Amount: transaction.amount,
              "Paid Amount": transaction.paidAmount,
              "Unpaid Amount": transaction.unPaidAmount,
              "Created Date": createdDate,
              "Created Time": createdTime,
              "Updated Date": updatedDate,
              "Updated Time": updatedTime,
            };
          });

          allTransactions.push(...formattedTransactions);

          // Check if we've reached the last page
          if (currentPage >= response.pages) {
            hasMorePages = false;
          } else {
            currentPage++;
          }
        } else {
          hasMorePages = false;
        }
      }

      // Only proceed if we have data
      if (allTransactions.length === 0) {
        toast.error(t("noDataToExport") || "No data to export");
        return;
      }

      // Dynamically import xlsx library (to reduce initial bundle size)
      const XLSX = await import("xlsx");

      // Create worksheet
      const worksheet = XLSX.utils.json_to_sheet(allTransactions);

      // Create workbook
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");

      // Generate filename with current date
      const date = new Date();
      const dateStr = `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const filename = `transactions_${dateStr}.xlsx`;

      // Write and download file
      XLSX.writeFile(workbook, filename);

      toast.success(t("exportSuccess") || "Transactions exported successfully");
    } catch (error) {
      console.error("Error exporting transactions:", error);
      toast.error(t("exportError") || "Failed to export transactions");
    } finally {
      setIsExporting(false);
    }
  }, [loggedInUser, userRole, filters, t]);

  // First check if the user data is loading
  const headerSubtextLoading =
    t("headerSubtextLoading") || "Loading transactions...";
  if (loading) {
    return (
      <section className="home">
        <div className="home-content">
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="mt-4 text-gray-500">
                {t("loadingUserdata") || "Loading user data..."}
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Check user role
  if (!["admin", "transactor", "merchant"].includes(userRole)) {
    return <UnauthorizedPage />;
  }

  // Determine if we're currently loading transactions
  const transactionsLoading = (!transactionData && !error) || isValidating;
  const headerTitle = t("headerTitle") || "Transactions";
  const headersubtext =
    t("headerSubtext", { qty: pagination.total }) ||
    `Monitor all payment transactions (${pagination.total} total)`;
  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">
          <div className="flex justify-between items-center w-full">
            <HeaderBox
              type="title"
              title={headerTitle}
              subtext={
                transactionsLoading ? headerSubtextLoading : headersubtext
              }
            />

            <div className="flex items-center gap-2">
              {userRole === "admin" && (
                <Button
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={handleFixQRCodes}
                  disabled={isFixingQRCodes}
                >
                  {isFixingQRCodes ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("fixingQRCodes") || "Fixing QR Codes..."}
                    </>
                  ) : (
                    <>
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <rect x="2" y="2" width="8" height="8" rx="2"></rect>
                        <rect x="14" y="2" width="8" height="8" rx="2"></rect>
                        <rect x="2" y="14" width="8" height="8" rx="2"></rect>
                        <path d="M14 14h8v8h-8z"></path>
                        <path d="M6 6h.01"></path>
                        <path d="M18 6h.01"></path>
                        <path d="M6 18h.01"></path>
                        <path d="M18 18h.01"></path>
                      </svg>
                      {t("fixQRCodes") || "Fix QR Codes"}
                    </>
                  )}
                </Button>
              )}

              {/* Export to Excel button */}
              <Button
                className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white"
                onClick={exportToExcel}
                disabled={isExporting || transactions.length === 0}
              >
                {isExporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t("exporting") || "Exporting..."}
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4" />
                    {t("exportToExcel") || "Export to Excel"}
                  </>
                )}
              </Button>

              <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                <SheetTrigger asChild>
                  <Button className="flex items-center gap-2 light-btn">
                    <Filter className="h-4 w-4" />
                    {tcommon("btnAdvancedFilters") || "Advanced Filters"}
                  </Button>
                </SheetTrigger>
                <SheetContent className="sm:max-w-md overflow-y-auto bg-white">
                  <SheetHeader>
                    <SheetTitle>
                      {t("filterTitle") || "Filter Transactions"}
                    </SheetTitle>
                    <SheetDescription>
                      {t("filterDescription") ||
                        "Apply filters to narrow down your transaction list."}
                    </SheetDescription>
                  </SheetHeader>

                  <div className="grid gap-4 py-4">
                    <div className="space-y-2">
                      <Label htmlFor="status">{t("status") || "Status"}</Label>
                      <Select
                        value={localFilters.status}
                        onValueChange={(value) =>
                          updateLocalFilterField("status", value)
                        }
                      >
                        <SelectTrigger id="status">
                          <SelectValue placeholder="Processing" />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          <SelectItem value="all">All Statuses</SelectItem>
                          <SelectItem value="processing">Processing</SelectItem>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="canceled">Canceled</SelectItem>
                          <SelectItem value="failed">Failed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="type">{t("type") || "Type"}</Label>
                      <Select
                        value={localFilters.type}
                        onValueChange={(value) =>
                          updateLocalFilterField("type", value)
                        }
                      >
                        <SelectTrigger id="type">
                          <SelectValue placeholder="All Types" />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          <SelectItem value="all">All Types</SelectItem>
                          <SelectItem value="deposit">Deposit</SelectItem>
                          <SelectItem value="withdraw">Withdraw</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="order-id">
                        {t("orderId") || "Order ID"}{" "}
                      </Label>
                      <Input
                        id="order-id"
                        value={localFilters.orderId}
                        onChange={(e) =>
                          updateLocalFilterField("orderId", e.target.value)
                        }
                        placeholder={
                          t("searchByOrderId") || "Search by Order ID"
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="merchant-order-id">
                        {t("merchantOrderID") || "Merchant Ref ID"}{" "}
                      </Label>
                      <Input
                        id="merchant-order-id"
                        value={localFilters.merchantOrdId}
                        onChange={(e) =>
                          updateLocalFilterField(
                            "merchantOrdId",
                            e.target.value
                          )
                        }
                        placeholder={
                          t("searchByMerchantOrderId") ||
                          "Search by Merchant Ref ID"
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="date-from">
                        {t("fromDate") || "From Date"}
                      </Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            id="date-from"
                            variant={"outline"}
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !localFilters.dateFrom && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {localFilters.dateFrom ? (
                              format(localFilters.dateFrom, "PPP")
                            ) : (
                              <span className="text-gray-300">
                                {t("pickADate") || "Pick a date"}
                              </span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            className="bg-white"
                            mode="single"
                            selected={localFilters.dateFrom}
                            onSelect={(date) =>
                              updateLocalFilterField("dateFrom", date)
                            }
                            initialFocus
                            disabled={(date) => {
                              // Disable all future dates beyond today
                              if (date > new Date()) return true;

                              // If toDate is set, only allow dates within 3 days before toDate
                              if (localFilters.dateTo) {
                                const diffDays = Math.floor(
                                  (localFilters.dateTo.getTime() -
                                    date.getTime()) /
                                    (1000 * 60 * 60 * 24)
                                );
                                return diffDays > 2 || diffDays < 0;
                              }
                              return false;
                            }}
                            locale={dateLocale}
                            classNames={{
                              day_selected:
                                "bg-blue-500 text-white hover:bg-blue-600 focus:bg-blue-600 font-semibold",
                              day_today:
                                "bg-blue-50 text-blue-900 font-semibold",
                            }}
                            footer={
                              <div className="mt-3 flex justify-end pr-2 pb-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    updateLocalFilterField(
                                      "dateFrom",
                                      undefined
                                    )
                                  }
                                >
                                  {tcommon("btnClear") || "Clear"}
                                </Button>
                              </div>
                            }
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="date-to">
                        {t("toDate") || "To Date"}
                      </Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            id="date-to"
                            variant={"outline"}
                            className={cn(
                              "w-full justify-start text-left font-normal",
                              !localFilters.dateTo && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4 bg" />
                            {localFilters.dateTo ? (
                              format(localFilters.dateTo, "PPP")
                            ) : (
                              <span className="text-gray-300">
                                {t("pickADate") || "Pick a date"}
                              </span>
                            )}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            className="bg-white"
                            mode="single"
                            selected={localFilters.dateTo}
                            onSelect={(date) =>
                              updateLocalFilterField("dateTo", date)
                            }
                            initialFocus
                            disabled={(date) => {
                              // Disable all future dates beyond today
                              if (date > new Date()) return true;

                              // If fromDate is set, only allow dates within 3 days after fromDate
                              if (localFilters.dateFrom) {
                                const diffDays = Math.floor(
                                  (date.getTime() -
                                    localFilters.dateFrom.getTime()) /
                                    (1000 * 60 * 60 * 24)
                                );
                                return diffDays > 2 || diffDays < 0;
                              }
                              return false;
                            }}
                            locale={dateLocale}
                            classNames={{
                              day_selected:
                                "bg-blue-500 text-white hover:bg-blue-600 focus:bg-blue-600 font-semibold",
                              day_today:
                                "bg-blue-50 text-blue-900 font-semibold",
                            }}
                            footer={
                              <div className="mt-3 flex justify-end pr-2 pb-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    updateLocalFilterField("dateTo", undefined)
                                  }
                                >
                                  {tcommon("btnClear") || "Clear"}
                                </Button>
                              </div>
                            }
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="min-amount">
                          {t("minAmount") || "Min Amount"}
                        </Label>
                        <Input
                          id="min-amount"
                          type="number"
                          value={localFilters.amount.min}
                          onChange={(e) =>
                            updateLocalAmountFilter("min", e.target.value)
                          }
                          placeholder="Min"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="max-amount">
                          {t("maxAmount") || "Max Amount"}
                        </Label>
                        <Input
                          id="max-amount"
                          type="number"
                          value={localFilters.amount.max}
                          onChange={(e) =>
                            updateLocalAmountFilter("max", e.target.value)
                          }
                          placeholder="Max"
                        />
                      </div>
                    </div>
                  </div>

                  <SheetFooter className="pt-4 flex justify-between">
                    {hasModifiedFilters() ? (
                      <Button className="light-btn" onClick={resetFilters}>
                        {tcommon("btnResetFilters") || "Reset Filters"}
                      </Button>
                    ) : (
                      <div></div>
                    )}
                    <Button
                      className="light-btn"
                      onClick={applyFilters}
                      disabled={!hasModifiedFilters()}
                    >
                      {tcommon("btnApplyFilters") || "Apply Filters"}
                    </Button>
                  </SheetFooter>
                </SheetContent>
              </Sheet>
            </div>
          </div>
        </header>

        {/* Below the header section, add notification for QR fix results */}
        {fixQRResult && (
          <div
            className={`mt-2 px-4 py-2 rounded-md flex items-center justify-between ${
              fixQRResult.success
                ? "bg-green-100 text-green-800"
                : "bg-red-100 text-red-800"
            }`}
          >
            <div className="flex items-center">
              {fixQRResult.success ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 mr-2"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5 mr-2"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
              )}
              <span>{fixQRResult.message}</span>
            </div>
            <button
              onClick={() => setFixQRResult(null)}
              className="ml-2 text-gray-500 hover:text-gray-700"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        )}

        <div className="mt-6">
          {/* Show spinner while initial transactions are loading */}
          {transactionsLoading ? (
            <div className="bg-white rounded-lg border p-8 flex items-center justify-center h-64">
              <div className="flex flex-col items-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="mt-4 text-gray-500">
                  {t("headerSubtextLoading") || "Loading transactions..."}
                </p>
              </div>
            </div>
          ) : transactions.length === 0 ? (
            <div className="bg-white rounded-lg border p-8 text-center">
              {filterActive ? (
                <>
                  <p className="text-gray-500 mb-2">
                    {t("noTransactionFound") || "No transactions found"}
                  </p>
                  <p className="text-sm text-gray-400">
                    {t("noTransactionsMatchFilter") ||
                      "No transactions match your filter criteria"}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-gray-500 mb-2">
                    {t("outOfTransactions") ||
                      "Good job you solved all transaction!"}
                  </p>
                  <p className="text-sm text-gray-400">
                    {t("transactionInWaiting") ||
                      "We're waiting for customer new payment."}
                  </p>
                </>
              )}
            </div>
          ) : (
            loggedInUser && (
              <div
                className={
                  isValidating
                    ? "opacity-70 transition-opacity duration-300"
                    : ""
                }
              >
                <TransactionTable
                  transactions={transactions}
                  pagination={pagination}
                  onPageChange={handlePageChange}
                  onPageSizeChange={handlePageSizeChange}
                />
                {isValidating && (
                  <div className="fixed bottom-4 right-4 bg-primary text-white px-4 py-2 rounded-md shadow-lg flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>{t("updateting") || "Updating..."}</span>
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
}
