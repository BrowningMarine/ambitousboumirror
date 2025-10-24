import { useEffect, useRef, useCallback } from "react";
import { Transaction } from "./useWithdrawals";

interface UseInfiniteScrollOptions {
  hasMore: boolean;
  loading: boolean;
  loadingMore: boolean;
  isPreloading: boolean;
  transactions: Transaction[];
  totalPendingCount: number;
  limit: number;
  preloadThreshold?: number;
  onLoadMore: (pageNum: number, append?: boolean, preload?: boolean) => void;
}

interface UseInfiniteScrollResult {
  loaderRef: React.RefObject<HTMLDivElement>;
  setupObservers: () => void;
  cleanupObservers: () => void;
}

export function useInfiniteScroll({
  hasMore,
  loading,
  loadingMore,
  isPreloading,
  transactions,
  totalPendingCount,
  limit,
  preloadThreshold = 3,
  onLoadMore,
}: UseInfiniteScrollOptions): UseInfiniteScrollResult {
  const loaderRef = useRef<HTMLDivElement>(null);
  const preloadObserverRef = useRef<IntersectionObserver | null>(null);
  const mainObserverRef = useRef<IntersectionObserver | null>(null);

  // Setup main infinite scroll observer
  const setupMainObserver = useCallback(() => {
    if (mainObserverRef.current) {
      mainObserverRef.current.disconnect();
    }

    mainObserverRef.current = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (target.isIntersecting && !loading && !loadingMore) {
          // Check if any transactions are currently transitioning
          const hasTransitioningTransactions = transactions.some(
            (t) => t.isTransitioning
          );

          if (hasMore && !hasTransitioningTransactions) {
            const currentPage = Math.floor(transactions.length / limit) + 1;
            onLoadMore(currentPage, true);
          } else if (
            totalPendingCount > transactions.length &&
            !hasTransitioningTransactions
          ) {
            // Only fetch if no transactions are transitioning
            const currentPage = Math.floor(transactions.length / limit) + 1;
            onLoadMore(currentPage, true);
          }
        }
      },
      { threshold: 0.1 }
    );
  }, [hasMore, loading, loadingMore, transactions, totalPendingCount, limit, onLoadMore]);

  // Setup preload observer
  const setupPreloadObserver = useCallback(() => {
    if (preloadObserverRef.current) {
      preloadObserverRef.current.disconnect();
    }

    preloadObserverRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (
            entry.isIntersecting &&
            !loading &&
            !loadingMore &&
            !isPreloading
          ) {
            const transactionIndex = parseInt(
              entry.target.getAttribute("data-index") || "0"
            );
            const remainingItems = transactions.length - transactionIndex;

            // Start preloading when approaching the end
            if (remainingItems <= preloadThreshold && hasMore) {
              const hasTransitioningTransactions = transactions.some(
                (t) => t.isTransitioning
              );

              if (!hasTransitioningTransactions) {
                const currentPage = Math.floor(transactions.length / limit) + 1;
                onLoadMore(currentPage, true, true); // preload = true
              }
            }
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: "200px", // Start preloading 200px before entering viewport
      }
    );
  }, [
    hasMore,
    loading,
    loadingMore,
    isPreloading,
    transactions,
    preloadThreshold,
    limit,
    onLoadMore,
  ]);

  // Setup all observers
  const setupObservers = useCallback(() => {
    setupMainObserver();
    setupPreloadObserver();

    // Observe the loader element
    const currentLoaderRef = loaderRef.current;
    if (currentLoaderRef && mainObserverRef.current) {
      mainObserverRef.current.observe(currentLoaderRef);
    }

    // Observe transaction cards for preloading
    const transactionCards = document.querySelectorAll("[data-index]");
    transactionCards.forEach((card) => {
      if (preloadObserverRef.current) {
        preloadObserverRef.current.observe(card);
      }
    });
  }, [setupMainObserver, setupPreloadObserver]);

  // Cleanup observers
  const cleanupObservers = useCallback(() => {
    const currentLoaderRef = loaderRef.current;

    if (currentLoaderRef && mainObserverRef.current) {
      mainObserverRef.current.unobserve(currentLoaderRef);
    }

    if (preloadObserverRef.current) {
      preloadObserverRef.current.disconnect();
    }

    if (mainObserverRef.current) {
      mainObserverRef.current.disconnect();
    }
  }, []);

  // Setup observers when dependencies change
  useEffect(() => {
    setupObservers();

    return () => {
      cleanupObservers();
    };
  }, [
    hasMore,
    loading,
    loadingMore,
    isPreloading,
    transactions.length,
    totalPendingCount,
    preloadThreshold,
    transactions,
    limit,
    setupObservers,
    cleanupObservers,
  ]);

  return {
    loaderRef,
    setupObservers,
    cleanupObservers,
  };
} 