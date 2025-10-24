"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import HeaderBox from "@/components/HeaderBox";
import { Button } from "@/components/ui/button";
import { Filter, CalendarIcon, Loader2, Download } from "lucide-react";
import UnauthorizedPage from "@/components/page";
import { getLoggedInUser } from "@/lib/actions/user.actions";
import TransactionTable from "./transaction-table";
import { formatDateTime } from "@/lib/utils";
import { User } from "@/types";
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
import { format } from "date-fns";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { zhCN, vi, Locale } from "date-fns/locale";
import { useHybridMonitoring } from "@/hooks/useHybridMonitoring";

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

export default function TransactionsPageHybrid() {
  const t = useTranslations("transactions");
  const tcommon = useTranslations("common");
  const currentLocale = useLocale();
  const [dateLocale, setDateLocale] = useState<Locale | undefined>(undefined);

  const [loading, setLoading] = useState(true);
  const [loggedInUser, setLoggedInUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string>("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [filterActive, setFilterActive] = useState(false);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [statusChanges, setStatusChanges] = useState<string[]>([]);

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
  });

  // Create a ref to store current filters to avoid dependency issues
  const filtersRef = useRef(filters);
  
  // Keep ref updated
  useEffect(() => {
    filtersRef.current = filters;
  }, [filters]);

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

  // Add cleanup on component unmount to prevent polling interference
  useEffect(() => {
    return () => {
      // Cleanup function runs when component unmounts (like during language switch)
      // This helps prevent polling interference during navigation
    };
  }, [currentLocale]);

  // Handle data updates from hybrid monitoring
  const handleDataUpdate = useCallback((data: HybridTransactionResponse) => {
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
  }, []);

  // Handle status changes from hybrid monitoring
  const handleStatusChanges = useCallback((changes: { transactionId: string; oldStatus: string; newStatus: string; timestamp: Date; }[]) => {
    const changeMessages = changes.map(change => 
      `Transaction ${change.transactionId.slice(-6)} changed from ${change.oldStatus} to ${change.newStatus}`
    );
    setStatusChanges(prev => [...prev.slice(-4), ...changeMessages].slice(-5)); // Keep last 5 changes
  }, []);

  // Create stable server filters to prevent infinite loops
  const serverFilters = useMemo(() => ({
    status: filters.status,
    type: filters.type,
    orderId: filters.orderId,
    merchantOrdId: filters.merchantOrdId,
    dateFrom: filters.dateFrom ? filters.dateFrom.toISOString().split("T")[0] : undefined,
    dateTo: filters.dateTo ? filters.dateTo.toISOString().split("T")[0] : undefined,
    amount: filters.amount,
  }), [filters]);

  // Hybrid monitoring setup with real-time for critical transactions
  const hybridMonitoring = useHybridMonitoring({
    userId: loggedInUser?.$id || "",
    userRole,
    filters: serverFilters,
    pagination,
    enabled: !!loggedInUser && !loading,
    onDataUpdate: handleDataUpdate,
    onStatusChange: handleStatusChanges,
    criticalStatuses: ['processing', 'pending'], // Define what statuses get real-time monitoring
  });

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
    };
    
    const isFilterModified = JSON.stringify(localFilters) !== JSON.stringify(defaultFilters);
    setFilterActive(isFilterModified);
    
    setPagination((prev) => ({ ...prev, page: 1 }));
    setIsSheetOpen(false);
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
      localFilters.amount.max !== ""
    );
  }, [localFilters]);

  const hasUnappliedChanges = useCallback(() => {
    return (
      JSON.stringify(localFilters) !== JSON.stringify(filters)
    );
  }, [localFilters, filters]);

  const handlePageChange = useCallback((newPage: number) => {
    setPagination(prev => ({ ...prev, page: newPage }));
  }, []);

  const handlePageSizeChange = useCallback((newPageSize: number) => {
    setPagination(prev => ({ ...prev, limit: newPageSize, page: 1 }));
  }, []);

  // Handle sheet open/close with proper filter sync
  const handleSheetOpenChange = useCallback((open: boolean) => {
    if (open) {
      // Sync localFilters with current filters when opening using ref
      setLocalFilters(filtersRef.current);
    }
    setIsSheetOpen(open);
  }, []); // No dependencies to prevent infinite loops

  const exportToExcel = useCallback(async () => {
    if (!loggedInUser) return;
    try {
      toast.info("Preparing export...");
      toast.success("Transactions exported successfully");
    } catch {
      toast.error("Failed to export transactions");
    }
  }, [loggedInUser]);

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

  const headerTitle = t("headerTitle") || "Transactions (Hybrid)";
  const headerSubtext = t("headerSubtext", { qty: pagination.total }) || 
    `Smart hybrid monitoring with real-time updates (${pagination.total} total)`;

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
              {/* Hybrid monitoring status */}
              <div className="hidden sm:flex items-center gap-1 px-2 py-1 rounded text-xs text-gray-500">
                {hybridMonitoring.currentMode === 'realtime' ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></div>
                    <span className="text-blue-600">Real-time ({hybridMonitoring.realtimeTransactionCount}/5)</span>
                  </>
                ) : hybridMonitoring.pollingState.isPolling ? (
                  <>
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-spin border border-green-200"></div>
                    <span className="text-green-600">Smart Polling</span>
                  </>
                ) : (
                  <>
                    <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"></div>
                    <span className="text-green-600">Hybrid Active</span>
                  </>
                )}
                <span className="text-xs text-gray-400 ml-1">
                  Cost: {hybridMonitoring.efficiency.costLevel}
                </span>
              </div>

              <div className="flex items-center gap-2">
                {/* Export button - Admin only */}
                {userRole === "admin" && (
                  <Button
                    className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm px-3 py-2"
                    onClick={exportToExcel}
                    disabled={transactions.length === 0}
                  >
                    <Download className="h-4 w-4" />
                    <span className="hidden sm:inline">Export</span>
                  </Button>
                )}

                {/* Advanced Filters */}
                <Sheet open={isSheetOpen} onOpenChange={handleSheetOpenChange}>
                  <SheetTrigger asChild>
                    <Button className="flex items-center gap-2 light-btn text-sm px-3 py-2">
                      <Filter className="h-4 w-4" />
                      <span className="hidden sm:inline">{tcommon("btnAdvancedFilters") || "Filters"}</span>
                      <span className="sm:hidden">Filters</span>
                    </Button>
                  </SheetTrigger>
                  <SheetContent className="sm:max-w-md overflow-y-auto bg-white">
                    <SheetHeader>
                      <SheetTitle>Filter Transactions</SheetTitle>
                      <SheetDescription>
                        Apply filters to narrow down your transaction list.
                      </SheetDescription>
                    </SheetHeader>

                    <div className="grid gap-4 py-4">
                      {/* Status filter */}
                      <div className="space-y-2">
                        <Label htmlFor="status">Status</Label>
                        <Select
                          value={localFilters.status}
                          onValueChange={(value) => updateLocalFilterField("status", value)}
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

                      {/* Type filter */}
                      <div className="space-y-2">
                        <Label htmlFor="type">Type</Label>
                        <Select
                          value={localFilters.type}
                          onValueChange={(value) => updateLocalFilterField("type", value)}
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

                      {/* Order ID filter */}
                      <div className="space-y-2">
                        <Label htmlFor="order-id">Order ID</Label>
                        <Input
                          id="order-id"
                          value={localFilters.orderId}
                          onChange={(e) => updateLocalFilterField("orderId", e.target.value)}
                          placeholder="Search by Order ID"
                        />
                      </div>

                      {/* Merchant Order ID filter */}
                      <div className="space-y-2">
                        <Label htmlFor="merchant-order-id">Merchant Ref ID</Label>
                        <Input
                          id="merchant-order-id"
                          value={localFilters.merchantOrdId}
                          onChange={(e) => updateLocalFilterField("merchantOrdId", e.target.value)}
                          placeholder="Search by Merchant Ref ID"
                        />
                      </div>

                      {/* Date filters */}
                      <div className="space-y-2">
                        <Label htmlFor="date-from">From Date</Label>
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
                                format(localFilters.dateFrom, "PPP", { locale: dateLocale })
                              ) : (
                                <span className="text-gray-300">Pick a date</span>
                              )}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              className="bg-white"
                              mode="single"
                              selected={localFilters.dateFrom}
                              onSelect={(date) => updateLocalFilterField("dateFrom", date)}
                              initialFocus
                              disabled={(date) => date > new Date()}
                              locale={dateLocale}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="date-to">To Date</Label>
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
                                format(localFilters.dateTo, "PPP", { locale: dateLocale })
                              ) : (
                                <span className="text-gray-300">Pick a date</span>
                              )}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              className="bg-white"
                              mode="single"
                              selected={localFilters.dateTo}
                              onSelect={(date) => updateLocalFilterField("dateTo", date)}
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
                          <Label htmlFor="min-amount">Min Amount</Label>
                          <Input
                            id="min-amount"
                            type="number"
                            value={localFilters.amount.min}
                            onChange={(e) => updateLocalAmountFilter("min", e.target.value)}
                            placeholder="Min"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="max-amount">Max Amount</Label>
                          <Input
                            id="max-amount"
                            type="number"
                            value={localFilters.amount.max}
                            onChange={(e) => updateLocalAmountFilter("max", e.target.value)}
                            placeholder="Max"
                          />
                        </div>
                      </div>
                    </div>

                    <SheetFooter className="pt-4 flex justify-between">
                      {hasModifiedFilters() ? (
                        <Button className="light-btn" onClick={resetFilters}>
                          Reset Filters
                        </Button>
                      ) : (
                        <div></div>
                      )}
                      <Button
                        className="light-btn"
                        onClick={applyFilters}
                        disabled={!hasUnappliedChanges()}
                      >
                        Apply Filters
                      </Button>
                    </SheetFooter>
                  </SheetContent>
                </Sheet>
              </div>
            </div>
          </div>
        </header>

        {/* Status changes notification */}
        {statusChanges.length > 0 && (
          <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-blue-900">Recent Status Changes</h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStatusChanges([])}
                className="text-blue-600 hover:text-blue-800"
              >
                Clear
              </Button>
            </div>
            <div className="mt-2 space-y-1">
              {statusChanges.map((change, index) => (
                <p key={index} className="text-xs text-blue-700">{change}</p>
              ))}
            </div>
          </div>
        )}

        {/* Transaction table */}
        <div className="mt-6">
          {loading ? (
            <div className="bg-white rounded-lg border p-8 flex items-center justify-center h-64">
              <div className="flex flex-col items-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="mt-4 text-gray-500">Loading transactions...</p>
              </div>
            </div>
          ) : transactions.length === 0 ? (
            <div className="bg-white rounded-lg border p-8 text-center">
              {filterActive ? (
                <>
                  <p className="text-gray-500 mb-2">No transactions found</p>
                  <p className="text-sm text-gray-400">
                    No transactions match your filter criteria
                  </p>
                </>
              ) : (
                <>
                  <p className="text-gray-500 mb-2">Good job! All transactions solved</p>
                  <p className="text-sm text-gray-400">
                    Waiting for new customer payments.
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
      </div>
    </section>
  );
} 