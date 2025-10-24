"use client";

import { useState, useEffect, useCallback } from "react";
import DynamicTotalCard from "./DynamicStatisticsCard";
import { subscribeToCollection } from "@/lib/client/appwriteSubcriptions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { useLocale, useTranslations } from "next-intl";
import { Loader2, Trash2, RefreshCcw } from "lucide-react";
import { 
  getCachedStats, 
  setCachedStats, 
  cleanExpiredStatsCache,
  clearAllStatsCache 
} from "@/lib/utils/statsCache";

// Icons for the statistics cards
const OrdersIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const MoneyIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
  </svg>
);

const PerformanceIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
  </svg>
);

interface TransactionStats {
  totalOrders: number;
  totalDeposits: number;
  totalWithdraws: number;
  totalDepositAmount: number;
  totalWithdrawAmount: number;
  averageProcessingTime: number;
  successRate: number;
  statusBreakdown: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    canceled: number;
  };
  // Additional fields that might be available from the API
  completedDeposits?: number;
  completedWithdraws?: number;
  completedDepositAmount?: number;
  completedWithdrawAmount?: number;
}

interface TransactionDocument {
  $id?: string;
  $createdAt?: string;
  $updatedAt?: string;
  odrType?: string;
  odrStatus?: string;
}

export default function TransactionStatsCards() {
  const t = useTranslations("transactionStats");
  const currentLocale = useLocale();
  
  // Get today's date in local timezone
  const getTodayLocal = () => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const [stats, setStats] = useState<TransactionStats | null>(null);
  const [comparisonStats, setComparisonStats] = useState<TransactionStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(getTodayLocal());
  const [isFromCache, setIsFromCache] = useState(false);
  const [lastStatsHash, setLastStatsHash] = useState<string>('');

  // Helper function to create local date from date string
  const createLocalDate = (dateString: string, time: 'start' | 'end' = 'start') => {
    const [year, month, day] = dateString.split('-').map(Number);
    if (time === 'start') {
      return new Date(year, month - 1, day, 0, 0, 0, 0); // Local timezone start of day
    } else {
      return new Date(year, month - 1, day, 23, 59, 59, 999); // Local timezone end of day
    }
  };

  // Check if viewing today (using client timezone)
  const isViewingToday = selectedDate === getTodayLocal();

  // Helper function to create stats hash for change detection
  const createStatsHash = (statsData: TransactionStats): string => {
    return JSON.stringify({
      totalOrders: statsData.totalOrders,
      totalDeposits: statsData.totalDeposits,
      totalWithdraws: statsData.totalWithdraws,
      totalDepositAmount: statsData.totalDepositAmount,
      totalWithdrawAmount: statsData.totalWithdrawAmount,
      successRate: Math.round(statsData.successRate * 10) / 10,
      statusBreakdown: statsData.statusBreakdown
    });
  };

  // Function to fetch statistics (optimized with caching)
  const fetchStats = useCallback(async (dateFrom?: Date, dateTo?: Date, skipYesterday = false) => {
    try {
      setLoading(true);
      setError(null);
      
      // Clean expired cache entries occasionally
      if (Math.random() < 0.1) {
        cleanExpiredStatsCache();
      }

      // Check cache first for non-today data
      if (!isViewingToday) {
        const cachedData = getCachedStats(selectedDate);
        if (cachedData) {
          setStats(cachedData);
          setIsFromCache(true);
          
          // Set hash for cached data to prevent unnecessary updates
          setLastStatsHash(createStatsHash(cachedData));
          
          // Still need to fetch today's data for comparison even if main data is cached
          if (!skipYesterday) {
            const todayString = getTodayLocal();
            const cachedTodayData = getCachedStats(todayString);
            if (cachedTodayData) {
              setComparisonStats(cachedTodayData);
            } else {
              // Fetch today's data for comparison
              const todayStart = createLocalDate(todayString, 'start');
              const todayEnd = createLocalDate(todayString, 'end');
              const todayParams = new URLSearchParams();
              todayParams.append('dateFrom', todayStart.toISOString());
              todayParams.append('dateTo', todayEnd.toISOString());
              
              try {
                const todayResponse = await fetch(`/api/transaction-stats?${todayParams.toString()}`);
                if (todayResponse.ok) {
                  const todayResult = await todayResponse.json();
                  if (todayResult.success && todayResult.data) {
                    setComparisonStats(todayResult.data);
                    setCachedStats(todayString, todayResult.data);
                  }
                }
              } catch (todayError) {
                console.warn('Could not fetch today data for comparison:', todayError);
              }
            }
          }
          
          setLoading(false);
          return;
        }
      }
      
      setIsFromCache(false);
      
      const params = new URLSearchParams();
      if (dateFrom) params.append('dateFrom', dateFrom.toISOString());
      if (dateTo) params.append('dateTo', dateTo.toISOString());
      
      // Add cache busting for today's data
      if (isViewingToday) {
        params.append('_t', Date.now().toString());
      }
      
      // Fetch current period data
      const response = await fetch(`/api/transaction-stats?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.success && result.data) {
        // Create a simple hash of the stats to detect actual changes
        const statsHash = createStatsHash(result.data);
        
        // Only update if the data actually changed
        if (statsHash !== lastStatsHash) {
          setStats(result.data);
          setLastStatsHash(statsHash);
          
          // Cache the data for future use
          setCachedStats(selectedDate, result.data);
        }
        
        // Only fetch today's data for comparison if not viewing today
        if (!skipYesterday && !isViewingToday) {
          // Get today's date for comparison
          const todayString = getTodayLocal();
          const todayStart = createLocalDate(todayString, 'start');
          const todayEnd = createLocalDate(todayString, 'end');
          
          // Check cache for today's data first
          const cachedTodayData = getCachedStats(todayString);
          if (cachedTodayData) {
            setComparisonStats(cachedTodayData);
          } else {
            // Fetch today's data if not cached
            const todayParams = new URLSearchParams();
            todayParams.append('dateFrom', todayStart.toISOString());
            todayParams.append('dateTo', todayEnd.toISOString());
            
            try {
              const todayResponse = await fetch(`/api/transaction-stats?${todayParams.toString()}`);
              if (todayResponse.ok) {
                const todayResult = await todayResponse.json();
                if (todayResult.success && todayResult.data) {
                  setComparisonStats(todayResult.data);
                  // Cache today's data
                  setCachedStats(todayString, todayResult.data);
                }
              }
            } catch (todayError) {
              console.warn('Could not fetch today data for comparison:', todayError);
            }
          }
        }
      } else {
        setError(result.message || 'Failed to fetch statistics');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Error fetching statistics';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [isViewingToday, selectedDate, lastStatsHash]);

  // Calculate percentage change vs yesterday
  const calculateChange = (current: number, yesterday: number): number => {
    if (yesterday === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - yesterday) / yesterday) * 100);
  };

  // Get today's date string for comparison display
  const getTodayDateString = () => {
    return getTodayLocal();
  };

  // Real-time subscription for today's data with improved debouncing
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    let debounceTimer: NodeJS.Timeout | null = null;
    let lastRefreshTime = 0;
    const MIN_REFRESH_INTERVAL = 3000; // Minimum 3 seconds between refreshes

    if (isViewingToday) {
      
      // Improved debounced refresh function
      const debouncedRefresh = () => {
        const now = Date.now();
        
        // If we just refreshed recently, extend the debounce
        if (now - lastRefreshTime < MIN_REFRESH_INTERVAL) {
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }
          
          debounceTimer = setTimeout(() => {
            lastRefreshTime = Date.now();
            const dateFrom = createLocalDate(selectedDate, 'start');
            const dateTo = createLocalDate(selectedDate, 'end');
            fetchStats(dateFrom, dateTo, true); // Skip yesterday refetch
          }, MIN_REFRESH_INTERVAL - (now - lastRefreshTime));
          return;
        }
        
        // Clear any existing timer
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        
        // Set a new timer
        debounceTimer = setTimeout(() => {
          lastRefreshTime = Date.now();
          const dateFrom = createLocalDate(selectedDate, 'start');
          const dateTo = createLocalDate(selectedDate, 'end');
          fetchStats(dateFrom, dateTo, true); // Skip yesterday refetch
        }, 1500); // 1.5 second debounce
      };

      // Subscribe to transaction collection for real-time updates
      unsubscribe = subscribeToCollection(
        appwriteConfig.databaseId,
        appwriteConfig.odrtransCollectionId,
        // onCreate - only refresh for today's transactions
        (document: TransactionDocument) => {
          const transactionDate = new Date(document.$createdAt || '');
          const todayStart = createLocalDate(selectedDate, 'start');
          const todayEnd = createLocalDate(selectedDate, 'end');
          
          // Only refresh if the transaction is from today
          if (transactionDate >= todayStart && transactionDate <= todayEnd) {
            debouncedRefresh();
          }
        },
        // onUpdate - only refresh for today's transactions
        (document: TransactionDocument) => {
          const transactionDate = new Date(document.$createdAt || '');
          const todayStart = createLocalDate(selectedDate, 'start');
          const todayEnd = createLocalDate(selectedDate, 'end');
          
          // Only refresh if the transaction is from today
          if (transactionDate >= todayStart && transactionDate <= todayEnd) {
            debouncedRefresh();
          }
        }
      );
    }

    return () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [isViewingToday, selectedDate, fetchStats]);

  // Initial load and date change handler
  useEffect(() => {
    // Clear comparison stats when date changes to ensure fresh comparison data
    setComparisonStats(null);
    
    // Use local timezone for date range calculation
    const dateFrom = createLocalDate(selectedDate, 'start');
    const dateTo = createLocalDate(selectedDate, 'end');
    
    fetchStats(dateFrom, dateTo);
  }, [selectedDate, fetchStats]);

  // No periodic updates needed for historical data since it's cached and doesn't change
  // Real-time updates are handled by subscribeToCollection for today's data only

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('vi-VN', {
      style: 'currency',
      currency: 'VND',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  // Format processing time
  const formatProcessingTime = (minutes: number) => {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  };

  // Format date for display using locale
  const formatDateForDisplay = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(currentLocale === 'vn' ? 'vi-VN' : 
                                   currentLocale === 'zh' ? 'zh-CN' : 'en-US');
  };

  if (loading && !stats) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{t("transactionStatistics") || "Transaction Statistics"}</h3>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
          />
        </div>
        <div className="text-center py-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t("loading") || "Loading..."}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{t("transactionStatistics") || "Transaction Statistics"}</h3>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
          />
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p className="text-sm text-red-600 dark:text-red-400">Error: {error}</p>
          <button
            onClick={() => fetchStats()}
            className="mt-2 px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
          >
            {t("retry") || "Retry"}
          </button>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">{t("transactionStatistics") || "Transaction Statistics"}</h3>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
          />
        </div>
        <div className="text-center py-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{t("noDataAvailable") || "No data available"}</p>
          <button
            onClick={() => fetchStats()}
            className="mt-2 px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            {t("loadData") || "Load Data"}
          </button>
        </div>
      </div>
    );
  }

  // Calculate completed deposits and withdrawals
  // Use provided data if available, otherwise estimate based on completion ratio
  const completionRatio = stats.totalOrders > 0 ? stats.statusBreakdown.completed / stats.totalOrders : 0;
  const completedDeposits = stats.completedDeposits ?? Math.round(stats.totalDeposits * completionRatio);
  const completedWithdraws = stats.completedWithdraws ?? Math.round(stats.totalWithdraws * completionRatio);
  
  // Calculate completed amounts (estimate based on completion ratio)
  const completedDepositAmount = stats.completedDepositAmount ?? Math.round(stats.totalDepositAmount * completionRatio);
  const completedWithdrawAmount = stats.completedWithdrawAmount ?? Math.round(stats.totalWithdrawAmount * completionRatio);
  
  // Calculate net completed amount for orders (deposits - withdrawals)
  const totalCompletedAmount = completedDepositAmount - completedWithdrawAmount;
  
  const todayCompletionRatio = comparisonStats && comparisonStats.totalOrders > 0 ? 
    comparisonStats.statusBreakdown.completed / comparisonStats.totalOrders : 0;
  const todayCompletedDeposits = comparisonStats ? 
    (comparisonStats.completedDeposits ?? Math.round(comparisonStats.totalDeposits * todayCompletionRatio)) : 0;
  const todayCompletedWithdraws = comparisonStats ? 
    (comparisonStats.completedWithdraws ?? Math.round(comparisonStats.totalWithdraws * todayCompletionRatio)) : 0;
  const todayTotalCompletedAmount = comparisonStats ? 
    ((comparisonStats.completedDepositAmount ?? Math.round(comparisonStats.totalDepositAmount * todayCompletionRatio)) - 
     (comparisonStats.completedWithdrawAmount ?? Math.round(comparisonStats.totalWithdrawAmount * todayCompletionRatio))) : 0;

  // Simple, eye-friendly card designs
  const cards = [
    {
      title: t("totalOrders") || "Total Orders",
      mainValue: formatCurrency(totalCompletedAmount),
      subValue: `${stats.statusBreakdown.completed} completed/${stats.totalOrders} orders`,
      percentChange: comparisonStats && !isViewingToday ? 
        calculateChange(totalCompletedAmount, todayTotalCompletedAmount) : undefined,
      trendDirection: comparisonStats && !isViewingToday ? 
        (totalCompletedAmount > todayTotalCompletedAmount ? "up" as const : 
         totalCompletedAmount < todayTotalCompletedAmount ? "down" as const : "neutral" as const) : "neutral" as const,
      icon: <OrdersIcon />,
      cardStyle: "default" as const,
      mainValueColor: totalCompletedAmount >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400",
      comparisonText: comparisonStats && !isViewingToday ? `vs ${formatDateForDisplay(getTodayDateString())}` : undefined,
    },
    {
      title: t("totalDeposits") || "Total Deposits",
      mainValue: formatCurrency(completedDepositAmount),
      subValue: `${completedDeposits} completed/${stats.totalDeposits} deposits`,
      percentChange: comparisonStats && !isViewingToday ? 
        calculateChange(completedDeposits, todayCompletedDeposits) : undefined,
      trendDirection: comparisonStats && !isViewingToday ? 
        (completedDeposits > todayCompletedDeposits ? "up" as const : 
         completedDeposits < todayCompletedDeposits ? "down" as const : "neutral" as const) : "up" as const,
      icon: <MoneyIcon />,
      cardStyle: "default" as const,
      mainValueColor: "text-green-600 dark:text-green-400",
      subValueColor: "text-green-600 dark:text-green-400",
      comparisonText: comparisonStats && !isViewingToday ? `vs ${formatDateForDisplay(getTodayDateString())}` : undefined,
    },
    {
      title: t("totalWithdrawals") || "Total Withdrawals", 
      mainValue: formatCurrency(completedWithdrawAmount),
      subValue: `${completedWithdraws} completed/${stats.totalWithdraws} withdrawals`,
      percentChange: comparisonStats && !isViewingToday ? 
        calculateChange(completedWithdraws, todayCompletedWithdraws) : undefined,
      trendDirection: comparisonStats && !isViewingToday ? 
        (completedWithdraws > todayCompletedWithdraws ? "up" as const : 
         completedWithdraws < todayCompletedWithdraws ? "down" as const : "neutral" as const) : "down" as const,
      icon: <MoneyIcon />,
      cardStyle: "default" as const,
      mainValueColor: "text-red-600 dark:text-red-400",
      subValueColor: "text-red-600 dark:text-red-400",
      comparisonText: comparisonStats && !isViewingToday ? `vs ${formatDateForDisplay(getTodayDateString())}` : undefined,
    },
    {
      title: t("performance") || "Performance",
      mainValue: `${Math.round(stats.successRate * 10) / 10}% success`,
      subValue: `${formatProcessingTime(stats.averageProcessingTime)} ${t("avgTime") || "avg time"}`,
      percentChange: comparisonStats && !isViewingToday ? 
        calculateChange(Math.round(stats.successRate), Math.round(comparisonStats.successRate)) : undefined,
      trendDirection: comparisonStats && !isViewingToday ? 
        (stats.successRate > comparisonStats.successRate ? "up" as const : 
         stats.successRate < comparisonStats.successRate ? "down" as const : "neutral" as const) : 
        (stats.successRate >= 90 ? "up" as const : "down" as const),
      icon: <PerformanceIcon />,
      cardStyle: "default" as const,
      mainValueColor: stats.successRate >= 95 ? "text-blue-600 dark:text-blue-400" : 
        stats.successRate >= 85 ? "text-green-600 dark:text-green-400" : 
        stats.successRate >= 70 ? "text-orange-600 dark:text-orange-400" : "text-red-600 dark:text-red-400",
      subValueColor: stats.averageProcessingTime <= 30 ? "text-green-600 dark:text-green-400" : 
        stats.averageProcessingTime <= 60 ? "text-orange-600 dark:text-orange-400" : "text-red-600 dark:text-red-400",
      comparisonText: comparisonStats && !isViewingToday ? `vs ${formatDateForDisplay(getTodayDateString())}` : undefined,
      percentChangeColor: comparisonStats && !isViewingToday ? 
        (Math.abs(calculateChange(Math.round(stats.successRate), Math.round(comparisonStats.successRate))) < 50 ? "text-yellow-600 dark:text-yellow-400" :
         Math.abs(calculateChange(Math.round(stats.successRate), Math.round(comparisonStats.successRate))) <= 75 ? "text-orange-600 dark:text-orange-400" : 
         "text-red-600 dark:text-red-400") : undefined,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t("transactionStatistics") || "Transaction Statistics"}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 flex items-center flex-wrap">
            {formatDateForDisplay(selectedDate)}
            {comparisonStats && !isViewingToday && <span className="ml-2">• vs {formatDateForDisplay(getTodayDateString())}</span>}
            {isViewingToday && <span className="ml-2 text-green-500">• {t("liveData") || "Live Data"}</span>}
            {!isViewingToday && isFromCache && <span className="ml-2 text-orange-500">• {t("cached") || "Cached"}</span>}
            {loading && <span className="ml-2 text-blue-500 inline-flex items-center">• <Loader2 className="animate-spin ml-1 mr-1 h-3 w-3" />{t("updating") || "Updating..."}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
          />
          <button
            onClick={() => {
              // Use local timezone for date range calculation
              const dateFrom = createLocalDate(selectedDate, 'start');
              const dateTo = createLocalDate(selectedDate, 'end');
              fetchStats(dateFrom, dateTo);
            }}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
            title={t("refreshData") || "Refresh data"}
          >
            <RefreshCcw className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              clearAllStatsCache();
              // Force refresh after clearing cache
              const dateFrom = createLocalDate(selectedDate, 'start');
              const dateTo = createLocalDate(selectedDate, 'end');
              fetchStats(dateFrom, dateTo);
            }}
            className="px-3 py-1 text-sm bg-gray-600 text-white rounded hover:bg-gray-700"
            title={t("clearCache") || "Clear cache"}
          >
          <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <DynamicTotalCard
        cards={cards}
        columns={4}
        gap="sm"
        containerClassName="w-full"
      />
    </div>
  );
} 