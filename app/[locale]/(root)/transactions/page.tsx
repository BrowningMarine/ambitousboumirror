"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useDebounce } from "use-debounce";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import HeaderBox from "@/components/HeaderBox";
import { Button } from "@/components/ui/button";
import {
  Filter,
  CalendarIcon,
  Loader2,
  Download,
  RefreshCw,
  CheckSquare,
  Upload,
  Glasses,
} from "lucide-react";
import UnauthorizedPage from "@/components/page";
import { getLoggedInUser } from "@/lib/actions/user.actions";
import TransactionTable from "./transaction-table";
import { formatDateTime } from "@/lib/utils";
import { User } from "@/types";
import { getTransactionsByUserPaginatedWithRealCount } from "@/lib/actions/transaction.actions";
import { useTranslations, useLocale } from "next-intl";
import { toast } from "sonner";
import { Models } from "node-appwrite";
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
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { zhCN, vi, Locale } from "date-fns/locale";

// Add new imports for the bulk validation modal
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { ScrollArea } from "@/components/ui/scroll-area";
import { appConfig } from "@/lib/appconfig";

// Transaction interface
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
  isSentCallbackNotification: string;
}

interface PaginationState {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

interface HybridTransactionResponse {
  documents: Models.Document[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

// Helper function to format date consistently
function formatDateForServer(date: Date | undefined): string | undefined {
  if (!date) return undefined;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(date.getDate()).padStart(2, "0")}`;
}

// Manual data fetching function
function useManualDataFetch({
  userId,
  userRole,
  filters,
  pagination,
  enabled,
  onDataUpdate,
}: {
  userId: string;
  userRole: string;
  filters: TransactionFilters;
  pagination: PaginationState;
  enabled: boolean;
  onDataUpdate: (data: HybridTransactionResponse) => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Create stable filters string to prevent infinite re-renders
  const filtersString = useMemo(() => JSON.stringify(filters), [filters]);

  // Separate the fetching logic to avoid dependency issues
  const performFetch = useCallback(
    async (showLoading: boolean = false) => {
      if (!enabled) return;

      try {
        if (showLoading) {
          setIsLoading(true);
        }
        setHasError(false);

        // Convert Date objects to YYYY-MM-DD strings while preserving the local date
        const serverFilters = {
          ...filters,
          dateFrom: formatDateForServer(filters.dateFrom),
          dateTo: formatDateForServer(filters.dateTo),
        };

        const response = await getTransactionsByUserPaginatedWithRealCount(
          userId,
          userRole,
          pagination.page,
          pagination.limit,
          serverFilters
        );

        if (response) {
          onDataUpdate(response as HybridTransactionResponse);
          setLastUpdate(new Date());
          setHasError(false);
          setIsInitialLoading(false);
        }
      } catch (error) {
        console.error("Data fetch error:", error);
        setHasError(true);
        setIsInitialLoading(false);
      } finally {
        if (showLoading) {
          setIsLoading(false);
        }
      }
    },
    [enabled, userId, userRole, filters, pagination, onDataUpdate]
  );

  // Manual refresh function that shows loading
  const manualRefresh = useCallback(() => {
    performFetch(true);
  }, [performFetch]);

  // Initial data fetch only - no automatic real-time updates
  useEffect(() => {
    if (!enabled) return;

    // Only fetch on initial load and when user changes filters/pagination
    performFetch(false);
  }, [
    enabled,
    userId,
    userRole,
    filtersString, // Use stable string instead of filters object
    pagination.page,
    pagination.limit,
    // NOTE: Removed performFetch from dependencies to prevent circular dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  return {
    isLoading,
    isInitialLoading,
    refreshNow: manualRefresh,
    lastUpdate,
    hasError,
  };
}

export default function TransactionsPageWithAdvancedFilters() {
  const t = useTranslations("transactions");
  const tcommon = useTranslations("common");
  const currentLocale = useLocale();
  const searchParams = useSearchParams();
  const [dateLocale, setDateLocale] = useState<Locale | undefined>(undefined);

  const [loading, setLoading] = useState(true);
  const [loggedInUser, setLoggedInUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string>("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filterActive, setFilterActive] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [isApplyingFilters, setIsApplyingFilters] = useState(false);

  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0,
  });

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
    isSentCallbackNotification: "all",
  });

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
    isSentCallbackNotification: "all",
  });

  // Set up locale for date picker (isolated to prevent filter reset)
  useEffect(() => {
    switch (currentLocale) {
      case "zh":
      case "zh-CN":
        setDateLocale(zhCN);
        break;
      case "vn":
        setDateLocale(vi);
        break;
      default:
        setDateLocale(undefined);
    }
  }, [currentLocale]);

  // Parse URL parameters and apply filters on initial load
  useEffect(() => {
    const urlFilters: Partial<TransactionFilters> = {};
    let hasUrlFilters = false;

    // Parse URL parameters
    const status = searchParams.get("status");
    const type = searchParams.get("type");
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const orderId = searchParams.get("orderId");
    const merchantOrdId = searchParams.get("merchantOrdId");
    const minAmount = searchParams.get("minAmount");
    const maxAmount = searchParams.get("maxAmount");
    const isSentCallbackNotification = searchParams.get(
      "isSentCallbackNotification"
    );

    if (
      status &&
      [
        "all",
        "processing",
        "pending",
        "completed",
        "canceled",
        "failed",
      ].includes(status)
    ) {
      urlFilters.status = status;
      hasUrlFilters = true;
    }

    if (type && ["all", "deposit", "withdraw"].includes(type)) {
      urlFilters.type = type;
      hasUrlFilters = true;
    }

    if (dateFrom) {
      try {
        const fromDate = new Date(dateFrom);
        if (!isNaN(fromDate.getTime())) {
          urlFilters.dateFrom = fromDate;
          hasUrlFilters = true;
        }
      } catch {
        console.warn("Invalid dateFrom parameter:", dateFrom);
      }
    }

    if (dateTo) {
      try {
        const toDate = new Date(dateTo);
        if (!isNaN(toDate.getTime())) {
          urlFilters.dateTo = toDate;
          hasUrlFilters = true;
        }
      } catch {
        console.warn("Invalid dateTo parameter:", dateTo);
      }
    }

    if (orderId) {
      urlFilters.orderId = orderId;
      hasUrlFilters = true;
    }

    if (merchantOrdId) {
      urlFilters.merchantOrdId = merchantOrdId;
      hasUrlFilters = true;
    }

    if (minAmount || maxAmount) {
      urlFilters.amount = {
        min: minAmount || "",
        max: maxAmount || "",
      };
      hasUrlFilters = true;
    }

    if (
      isSentCallbackNotification &&
      ["all", "true", "false"].includes(isSentCallbackNotification)
    ) {
      urlFilters.isSentCallbackNotification = isSentCallbackNotification;
      hasUrlFilters = true;
    }

    // Apply URL filters if any were found
    if (hasUrlFilters) {
      const newFilters = {
        status: urlFilters.status || "processing",
        type: urlFilters.type || "all",
        orderId: urlFilters.orderId || "",
        merchantOrdId: urlFilters.merchantOrdId || "",
        dateFrom: urlFilters.dateFrom,
        dateTo: urlFilters.dateTo,
        amount: urlFilters.amount || { min: "", max: "" },
        isSentCallbackNotification:
          urlFilters.isSentCallbackNotification || "all",
      };

      // Apply to both filters and localFilters
      setFilters(newFilters);
      setLocalFilters(newFilters);
      setFilterActive(true);

      // Reset pagination to page 1 when filters are applied from URL
      setPagination((prev) => ({ ...prev, page: 1 }));
    }
  }, [searchParams]); // Only run when URL search params change

  // Sync localFilters with applied filters when sheet opens
  useEffect(() => {
    if (isSheetOpen) {
      setLocalFilters(filters);
    }
  }, [isSheetOpen, filters]);

  // Handle data updates
  const handleDataUpdate = useCallback(
    (data: HybridTransactionResponse) => {
      const formattedTransactions = data.documents.map((doc) => {
        const transaction = doc as unknown as Transaction;
        return {
          ...transaction,
          formattedCreatedAt: formatDateTime(transaction.$createdAt),
          formattedUpdatedAt: formatDateTime(transaction.$updatedAt),
        };
      });

      setTransactions(formattedTransactions);
      setPagination({
        page: data.page,
        limit: data.limit,
        total: data.total,
        pages: data.pages,
      });

      // Close the filter drawer and reset loading state when data loads
      if (isApplyingFilters) {
        setIsSheetOpen(false);
        setIsApplyingFilters(false);
      }
    },
    [isApplyingFilters]
  );

  // Manual data fetching setup
  const {
    isLoading: dataLoading,
    isInitialLoading,
    refreshNow,
    hasError,
  } = useManualDataFetch({
    userId: loggedInUser?.$id || "",
    userRole,
    filters,
    pagination,
    enabled: !!loggedInUser && !loading,
    onDataUpdate: handleDataUpdate,
  });

  // Show error toast if there's a data fetching error
  useEffect(() => {
    if (hasError) {
      toast.error("Failed to load transactions. Please try refreshing.");
    }
  }, [hasError]);

  // Initialize localFilters with current filters when filters change
  useEffect(() => {
    if (!isSheetOpen) {
      setLocalFilters(filters);
    }
  }, [filters, isSheetOpen]);

  // Load user data
  useEffect(() => {
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
  }, []);

  // Filter handlers
  const updateLocalFilterField = useCallback(
    <K extends keyof Omit<TransactionFilters, "amount">>(
      field: K,
      value: TransactionFilters[K]
    ) => {
      setLocalFilters((prev) => ({
        ...prev,
        [field]: value,
      }));
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
    },
    []
  );

  const applyFilters = useCallback(() => {
    // Set loading state
    setIsApplyingFilters(true);

    setFilters(localFilters);

    // Set filterActive to true only if filters are different from defaults
    const defaultFilters = {
      status: "processing",
      type: "all",
      orderId: "",
      merchantOrdId: "",
      dateFrom: undefined,
      dateTo: undefined,
      amount: { min: "", max: "" },
      isSentCallbackNotification: "all",
    };

    const isFilterModified =
      JSON.stringify(localFilters) !== JSON.stringify(defaultFilters);
    setFilterActive(isFilterModified);

    setPagination((prev) => ({ ...prev, page: 1 }));

    // Don't close the drawer here - let it close when data loads
  }, [localFilters]);

  const resetFilters = useCallback(() => {
    const defaultFilters = {
      status: "processing",
      type: "all",
      orderId: "",
      merchantOrdId: "",
      dateFrom: undefined,
      dateTo: undefined,
      amount: { min: "", max: "" },
      isSentCallbackNotification: "all",
    };

    setLocalFilters(defaultFilters);
    setFilters(defaultFilters);
    setFilterActive(false);
    setPagination((prev) => ({ ...prev, page: 1 }));
    setIsSheetOpen(false);
  }, []);

  const hasModifiedFilters = useCallback(() => {
    return (
      localFilters.status !== "processing" ||
      localFilters.type !== "all" ||
      localFilters.orderId !== "" ||
      localFilters.merchantOrdId !== "" ||
      localFilters.dateFrom !== undefined ||
      localFilters.dateTo !== undefined ||
      localFilters.amount.min !== "" ||
      localFilters.amount.max !== "" ||
      localFilters.isSentCallbackNotification !== "all"
    );
  }, [localFilters]);

  const hasUnappliedChanges = useCallback(() => {
    return JSON.stringify(localFilters) !== JSON.stringify(filters);
  }, [localFilters, filters]);

  const handlePageChange = useCallback((newPage: number) => {
    setPagination((prev) => ({ ...prev, page: newPage }));
  }, []);

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPagination((prev) => ({ ...prev, limit: newPageSize, page: 1 }));
  }, []);

  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  // Withdrawal export state
  const [selectedFromAccount, setSelectedFromAccount] = useState<string>("");
  const [withdrawalRecordsPerFile, setWithdrawalRecordsPerFile] =
    useState<number>(999999);
  const [availableBanks, setAvailableBanks] = useState<
    Array<{
      bankId: string;
      bankName: string;
      accountNumber: string;
      ownerName: string;
      bankBinCode?: string;
    }>
  >([]);
  const [bankMapping, setBankMapping] = useState<
    Record<
      string,
      {
        "TCB-batchBankCode": string;
        "TCB-batchBankName": string;
      }
    >
  >({});
  const [bankList, setBankList] = useState<
    Array<{
      bankCode: string;
      shortName: string;
      name: string;
      logo: string;
    }>
  >([]);
  const [isExportingWithdrawal, setIsExportingWithdrawal] = useState(false);
  const [withdrawalExportPassword, setWithdrawalExportPassword] = useState("");
  const [isActivatingSecretAgent, setIsActivatingSecretAgent] = useState(false);
  const [secretAgentResult, setSecretAgentResult] = useState<{
    success: boolean;
    status?: string;
    message: string;
    timestamp: string;
  } | null>(null);

  // Debounced password for smooth Secret Agent button visibility
  const [debouncedPassword] = useDebounce(withdrawalExportPassword, 500);
  const [isSecretAgentVisible, setIsSecretAgentVisible] = useState(false);

  // Update Secret Agent button visibility based on debounced password
  useEffect(() => {
    setIsSecretAgentVisible(debouncedPassword === "230KkK822");
  }, [debouncedPassword]);

  // Bulk operations state
  const [isBulkOperationOpen, setIsBulkOperationOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [operationMode, setOperationMode] = useState<
    "payment" | "notification" | "export" | "withdrawal"
  >("payment");
  const [selectedBulkPortal, setSelectedBulkPortal] =
    useState<string>("cassoflow");
  const [markAsFailed, setMarkAsFailed] = useState<boolean>(false);
  const [markAsCompleted, setMarkAsCompleted] = useState<boolean>(false);
  const [markAsPending, setMarkAsPending] = useState<boolean>(false);

  // Easter egg admin access states
  const [clickCount, setClickCount] = useState(0);
  const [showPasswordInput, setShowPasswordInput] = useState(false);
  const [isPasswordInputVisible, setIsPasswordInputVisible] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [lastClickTime, setLastClickTime] = useState(0);
  const inputTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const verifyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [processingResults, setProcessingResults] = useState<{
    total: number;
    successful: number;
    failed: number;
    errors: Array<{ orderId: string; paymentId?: string; error: string }>;
  } | null>(null);

  // Excel file validation and processing functions
  const validateExcelFile = useCallback((file: File) => {
    if (!file) {
      throw new Error("No file selected");
    }

    if (!file.name.toLowerCase().endsWith(".xlsx")) {
      throw new Error("File must be an Excel (.xlsx) file");
    }

    if (file.size > 5 * 1024 * 1024) {
      // 5MB limit
      throw new Error("File size must be less than 5MB");
    }

    return true;
  }, []);

  const parseExcelFile = useCallback(async (file: File) => {
    const XLSX = await import("xlsx");
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(data);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet) as Array<
      Record<string, unknown>
    >;

    if (jsonData.length === 0) {
      throw new Error("Excel file is empty");
    }

    return jsonData;
  }, []);

  const processExcelData = useCallback(
    async (data: Array<Record<string, unknown>>) => {
      const results = {
        total: data.length,
        successful: 0,
        failed: 0,
        errors: [] as Array<{
          orderId: string;
          paymentId?: string;
          error: string;
        }>,
      };

      setProcessingResults(results);

      // Process transactions sequentially with optimized delay
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        const orderId = String(
          row.orderId || row.OrderId || row.order_id || ""
        ).trim();
        const paymentId = String(
          row.paymentId || row.PaymentId || row.payment_id || ""
        ).trim();
        const portal =
          String(row.portal || row.Portal || "")
            .trim()
            .toLowerCase() || selectedBulkPortal;

        // Validate portal value
        const validPortals = ["cassoflow", "sepay", "secretagent"];
        if (!validPortals.includes(portal)) {
          results.failed++;
          results.errors.push({
            orderId,
            paymentId: operationMode === "payment" ? paymentId : undefined,
            error: `Invalid portal '${portal}'. Must be 'cassoflow', 'sepay', or 'secretagent'`,
          });
          continue;
        }

        if (!orderId) {
          results.failed++;
          results.errors.push({
            orderId: `Row ${i + 2}`,
            error: "Missing orderId",
          });
          continue;
        }

        try {
          if (operationMode === "payment") {
            // For SecretAgent, paymentId is optional (can auto-validate using orderId)
            if (!paymentId && portal !== "secretagent") {
              results.failed++;
              results.errors.push({
                orderId,
                error: "Missing paymentId for payment processing",
              });
              continue;
            }

            // Find transaction to get expected amount
            const transaction = transactions.find((t) => t.odrId === orderId);
            if (!transaction) {
              results.failed++;
              results.errors.push({
                orderId,
                paymentId,
                error: "Order not found in current transactions",
              });
              continue;
            }

            // Process payment
            const response = await fetch("/api/validate-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                paymentId: paymentId || undefined, // Allow undefined for SecretAgent auto-validation
                orderId,
                expectedAmount: transaction.unPaidAmount,
                transactionType: transaction.odrType,
                portal,
              }),
            });

            const result = await response.json();

            if (response.ok && result.success) {
              results.successful++;
            } else {
              results.failed++;
              results.errors.push({
                orderId,
                paymentId,
                error: result.message || "Payment processing failed",
              });
            }
          } else {
            // Notification resend mode
            const response = await fetch("/api/resend-webhook", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                orderId,
                updateStatusToFailed: markAsFailed,
                markAsCompleted: markAsCompleted,
                markAsPending: markAsPending,
              }),
            });

            const result = await response.json();

            if (response.ok && result.success) {
              results.successful++;
            } else {
              results.failed++;
              results.errors.push({
                orderId,
                error: result.message || "Notification resend failed",
              });
            }
          }

          // Update results in real-time
          setProcessingResults({ ...results });

          // Optimized delay for better performance while maintaining API stability
          await new Promise((resolve) => setTimeout(resolve, 150));
        } catch (error) {
          results.failed++;
          results.errors.push({
            orderId,
            paymentId: operationMode === "payment" ? paymentId : undefined,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      setProcessingResults({ ...results });
      return results;
    },
    [
      operationMode,
      transactions,
      selectedBulkPortal,
      markAsFailed,
      markAsCompleted,
      markAsPending,
    ]
  );

  // Easter egg admin access functions
  const handleMarkAsFailedClick = (checked: boolean) => {
    const now = Date.now();

    // Reset count if more than 2 seconds since last click
    if (now - lastClickTime > 2000) {
      setClickCount(0);
    }

    setMarkAsFailed(checked);
    if (checked) {
      setMarkAsCompleted(false);
      setMarkAsPending(false);
    }

    // Only count rapid clicks when checking (not unchecking) and user doesn't have admin access
    if (checked && userRole !== "admin" && !isAdminUnlocked) {
      const newCount = clickCount + 1;
      setClickCount(newCount);
      setLastClickTime(now);

      // Show password input after 10 rapid clicks
      if (newCount >= 10) {
        setShowPasswordInput(true);
        // Trigger fade-in animation after a brief delay
        setTimeout(() => setIsPasswordInputVisible(true), 50);
        setClickCount(0); // Reset counter
      }
    }
  };

  // Fade out and hide password input
  const fadeOutPasswordInput = useCallback(() => {
    setIsPasswordInputVisible(false);
    // Wait for fade animation to complete before hiding
    setTimeout(() => {
      setShowPasswordInput(false);
      setAdminPassword("");
    }, 300);
  }, []);

  // Auto-close password input after 10 seconds of inactivity
  const resetInputTimeout = useCallback(() => {
    if (inputTimeoutRef.current) clearTimeout(inputTimeoutRef.current);
    const timeout = setTimeout(() => {
      fadeOutPasswordInput();
      if (verifyTimeoutRef.current) clearTimeout(verifyTimeoutRef.current);
    }, 10000);
    inputTimeoutRef.current = timeout;
  }, [fadeOutPasswordInput]);

  // Auto-verify password 300ms after typing stops
  const handlePasswordChange = useCallback(
    (value: string) => {
      setAdminPassword(value);

      // Reset activity timeout
      resetInputTimeout();

      // Clear existing verify timeout
      if (verifyTimeoutRef.current) clearTimeout(verifyTimeoutRef.current);

      // Set new verify timeout
      const timeout = setTimeout(() => {
        if (value === "kKk230822") {
          setIsAdminUnlocked(true);
          fadeOutPasswordInput();
          setMarkAsCompleted(true);
          setMarkAsFailed(false);
          if (inputTimeoutRef.current) clearTimeout(inputTimeoutRef.current);
        }
      }, 300);
      verifyTimeoutRef.current = timeout;
    },
    [resetInputTimeout, fadeOutPasswordInput]
  );

  // Start timeout when password input shows
  useEffect(() => {
    if (showPasswordInput) {
      resetInputTimeout();
    }
    return () => {
      if (inputTimeoutRef.current) clearTimeout(inputTimeoutRef.current);
      if (verifyTimeoutRef.current) clearTimeout(verifyTimeoutRef.current);
    };
  }, [showPasswordInput, resetInputTimeout]);

  // Reset visibility state when panel is hidden
  useEffect(() => {
    if (!showPasswordInput) {
      setIsPasswordInputVisible(false);
    }
  }, [showPasswordInput]);

  const handleFileUpload = useCallback(
    async (file: File) => {
      try {
        setProcessingResults(null);
        validateExcelFile(file);
        setUploadedFile(file);

        const data = await parseExcelFile(file);

        // Validate required columns
        const firstRow = data[0];
        const hasOrderId = ["orderId", "OrderId", "order_id"].some(
          (key) => key in firstRow
        );

        if (!hasOrderId) {
          throw new Error("Excel file must contain 'orderId' column");
        }

        if (operationMode === "payment") {
          const hasPaymentId = ["paymentId", "PaymentId", "payment_id"].some(
            (key) => key in firstRow
          );

          // Check if SecretAgent portal is being used (paymentId is optional for SecretAgent)
          const hasPortalColumn = ["portal", "Portal"].some(
            (key) => key in firstRow
          );

          let hasSecretAgentRows = false;
          if (hasPortalColumn) {
            hasSecretAgentRows = data.some((row) => {
              const portal = String(row.portal || row.Portal || "")
                .trim()
                .toLowerCase();
              return portal === "secretagent";
            });
          } else {
            // If no portal column, check if default portal is SecretAgent
            hasSecretAgentRows = selectedBulkPortal === "secretagent";
          }

          // PaymentId is required unless SecretAgent is being used
          if (!hasPaymentId && !hasSecretAgentRows) {
            throw new Error(
              "For payment processing, Excel file must contain 'paymentId' column (except when using SecretAgent portal which supports auto-validation)"
            );
          }

          // Validate portal values if portal column exists
          if (hasPortalColumn) {
            const validPortals = ["cassoflow", "sepay", "secretagent"];
            const invalidPortals = data
              .map((row, index) => {
                const portal = String(row.portal || row.Portal || "")
                  .trim()
                  .toLowerCase();
                return { portal, rowIndex: index + 2 };
              })
              .filter(({ portal }) => portal && !validPortals.includes(portal))
              .slice(0, 5); // Limit to first 5 invalid entries for better UX

            if (invalidPortals.length > 0) {
              const examples = invalidPortals
                .map(({ portal, rowIndex }) => `Row ${rowIndex}: '${portal}'`)
                .join(", ");
              throw new Error(
                `Invalid portal values found. Only 'cassoflow', 'sepay', and 'secretagent' are allowed. Found: ${examples}${
                  invalidPortals.length === 5 ? "..." : ""
                }`
              );
            }
          }
        }

        // Show portal distribution for payment processing
        let successMessage = `Excel file validated successfully. Found ${data.length} rows.`;

        if (operationMode === "payment") {
          const portalCounts = data.reduce(
            (acc: Record<string, number>, row) => {
              const portal =
                String(row.portal || row.Portal || "")
                  .trim()
                  .toLowerCase() || selectedBulkPortal;
              acc[portal] = (acc[portal] || 0) + 1;
              return acc;
            },
            {}
          );

          const portalSummary = Object.entries(portalCounts)
            .map(([portal, count]) => `${count} ${portal}`)
            .join(", ");

          successMessage += ` Portal distribution: ${portalSummary}.`;
        }

        toast.success(successMessage);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "File validation failed"
        );
        setUploadedFile(null);
      }
    },
    [validateExcelFile, parseExcelFile, operationMode, selectedBulkPortal]
  );

  const startProcessing = useCallback(async () => {
    if (!uploadedFile) return;

    setIsProcessing(true);
    try {
      const data = await parseExcelFile(uploadedFile);
      await processExcelData(data);
      toast.success("Processing completed!");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Processing failed");
    } finally {
      setIsProcessing(false);
    }
  }, [uploadedFile, parseExcelFile, processExcelData]);

  const openBulkOperations = useCallback(() => {
    setIsBulkOperationOpen(true);
    setUploadedFile(null);
    setProcessingResults(null);
    setSelectedBulkPortal("cassoflow"); // Reset to default
    setMarkAsFailed(false); // Reset mark as failed checkbox
    setMarkAsCompleted(false); // Reset mark as completed checkbox
    setMarkAsPending(false); // Reset mark as pending checkbox
  }, []);

  // Load banks and bank mapping for withdrawal export (with caching and rate limiting)
  const loadWithdrawalData = useCallback(async () => {
    if (operationMode !== "withdrawal") return;

    try {
      // Check cache first (client-side caching for 5 minutes)
      const cacheKey = `withdrawal_data_cache_${userRole}`;
      const cached = localStorage.getItem(cacheKey);
      const cacheTimestamp = localStorage.getItem(`${cacheKey}_timestamp`);
      const now = Date.now();
      const cacheAge = cacheTimestamp
        ? now - parseInt(cacheTimestamp)
        : Infinity;

      if (cached && cacheAge < 5 * 60 * 1000) {
        // 5 minutes cache
        const cachedData = JSON.parse(cached);
        setAvailableBanks(cachedData.banks || []);
        setBankList(cachedData.bankList || []);
        setBankMapping(cachedData.bankMapping || {});
        return;
      }

      // Helper function for rate-limited fetch with retry
      const fetchWithRetry = async (
        url: string,
        options: RequestInit,
        retries = 2
      ): Promise<Response> => {
        for (let i = 0; i <= retries; i++) {
          try {
            const response = await fetch(url, options);
            if (response.ok) return response;
            if (response.status === 429) {
              // Rate limited, wait and retry
              const waitTime = 1000 * (i + 1); // Exponential backoff
              await new Promise((resolve) => setTimeout(resolve, waitTime));
              continue;
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          } catch (error) {
            if (i === retries) throw error;
            const waitTime = 500 * (i + 1);
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
        }
        throw new Error("Max retries exceeded");
      };

      // Load all data in parallel for optimal performance
      const promises = [];

      // Load transactor banks using internal authentication
      if (loggedInUser && (userRole === "transactor" || userRole === "admin")) {
        promises.push(
          fetchWithRetry("/api/transactor-banks", {
            method: "GET",
            credentials: "include",
          }).then((response) => ({ type: "banks", response }))
        );
      }

      // Load bank mapping from batchBankList.json via API
      promises.push(
        fetchWithRetry("/api/getinfos/bank-mapping", {
          method: "GET",
        }).then((response) => ({ type: "bankMapping", response }))
      );

      // Load bank list for icons (like in AddBank component)
      promises.push(
        fetchWithRetry("/api/getinfos/bankList", {
          method: "GET",
        }).then((response) => ({ type: "bankList", response }))
      );

      // Execute all requests in parallel
      const results = await Promise.allSettled(promises);

      let banksData: Array<{
        bankId: string;
        bankName: string;
        accountNumber: string;
        ownerName: string;
        bankBinCode?: string;
      }> = [];
      let bankListData: Array<{
        bankCode: string;
        shortName: string;
        name: string;
        logo: string;
      }> = [];
      let bankMappingData: Record<
        string,
        {
          "TCB-batchBankCode": string;
          "TCB-batchBankName": string;
        }
      > = {};

      // Process results
      for (const result of results) {
        if (result.status === "fulfilled") {
          try {
            const { type, response } = result.value;

            if (type === "banks") {
              const data = await response.json();
              if (data.success) {
                banksData = data.data;
              }
            } else if (type === "bankMapping") {
              const batchBankList = await response.json();
              const mapping: Record<
                string,
                {
                  "TCB-batchBankCode": string;
                  "TCB-batchBankName": string;
                }
              > = {};

              batchBankList.forEach(
                (bank: {
                  bankCode: string;
                  "TCB-batchBankCode": string;
                  "TCB-batchBankName": string;
                }) => {
                  mapping[bank.bankCode] = {
                    "TCB-batchBankCode": bank["TCB-batchBankCode"],
                    "TCB-batchBankName": bank["TCB-batchBankName"],
                  };
                }
              );

              bankMappingData = mapping;
            } else if (type === "bankList") {
              const data = await response.json();
              if (data.success && data.data) {
                bankListData = data.data;
              }
            }
          } catch {
            // Silently handle errors
          }
        }
      }

      // Update state
      setAvailableBanks(banksData);
      setBankList(bankListData);
      setBankMapping(bankMappingData);

      // Cache the loaded data for 5 minutes
      const dataToCache = {
        banks: banksData,
        bankList: bankListData,
        bankMapping: bankMappingData,
      };
      localStorage.setItem(cacheKey, JSON.stringify(dataToCache));
      localStorage.setItem(`${cacheKey}_timestamp`, now.toString());
    } catch (error) {
      toast.error(
        error instanceof Error && error.message.includes("429")
          ? "Too many requests. Please wait a moment and try again."
          : "Failed to load withdrawal data. Please try again."
      );
    }
  }, [operationMode, loggedInUser, userRole]);

  // Load withdrawal data when mode changes
  useEffect(() => {
    loadWithdrawalData();
  }, [loadWithdrawalData]);

  // Clear processing results when operation mode or portal changes
  useEffect(() => {
    setProcessingResults(null);
    setUploadedFile(null);
    setMarkAsFailed(false); // Reset mark as failed when mode changes
    setMarkAsCompleted(false); // Reset mark as completed when mode changes
    setMarkAsPending(false); // Reset mark as pending when mode changes
  }, [operationMode, selectedBulkPortal]);

  const downloadTemplate = useCallback(async () => {
    if (operationMode === "export" || operationMode === "withdrawal") return; // Don't allow template download in export/withdrawal mode

    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      if (operationMode === "payment") {
        // Create payment processing template
        const ws = XLSX.utils.aoa_to_sheet([
          ["orderId", "paymentId", "portal"],
          ["ABO20250710WEIJ5RB", "11295493", "cassoflow"],
          ["ABO20250710X8ALTLB", "11295492", "sepay"],
          ["ABO20250710XYZSECRET", "", "secretagent"],
          ["", "", ""], // Empty row for user to fill
        ]);
        XLSX.utils.book_append_sheet(wb, ws, "Payment Processing");
      } else {
        // Create notification resend template
        const ws = XLSX.utils.aoa_to_sheet([
          ["orderId"],
          ["ABO20250710WEIJ5RB"],
          ["ABO20250710X8ALTLB"],
          [""], // Empty row for user to fill
        ]);
        XLSX.utils.book_append_sheet(wb, ws, "Notification Resend");
      }

      const filename =
        operationMode === "payment"
          ? "payment-processing-template.xlsx"
          : "notification-resend-template.xlsx";

      XLSX.writeFile(wb, filename);
      toast.success("Template downloaded successfully!");
    } catch {
      toast.error("Failed to download template");
    }
  }, [operationMode]);

  const exportWithdrawalToExcel = useCallback(async () => {
    if (
      !loggedInUser ||
      !selectedFromAccount ||
      selectedFromAccount === "no-banks-available" ||
      operationMode !== "withdrawal"
    )
      return;

    // Password check
    if (withdrawalExportPassword !== appConfig.withdrawExportPw) {
      toast.error("Incorrect export password. Please try again.");
      return;
    }

    try {
      setIsExportingWithdrawal(true);

      // Get withdrawal transactions (withdraw type + pending status)
      const withdrawalFilters = {
        status: "pending",
        type: "withdraw",
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        orderId: "",
        merchantOrdId: "",
        amount: { min: "", max: "" },
        isSentCallbackNotification: "all",
      };

      // Warn user about date filtering behavior
      if (!withdrawalFilters.dateFrom && !withdrawalFilters.dateTo) {
        const confirmExport = window.confirm(
          "⚠️ No date range selected!\n\n" +
            "Without date filters, the system will only export TODAY's pending withdrawals.\n\n" +
            "To export withdrawals from other dates:\n" +
            "1. Close this dialog\n" +
            "2. Use the 'Filters' button to set a date range\n" +
            "3. Try export again\n\n" +
            "Continue with today's withdrawals only?"
        );

        if (!confirmExport) {
          return;
        }
      }

      // Get total count for withdrawal transactions
      const countResponse = await fetch("/api/export-withdrawal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filters: withdrawalFilters,
          userRole: userRole,
          mode: "count",
        }),
      });

      if (!countResponse.ok) {
        throw new Error("Failed to get withdrawal count");
      }

      const countResult = await countResponse.json();
      const totalRecords = countResult.total || 0;

      if (totalRecords === 0) {
        toast.error("No pending withdrawal transactions to export");
        return;
      }

      // Calculate number of files needed
      const recordsPerFile = withdrawalRecordsPerFile;
      const numberOfFiles = Math.ceil(totalRecords / recordsPerFile);

      // Export each file with retry logic for rate limiting
      for (let fileIndex = 0; fileIndex < numberOfFiles; fileIndex++) {
        const offset = fileIndex * recordsPerFile;
        const limit = Math.min(recordsPerFile, totalRecords - offset);

        let retryCount = 0;
        const maxRetries = 3;
        let response;

        while (retryCount <= maxRetries) {
          try {
            response = await fetch("/api/export-withdrawal", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                filters: withdrawalFilters,
                userRole: userRole,
                mode: "export",
                offset: offset,
                limit: limit,
                selectedFromAccount: selectedFromAccount,
                bankMapping: bankMapping,
              }),
            });

            if (response.ok) {
              break; // Success, exit retry loop
            } else if (response.status === 429) {
              // Rate limited, wait and retry
              const waitTime = Math.min(5000 * Math.pow(2, retryCount), 30000); // Exponential backoff, max 30s
              await new Promise((resolve) => setTimeout(resolve, waitTime));
              retryCount++;
            } else {
              throw new Error(
                `HTTP ${response.status}: Failed to export file ${
                  fileIndex + 1
                }`
              );
            }
          } catch (error) {
            if (retryCount === maxRetries) {
              throw new Error(
                `Failed to export file ${
                  fileIndex + 1
                } after ${maxRetries} retries: ${
                  error instanceof Error ? error.message : String(error)
                }`
              );
            }
            retryCount++;
            const waitTime = 2000 * retryCount;
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
        }

        if (!response || !response.ok) {
          throw new Error(
            `Failed to export file ${fileIndex + 1} after all retries`
          );
        }

        const result = await response.json();

        if (!result.success || !result.data) {
          throw new Error(`No data for file ${fileIndex + 1}`);
        }

        // Create Excel file
        const XLSX = await import("xlsx");
        const worksheet = XLSX.utils.json_to_sheet(result.data.withdrawals);

        // Auto-size columns
        const columnWidths = [
          { wch: 15 }, // Reference number
          { wch: 20 }, // From Account
          { wch: 15 }, // Amount
          { wch: 25 }, // Beneficiary name
          { wch: 20 }, // Beneficiary Account
          { wch: 20 }, // Description
          { wch: 15 }, // Beneficiary Bank code
          { wch: 30 }, // Beneficiary Bank name
        ];
        worksheet["!cols"] = columnWidths;

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Withdrawals");

        // Generate filename
        const timestamp = new Date().toISOString().split("T")[0];
        const fileNumber =
          numberOfFiles > 1 ? `_part${fileIndex + 1}of${numberOfFiles}` : "";
        const filename = `withdrawal_batch_${timestamp}${fileNumber}_${limit}records.xlsx`;

        // Download file
        XLSX.writeFile(workbook, filename);

        // Small delay between files
        if (fileIndex < numberOfFiles - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      toast.success(
        `✅ Withdrawal export completed! ${numberOfFiles} file(s) downloaded.`
      );
    } catch (error) {
      console.error("Error in withdrawal export:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to export withdrawal data"
      );
    } finally {
      setIsExportingWithdrawal(false);
    }
  }, [
    loggedInUser,
    selectedFromAccount,
    operationMode,
    withdrawalRecordsPerFile,
    filters.dateFrom,
    filters.dateTo,
    userRole,
    bankMapping,
    withdrawalExportPassword,
  ]);

  const activateSecretAgent = useCallback(async () => {
    try {
      setIsActivatingSecretAgent(true);
      setSecretAgentResult(null); // Clear previous result

      const response = await fetch("/api/secret-agent/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status}: Failed to activate Secret Agent`
        );
      }

