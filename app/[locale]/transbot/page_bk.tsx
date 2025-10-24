"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useTranslations, useLocale } from "next-intl";
import { DynamicTable } from "@/components/DynamicTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Search, RefreshCw } from "lucide-react";

// Define the Transaction interface based on Supabase schema
interface SupabaseTransaction {
  id: number;
  chat_id: number;
  entryType: "in" | "out" | "pay";
  amount: number;
  entryExchangeRate?: number;
  entryFee?: number;
  updatedReason?: string;
  updatedByUser?: string;
  updatedAt?: string;
  createdByUser: string;
  createdAt: string;
}

// Filter interface
interface TransactionFilters {
  entryType: string;
  fromDate: string;
  toDate: string;
  orderBy: string;
  order: string;
  search: string;
}

export default function TransBotPage() {
  // Translation hooks
  const t = useTranslations("transbot");
  const locale = useLocale();

  // State management
  const [transactions, setTransactions] = useState<SupabaseTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chatId, setChatId] = useState<string>(""); // User needs to specify chat_id

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);

  // Filter state - default to today's date
  const [filters, setFilters] = useState<TransactionFilters>(() => {
    const today = new Date().toISOString().split("T")[0]; // Get today's date in YYYY-MM-DD format
    return {
      entryType: "all",
      fromDate: today,
      toDate: today,
      orderBy: "createdAt",
      order: "desc",
      search: "",
    };
  });

  // Fetch transactions using API route
  const fetchTransactions = useCallback(async () => {
    if (!chatId.trim()) {
      setError(t("pleaseEnterChatId"));
      setLoading(false);
      return;
    }

    // Validate chat_id is a number
    if (isNaN(Number(chatId))) {
      setError(t("chatIdMustBeNumber"));
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Build query parameters
      const params = new URLSearchParams({
        chat_id: chatId,
        limit: pageSize === -1 ? "999999" : pageSize.toString(),
        page: currentPage.toString(),
        order_by: filters.orderBy,
        order: filters.order,
      });

      // Add optional filters
      if (filters.entryType && filters.entryType !== "all") {
        params.append("entryType", filters.entryType);
      }

      // If no dates are set, default to today
      const today = new Date().toISOString().split("T")[0];
      const fromDate = filters.fromDate || today;
      const toDate = filters.toDate || today;

      params.append("from_date", fromDate);
      params.append("to_date", toDate);

      if (filters.search) {
        params.append("search", filters.search);
      }

      const url = `/api/transbot?${params}`;

      const response = await fetch(url, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "XMLHttpRequest",
          "X-App-Token": "transbot-secure-access",
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          errorData.error || `HTTP error! status: ${response.status}`
        );
      }

      const data = await response.json();

      if (data.status) {
        setTransactions(data.data || []);
        setTotalPages(data.pagination.total_pages);
        setTotalItems(data.pagination.total_count);
      } else {
        throw new Error(data.error || "Failed to fetch transactions");
      }
    } catch (err) {
      console.error("Fetch error:", err);
      setError(err instanceof Error ? err.message : "An error occurred");
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [chatId, currentPage, pageSize, filters, t]);

  // Filtered transactions for search
  const filteredTransactions = useMemo(() => {
    if (!filters.search.trim()) return transactions;

    const searchTerm = filters.search.toLowerCase();
    return transactions.filter(
      (transaction) =>
        transaction.id.toString().includes(searchTerm) ||
        transaction.createdByUser.toLowerCase().includes(searchTerm) ||
        transaction.entryType.toLowerCase().includes(searchTerm) ||
        transaction.amount.toString().includes(searchTerm)
    );
  }, [transactions, filters.search]);

  // Effect to reset page when chat_id changes
  useEffect(() => {
    setCurrentPage(1);
  }, [chatId]);

  // Effect to fetch data when dependencies change
  useEffect(() => {
    if (chatId.trim()) {
      fetchTransactions();
    }
  }, [chatId, currentPage, pageSize, filters, fetchTransactions]);

  // Handle chat ID change
  const handleChatIdChange = (value: string) => {
    setChatId(value);
    // Reset pagination when changing chat_id
    setCurrentPage(1);
    // Clear previous data
    setTransactions([]);
    setTotalPages(1);
    setTotalItems(0);
    setError(null);
  };

  // Handle filter changes
  const handleFilterChange = (key: keyof TransactionFilters, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setCurrentPage(1); // Reset to first page when filtering
  };

  // Handle page changes
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  // Handle page size changes
  const handlePageSizeChange = (newPageSize: number) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  // Clear all filters
  const clearFilters = () => {
    const today = new Date().toISOString().split("T")[0];
    setFilters({
      entryType: "all",
      fromDate: today,
      toDate: today,
      orderBy: "createdAt",
      order: "desc",
      search: "",
    });
    setCurrentPage(1);
  };

  // Table columns definition - matching the image layout
  const columns = [
    {
      header: t("number"),
      cell: (transaction: SupabaseTransaction) => {
        const index = filteredTransactions.findIndex(
          (t) => t.id === transaction.id
        );
        return (
          <span className="text-gray-600 text-sm">
            {pageSize === -1
              ? index + 1
              : index + 1 + (currentPage - 1) * pageSize}
          </span>
        );
      },
      width: "60px",
    },
    {
      header: t("time"),
      cell: (transaction: SupabaseTransaction) => (
        <div className="text-sm">
          {/* Show date when date filters are applied, otherwise just time */}
          {filters.fromDate || filters.toDate ? (
            <>
              <div className="text-gray-900">
                {new Date(transaction.createdAt).toLocaleDateString(locale)}
              </div>
              <div className="text-gray-500 text-xs">
                {new Date(transaction.createdAt).toLocaleTimeString(locale, {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </div>
            </>
          ) : (
            new Date(transaction.createdAt).toLocaleTimeString(locale, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })
          )}
        </div>
      ),
      width: "120px",
    },
    {
      header: t("amount"),
      cell: (transaction: SupabaseTransaction) => (
        <span className="font-medium text-blue-600 text-sm">
          {transaction.amount.toLocaleString()}
        </span>
      ),
      width: "120px",
    },
    {
      header: t("type"),
      cell: (transaction: SupabaseTransaction) => (
        <span
          className={`text-sm font-medium px-2 py-1 rounded ${
            transaction.entryType === "in"
              ? "bg-green-100 text-green-700"
              : transaction.entryType === "out"
              ? "bg-red-100 text-red-700"
              : "bg-blue-100 text-blue-700"
          }`}
        >
          {transaction.entryType.toUpperCase()}
        </span>
      ),
      width: "80px",
    },
    {
      header: t("transactionDetails"),
      cell: (transaction: SupabaseTransaction) => (
        <div className="text-sm">
          {transaction.entryExchangeRate &&
          transaction.entryFee !== undefined ? (
            <div>
              {(transaction.entryFee || 0) === 0 ? (
                // No fee case: just show amount/rate=result
                <>
                  <span className="text-gray-700">
                    {transaction.amount}/{transaction.entryExchangeRate}=
                  </span>
                  <span
                    className={`font-medium ${
                      transaction.entryType === "in"
                        ? "text-green-600"
                        : transaction.entryType === "out"
                        ? "text-red-600"
                        : "text-blue-600"
                    }`}
                  >
                    {(
                      transaction.amount / transaction.entryExchangeRate
                    ).toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    U
                  </span>
                </>
              ) : (
                // With fee case: show amount×feeRate/rate=result
                <>
                  <span className="text-gray-700">
                    {transaction.amount}×
                    {(100 - (transaction.entryFee || 0)) / 100}/
                    {transaction.entryExchangeRate}=
                  </span>
                  <span
                    className={`font-medium ${
                      transaction.entryType === "in"
                        ? "text-green-600"
                        : transaction.entryType === "out"
                        ? "text-red-600"
                        : "text-blue-600"
                    }`}
                  >
                    {(
                      (transaction.amount *
                        (100 - (transaction.entryFee || 0))) /
                      100 /
                      transaction.entryExchangeRate
                    ).toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    U
                  </span>
                </>
              )}
            </div>
          ) : transaction.entryExchangeRate ? (
            <div>
              <span className="text-gray-700">
                {transaction.amount}/{transaction.entryExchangeRate}=
              </span>
              <span
                className={`font-medium ${
                  transaction.entryType === "in"
                    ? "text-green-600"
                    : transaction.entryType === "out"
                    ? "text-red-600"
                    : "text-blue-600"
                }`}
              >
                {(
                  transaction.amount / transaction.entryExchangeRate
                ).toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}{" "}
                U
              </span>
            </div>
          ) : (
            <span className="text-gray-400">N/A</span>
          )}
        </div>
      ),
      width: "200px",
    },
    {
      header: t("operator"),
      cell: (transaction: SupabaseTransaction) => (
        <span className="text-sm text-gray-700">
          {transaction.updatedByUser || transaction.createdByUser}
        </span>
      ),
      width: "120px",
    },
  ];

  return (
    <div className="container mx-auto p-4 space-y-4">
      {/* Header with date and summary */}
      <div className="bg-white rounded-lg shadow-sm border p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-medium text-gray-800">
              {/* Show date range if filters are applied, otherwise show today's date */}
              {filters.fromDate || filters.toDate ? (
                <span>
                  {filters.fromDate && filters.toDate
                    ? `${new Date(filters.fromDate).toLocaleDateString(
                        locale
                      )} ${t("to")} ${new Date(
                        filters.toDate
                      ).toLocaleDateString(locale)}`
                    : filters.fromDate
                    ? `${t("from")}: ${new Date(
                        filters.fromDate
                      ).toLocaleDateString(locale)}`
                    : `${t("to")}: ${new Date(
                        filters.toDate
                      ).toLocaleDateString(locale)}`}
                </span>
              ) : (
                new Date().toLocaleDateString(locale, {
                  year: "numeric",
                  month: "2-digit",
                  day: "2-digit",
                  weekday: "long",
                })
              )}
            </h1>
            {chatId && (
              <span className="text-gray-600">
                {t("chatId")}: {chatId}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {totalItems > 0 && (
              <div className="flex items-center gap-4 text-sm text-gray-600">
                <span>
                  <span className="text-green-600">{t("deposit")}</span>:{" "}
                  {
                    filteredTransactions.filter((t) => t.entryType === "in")
                      .length
                  }{" "}
                  {t("items")}
                </span>
                <span>
                  <span className="text-red-600">{t("withdraw")}</span>:{" "}
                  {
                    filteredTransactions.filter((t) => t.entryType === "out")
                      .length
                  }{" "}
                  {t("items")}
                </span>
                <span>
                  <span className="text-blue-600">{t("payment")}</span>:{" "}
                  {
                    filteredTransactions.filter((t) => t.entryType === "pay")
                      .length
                  }{" "}
                  {t("items")}
                </span>
              </div>
            )}
            <Button
              onClick={fetchTransactions}
              disabled={loading || !chatId.trim()}
              size="sm"
              variant="outline"
            >
              <RefreshCw
                className={`w-4 h-4 mr-1 ${loading ? "animate-spin" : ""}`}
              />
              {t("refresh")}
            </Button>
          </div>
        </div>
      </div>

      {/* Chat ID Input - Compact */}
      <Card className="bg-white shadow-sm">
        <CardContent className="p-4">
          <div className="flex gap-3 items-center">
            <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
              {t("chatId")}:
            </label>
            <Input
              type="number"
              placeholder={t("chatIdPlaceholder")}
              value={chatId}
              onChange={(e) => handleChatIdChange(e.target.value)}
              className="flex-1 max-w-xs"
            />
            <Button
              onClick={fetchTransactions}
              disabled={!chatId.trim()}
              size="sm"
            >
              {t("query")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Compact Filters */}
      <Card className="bg-white shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-center">
            {/* Search */}
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-gray-400" />
              <Input
                placeholder={t("searchPlaceholder")}
                value={filters.search}
                onChange={(e) => handleFilterChange("search", e.target.value)}
                className="w-48"
              />
            </div>

            {/* Entry Type */}
            <Select
              value={filters.entryType}
              onValueChange={(value) => handleFilterChange("entryType", value)}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder={t("allTypes")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allTypes")}</SelectItem>
                <SelectItem value="in">{t("deposit")}</SelectItem>
                <SelectItem value="out">{t("withdraw")}</SelectItem>
                <SelectItem value="pay">{t("payment")}</SelectItem>
              </SelectContent>
            </Select>

            {/* Date Range */}
            <Input
              type="date"
              value={filters.fromDate}
              onChange={(e) => handleFilterChange("fromDate", e.target.value)}
              className="w-40"
            />
            <span className="text-gray-500">{t("to")}</span>
            <Input
              type="date"
              value={filters.toDate}
              onChange={(e) => handleFilterChange("toDate", e.target.value)}
              className="w-40"
            />

            {/* Order */}
            <Select
              value={filters.order}
              onValueChange={(value) => handleFilterChange("order", value)}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">{t("latest")}</SelectItem>
                <SelectItem value="asc">{t("oldest")}</SelectItem>
              </SelectContent>
            </Select>

            {/* Clear */}
            <Button variant="outline" onClick={clearFilters} size="sm">
              {t("clear")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Error Display */}
      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4">
            <div className="text-red-600">
              <strong>{t("error")}:</strong> {error}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Transactions Table */}
      <Card className="bg-white shadow-sm">
        <CardContent className="p-0">
          <DynamicTable
            data={filteredTransactions}
            columns={columns}
            pagination={true}
            externalPagination={true}
            currentPage={currentPage}
            totalPages={totalPages}
            totalItems={totalItems}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            pageSize={pageSize}
            pageSizeOptions={[10, 50, 100, -1]}
          />
        </CardContent>
      </Card>

      {/* Transaction Details - respecting filter conditions */}
      {filteredTransactions.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border p-4 space-y-4">
          {/* Distribution Summary */}
          <div>
            <h3 className="font-medium text-gray-800 mb-3">
              {t("distributionSummary")}
            </h3>
            <div className="bg-gray-50 p-3 rounded space-y-2">
              {(() => {
                // Calculate totals based on exchange rate results
                let totalIn = 0;
                let totalOut = 0;
                let totalPay = 0;

                filteredTransactions.forEach((t) => {
                  let exchangeResult = 0;
                  if (t.entryExchangeRate && t.entryFee !== undefined) {
                    if ((t.entryFee || 0) === 0) {
                      exchangeResult = t.amount / t.entryExchangeRate;
                    } else {
                      exchangeResult =
                        (t.amount * (100 - (t.entryFee || 0))) /
                        100 /
                        t.entryExchangeRate;
                    }
                  } else if (t.entryExchangeRate) {
                    exchangeResult = t.amount / t.entryExchangeRate;
                  } else {
                    exchangeResult = t.amount;
                  }

                  if (t.entryType === "in") {
                    totalIn += exchangeResult;
                  } else if (t.entryType === "out") {
                    totalOut += exchangeResult;
                  } else if (t.entryType === "pay") {
                    totalPay += exchangeResult;
                  }
                });

                const shouldDistribute = totalIn - totalOut;
                const alreadyDistributed = totalPay;
                const notYetDistributed = totalPay - (totalIn - totalOut);

                return (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-green-600">
                        {t("shouldDistribute")}
                      </span>
                      <span className="font-bold text-green-500">
                        {shouldDistribute.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                        U
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-blue-600">
                        {t("alreadyDistributed")}
                      </span>
                      <span className="font-bold text-blue-500">
                        {alreadyDistributed.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                        U
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-red-600">
                        {t("notYetDistributed")}
                      </span>
                      <span className="font-bold text-red-500">
                        {notYetDistributed.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                        U
                      </span>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
