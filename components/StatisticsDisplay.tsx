"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format, subDays } from "date-fns";
import { vi, zhCN, enUS, Locale } from "date-fns/locale";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Clock,
  DollarSign,
  Calendar as CalendarIcon,
} from "lucide-react";
import { useTranslations, useLocale } from "next-intl";
import {
  getStatisticsByDate,
  getStatisticsForDateRange,
} from "@/lib/actions/statistics.actions";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip as ChartTooltip,
  Legend,
} from "chart.js";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { DateRange } from "react-day-picker";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  TooltipProvider,
  TooltipContent,
  TooltipTrigger,
  Tooltip,
} from "@/components/ui/tooltip";
import DynamicTabs from "@/components/ui/DynamicTabs";

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  ChartTooltip,
  Legend
);

// Define the statistics data structure
interface StatisticsData {
  $id?: string;
  recDate: string;
  totalOrder: number;
  totalAmount: number;
  completedDepositOrder: number;
  completedDepositAmount: number;
  completedWithdrawOrder: number;
  completedWithdrawAmount: number;
  failedDepositOrder: number;
  failedDepositAmount: number;
  failedWithdrawOrder: number;
  failedWithdrawAmount: number;
  pendingOrder: number;
  pendingAmount: number;
  averageProcessedTime: number;
}

// Get date-fns locale based on current locale
const getDateFnsLocale = (locale: string) => {
  switch (locale) {
    case "vn":
      return vi;
    case "zh":
      return zhCN;
    case "en":
    default:
      return enUS;
  }
};

// Format number with thousand separators based on locale
const formatNumber = (amount: number, locale: string = "vi-VN") => {
  const localeMap: Record<string, string> = {
    en: "en-US",
    vn: "vi-VN",
    zh: "zh-CN",
  };
  return new Intl.NumberFormat(localeMap[locale] || "vi-VN").format(amount);
};

// Format large numbers with abbreviations (M for millions, B for billions)
const formatLargeNumber = (
  amount: number,
  t: (key: string) => string,
  locale: string
) => {
  const abs = Math.abs(amount);

  if (abs >= 1000000000) {
    return {
      display: (amount / 1000000000).toFixed(1) + "B",
      fullText: formatNumber(amount, locale) + " (" + t("billions") + ")",
    };
  } else if (abs >= 1000000) {
    return {
      display: (amount / 1000000).toFixed(1) + "M",
      fullText: formatNumber(amount, locale) + " (" + t("millions") + ")",
    };
  } else {
    return {
      display: formatNumber(amount, locale),
      fullText: formatNumber(amount, locale),
    };
  }
};

// Format processing time in hours and minutes
const formatProcessingTime = (minutes: number) => {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = Math.round(minutes % 60);

    if (remainingMinutes === 0) {
      return `${hours}h`;
    } else {
      return `${hours}h ${remainingMinutes}m`;
    }
  } else {
    return `${minutes.toFixed(1)}m`;
  }
};