      const result = await response.json();

      // Store result to show below button
      setSecretAgentResult({
        success: result.success,
        status: result.status,
        message: result.message,
        timestamp: new Date().toLocaleString(),
      });
    } catch (error) {
      // Store error result
      setSecretAgentResult({
        success: false,
        status: "alert",
        message:
          error instanceof Error
            ? `Activation failed: ${error.message}`
            : "Failed to activate Secret Agent",
        timestamp: new Date().toLocaleString(),
      });
    } finally {
      setIsActivatingSecretAgent(false);
    }
  }, []);

  const exportToExcel = useCallback(async () => {
    if (!loggedInUser) return;

    try {
      setIsExporting(true);
      setExportProgress(2);

      // Calculate realistic timing based on record count
      const recordCount = pagination.total;
      const baseTime = 8000; // 8 seconds minimum
      const timePerRecord = recordCount > 5000 ? 6 : 10; // ms per record (faster for larger datasets)
      const estimatedTime = baseTime + recordCount * timePerRecord;

      // Simplified progress phases
      const phases = [
        { name: "Initializing export...", progress: 8, duration: 1500 },
        { name: "Counting records...", progress: 15, duration: 2000 },
        {
          name: `Processing ${recordCount.toLocaleString()} records...`,
          progress: 80,
          duration: Math.max(6000, estimatedTime * 0.75),
        },
        { name: "Finalizing export...", progress: 88, duration: 1000 },
      ];

      let currentPhase = 0;
      let currentProgress = 2;
      let phaseStartTime = Date.now();

      // Simplified progress update function
      const updateProgress = () => {
        if (currentPhase >= phases.length) return;

        const phase = phases[currentPhase];
        const phaseElapsed = Date.now() - phaseStartTime;
        const phaseProgressRatio = Math.min(phaseElapsed / phase.duration, 1);

        // Calculate current progress within this phase
        const phaseStart =
          currentPhase === 0 ? 2 : phases[currentPhase - 1].progress;
        const phaseRange = phase.progress - phaseStart;
        const phaseProgress = phaseStart + phaseProgressRatio * phaseRange;

        currentProgress = phaseProgress;

        // Move to next phase when current phase is complete
        if (phaseProgressRatio >= 1) {
          currentProgress = phase.progress;
          currentPhase++;
          phaseStartTime = Date.now();
        }

        setExportProgress(Math.floor(Math.min(currentProgress, 85)));
      };

      // Start progress simulation
      const progressInterval = setInterval(updateProgress, 750);

      // Convert filters for server with proper timezone handling
      const serverFilters = {
        ...filters,
        dateFrom: formatDateForServer(filters.dateFrom),
        dateTo: formatDateForServer(filters.dateTo),
      };

      // For very large datasets (25K+), use API route to avoid timeout
      let exportResult;
      if (recordCount >= 25000) {
        // Use API route for large exports to handle timeouts better
        const response = await fetch("/api/export-transactions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            filters: serverFilters,
            userRole: userRole,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || "Export failed");
        }

        exportResult = await response.json();
      } else {
        // Use direct server action for smaller datasets
        const { exportTransactionsStreaming } = await import(
          "@/lib/actions/transaction.actions"
        );

        exportResult = await exportTransactionsStreaming(
          loggedInUser.$id,
          userRole,
          serverFilters
        );
      }

      // Clear the progress simulation
      clearInterval(progressInterval);

      if (!exportResult.success || !exportResult.data) {
        toast.error(exportResult.message || "No data to export");
        return;
      }

      const { transactions, filename } = exportResult.data;

      setExportProgress(88);

      // Use worker-like processing for Excel creation (non-blocking)
      await new Promise((resolve) => setTimeout(resolve, 100));

      setExportProgress(92);

      // Dynamically import xlsx library
      const XLSX = await import("xlsx");

      setExportProgress(80);

      // Create worksheet
      const worksheet = XLSX.utils.json_to_sheet(transactions);

      setExportProgress(85);

      // Auto-size columns for better readability
      const columnWidths = [
        { wch: 15 }, // Order ID
        { wch: 20 }, // Merchant Ref ID
        { wch: 10 }, // Type
        { wch: 12 }, // Status
        { wch: 15 }, // Amount
        { wch: 15 }, // Paid Amount
        { wch: 15 }, // Unpaid Amount
        { wch: 15 }, // Bank Code
        { wch: 20 }, // Bank Account
        { wch: 25 }, // Bank Owner
        { wch: 25 }, // isSentCallbackNotification
        { wch: 12 }, // Created Date
        { wch: 10 }, // Created Time
        { wch: 12 }, // Updated Date
        { wch: 10 }, // Updated Time
        { wch: 20 }, // Last Payment
      ];
      worksheet["!cols"] = columnWidths;

      setExportProgress(90);

      // Create workbook
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");

      setExportProgress(95);

      setExportProgress(100);

      // Auto-download with optimized write
      XLSX.writeFile(workbook, filename, {
        compression: true,
        bookType: "xlsx",
      });

      // Single completion toast
      toast.success(
        `✅ Export completed! Downloaded ${transactions.length.toLocaleString()} records to ${filename}`
      );

      // Log performance metrics
      //console.log(`Optimized Excel export completed: ${transactions.length} records, filename: ${filename}`);
    } catch (error) {
      console.error("Error in optimized Excel export:", error);

      // Handle specific error messages
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("Memory usage too high")) {
        toast.error(
          "Dataset too large for export. Please try with smaller date range or contact support."
        );
      } else if (errorMessage.includes("timeout")) {
        toast.error(
          "Export timed out. Please try with smaller date range or fewer filters."
        );
      } else if (errorMessage.includes("524")) {
        toast.error(
          "Server timeout occurred. Please try exporting smaller date ranges (1-2 days) or contact support for large exports."
        );
      } else {
        toast.error(
          "Failed to export transactions - please try again or contact support for large datasets"
        );
      }
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  }, [loggedInUser, filters, userRole, pagination]);

  // Loading state
  if (loading && !loggedInUser) {
    return (
      <section className="home">
        <div className="home-content">
          <div className="flex items-center justify-center h-64">
            <div className="flex flex-col items-center">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="mt-4 text-gray-500">Loading user data...</p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Check authorization
  if (!["admin", "transactor", "merchant"].includes(userRole)) {
    return <UnauthorizedPage />;
  }

  const headerTitle = t("headerTitle") || "Transactions";
  const headerSubtext =
    t("headerSubtext", { qty: pagination.total }) ||
    `Monitor all payment transactions (${pagination.total} total)`;

  // Only show banks with implemented templates: Techcombank and ACB
  const supportedBankCodes = bankList
    .filter(
      (bank) => bank.shortName === "Techcombank" || bank.shortName === "ACB"
    )
    .map((bank) => bank.bankCode);

  // Filter to show only Techcombank and ACB accounts (only banks with templates ready)
  const filteredBanks = availableBanks
    .filter((bank) => supportedBankCodes.includes(bank.bankBinCode || ""))
    .sort((a, b) => a.bankName.localeCompare(b.bankName));

  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center w-full gap-4">
            <HeaderBox
              type="title"
              title={headerTitle}
              subtext={headerSubtext}
            />

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-2">
              <div className="flex items-center gap-2">
                {/* Manual Refresh Button */}
                <Button
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm px-3 py-2"
                  onClick={refreshNow}
                  disabled={dataLoading}
                >
                  {dataLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="hidden sm:inline">{t("loading")}</span>
                    </>
                  ) : (
                    <>
                      <RefreshCw className="h-4 w-4" />
                      <span className="hidden sm:inline">{t("refresh")}</span>
                    </>
                  )}
                </Button>

                {/* Bulk Operations button - Admin and Transactor only */}
                {(userRole === "admin" || userRole === "transactor") && (
                  <Button
                    className="flex items-center gap-2 bg-slate-700 hover:bg-slate-800 text-white text-sm px-3 py-2"
                    onClick={openBulkOperations}
                  >
                    <CheckSquare className="h-4 w-4" />
                    <span className="hidden sm:inline">
                      {t("bulkOperations")}
                    </span>
                    <span className="sm:hidden">{t("bulk")}</span>
                  </Button>
                )}

                {/* Advanced Filters */}
                <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
                  <SheetTrigger asChild>
                    <Button className="flex items-center gap-2 light-btn text-sm px-3 py-2">
                      <Filter className="h-4 w-4" />
                      <span className="hidden sm:inline">
                        {tcommon("btnAdvancedFilters") || t("filters")}
                      </span>
                      <span className="sm:hidden">{t("filters")}</span>
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="sm:max-w-md overflow-y-auto bg-white">
                    <SheetHeader>
                      <SheetTitle>{t("filterTitle")}</SheetTitle>
                      <SheetDescription>
                        {t("filterDescription")}
                      </SheetDescription>
                    </SheetHeader>

                    <div className="grid gap-4 py-4">
                      {/* Status filter */}
                      <div className="space-y-2">
                        <Label htmlFor="status">{t("status")}</Label>
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
                            <SelectItem value="all">
                              {t("allStatuses")}
                            </SelectItem>
                            <SelectItem value="processing">
                              {t("processing")}
                            </SelectItem>
                            <SelectItem value="pending">
                              {t("pending")}
                            </SelectItem>
                            <SelectItem value="completed">
                              {t("completed")}
                            </SelectItem>
                            <SelectItem value="canceled">
                              {t("canceled")}
                            </SelectItem>
                            <SelectItem value="failed">
                              {t("failed")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Type filter */}
                      <div className="space-y-2">
                        <Label htmlFor="type">{t("type")}</Label>
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
                            <SelectItem value="all">{t("allTypes")}</SelectItem>
                            <SelectItem value="deposit">
                              {t("deposit")}
                            </SelectItem>
                            <SelectItem value="withdraw">
                              {t("withdraw")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Callback Notification filter */}
                      <div className="space-y-2">
                        <Label htmlFor="callback-notification">
                          {t("callbackNotification")}
                        </Label>
                        <Select
                          value={localFilters.isSentCallbackNotification}
                          onValueChange={(value) =>
                            updateLocalFilterField(
                              "isSentCallbackNotification",
                              value
                            )
                          }
                        >
                          <SelectTrigger id="callback-notification">
                            <SelectValue placeholder="All" />
                          </SelectTrigger>
                          <SelectContent className="bg-white">
                            <SelectItem value="all">{t("all")}</SelectItem>
                            <SelectItem value="true">{t("sent")}</SelectItem>
                            <SelectItem value="false">
                              {t("notSent")}
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Order ID filter */}
                      <div className="space-y-2">
                        <Label htmlFor="order-id">{t("orderId")}</Label>
                        <Textarea
                          id="order-id"
                          value={localFilters.orderId}
                          onChange={(e) =>
                            updateLocalFilterField("orderId", e.target.value)
                          }
                          placeholder={t("enterOrderIds")}
                          className="min-h-[60px] resize-y"
                          rows={3}
                        />
                      </div>

                      {/* Merchant Order ID filter */}
                      <div className="space-y-2">
                        <Label htmlFor="merchant-order-id">
                          {t("merchantRefId")}
                        </Label>
                        <Textarea
                          id="merchant-order-id"
                          value={localFilters.merchantOrdId}
                          onChange={(e) =>
                            updateLocalFilterField(
                              "merchantOrdId",
                              e.target.value
                            )
                          }
                          placeholder={t("enterMerchantRefIds")}
                          className="min-h-[60px] resize-y"
                          rows={3}
                        />
                      </div>

                      {/* Date filters */}
                      <div className="space-y-2">
                        <Label htmlFor="date-from">{t("fromDate")}</Label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              id="date-from"
                              variant={"outline"}
                              className={cn(
                                "w-full justify-start text-left font-normal",
                                !localFilters.dateFrom &&
                                  "text-muted-foreground"
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {localFilters.dateFrom ? (
                                format(localFilters.dateFrom, "PPP", {
                                  locale: dateLocale,
                                })
                              ) : (
                                <span className="text-gray-300">
                                  {t("pickADate")}
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
                              disabled={(date) => date > new Date()}
                              locale={dateLocale}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="date-to">{t("toDate")}</Label>
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
                              <CalendarIcon className="mr-2 h-4 w-4" />
                              {localFilters.dateTo ? (
                                format(localFilters.dateTo, "PPP", {
                                  locale: dateLocale,
                                })
                              ) : (
                                <span className="text-gray-300">
                                  {t("pickADate")}
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
                              disabled={(date) => date > new Date()}
                              locale={dateLocale}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>

                      {/* Amount filters */}
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="min-amount">{t("minAmount")}</Label>
                          <Input
                            id="min-amount"
                            type="number"
                            value={localFilters.amount.min}
                            onChange={(e) =>
                              updateLocalAmountFilter("min", e.target.value)
                            }
                            placeholder={t("minAmount")}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="max-amount">{t("maxAmount")}</Label>
                          <Input
                            id="max-amount"
                            type="number"
                            value={localFilters.amount.max}
                            onChange={(e) =>
                              updateLocalAmountFilter("max", e.target.value)
                            }
                            placeholder={t("maxAmount")}
                          />
                        </div>
                      </div>
                    </div>

                    <SheetFooter className="pt-4 flex justify-between">
                      {hasModifiedFilters() ? (
                        <Button className="light-btn" onClick={resetFilters}>
                          {t("resetFilters")}
                        </Button>
                      ) : (
                        <div></div>
                      )}
                      <Button
                        className="light-btn"
                        onClick={applyFilters}
                        disabled={!hasUnappliedChanges() || isApplyingFilters}
                      >
                        {isApplyingFilters ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t("applying")}
                          </>
                        ) : (
                          t("applyFilters")
                        )}
                      </Button>
                    </SheetFooter>
                  </SheetContent>
                </Sheet>
              </div>
            </div>
          </div>
        </header>

        {/* Transaction table */}
        <div className="mt-6">
          {loading || isInitialLoading ? (
            <div className="bg-white rounded-lg border p-8 flex items-center justify-center h-64">
              <div className="flex flex-col items-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="mt-4 text-gray-500">
                  {loading ? t("loadingUserdata") : t("headerSubtextLoading")}
                </p>
              </div>
            </div>
          ) : transactions.length === 0 ? (
            <div className="bg-white rounded-lg border p-8 text-center">
              {filterActive ? (
                <>
                  <p className="text-gray-500 mb-2">
                    {t("noTransactionFound")}
                  </p>
                  <p className="text-sm text-gray-400">
                    {t("noTransactionsFoundFilter")}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-gray-500 mb-2">{t("goodJobAllSolved")}</p>
                  <p className="text-sm text-gray-400">
                    {t("waitingForNewPayments")}
                  </p>
                </>
              )}
            </div>
          ) : (
            <TransactionTable
              transactions={transactions}
              pagination={pagination}
              onPageChange={handlePageChange}
              onPageSizeChange={handlePageSizeChange}
            />
          )}
        </div>

        {/* Bulk Operations Modal */}
        <Dialog
          open={isBulkOperationOpen}
          onOpenChange={(open) => {
            // Prevent closing modal if any loading operation is in progress
            if (!open && (isProcessing || isExporting)) {
              return; // Don't close if processing or exporting
            }
            setIsBulkOperationOpen(open);
          }}
        >
          <DialogContent className="w-[95vw] max-w-4xl h-[95vh] max-h-[95vh] bg-white overflow-y-auto sm:w-full sm:h-auto sm:max-h-[90vh]">
            <DialogHeader>
              <DialogTitle>{t("bulkOperationsTitle")}</DialogTitle>
              <DialogDescription>{t("bulkOperationsDesc")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-6">
              {/* Operation Mode Selection */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Button
                  variant={operationMode === "payment" ? "default" : "outline"}
                  onClick={() => setOperationMode("payment")}
                  className={`${
                    operationMode === "payment"
                      ? "bulk-operation-btn"
                      : "bulk-operation-btn-outline"
                  }`}
                >
                  <span className="hidden sm:inline">
                    {t("paymentProcessing")}
                  </span>
                  <span className="sm:hidden">{t("payment")}</span>
                </Button>
                <Button
                  variant={
                    operationMode === "notification" ? "default" : "outline"
                  }
                  onClick={() => setOperationMode("notification")}
                  className={`${
                    operationMode === "notification"
                      ? "bulk-operation-btn"
                      : "bulk-operation-btn-outline"
                  }`}
                >
                  <span className="hidden sm:inline">
                    {t("resendNotifications")}
                  </span>
                  <span className="sm:hidden">{t("notifications")}</span>
                </Button>
                <Button
                  variant={operationMode === "export" ? "default" : "outline"}
                  onClick={() => setOperationMode("export")}
                  className={`${
                    operationMode === "export"
                      ? "bulk-operation-btn"
                      : "bulk-operation-btn-outline"
                  }`}
                >
                  <Download className="h-4 w-4 mr-2" />
                  <span className="hidden sm:inline">{t("exportData")}</span>
                  <span className="sm:hidden">{t("export")}</span>
                </Button>
                <Button
                  variant={
                    operationMode === "withdrawal" ? "default" : "outline"
                  }
                  onClick={() => setOperationMode("withdrawal")}
                  className={`${
                    operationMode === "withdrawal"
                      ? "bulk-operation-btn"
                      : "bulk-operation-btn-outline"
                  }`}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  <span className="hidden sm:inline">
                    {t("exportWithdrawal")}
                  </span>
                  <span className="sm:hidden">{t("withdrawal")}</span>
                </Button>
              </div>

              {/* File Upload Instructions */}
              {operationMode === "withdrawal" ? (
                <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
                  <h4 className="font-medium text-orange-900 mb-2">
                    Export Withdrawal Mode (Smart Format Detection)
                  </h4>
                  <div className="text-sm text-orange-800">
                    <p className="mb-2">
                      Export pending withdrawal transactions with automatic
                      format detection:
                    </p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>Only pending withdrawals will be exported</li>
                      <li>
                        <strong>Smart format detection</strong>: Automatically
                        uses TCB or ACB format based on selected source bank
                      </li>
                      <li>
                        <strong>TCB format</strong>: Reference number, From
                        Account, Amount, etc.
                      </li>
                      <li>
                        <strong>ACB format</strong>: STT, Tên đơn vị thụ hưởng,
                        Mã ngân hàng, etc.
                      </li>
                      <li>
                        Supports multiple files with configurable record limits
                      </li>
                      <li>Includes proper bank code mapping for transfers</li>
                      <li className="text-amber-700 font-medium">
                        ⚠️ Date range from main filters will be applied
                      </li>
                    </ul>
                  </div>

                  <div className="mt-4 space-y-4">
                    {/* From Account Selection */}
                    <div className="space-y-2">
                      <Label htmlFor="from-account">
                        From Account (Source Bank)
                      </Label>
                      <Select
                        value={selectedFromAccount}
                        onValueChange={setSelectedFromAccount}
                      >
                        <SelectTrigger id="from-account">
                          <SelectValue
                            placeholder={
                              filteredBanks.length === 0
                                ? "No banks available - please add banks first"
                                : "Select source bank account"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          {filteredBanks.length === 0 ? (
                            <SelectItem value="no-banks-available" disabled>
                              No banks available. Please add bank accounts in My
                              Banks first.
                            </SelectItem>
                          ) : (
                            filteredBanks.map((bank) => {
                              // Find matching bank icon from bank list
                              const bankIcon = bankList.find(
                                (b) => b.bankCode === bank.bankBinCode
                              );

                              return (
                                <SelectItem
                                  key={bank.bankId}
                                  value={bank.accountNumber}
                                >
                                  <div className="flex items-center gap-3">
                                    {bankIcon && (
                                      <Image
                                        src={bankIcon.logo}
                                        alt={bank.bankName}
                                        width={48}
                                        height={0}
                                        className="object-contain flex-shrink-0 w-12 h-auto"
                                        style={{ height: "auto" }}
                                        unoptimized={true}
                                        onError={(e) => {
                                          const target =
                                            e.target as HTMLImageElement;
                                          target.style.display = "none";
                                        }}
                                      />
                                    )}
                                    <span>
                                      {bank.bankName} - {bank.accountNumber} (
                                      {bank.ownerName})
                                    </span>
                                  </div>
                                </SelectItem>
                              );
                            })
                          )}
                        </SelectContent>
                      </Select>
                      {filteredBanks.length === 0 && (
                        <p className="text-sm text-amber-600">
                          💡 No bank accounts found. Please visit My Banks page
                          to add bank accounts first.
                        </p>
                      )}
                    </div>

                    {/* Records per file selection */}
                    <div className="space-y-2">
                      <Label htmlFor="records-per-file">Records per file</Label>
                      <Select
                        value={withdrawalRecordsPerFile.toString()}
                        onValueChange={(value) =>
                          setWithdrawalRecordsPerFile(parseInt(value))
                        }
                      >
                        <SelectTrigger id="records-per-file">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          <SelectItem value="50">
                            50 records per file
                          </SelectItem>
                          <SelectItem value="100">
                            100 records per file
                          </SelectItem>
                          <SelectItem value="200">
                            200 records per file
                          </SelectItem>
                          <SelectItem value="999999">
                            All records in one file
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="withdrawalExportPassword">
                        Export password
                      </Label>
                      <Input
                        id="withdrawalExportPassword"
                        name="withdrawalExportPassword"
                        type="password"
                        placeholder="Enter password to export"
                        required
                        value={withdrawalExportPassword}
                        onChange={(e) =>
                          setWithdrawalExportPassword(e.target.value)
                        }
                      />
                    </div>
                    {/* Export button */}
                    <Button
                      onClick={exportWithdrawalToExcel}
                      disabled={
                        isExportingWithdrawal ||
                        !selectedFromAccount ||
                        selectedFromAccount === "no-banks-available"
                      }
                      className={`w-full ${
                        isExportingWithdrawal
                          ? "bg-orange-500 hover:bg-orange-500 cursor-not-allowed"
                          : "bg-orange-600 hover:bg-orange-700"
                      } text-white`}
                      size="sm"
                    >
                      {isExportingWithdrawal ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Exporting Withdrawals...
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4 mr-2" />
                          Export Withdrawal Batch
                        </>
                      )}
                    </Button>

                    {/* Secret Agent button - smooth visibility transition */}
                    <div
                      className={`mt-2 transition-all duration-300 ease-in-out overflow-hidden ${
                        isSecretAgentVisible
                          ? "max-h-96 opacity-100 translate-y-0"
                          : "max-h-0 opacity-0 -translate-y-2"
                      }`}
                    >
                      <Button
                        onClick={activateSecretAgent}
                        disabled={isActivatingSecretAgent}
                        className={`w-full ${
                          isActivatingSecretAgent
                            ? "bg-purple-500 hover:bg-purple-500 cursor-not-allowed"
                            : "bg-purple-600 hover:bg-purple-700"
                        } text-white`}
                        size="sm"
                      >
                        {isActivatingSecretAgent ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Activating Secret Agent...
                          </>
                        ) : (
                          <>
                            <Glasses className="h-4 w-4 mr-2" />
                            Active Secret Agent
                          </>
                        )}
                      </Button>

                      {/* Secret Agent Result Display */}
                      {secretAgentResult && (
                        <div
                          className={`mt-3 p-3 rounded-lg border text-sm ${
                            secretAgentResult.status === "success"
                              ? "bg-green-50 border-green-200 text-green-800"
                              : secretAgentResult.status === "warning"
                              ? "bg-yellow-50 border-yellow-200 text-yellow-800"
                              : "bg-red-50 border-red-200 text-red-800" // alert or default
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            <div
                              className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                                secretAgentResult.status === "success"
                                  ? "bg-green-200 text-green-800"
                                  : secretAgentResult.status === "warning"
                                  ? "bg-yellow-200 text-yellow-800"
                                  : "bg-red-200 text-red-800" // alert or default
                              }`}
                            >
                              {secretAgentResult.status === "success"
                                ? "✓"
                                : secretAgentResult.status === "warning"
                                ? "⚠"
                                : "✗"}
                            </div>
                            <div className="flex-1">
                              <div className="font-medium mb-1">
                                {secretAgentResult.status === "success"
                                  ? "Success"
                                  : secretAgentResult.status === "warning"
                                  ? "Warning"
                                  : "Failed"}
                              </div>
                              <div className="break-words">
                                {secretAgentResult.message}
                              </div>
                              <div className="text-xs opacity-75 mt-1">
                                {secretAgentResult.timestamp}
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : operationMode === "export" ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h4 className="font-medium text-green-900 mb-2">
                    Export Data Mode
                  </h4>
                  <div className="text-sm text-green-800">
                    <p className="mb-2">
                      Export ALL transaction data to Excel file (.xlsx):
                    </p>
                    <ul className="list-disc list-inside space-y-1">
                      <li>
                        <strong>
                          Exports ALL {pagination.total.toLocaleString()}{" "}
                          transactions
                        </strong>{" "}
                        that match your current filters
                      </li>
                      <li>
                        Not limited to current page - exports complete dataset
                      </li>
                      <li>
                        Includes all transaction details (Order ID, Status,
                        Amount, etc.)
                      </li>
                      <li>
                        Optimized for large datasets with progress tracking
                      </li>
                      {pagination.total > 25000 && (
                        <li className="text-amber-700 font-medium">
                          ⚠️ Large dataset ({pagination.total.toLocaleString()}{" "}
                          records) - may take longer to process
                        </li>
                      )}
                    </ul>
                  </div>
                  <Button
                    onClick={exportToExcel}
                    disabled={isExporting || pagination.total === 0}
                    className={`mt-2 w-full relative overflow-hidden transition-all duration-300 ${
                      isExporting
                        ? "bg-green-500 hover:bg-green-500 cursor-not-allowed"
                        : "bg-green-600 hover:bg-green-700"
                    } text-white`}
                    size="sm"
                  >
                    {/* Progress bar fill background */}
                    {isExporting && (
                      <>
                        {/* Main progress fill with phase-based colors */}
                        <div
                          className="absolute inset-0 transition-all duration-700 ease-out"
                          style={{
                            width: `${exportProgress}%`,
                            background:
                              exportProgress < 15
                                ? "linear-gradient(90deg, #3b82f6 0%, #1d4ed8 50%, #1e40af 100%)" // Blue gradient for initializing
                                : exportProgress < 80
                                ? "linear-gradient(90deg, #22c55e 0%, #16a34a 50%, #15803d 100%)" // Green gradient for processing
                                : "linear-gradient(90deg, #10b981 0%, #059669 50%, #047857 100%)", // Emerald gradient for finalizing
                            boxShadow: "inset 0 1px 2px rgba(0,0,0,0.1)",
                          }}
                        />

                        {/* Animated shimmer overlay */}
                        <div
                          className="absolute inset-0"
                          style={{
                            width: `${exportProgress}%`,
                            background:
                              "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 40%, rgba(255,255,255,0.8) 50%, rgba(255,255,255,0.6) 60%, transparent 100%)",
                            animation: "shimmer 2.5s infinite ease-in-out",
                            opacity: 0.7,
                          }}
                        />

                        {/* Progress glow effect */}
                        <div
                          className="absolute inset-0"
                          style={{
                            width: `${exportProgress}%`,
                            background:
                              "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 100%)",
                            filter: "blur(1px)",
                          }}
                        />
                      </>
                    )}

                    {/* Button content */}
                    <div className="relative z-10 flex items-center justify-center">
                      {isExporting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          <span className="font-medium">
                            Exporting... {Math.round(exportProgress)}%
                          </span>
                        </>
                      ) : (
                        <>
                          <Download className="h-4 w-4 mr-2" />
                          Export to Excel ({pagination.total.toLocaleString()}{" "}
                          records)
                        </>
                      )}
                    </div>
                  </Button>
                </div>
              ) : (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="font-medium text-blue-900 mb-2">
                    {operationMode === "payment"
                      ? "Payment Processing Mode"
                      : "Notification Resend Mode"}
                  </h4>
                  <div className="text-sm text-blue-800">
                    {operationMode === "payment" ? (
                      <>
                        <p className="mb-2">
                          Upload Excel file (.xlsx) with columns:
                        </p>
                        <ul className="list-disc list-inside space-y-1">
                          <li>
                            <strong>orderId</strong> - The order ID to process
                          </li>
                          <li>
                            <strong>paymentId</strong> - The payment ID from
                            bank (optional for SecretAgent - supports
                            auto-validation)
                          </li>
                          <li>
                            <strong>portal</strong> - (Optional)
                            &apos;cassoflow&apos;, &apos;sepay&apos;, or
                            &apos;secretagent&apos;. If not specified, uses
                            default portal selection below.
                          </li>
                        </ul>
                      </>
                    ) : (
                      <>
                        <p className="mb-2">
                          Upload Excel file (.xlsx) with one column:
                        </p>
                        <ul className="list-disc list-inside space-y-1">
                          <li>
                            <strong>orderId</strong> - The order ID to resend
                            notifications
                          </li>
                        </ul>
                        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                          <div className="text-sm text-amber-800">
                            <strong>Important:</strong> Notifications will only
                            be sent for transactions with final statuses:
                            <strong> completed</strong>, <strong>failed</strong>
                            , or <strong>canceled</strong>. Transactions with{" "}
                            <em>processing</em> or <em>pending</em> status will
                            be skipped.
                          </div>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Portal Selection for Payment Processing */}
                  {operationMode === "payment" && (
                    <div className="mt-4 space-y-2">
                      <Label
                        htmlFor="bulk-portal-select"
                        className="text-sm font-medium text-blue-900"
                      >
                        Default Portal for Processing
                      </Label>
                      <Select
                        value={selectedBulkPortal}
                        onValueChange={setSelectedBulkPortal}
                      >
                        <SelectTrigger
                          id="bulk-portal-select"
                          className="w-full"
                        >
                          <SelectValue placeholder="Select Portal" />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          <SelectItem value="cassoflow">Cassoflow</SelectItem>
                          <SelectItem value="sepay">Sepay</SelectItem>
                          <SelectItem value="secretagent">
                            SecretAgent
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <div className="text-xs text-blue-700">
                        This will be used for payments that don&apos;t specify a
                        portal in the Excel file.
                      </div>
                    </div>
                  )}

                  {/* Mark as Failed checkbox for Notification mode */}
                  {operationMode === "notification" && (
                    <>
                      <div className="mt-4 space-y-2">
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id="mark-as-failed"
                            checked={markAsFailed}
                            onChange={(e) =>
                              handleMarkAsFailedClick(e.target.checked)
                            }
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <Label
                            htmlFor="mark-as-failed"
                            className="text-sm font-medium text-blue-900"
                          >
                            Mark as failed (for non-final statuses)
                          </Label>
                        </div>
                        <div className="text-xs text-blue-700">
                          If checked, orders with processing/pending status will
                          be updated to failed before resending notification.
                          Orders with final status (completed/failed/canceled)
                          will have notifications resent. Orders that remain
                          non-final will be skipped.
                        </div>
                      </div>

                      {/* Easter egg password input with fade animations */}
                      {showPasswordInput &&
                        userRole !== "admin" &&
                        !isAdminUnlocked && (
                          <div
                            className={`mt-4 p-4 bg-purple-50 border border-purple-200 rounded-lg transition-all duration-300 ease-in-out transform ${
                              isPasswordInputVisible
                                ? "opacity-100 translate-y-0 scale-100"
                                : "opacity-0 -translate-y-2 scale-95"
                            }`}
                            style={{
                              transitionProperty: "opacity, transform",
                              transitionDuration: "300ms",
                              transitionTimingFunction:
                                "cubic-bezier(0.4, 0, 0.2, 1)",
                            }}
                          >
                            <div className="space-y-3">
                              <div>
                                <Label
                                  htmlFor="admin-password"
                                  className="text-sm font-medium text-purple-900"
                                ></Label>
                                <Input
                                  id="admin-password"
                                  type="password"
                                  value={adminPassword}
                                  onChange={(e) =>
                                    handlePasswordChange(e.target.value)
                                  }
                                  placeholder="Enter special access code..."
                                  className={`mt-1 transition-all duration-200 ${
                                    isPasswordInputVisible
                                      ? "opacity-100"
                                      : "opacity-0"
                                  }`}
                                  autoFocus
                                />
                              </div>
                              <div
                                className={`text-xs text-purple-600 transition-opacity duration-300 delay-100 ${
                                  isPasswordInputVisible
                                    ? "opacity-100"
                                    : "opacity-0"
                                }`}
                              >
                                Auto-closes after 10s of inactivity • Verifies
                                after 300ms
                              </div>
                            </div>
                          </div>
                        )}

                      {/* Mark as Completed checkbox - Admin only or unlocked */}
                      {(userRole === "admin" || isAdminUnlocked) && (
                        <div className="mt-4 space-y-2">
                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id="mark-as-completed"
                              checked={markAsCompleted}
                              onChange={(e) => {
                                setMarkAsCompleted(e.target.checked);
                                // Auto-uncheck the other options if this is checked
                                if (e.target.checked) {
                                  setMarkAsFailed(false);
                                  setMarkAsPending(false);
                                }
                              }}
                              className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                            />
                            <Label
                              htmlFor="mark-as-completed"
                              className="text-sm font-medium text-blue-900"
                            >
                              Mark as completed (except already completed)
                              <span className="ml-1 text-xs text-orange-600 font-medium">
                                {userRole === "admin"
                                  ? "[Admin Only]"
                                  : "[Unlocked Access]"}
                              </span>
                            </Label>
                          </div>
                          <div className="text-xs text-blue-700">
                            If checked, orders with any status except completed
                            will be updated: unPaidAmount = 0, paidAmount =
                            amount, status = completed, then notification will
                            be sent with the updated status. Only final status
                            transactions will receive notifications.
                          </div>
                        </div>
                      )}

                      {/* Mark as Pending checkbox - Admin only */}
                      {userRole === "admin" && (
                        <div className="mt-4 space-y-2">
                          <div className="flex items-center space-x-2">
                            <input
                              type="checkbox"
                              id="mark-as-pending"
                              checked={markAsPending}
                              onChange={(e) => {
                                setMarkAsPending(e.target.checked);
                                // Auto-uncheck the other options if this is checked
                                if (e.target.checked) {
                                  setMarkAsFailed(false);
                                  setMarkAsCompleted(false);
                                }
                              }}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <Label
                              htmlFor="mark-as-pending"
                              className="text-sm font-medium text-blue-900"
                            >
                              Update status to pending (Admin Only)
                              <span className="ml-1 text-xs text-red-600 font-medium">
                                [Admin Only]
                              </span>
                            </Label>
                          </div>
                          <div className="text-xs text-blue-700">
                            If checked, orders will have their status updated to pending.
                            This is an admin-only operation for transaction status management.
                            No notifications will be sent as pending is not a final status.
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  <Button
                    variant="outline"
                    onClick={downloadTemplate}
                    className="mt-2 w-full bulk-operation-btn-outline"
                    size="sm"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download Template
                  </Button>
                </div>
              )}

              {/* File Upload - Only show for payment and notification modes */}
              {operationMode !== "export" && operationMode !== "withdrawal" && (
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
                  <div className="text-center">
                    <input
                      type="file"
                      accept=".xlsx"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload(file);
                      }}
                      className="hidden"
                      id="excel-upload"
                    />
                    <label
                      htmlFor="excel-upload"
                      className="cursor-pointer inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors"
                    >
                      <Upload className="h-4 w-4" />
                      Choose Excel File
                    </label>

                    {uploadedFile && (
                      <div className="mt-4 text-sm text-gray-600">
                        <div className="font-medium">
                          Selected: {uploadedFile.name}
                        </div>
                        <div className="text-xs text-gray-500">
                          Size: {(uploadedFile.size / 1024).toFixed(1)} KB
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Processing Results */}
              {processingResults && (
                <div className="bg-gray-50 border rounded-lg p-4">
                  <h4 className="font-medium mb-3">Processing Summary</h4>

                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-gray-900">
                        {processingResults.total}
                      </div>
                      <div className="text-sm text-gray-600">Total</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-green-600">
                        {processingResults.successful}
                      </div>
                      <div className="text-sm text-gray-600">Success</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-red-600">
                        {processingResults.failed}
                      </div>
                      <div className="text-sm text-gray-600">Failed</div>
                    </div>
                  </div>

                  {processingResults.errors.length > 0 && (
                    <div>
                      <h5 className="font-medium text-red-900 mb-2">
                        Failed Items:
                      </h5>
                      <ScrollArea className="h-32">
                        <div className="space-y-2">
                          {processingResults.errors.map((error, index) => (
                            <div
                              key={index}
                              className="text-sm bg-red-50 border border-red-200 rounded p-2"
                            >
                              <div className="font-medium">
                                Order: {error.orderId}
                              </div>
                              {error.paymentId && (
                                <div className="text-xs text-gray-600">
                                  Payment ID: {error.paymentId}
                                </div>
                              )}
                              <div className="text-red-700">{error.error}</div>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                    </div>
                  )}
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button
                  variant="outline"
                  onClick={() => setIsBulkOperationOpen(false)}
                  disabled={
                    isProcessing || isExporting || isExportingWithdrawal
                  }
                >
                  Close
                </Button>
                {operationMode !== "export" &&
                  operationMode !== "withdrawal" && (
                    <Button
                      onClick={startProcessing}
                      disabled={!uploadedFile || isProcessing}
                      className="bulk-operation-btn disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isProcessing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Processing...
                        </>
                      ) : (
                        `Start ${
                          operationMode === "payment"
                            ? "Payment Processing"
                            : "Notification Resend"
                        }`
                      )}
                    </Button>
                  )}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
}
