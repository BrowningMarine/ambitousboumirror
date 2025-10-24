"use client";

import { useState, useEffect, useCallback } from "react";
import DynamicChart from "./DynamicChart";
import { getTransactionsForCharts } from "@/lib/actions/dashboard.actions";
import { format, addDays, startOfDay, endOfDay, isValid } from "date-fns";
import { Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { DateRange } from "react-day-picker";

// Define TimeSeriesItem interface
interface TimeSeriesItem {
  timestamp: string;
  amount: number;
}

// Define TransactionSummary interface
interface TransactionSummary {
  totalDeposit: number;
  totalWithdraw: number;
  totalDepositAmount: number;
  totalWithdrawAmount: number;
  averageProcessingTime: number;
  depositByStatus: Record<string, number>;
  withdrawByStatus: Record<string, number>;
}

// Define TimeSeriesData interface
interface TimeSeriesData {
  deposit: TimeSeriesItem[];
  withdraw: TimeSeriesItem[];
  combined: TimeSeriesItem[];
}

// Define initial data structure for charts
const initialData = {
  summary: {
    totalDeposit: 0,
    totalWithdraw: 0,
    totalDepositAmount: 0,
    totalWithdrawAmount: 0,
    averageProcessingTime: 0,
    depositByStatus: {},
    withdrawByStatus: {},
  },
  timeSeriesData: {
    deposit: [] as TimeSeriesItem[],
    withdraw: [] as TimeSeriesItem[],
    combined: [] as TimeSeriesItem[],
  },
};

interface DashboardChartsProps {
  className?: string;
  initialData?: {
    transactions?: {
      $id: string;
      amount: number;
      odrType: string;
      odrStatus: string;
      $createdAt: string;
      $updatedAt: string;
      lastPaymentDate?: string;
    }[];
    summary?: TransactionSummary;
    timeSeriesData?: TimeSeriesData;
  };
}

const DashboardCharts = ({
  className = "",
  initialData: propInitialData,
}: DashboardChartsProps) => {
  // State for time period filtering
  const [timePeriod, setTimePeriod] = useState<
    "day" | "week" | "month" | "year"
  >("week");
  const [chartData, setChartData] = useState({
    summary: propInitialData?.summary || initialData.summary,
    timeSeriesData:
      propInitialData?.timeSeriesData || initialData.timeSeriesData,
  });
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: addDays(new Date(), -7),
    to: new Date(),
  });
  const [useCustomDateRange, setUseCustomDateRange] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Format currency
  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Format time
  const formatTime = (minutes: number): string => {
    if (minutes < 60) {
      return `${Math.round(minutes)} minutes`;
    } else if (minutes < 1440) {
      // Less than a day
      const hours = Math.floor(minutes / 60);
      const mins = Math.round(minutes % 60);
      return `${hours}h ${mins}m`;
    } else {
      const days = Math.floor(minutes / 1440);
      const hours = Math.floor((minutes % 1440) / 60);
      return `${days}d ${hours}h`;
    }
  };

  // Format date for display
  const formatDate = (date: Date): string => {
    return format(date, "PPP");
  };

  // Format time axis labels based on time period
  const formatTimeLabel = (
    timestamp: string,
    timeFormat: "day" | "week" | "month" | "year"
  ): string => {
    try {
      const date = new Date(timestamp);
      if (!isValid(date)) {
        return "Invalid date";
      }

      switch (timeFormat) {
        case "day":
          // For day view, show hour with AM/PM
          return format(date, "h:mm a"); // Hour format with minutes (e.g., "2:00 PM")
        case "week":
          // For week view, show day of week and date
          return format(date, "EEE, MMM d"); // Day of week and date (e.g., "Mon, Jan 15")
        case "month":
          // For month view, show date only
          return format(date, "MMM d"); // Month day format (e.g., "Jan 15")
        case "year":
          return format(date, "MMM"); // Month format (e.g., "January")
        default:
          return format(date, "MMM d");
      }
    } catch (error) {
      console.error("Error formatting date:", timestamp, error);
      return "Invalid date";
    }
  };

  // Fetch transaction data
  const fetchTransactionData = useCallback(async () => {
    setIsLoading(true);
    try {
      let startDate: string | undefined;
      let endDate: string | undefined;

      if (useCustomDateRange && dateRange?.from) {
        startDate = startOfDay(dateRange.from).toISOString();
        // If to date is missing, use the same day as from date
        endDate = dateRange.to
          ? endOfDay(dateRange.to).toISOString()
          : endOfDay(dateRange.from).toISOString();
      }

      // Calculate date difference to prevent fetching too much data
      const dateFrom = startDate
        ? new Date(startDate)
        : addDays(new Date(), -7);
      const dateTo = endDate ? new Date(endDate) : new Date();
      const daysDifference = Math.ceil(
        (dateTo.getTime() - dateFrom.getTime()) / (1000 * 60 * 60 * 24)
      );

      // If date range is too large, adjust the time period to reduce data points
      let effectiveTimePeriod = timePeriod;
      if (daysDifference > 60 && timePeriod === "day") {
        effectiveTimePeriod = "week";
      } else if (daysDifference > 180 && timePeriod === "week") {
        effectiveTimePeriod = "month";
      }

      // For single day view, always use 'day' time period
      if (daysDifference <= 1) {
        effectiveTimePeriod = "day";
      }

      const result = await getTransactionsForCharts(
        effectiveTimePeriod,
        startDate,
        endDate
      );

      if (result.success && result.data) {
        setChartData({
          summary: result.data.summary || initialData.summary,
          timeSeriesData:
            result.data.timeSeriesData || initialData.timeSeriesData,
        });
      }
    } catch (error) {
      console.error("Error fetching transaction data:", error);

      // Show error notification
      if (document) {
        const errorDiv = document.createElement("div");
        errorDiv.className =
          "fixed top-4 right-4 bg-red-500 text-white px-4 py-2 rounded shadow-lg z-50 animate-fade-in";
        errorDiv.textContent =
          "Error connecting to Appwrite server. Using cached data.";
        document.body.appendChild(errorDiv);

        // Remove after 5 seconds
        setTimeout(() => {
          errorDiv.classList.add("animate-fade-out");
          setTimeout(() => {
            document.body.removeChild(errorDiv);
          }, 500);
        }, 5000);
      }

      // If we have initial data from server-side, keep using it
      if (propInitialData?.summary && propInitialData?.timeSeriesData) {
        setChartData({
          summary: propInitialData.summary,
          timeSeriesData: propInitialData.timeSeriesData,
        });
      }
    } finally {
      setIsLoading(false);
    }
  }, [timePeriod, dateRange, useCustomDateRange, propInitialData]);

  // Fetch data when time period or date range changes
  useEffect(() => {
    fetchTransactionData();
  }, [fetchTransactionData]);

  // Add CSS for animations
  useEffect(() => {
    // Add styles for animations if they don't exist
    if (typeof document !== "undefined") {
      if (!document.getElementById("chart-animations")) {
        const style = document.createElement("style");
        style.id = "chart-animations";
        style.innerHTML = `
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes fadeOut {
            from { opacity: 1; transform: translateY(0); }
            to { opacity: 0; transform: translateY(-10px); }
          }
          .animate-fade-in {
            animation: fadeIn 0.5s ease-in-out forwards;
          }
          .animate-fade-out {
            animation: fadeOut 0.5s ease-in-out forwards;
          }
        `;
        document.head.appendChild(style);
      }
    }
  }, []);

  // Prepare data for transaction volume chart
  const prepareVolumeChartData = () => {
    try {
      // Filter out any items with invalid timestamps
      const validItems = chartData.timeSeriesData.combined.filter((item) => {
        // Check if the timestamp is valid
        try {
          return isValid(new Date(item.timestamp));
        } catch {
          return false;
        }
      });

      // Group by formatted date to avoid duplicates
      const groupedByDate = new Map();

      validItems.forEach((item) => {
        const formattedLabel = formatTimeLabel(item.timestamp, timePeriod);
        const key = formattedLabel;

        if (groupedByDate.has(key)) {
          // Add to existing entry
          const existing = groupedByDate.get(key);
          groupedByDate.set(key, {
            ...existing,
            value: existing.value + item.amount,
          });
        } else {
          // Create new entry
          groupedByDate.set(key, {
            $id: key,
            label: formattedLabel,
            value: item.amount,
            timestamp: item.timestamp,
          });
        }
      });

      // Convert map to array and sort by timestamp
      const sortedData = Array.from(groupedByDate.values()).sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      // Limit data points if there are too many
      const maxDataPoints = 30;
      if (sortedData.length > maxDataPoints) {
        const step = Math.ceil(sortedData.length / maxDataPoints);
        return sortedData.filter((_, index) => index % step === 0);
      }

      return sortedData;
    } catch (error) {
      console.error("Error preparing volume chart data:", error);
      return [];
    }
  };

  // Prepare data for deposit trend chart
  const prepareDepositTrendData = () => {
    try {
      // Filter out any items with invalid timestamps
      const validItems = chartData.timeSeriesData.deposit.filter((item) => {
        // Check if the timestamp is valid
        try {
          return isValid(new Date(item.timestamp));
        } catch {
          return false;
        }
      });

      // Group by formatted date to avoid duplicates
      const groupedByDate = new Map();

      validItems.forEach((item) => {
        const formattedLabel = formatTimeLabel(item.timestamp, timePeriod);
        const key = formattedLabel;

        if (groupedByDate.has(key)) {
          // Add to existing entry
          const existing = groupedByDate.get(key);
          groupedByDate.set(key, {
            ...existing,
            value: existing.value + item.amount,
          });
        } else {
          // Create new entry
          groupedByDate.set(key, {
            $id: key,
            label: formattedLabel,
            value: item.amount,
            timestamp: item.timestamp,
          });
        }
      });

      // Convert map to array and sort by timestamp
      const sortedData = Array.from(groupedByDate.values()).sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      // Limit data points if there are too many
      const maxDataPoints = 30;
      if (sortedData.length > maxDataPoints) {
        const step = Math.ceil(sortedData.length / maxDataPoints);
        return sortedData.filter((_, index) => index % step === 0);
      }

      return sortedData;
    } catch (error) {
      console.error("Error preparing deposit trend data:", error);
      return [];
    }
  };

  // Handle time period change
  const handleTimePeriodChange = (
    period: "day" | "week" | "month" | "year"
  ) => {
    setTimePeriod(period);
    setUseCustomDateRange(false);

    // Set appropriate date range based on period
    const today = new Date();
    let from: Date;

    switch (period) {
      case "day":
        from = startOfDay(today);
        break;
      case "week":
        from = addDays(today, -7);
        break;
      case "month":
        from = new Date(today);
        from.setMonth(from.getMonth() - 1);
        break;
      case "year":
        from = new Date(today);
        from.setFullYear(from.getFullYear() - 1);
        break;
      default:
        from = addDays(today, -7);
    }

    setDateRange({ from, to: today });
  };

  // Prepare transaction volume data for OrderTransactionChart
  const transactionVolumeData = prepareVolumeChartData();
  const depositTrendData = prepareDepositTrendData();

  return (
    <div className={`${className}`}>
      {/* Time period selector and date range picker */}
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
        <div className="flex items-center space-x-2">
          <span className="text-sm text-gray-500">Time period:</span>
          <div className="flex bg-gray-100 rounded-md p-1">
            <button
              className={`px-3 py-1 text-sm rounded-md ${
                timePeriod === "day" ? "bg-white shadow-sm" : "text-gray-500"
              }`}
              onClick={() => handleTimePeriodChange("day")}
            >
              Day
            </button>
            <button
              className={`px-3 py-1 text-sm rounded-md ${
                timePeriod === "week" ? "bg-white shadow-sm" : "text-gray-500"
              }`}
              onClick={() => handleTimePeriodChange("week")}
            >
              Week
            </button>
            <button
              className={`px-3 py-1 text-sm rounded-md ${
                timePeriod === "month" ? "bg-white shadow-sm" : "text-gray-500"
              }`}
              onClick={() => handleTimePeriodChange("month")}
            >
              Month
            </button>
            <button
              className={`px-3 py-1 text-sm rounded-md ${
                timePeriod === "year" ? "bg-white shadow-sm" : "text-gray-500"
              }`}
              onClick={() => handleTimePeriodChange("year")}
            >
              Year
            </button>
          </div>
        </div>

        <div className="flex items-center">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                id="date"
                variant={"outline"}
                className={cn(
                  "w-[300px] justify-start text-left font-normal",
                  !dateRange && "text-muted-foreground"
                )}
                onClick={() => setUseCustomDateRange(true)}
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>
                      {formatDate(dateRange.from)} - {formatDate(dateRange.to)}
                    </>
                  ) : (
                    formatDate(dateRange.from)
                  )
                ) : (
                  <span>Pick a date range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                initialFocus
                className="bg-white"
                mode="range"
                defaultMonth={dateRange?.from}
                selected={dateRange}
                onSelect={(range) => {
                  setDateRange(range);
                  setUseCustomDateRange(true);

                  // Immediately fetch data when a date is selected
                  if (range?.from) {
                    setTimeout(() => fetchTransactionData(), 100);
                  }
                }}
                numberOfMonths={2}
              />
              <div className="p-3 border-t border-gray-100 flex justify-between bg-white">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const today = new Date();
                    setDateRange({ from: today, to: today });
                    setUseCustomDateRange(true);
                    setTimeout(() => fetchTransactionData(), 100);
                  }}
                >
                  Today
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const today = new Date();
                    const yesterday = addDays(today, -1);
                    setDateRange({ from: yesterday, to: yesterday });
                    setUseCustomDateRange(true);
                    setTimeout(() => fetchTransactionData(), 100);
                  }}
                >
                  Yesterday
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    if (dateRange?.from) {
                      setTimeout(() => fetchTransactionData(), 100);
                    }
                  }}
                >
                  Apply
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Loading indicator */}
      {isLoading && (
        <div className="flex justify-center items-center py-4">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
          <span className="ml-2 text-gray-600">Loading data...</span>
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-medium text-gray-500">Total Deposits</h3>
          <div className="mt-2 flex items-baseline">
            <p className="text-2xl font-semibold">
              {chartData.summary.totalDeposit}
            </p>
            <p className="ml-2 text-sm text-gray-500">transactions</p>
          </div>
          <p className="mt-1 text-base font-medium text-emerald-600">
            {formatCurrency(chartData.summary.totalDepositAmount)}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-medium text-gray-500">
            Total Withdrawals
          </h3>
          <div className="mt-2 flex items-baseline">
            <p className="text-2xl font-semibold">
              {chartData.summary.totalWithdraw}
            </p>
            <p className="ml-2 text-sm text-gray-500">transactions</p>
          </div>
          <p className="mt-1 text-base font-medium text-red-600">
            {formatCurrency(chartData.summary.totalWithdrawAmount)}
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-medium text-gray-500">
            Average Processing Time
          </h3>
          <div className="mt-2">
            <p className="text-2xl font-semibold">
              {formatTime(chartData.summary.averageProcessingTime)}
            </p>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            for completed transactions
          </p>
        </div>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-sm font-medium text-gray-500">Net Flow</h3>
          <div className="mt-2">
            <p
              className={`text-2xl font-semibold ${
                chartData.summary.totalDepositAmount -
                  chartData.summary.totalWithdrawAmount >=
                0
                  ? "text-emerald-600"
                  : "text-red-600"
              }`}
            >
              {formatCurrency(
                chartData.summary.totalDepositAmount -
                  chartData.summary.totalWithdrawAmount
              )}
            </p>
          </div>
          <p className="mt-1 text-sm text-gray-500">deposits - withdrawals</p>
        </div>
      </div>

      {/* Main dashboard grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Transaction Volume Chart */}
        <div className="col-span-1 lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-lg font-medium mb-4">Transaction Volume</h3>
          {transactionVolumeData.length > 0 ? (
            <DynamicChart
              chartType="line"
              data={transactionVolumeData}
              labelKey="label"
              valueKey="value"
              height={250}
              colorPalette="blue"
              valueFormatter={formatCurrency}
              chartOptions={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    display: false,
                  },
                  tooltip: {
                    callbacks: {
                      title: (items) => {
                        if (items[0].label === "Invalid date") {
                          return "Unknown date";
                        }
                        return items[0].label;
                      },
                    },
                  },
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    grid: {
                      color: "rgba(0, 0, 0, 0.05)",
                    },
                    ticks: {
                      callback: function (value) {
                        return formatCurrency(Number(value));
                      },
                    },
                  },
                  x: {
                    grid: {
                      display: false,
                    },
                    ticks: {
                      maxRotation: 0,
                      autoSkip: true,
                      maxTicksLimit: 10,
                    },
                  },
                },
                elements: {
                  line: {
                    tension: 0.3, // Smoother curve
                    borderWidth: 2,
                    fill: true,
                    backgroundColor: "rgba(59, 130, 246, 0.1)", // Light blue background
                  },
                  point: {
                    radius: 4,
                    hitRadius: 10,
                    hoverRadius: 6,
                  },
                },
              }}
            />
          ) : (
            <div className="flex justify-center items-center h-[250px] text-gray-500">
              No data available
            </div>
          )}
        </div>

        {/* Transaction Status Distribution */}
        <div className="col-span-1 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-lg font-medium mb-4">Transaction Status</h3>
          {Object.keys(chartData.summary.depositByStatus).length > 0 ? (
            <DynamicChart
              chartType="doughnut"
              data={Object.entries(chartData.summary.depositByStatus).map(
                ([status, count]) => ({
                  $id: status,
                  label: status.charAt(0).toUpperCase() + status.slice(1),
                  value: count,
                })
              )}
              labelKey="label"
              valueKey="value"
              height={250}
              colorPalette="mixed"
              showLegend={true}
              chartOptions={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    position: "top",
                    align: "center",
                  },
                },
              }}
            />
          ) : (
            <div className="flex justify-center items-center h-[250px] text-gray-500">
              No data available
            </div>
          )}
        </div>

        {/* Transaction by Type */}
        <div className="col-span-1 md:col-span-2 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-lg font-medium mb-4">Transaction by Type</h3>
          <DynamicChart
            chartType="bar"
            data={[
              {
                $id: "deposit",
                label: "Deposits",
                value: chartData.summary.totalDeposit,
                amount: chartData.summary.totalDepositAmount,
              },
              {
                $id: "withdraw",
                label: "Withdrawals",
                value: chartData.summary.totalWithdraw,
                amount: chartData.summary.totalWithdrawAmount,
              },
            ]}
            labelKey="label"
            valueKey={["value", "amount"]}
            datasetLabels={["Count", "Amount"]}
            height={250}
            colorPalette="mixed"
            showLegend={true}
            valueFormatter={(value: number, key?: string): string =>
              key === "amount" ? formatCurrency(value) : value.toString()
            }
            chartOptions={{
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                y: {
                  beginAtZero: true,
                  grid: {
                    color: "rgba(0, 0, 0, 0.05)",
                  },
                },
                x: {
                  grid: {
                    display: false,
                  },
                },
              },
            }}
          />
        </div>

        {/* Deposit Trend Chart */}
        <div className="col-span-1 bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="text-lg font-medium mb-4">Deposit Trend</h3>
          {depositTrendData.length > 0 ? (
            <DynamicChart
              chartType="line"
              data={depositTrendData}
              labelKey="label"
              valueKey="value"
              height={250}
              colorPalette="green"
              valueFormatter={formatCurrency}
              chartOptions={{
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                  legend: {
                    display: false,
                  },
                  tooltip: {
                    callbacks: {
                      title: (items) => {
                        if (items[0].label === "Invalid date") {
                          return "Unknown date";
                        }
                        return items[0].label;
                      },
                    },
                  },
                },
                scales: {
                  y: {
                    beginAtZero: true,
                    grid: {
                      color: "rgba(0, 0, 0, 0.05)",
                    },
                    ticks: {
                      callback: function (value) {
                        return formatCurrency(Number(value));
                      },
                    },
                  },
                  x: {
                    grid: {
                      display: false,
                    },
                    ticks: {
                      maxRotation: 0,
                      autoSkip: true,
                      maxTicksLimit: 8,
                    },
                  },
                },
                elements: {
                  line: {
                    tension: 0.3, // Smoother curve
                    borderWidth: 2,
                    fill: true,
                    backgroundColor: "rgba(16, 185, 129, 0.1)", // Light green background
                  },
                  point: {
                    radius: 4,
                    hitRadius: 10,
                    hoverRadius: 6,
                  },
                },
              }}
            />
          ) : (
            <div className="flex justify-center items-center h-[250px] text-gray-500">
              No data available
            </div>
          )}
        </div>
      </div>

      {/* Real-time subscription notice */}
      <div className="mt-6 bg-blue-50 border border-blue-200 rounded-md p-3 text-sm text-blue-700 flex items-center">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 mr-2"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2h-1V9a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
        <span>
          Charts are connected to Appwrite subscriptions and will update in
          real-time when data changes.
        </span>
      </div>
    </div>
  );
};

export default DashboardCharts;