// Component for displaying amount with tooltip
const AmountDisplay = ({
  amount,
  prefix = "",
  t,
  locale,
}: {
  amount: number;
  prefix?: string;
  t: (key: string) => string;
  locale: string;
}) => {
  const formatted = formatLargeNumber(amount, t, locale);

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-help">
            {prefix}
            {formatNumber(amount, locale)} ₫
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {prefix}
            {formatted.display} ₫
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const StatisticsDisplay = () => {
  const t = useTranslations("transactionStats");
  const currentLocale = useLocale();
  const router = useRouter();
  const [dateLocale, setDateLocale] = useState<Locale | undefined>(undefined);
  const [activeTab, setActiveTab] = useState("today");
  const [statistics, setStatistics] = useState<StatisticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(
    new Date()
  );
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: undefined,
    to: undefined,
  });
  const [multiDayStats, setMultiDayStats] = useState<StatisticsData[]>([]);
  const [isRangeMode, setIsRangeMode] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Add ref to track if component is mounted
  const isMounted = useRef(true);

  // Handle mobile detection on client side
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };

    // Set initial value
    handleResize();

    // Add event listener
    window.addEventListener("resize", handleResize);

    // Cleanup
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Navigation functions for cards
  const navigateToTransactions = (filterType: string) => {
    const params = new URLSearchParams();

    // Apply filters based on card type
    switch (filterType) {
      case "totalOrders":
        // Show all transactions in current date range
        params.set("status", "all");
        params.set("type", "all");
        break;
      case "completedDeposits":
        params.set("status", "completed");
        params.set("type", "deposit");
        break;
      case "completedWithdrawals":
        params.set("status", "completed");
        params.set("type", "withdraw");
        break;
      case "pendingOrders":
        params.set("status", "pending");
        params.set("type", "all");
        break;
      default:
        params.set("status", "processing");
        params.set("type", "all");
    }

    // Add date filters if in range mode
    if (isRangeMode && dateRange?.from) {
      const fromDate = format(dateRange.from, "yyyy-MM-dd");
      params.set("dateFrom", fromDate);

      if (dateRange.to) {
        const toDate = format(dateRange.to, "yyyy-MM-dd");
        params.set("dateTo", toDate);
      } else {
        // If only start date is selected, set end date to same day
        params.set("dateTo", fromDate);
      }
    } else if (!isRangeMode && selectedDate) {
      // For single date mode, set both from and to the same date
      const currentDate = format(selectedDate, "yyyy-MM-dd");
      params.set("dateFrom", currentDate);
      params.set("dateTo", currentDate);
    }

    // Navigate to transactions page with filters
    const url = `/${currentLocale}/transactions?${params.toString()}`;
    router.push(url);
  };

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

  // Fetch statistics for a single date
  const fetchStatistics = async (date: string) => {
    setLoading(true);
    setError(null);
    setIsRangeMode(false);

    try {
      const result = await getStatisticsByDate(date);

      if (result.success && result.data) {
        setStatistics(result.data as StatisticsData);
        setMultiDayStats([]);
      } else {
        setError(result.message || t("statisticsNotAvailable"));
        // Set default empty statistics object instead of null
        setStatistics({
          recDate: date,
          totalOrder: 0,
          totalAmount: 0,
          completedDepositOrder: 0,
          completedDepositAmount: 0,
          completedWithdrawOrder: 0,
          completedWithdrawAmount: 0,
          failedDepositOrder: 0,
          failedDepositAmount: 0,
          failedWithdrawOrder: 0,
          failedWithdrawAmount: 0,
          pendingOrder: 0,
          pendingAmount: 0,
          averageProcessedTime: 0,
        });
      }
    } catch (error) {
      console.error("Error fetching statistics:", error);
      setError(t("noDataAvailable"));
      // Set default empty statistics object instead of null
      setStatistics({
        recDate: date,
        totalOrder: 0,
        totalAmount: 0,
        completedDepositOrder: 0,
        completedDepositAmount: 0,
        completedWithdrawOrder: 0,
        completedWithdrawAmount: 0,
        failedDepositOrder: 0,
        failedDepositAmount: 0,
        failedWithdrawOrder: 0,
        failedWithdrawAmount: 0,
        pendingOrder: 0,
        pendingAmount: 0,
        averageProcessedTime: 0,
      });
    } finally {
      setLoading(false);
    }
  };

  // Fetch statistics for a date range
  const fetchDateRangeStatistics = async (
    startDate: string,
    endDate: string
  ) => {
    setLoading(true);
    setError(null);
    setIsRangeMode(true);

    try {
      const result = await getStatisticsForDateRange(startDate, endDate);

      if (result.success && result.data) {
        const statsArray = result.data as StatisticsData[];
        setMultiDayStats(statsArray);

        // Calculate aggregated statistics
        const aggregatedStats = aggregateStatistics(statsArray);
        setStatistics(aggregatedStats);
      } else {
        setError(result.message || t("statisticsNotAvailableRange"));
        setStatistics({
          recDate: `${startDate} to ${endDate}`,
          totalOrder: 0,
          totalAmount: 0,
          completedDepositOrder: 0,
          completedDepositAmount: 0,
          completedWithdrawOrder: 0,
          completedWithdrawAmount: 0,
          failedDepositOrder: 0,
          failedDepositAmount: 0,
          failedWithdrawOrder: 0,
          failedWithdrawAmount: 0,
          pendingOrder: 0,
          pendingAmount: 0,
          averageProcessedTime: 0,
        });
        setMultiDayStats([]);
      }
    } catch (error) {
      console.error("Error fetching statistics for date range:", error);
      setError(t("noDataAvailable"));
      setStatistics({
        recDate: `${startDate} to ${endDate}`,
        totalOrder: 0,
        totalAmount: 0,
        completedDepositOrder: 0,
        completedDepositAmount: 0,
        completedWithdrawOrder: 0,
        completedWithdrawAmount: 0,
        failedDepositOrder: 0,
        failedDepositAmount: 0,
        failedWithdrawOrder: 0,
        failedWithdrawAmount: 0,
        pendingOrder: 0,
        pendingAmount: 0,
        averageProcessedTime: 0,
      });
      setMultiDayStats([]);
    } finally {
      setLoading(false);
    }
  };

  // Aggregate multiple days of statistics
  const aggregateStatistics = (
    statsArray: StatisticsData[]
  ): StatisticsData => {
    if (!statsArray.length) {
      return {
        recDate: "aggregate",
        totalOrder: 0,
        totalAmount: 0,
        completedDepositOrder: 0,
        completedDepositAmount: 0,
        completedWithdrawOrder: 0,
        completedWithdrawAmount: 0,
        failedDepositOrder: 0,
        failedDepositAmount: 0,
        failedWithdrawOrder: 0,
        failedWithdrawAmount: 0,
        pendingOrder: 0,
        pendingAmount: 0,
        averageProcessedTime: 0,
      };
    }

    // Initialize with zeros
    const aggregate: StatisticsData = {
      recDate: `${statsArray[0].recDate} to ${
        statsArray[statsArray.length - 1].recDate
      }`,
      totalOrder: 0,
      totalAmount: 0,
      completedDepositOrder: 0,
      completedDepositAmount: 0,
      completedWithdrawOrder: 0,
      completedWithdrawAmount: 0,
      failedDepositOrder: 0,
      failedDepositAmount: 0,
      failedWithdrawOrder: 0,
      failedWithdrawAmount: 0,
      pendingOrder: 0,
      pendingAmount: 0,
      averageProcessedTime: 0,
    };

    // Sum all values
    let totalProcessingTimeWeighted = 0;
    let totalCompletedOrders = 0;

    statsArray.forEach((stat) => {
      aggregate.totalOrder += stat.totalOrder;
      aggregate.totalAmount += stat.totalAmount;
      aggregate.completedDepositOrder += stat.completedDepositOrder;
      aggregate.completedDepositAmount += stat.completedDepositAmount;
      aggregate.completedWithdrawOrder += stat.completedWithdrawOrder;
      aggregate.completedWithdrawAmount += stat.completedWithdrawAmount;
      aggregate.failedDepositOrder += stat.failedDepositOrder;
      aggregate.failedDepositAmount += stat.failedDepositAmount;
      aggregate.failedWithdrawOrder += stat.failedWithdrawOrder;
      aggregate.failedWithdrawAmount += stat.failedWithdrawAmount;
      aggregate.pendingOrder += stat.pendingOrder;
      aggregate.pendingAmount += stat.pendingAmount;

      // Weighted average for processing time
      const completedOrders =
        stat.completedDepositOrder + stat.completedWithdrawOrder;
      if (completedOrders > 0) {
        totalProcessingTimeWeighted +=
          stat.averageProcessedTime * completedOrders;
        totalCompletedOrders += completedOrders;
      }
    });

    // Calculate weighted average processing time
    if (totalCompletedOrders > 0) {
      aggregate.averageProcessedTime =
        totalProcessingTimeWeighted / totalCompletedOrders;
    }

    return aggregate;
  };

  // Handle tab change
  const handleTabChange = (value: string) => {
    setActiveTab(value);

    // Get date based on selected tab
    let dateToFetch = "";
    let newSelectedDate: Date | undefined;
    let newDateRange: DateRange | undefined;

    switch (value) {
      case "today":
        newSelectedDate = new Date();
        dateToFetch = format(newSelectedDate, "yyyy-MM-dd");
        setIsRangeMode(false);
        fetchStatistics(dateToFetch);
        break;
      case "yesterday":
        newSelectedDate = subDays(new Date(), 1);
        dateToFetch = format(newSelectedDate, "yyyy-MM-dd");
        setIsRangeMode(false);
        fetchStatistics(dateToFetch);
        break;
      case "week":
        const endDate = new Date();
        const startDate = subDays(endDate, 6); // Last 7 days
        newDateRange = { from: startDate, to: endDate };
        setIsRangeMode(true);
        fetchDateRangeStatistics(
          format(startDate, "yyyy-MM-dd"),
          format(endDate, "yyyy-MM-dd")
        );
        break;
      case "month":
        const endDateMonth = new Date();
        const startDateMonth = subDays(endDateMonth, 29); // Last 30 days
        newDateRange = { from: startDateMonth, to: endDateMonth };
        setIsRangeMode(true);
        fetchDateRangeStatistics(
          format(startDateMonth, "yyyy-MM-dd"),
          format(endDateMonth, "yyyy-MM-dd")
        );
        break;
      case "custom":
        if (dateRange?.from && dateRange?.to) {
          setIsRangeMode(true);
          fetchDateRangeStatistics(
            format(dateRange.from, "yyyy-MM-dd"),
            format(dateRange.to, "yyyy-MM-dd")
          );
        } else if (selectedDate) {
          setIsRangeMode(false);
          fetchStatistics(format(selectedDate, "yyyy-MM-dd"));
        }
        break;
      default:
        newSelectedDate = new Date();
        dateToFetch = format(newSelectedDate, "yyyy-MM-dd");
        setIsRangeMode(false);
        fetchStatistics(dateToFetch);
    }

    // Update selected date if it changed from a tab
    if (value !== "custom") {
      if (newSelectedDate) {
        setSelectedDate(newSelectedDate);
      }
      if (newDateRange) {
        setDateRange(newDateRange);
      }
    }
  };

  // Handle date change from calendar
  const handleDateChange = (date: Date | undefined) => {
    if (!date) return;

    // Ensure date is within allowed range
    const minDate = new Date(2025, 4, 1); // May 1, 2025
    const maxDate = new Date(); // Today

    if (date < minDate || date > maxDate) {
      return; // Don't allow invalid dates
    }

    setSelectedDate(date);
    setDateRange(undefined);
    setActiveTab("custom");
    setIsRangeMode(false);
    fetchStatistics(format(date, "yyyy-MM-dd"));
  };

  // Handle date range change from calendar
  const handleDateRangeChange = (range: DateRange | undefined) => {
    //console.log("handleDateRangeChange called with:", range);

    // If range is undefined or incomplete, don't proceed
    if (!range) {
      //console.log("Range is undefined, not proceeding");
      return;
    }

    // Ensure dates are within allowed range
    const minDate = new Date(2025, 4, 1); // May 1, 2025
    const maxDate = new Date(); // Today

    // For single date selection (when only from is set)
    if (range.from && !range.to) {
      // Check if the from date is valid
      if (range.from < minDate || range.from > maxDate) {
        return; // Don't allow invalid dates
      }
      //console.log("Only from date selected:", range.from);
      setDateRange(range);
      return;
    }

    // For complete range selection
    if (range.from && range.to) {
      // Check if both dates are valid
      if (
        range.from < minDate ||
        range.from > maxDate ||
        range.to < minDate ||
        range.to > maxDate
      ) {
        return; // Don't allow invalid dates
      }
      //console.log("Complete range selected:", range.from, "to", range.to);
      setDateRange(range);
      setSelectedDate(undefined);
      setActiveTab("custom");
      setIsRangeMode(true);
      fetchDateRangeStatistics(
        format(range.from, "yyyy-MM-dd"),
        format(range.to, "yyyy-MM-dd")
      );
    }
  };

  // Fetch today's statistics on initial load
  useEffect(() => {
    const today = format(new Date(), "yyyy-MM-dd");
    fetchStatistics(today);
  }, []);

  // Add cleanup for isMounted ref
  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Prepare chart data for Chart.js
  const getChartData = () => {
    if (!statistics) return { labels: [], datasets: [] };

    // For single day view
    if (!isRangeMode || multiDayStats.length === 0) {
      return {
        labels: [t("deposits"), t("withdrawals"), t("pending")],
        datasets: [
          {
            label: t("completedOrders"),
            data: [
              statistics.completedDepositOrder,
              statistics.completedWithdrawOrder,
              0,
            ],
            backgroundColor: "rgba(75, 192, 192, 0.6)",
          },
          {
            label: t("failedOrders"),
            data: [
              statistics.failedDepositOrder,
              statistics.failedWithdrawOrder,
              0,
            ],
            backgroundColor: "rgba(255, 99, 132, 0.6)",
          },
          {
            label: t("pendingOrdersLabel"),
            data: [0, 0, statistics.pendingOrder],
            backgroundColor: "rgba(255, 206, 86, 0.6)",
          },
          {
            label: t("amount"),
            data: [
              statistics.completedDepositAmount,
              statistics.completedWithdrawAmount,
              statistics.pendingAmount,
            ],
            backgroundColor: "rgba(153, 102, 255, 0.6)",
            yAxisID: "y1",
          },
        ],
      };
    }

    // For date range view - show daily trends
    return {
      labels: multiDayStats.map((stat) =>
        format(new Date(stat.recDate), "MMM dd", {
          locale: getDateFnsLocale(currentLocale),
        })
      ),
      datasets: [
        {
          label: t("totalOrders"),
          data: multiDayStats.map((stat) => stat.totalOrder),
          backgroundColor: "rgba(75, 192, 192, 0.6)",
        },
        {
          label: t("completedDeposits"),
          data: multiDayStats.map((stat) => stat.completedDepositOrder),
          backgroundColor: "rgba(54, 162, 235, 0.6)",
        },
        {
          label: t("completedWithdrawals"),
          data: multiDayStats.map((stat) => stat.completedWithdrawOrder),
          backgroundColor: "rgba(255, 99, 132, 0.6)",
        },
        {
          label: "Amount",
          data: multiDayStats.map((stat) => stat.totalAmount),
          backgroundColor: "rgba(153, 102, 255, 0.6)",
          yAxisID: "y1",
        },
      ],
    };
  };

  // Chart.js options
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      intersect: false,
      mode: "index" as const,
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: t("numberOfOrders"),
        },
        ticks: {
          callback: function (value: number | string) {
            return formatNumber(Number(value), currentLocale);
          },
        },
      },
      y1: {
        beginAtZero: true,
        position: "right" as const,
        grid: {
          drawOnChartArea: false,
        },
        title: {
          display: true,
          text: t("amount") + " (₫)",
        },
        ticks: {
          callback: function (value: number | string) {
            const formatted = formatLargeNumber(
              Number(value),
              t,
              currentLocale
            );
            return formatted.display;
          },
        },
      },
    },
    plugins: {
      legend: {
        position: "top" as const,
        labels: {
          usePointStyle: true,
          padding: 15,
          font: {
            size: isMobile ? 10 : 12,
          },
        },
      },
      title: {
        display: true,
        text: isRangeMode
          ? t("dailyTransactionStatistics")
          : t("transactionStatistics"),
      },
      tooltip: {
        callbacks: {
          label: function (context: {
            dataset: { label?: string; yAxisID?: string };
            datasetIndex: number;
            parsed: { y: number };
          }) {
            const label = context.dataset.label || "";
            if (
              context.datasetIndex === 3 ||
              context.dataset.yAxisID === "y1"
            ) {
              // Format amount values - show simplified format
              const formatted = formatLargeNumber(
                context.parsed.y,
                t,
                currentLocale
              );
              return `${label}: ${formatted.display} ₫`;
            } else {
              // Format order counts
              return `${label}: ${formatNumber(
                context.parsed.y,
                currentLocale
              )}`;
            }
          },
        },
      },
    },
  };

  // Format date display
  const getDateDisplay = () => {
    const dateLocale = getDateFnsLocale(currentLocale);

    if (isRangeMode && dateRange?.from) {
      if (dateRange.to) {
        return `${format(dateRange.from, "MMMM d, yyyy", {
          locale: dateLocale,
        })} to ${format(dateRange.to, "MMMM d, yyyy", { locale: dateLocale })}`;
      } else {
        // If only from date is set
        return `${format(dateRange.from, "MMMM d, yyyy", {
          locale: dateLocale,
        })}`;
      }
    } else if (selectedDate) {
      return format(selectedDate, "MMMM d, yyyy", { locale: dateLocale });
    }
    return format(new Date(), "MMMM d, yyyy", { locale: dateLocale });
  };

  // Create a reusable content component to avoid duplication
  const renderStatisticsContent = () => (
    <>
      {loading ? (
        <div className="flex justify-center items-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : error ? (
        <div className="text-center py-12 text-muted-foreground">
          <p>{error}</p>
          <p className="text-sm mt-2">
            {isRangeMode
              ? t("statisticsNotAvailableRange")
              : t("statisticsNotAvailable")}
            .
          </p>
        </div>
      ) : statistics ? (
        <div className="space-y-4">
          {/* Date display */}
          <div className="text-xs sm:text-sm text-muted-foreground mb-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1 sm:gap-2">
              <span>{t("showingStatisticsFor")}</span>
              <span className="font-medium break-words">
                {getDateDisplay()}
              </span>
              {isRangeMode && multiDayStats.length > 0 && (
                <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full whitespace-nowrap">
                  {multiDayStats.length} {t("days")}
                </span>
              )}
            </div>
          </div>

          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <Card
              className="transition-all duration-200 hover:shadow-lg hover:scale-[1.02] hover:border-blue-200 cursor-pointer group"
              onClick={() => navigateToTransactions("totalOrders")}
            >
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate group-hover:text-primary transition-colors">
                      {t("totalOrders")}
                    </p>
                    <h4 className="text-lg sm:text-2xl font-bold group-hover:text-primary transition-colors">
                      {formatNumber(statistics.totalOrder, currentLocale)}
                    </h4>
                  </div>
                  <div className="p-2 bg-primary/10 rounded-full flex-shrink-0 group-hover:bg-primary/20 transition-colors">
                    <TrendingUp className="h-4 w-4 sm:h-5 sm:w-5 text-primary group-hover:scale-110 transition-transform" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2 group-hover:text-gray-600 transition-colors">
                  <span className="break-words">{t("totalAmount")}:</span>{" "}
                  <span className="break-all">
                    <AmountDisplay
                      amount={statistics.totalAmount}
                      t={t}
                      locale={currentLocale}
                    />
                  </span>
                </p>
              </CardContent>
            </Card>

            <Card
              className="transition-all duration-200 hover:shadow-lg hover:scale-[1.02] hover:border-green-200 cursor-pointer group"
              onClick={() => navigateToTransactions("completedDeposits")}
            >
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate group-hover:text-green-600 transition-colors">
                      {t("completedDeposits")}
                    </p>
                    <h4 className="text-lg sm:text-2xl font-bold group-hover:text-green-600 transition-colors">
                      {formatNumber(
                        statistics.completedDepositOrder,
                        currentLocale
                      )}
                    </h4>
                  </div>
                  <div className="p-2 bg-green-100 rounded-full flex-shrink-0 group-hover:bg-green-200 transition-colors">
                    <DollarSign className="h-4 w-4 sm:h-5 sm:w-5 text-green-600 group-hover:scale-110 transition-transform" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2 group-hover:text-gray-600 transition-colors">
                  <span className="break-words">{t("amount")}:</span>{" "}
                  <span className="break-all">
                    <AmountDisplay
                      amount={statistics.completedDepositAmount}
                      t={t}
                      locale={currentLocale}
                    />
                  </span>
                </p>
              </CardContent>
            </Card>

            <Card
              className="transition-all duration-200 hover:shadow-lg hover:scale-[1.02] hover:border-blue-200 cursor-pointer group"
              onClick={() => navigateToTransactions("completedWithdrawals")}
            >
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate group-hover:text-blue-600 transition-colors">
                      {t("completedWithdrawals")}
                    </p>
                    <h4 className="text-lg sm:text-2xl font-bold group-hover:text-blue-600 transition-colors">
                      {formatNumber(
                        statistics.completedWithdrawOrder,
                        currentLocale
                      )}
                    </h4>
                  </div>
                  <div className="p-2 bg-blue-100 rounded-full flex-shrink-0 group-hover:bg-blue-200 transition-colors">
                    <TrendingDown className="h-4 w-4 sm:h-5 sm:w-5 text-blue-600 group-hover:scale-110 transition-transform" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2 group-hover:text-gray-600 transition-colors">
                  <span className="break-words">{t("amount")}:</span>{" "}
                  <span className="break-all">
                    <AmountDisplay
                      amount={statistics.completedWithdrawAmount}
                      t={t}
                      locale={currentLocale}
                    />
                  </span>
                </p>
              </CardContent>
            </Card>

            <Card
              className="transition-all duration-200 hover:shadow-lg hover:scale-[1.02] hover:border-amber-200 cursor-pointer group"
              onClick={() => navigateToTransactions("pendingOrders")}
            >
              <CardContent className="p-3 sm:p-4">
                <div className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs sm:text-sm font-medium text-muted-foreground truncate group-hover:text-amber-600 transition-colors">
                      {t("avgProcessingTime")}
                    </p>
                    <h4 className="text-lg sm:text-2xl font-bold group-hover:text-amber-600 transition-colors">
                      {formatProcessingTime(
                        statistics?.averageProcessedTime || 0
                      )}
                    </h4>
                  </div>
                  <div className="p-2 bg-amber-100 rounded-full flex-shrink-0 group-hover:bg-amber-200 transition-colors">
                    <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-amber-600 group-hover:scale-110 transition-transform" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-2 group-hover:text-gray-600 transition-colors">
                  <span className="break-words">{t("pendingOrders")}:</span>{" "}
                  {formatNumber(statistics.pendingOrder, currentLocale)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Chart */}
          <Card className="transition-all duration-200 hover:shadow-lg hover:border-gray-300 group">
            <CardContent className="p-3 sm:p-4">
              <h4 className="text-sm font-medium mb-4 group-hover:text-primary transition-colors">
                {isRangeMode
                  ? t("dailyTransactionOverview")
                  : t("transactionOverview")}
              </h4>
              <div className="h-64 sm:h-80 w-full overflow-hidden">
                <Bar data={getChartData()} options={chartOptions} />
              </div>
            </CardContent>
          </Card>

          {/* Additional Stats */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4">
            <Card className="transition-all duration-200 hover:shadow-lg hover:border-green-200 cursor-pointer group">
              <CardContent className="p-3 sm:p-4">
                <h4 className="text-sm font-medium mb-4 group-hover:text-green-600 transition-colors">
                  {t("depositStatistics")}
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-muted-foreground text-xs sm:text-sm">
                      {t("completed")}:
                    </span>
                    <span className="font-medium text-xs sm:text-sm text-right">
                      {formatNumber(
                        statistics.completedDepositOrder,
                        currentLocale
                      )}{" "}
                      {t("orders")}
                    </span>
                  </div>
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-muted-foreground text-xs sm:text-sm">
                      {t("failed")}:
                    </span>
                    <span className="font-medium text-xs sm:text-sm text-right">
                      {formatNumber(
                        statistics.failedDepositOrder,
                        currentLocale
                      )}{" "}
                      {t("orders")}
                    </span>
                  </div>
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-muted-foreground text-xs sm:text-sm">
                      {t("totalAmount")}:
                    </span>
                    <span className="font-medium text-xs sm:text-sm text-right break-all">
                      <AmountDisplay
                        amount={statistics.completedDepositAmount}
                        t={t}
                        locale={currentLocale}
                      />
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="transition-all duration-200 hover:shadow-lg hover:border-blue-200 cursor-pointer group">
              <CardContent className="p-3 sm:p-4">
                <h4 className="text-sm font-medium mb-4 group-hover:text-blue-600 transition-colors">
                  {t("withdrawalStatistics")}
                </h4>
                <div className="space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-muted-foreground text-xs sm:text-sm">
                      {t("completed")}:
                    </span>
                    <span className="font-medium text-xs sm:text-sm text-right">
                      {formatNumber(
                        statistics.completedWithdrawOrder,
                        currentLocale
                      )}{" "}
                      {t("orders")}
                    </span>
                  </div>
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-muted-foreground text-xs sm:text-sm">
                      {t("failed")}:
                    </span>
                    <span className="font-medium text-xs sm:text-sm text-right">
                      {formatNumber(
                        statistics.failedWithdrawOrder,
                        currentLocale
                      )}{" "}
                      {t("orders")}
                    </span>
                  </div>
                  <div className="flex justify-between items-start gap-2">
                    <span className="text-muted-foreground text-xs sm:text-sm">
                      {t("totalAmount")}:
                    </span>
                    <span className="font-medium text-xs sm:text-sm text-right break-all">
                      <AmountDisplay
                        amount={statistics.completedWithdrawAmount}
                        t={t}
                        locale={currentLocale}
                      />
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      ) : null}
    </>
  );

  // Define dynamic tab items
  const dynamicTabItems = [
    {
      id: "today",
      label: t("today"),
      content: renderStatisticsContent(),
      triggerClassName:
        "border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent rounded-none px-4",
    },
    {
      id: "yesterday",
      label: t("yesterday"),
      content: renderStatisticsContent(),
      triggerClassName:
        "border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent rounded-none px-4",
    },
    {
      id: "week",
      label: t("last7Days"),
      content: renderStatisticsContent(),
      triggerClassName:
        "border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent rounded-none px-4",
    },
    {
      id: "month",
      label: t("last30Days"),
      content: renderStatisticsContent(),
      triggerClassName:
        "border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent rounded-none px-4",
    },
    {
      id: "custom",
      label: t("custom"),
      content: renderStatisticsContent(),
      triggerClassName:
        "border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent rounded-none px-4",
    },
  ];

  return (
    <Card className="col-span-4 w-full">
      <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4">
        <CardTitle className="text-lg sm:text-xl">
          {t("transactionStatistics")}
        </CardTitle>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2 sm:border-r sm:pr-4">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <Switch
                      id="date-range-toggle"
                      checked={isRangeMode}
                      onCheckedChange={(checked) => {
                        //console.log("Switch toggled to:", checked);
                        const wasRangeMode = isRangeMode;
                        setIsRangeMode(checked);

                        // Handle mode change
                        if (checked && !wasRangeMode) {
                          // Switching to range mode
                          if (!dateRange?.from || !dateRange?.to) {
                            // If no date range is set, create a default one (last 7 days to today)
                            const today = new Date();
                            const weekAgo = new Date();
                            weekAgo.setDate(weekAgo.getDate() - 6);

                            // Ensure dates are within allowed range
                            const minDate = new Date(2025, 4, 1); // May 1, 2025
                            const fromDate =
                              weekAgo < minDate ? minDate : weekAgo;

                            const newRange = { from: fromDate, to: today };
                            // console.log(
                            //   "Setting default date range:",
                            //   newRange
                            // );
                            setDateRange(newRange);

                            // Fetch statistics for the default range
                            fetchDateRangeStatistics(
                              format(fromDate, "yyyy-MM-dd"),
                              format(today, "yyyy-MM-dd")
                            );
                          } else if (dateRange.from && dateRange.to) {
                            // Use the existing date range
                            // console.log(
                            //   "Using existing date range:",
                            //   dateRange
                            // );
                            fetchDateRangeStatistics(
                              format(dateRange.from, "yyyy-MM-dd"),
                              format(dateRange.to, "yyyy-MM-dd")
                            );
                          }
                        } else if (!checked && wasRangeMode) {
                          // Switching to single date mode
                          // console.log(
                          //   "Switching to single date mode with selected date:",
                          //   selectedDate
                          // );
                          if (selectedDate) {
                            fetchStatistics(format(selectedDate, "yyyy-MM-dd"));
                          } else {
                            // If no single date selected, use today
                            const today = new Date();
                            setSelectedDate(today);
                            fetchStatistics(format(today, "yyyy-MM-dd"));
                          }
                        }
                      }}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="bg-white border shadow-lg">
                  <p className="text-sm">
                    {isRangeMode
                      ? t("switchToSingleDate")
                      : t("switchToDateRange")}
                  </p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Label
              htmlFor="date-range-toggle"
              className="text-xs sm:text-sm text-muted-foreground cursor-pointer"
            >
              {isRangeMode ? t("dateRange") : t("singleDate")}
            </Label>
          </div>

          {isRangeMode ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="flex items-center gap-2 text-xs sm:text-sm px-2 sm:px-3"
                >
                  <CalendarIcon className="h-3 w-3 sm:h-4 sm:w-4" />
                  <span className="hidden sm:inline">
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, "LLL dd, y", {
                            locale: getDateFnsLocale(currentLocale),
                          })}{" "}
                          -{" "}
                          {format(dateRange.to, "LLL dd, y", {
                            locale: getDateFnsLocale(currentLocale),
                          })}
                        </>
                      ) : (
                        format(dateRange.from, "LLL dd, y", {
                          locale: getDateFnsLocale(currentLocale),
                        })
                      )
                    ) : (
                      <span>{t("pickADateRange")}</span>
                    )}
                  </span>
                  <span className="sm:hidden">
                    {dateRange?.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, "MMM dd", {
                            locale: getDateFnsLocale(currentLocale),
                          })}{" "}
                          -{" "}
                          {format(dateRange.to, "MMM dd", {
                            locale: getDateFnsLocale(currentLocale),
                          })}
                        </>
                      ) : (
                        format(dateRange.from, "MMM dd", {
                          locale: getDateFnsLocale(currentLocale),
                        })
                      )
                    ) : (
                      <span>{t("pickRange")}</span>
                    )}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-white" align="end">
                <div className="p-3">
                  <Calendar
                    mode="range"
                    defaultMonth={dateRange?.from}
                    selected={dateRange}
                    onSelect={(range) => {
                      //console.log("Calendar range selection:", range);
                      handleDateRangeChange(range);
                    }}
                    numberOfMonths={isMobile ? 1 : 2}
                    initialFocus
                    className="bg-white [&_table]:border-spacing-0 [&_td]:p-0 [&_td]:border-0 [&_button]:m-0"
                    disabled={(date) => {
                      const minDate = new Date(2025, 4, 1); // May 1, 2025
                      const maxDate = new Date(); // Today
                      return date < minDate || date > maxDate;
                    }}
                    fromDate={new Date(2025, 4, 1)} // May 1, 2025
                    toDate={new Date()} // Today
                    classNames={{
                      cell: "p-0 border-0",
                      day: "h-9 w-9 p-0 font-normal aria-selected:opacity-100 m-0",
                      day_range_middle:
                        "bg-blue-100 text-blue-900 hover:bg-blue-200 !rounded-none !border-0 !shadow-none !ring-0 !m-0",
                      day_range_start:
                        "bg-blue-500 text-white hover:bg-blue-600 !rounded-l-md !rounded-r-none !border-0 !shadow-none !ring-0 !m-0",
                      day_range_end:
                        "bg-blue-500 text-white hover:bg-blue-600 !rounded-r-md !rounded-l-none !border-0 !shadow-none !ring-0 !m-0",
                      day_selected:
                        "bg-blue-500 text-white hover:bg-blue-600 !border-0 !shadow-none !ring-0 !m-0",
                    }}
                    locale={dateLocale}
                  />
                </div>
              </PopoverContent>
            </Popover>
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="flex items-center gap-2 text-xs sm:text-sm px-2 sm:px-3"
                >
                  <CalendarIcon className="h-3 w-3 sm:h-4 sm:w-4" />
                  {selectedDate ? (
                    <>
                      <span className="hidden sm:inline">
                        {format(selectedDate, "PPP", {
                          locale: getDateFnsLocale(currentLocale),
                        })}
                      </span>
                      <span className="sm:hidden">
                        {format(selectedDate, "MMM dd", {
                          locale: getDateFnsLocale(currentLocale),
                        })}
                      </span>
                    </>
                  ) : (
                    <span>{t("pickADate")}</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0 bg-white" align="end">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={handleDateChange}
                  initialFocus
                  className="bg-white"
                  disabled={(date) => {
                    const minDate = new Date(2025, 4, 1); // May 1, 2025
                    const maxDate = new Date(); // Today
                    return date < minDate || date > maxDate;
                  }}
                  fromDate={new Date(2025, 4, 1)} // May 1, 2025
                  toDate={new Date()} // Today
                  classNames={{
                    day_selected:
                      "bg-blue-500 text-white hover:bg-blue-600 focus:bg-blue-600 font-semibold",
                    day_today: "bg-blue-50 text-blue-900 font-semibold",
                  }}
                  locale={dateLocale}
                />
              </PopoverContent>
            </Popover>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-6">
        <DynamicTabs
          items={dynamicTabItems}
          activeTab={activeTab}
          onTabChange={handleTabChange}
          tabsListClassName="bg-transparent p-0 mb-4 sm:mb-6 flex-wrap gap-1 sm:gap-0"
          triggerClassName="hover:text-blue-600 transition-colors text-xs sm:text-sm px-2 sm:px-4 py-1 sm:py-2"
        />
      </CardContent>
    </Card>
  );
};

export default StatisticsDisplay;
