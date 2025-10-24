"use client";

import { useEffect, useState, useMemo, useRef, useCallback, memo } from "react";
import { useTranslations } from "next-intl";
import { client } from "@/lib/appwrite/appwrite-client";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { RealtimeResponseEvent } from "appwrite";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Check, X, RefreshCw, AlertTriangle } from "lucide-react";
import HeaderBox from "@/components/HeaderBox";
import { getLoggedInUser } from "@/lib/actions/user.actions";
import { updateTransactionStatus } from "@/lib/actions/transaction.actions";
import QRCodeDisplay, { RibbonType } from "@/components/QRCodeCard";
import {
  fetchPendingWithdrawals,
  getWithdrawalsTotalCount,
  assignWithdrawalToUser,
} from "@/lib/actions/withdraw.actions";
import CopyButton from "@/components/CopyButton";
import { Input } from "@/components/ui/input";
import RandomizeIcons from "@/components/RandomizeIcons";

// Define the Transaction type based on what we need to display
interface Transaction {
  $id: string;
  $createdAt: string;
  odrId: string;
  merchantOrdId: string;
  odrType: "withdraw";
  odrStatus: "pending" | "processing" | "completed" | "canceled" | "failed";
  amount: number;
  unPaidAmount: number;
  bankCode?: string;
  bankReceiveNumber?: string;
  bankReceiveOwnerName?: string;
  bankReceiveName?: string;
  qrCode?: string | null;
  createdIp?: string;
  isSuspicious?: boolean;
  isTransitioning?: boolean;
  users?: string | Record<string, unknown>; // Users can be a string or an object from the relationship
}

// Add interface for payment validation response
interface PaymentValidationResponse {
  error: number;
  message: string;
  alreadyProcessed?: boolean;
  data?: {
    id: number;
    tid: string;
    description: string;
    amount: number;
    when: string;
    corresponsiveName: string;
    corresponsiveAccount: string;
    corresponsiveBankName: string;
    [key: string]: unknown;
  };
  validation?: {
    extractedOrderId?: string;
    expectedOrderId?: string;
    orderIdMatch?: boolean;
    expectedAmount?: number;
    actualAmount?: number;
    amountMatch?: boolean;
    isDebitTransaction?: boolean;
    isValid?: boolean;
  };
}

export default function WithdrawListPage() {
  const t = useTranslations("withdraw");
  const { toast } = useToast();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [userRole, setUserRole] = useState<string>("");
  const [userId, setUserId] = useState<string | null>(null); // Add state for user ID
  const [updatingTransactions, setUpdatingTransactions] = useState<Set<string>>(
    new Set()
  );
  const [paymentIds, setPaymentIds] = useState<Record<string, string>>({});
  const [validatingPayment, setValidatingPayment] = useState<Set<string>>(
    new Set()
  );
  const [paymentValidationResults, setPaymentValidationResults] = useState<
    Record<string, PaymentValidationResponse | null>
  >({});
  const [validatedTransactions, setValidatedTransactions] = useState<
    Set<string>
  >(new Set());
  const [processingPayments, setProcessingPayments] = useState<Set<string>>(
    new Set()
  );
  const [justProcessedTransactions, setJustProcessedTransactions] = useState<
    Set<string>
  >(new Set());
  const [showTransactionActions, setShowTransactionActions] = useState<
    Set<string>
  >(new Set());
  const [preloadedQRs, setPreloadedQRs] = useState<Set<string>>(new Set());
  const [assigningTransactions, setAssigningTransactions] = useState<
    Set<string>
  >(new Set());

  // New states for improved infinite scroll
  const [loadingMore, setLoadingMore] = useState(false); // Separate loading state for infinite scroll
  const [isPreloading, setIsPreloading] = useState(false); // Pre-loading state
  const [skeletonCount, setSkeletonCount] = useState(3); // Number of skeleton items to show

  const limit = 10; // Fetch 10 items at a time
  const preloadThreshold = 3; // Start preloading when 3 items from bottom

  const loaderRef = useRef<HTMLDivElement>(null);
  const qrObserverRef = useRef<IntersectionObserver | null>(null);
  const preloadObserverRef = useRef<IntersectionObserver | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  // Store the latest creation date we've seen so far
  const latestCreatedAtRef = useRef<string | null>(null);
  // Track IDs of transactions that have been removed due to status change
  const removedIdsRef = useRef<Set<string>>(new Set());
  // Track total pending orders count
  const [totalPendingCount, setTotalPendingCount] = useState<number>(0);
  // Add a new state to track totalPendingCount loading state
  const [loadingCount, setLoadingCount] = useState<boolean>(true);
  // Ref to prevent infinite loops in discrepancy monitoring
  const discrepancyFixedRef = useRef<boolean>(false);

  // Function to fetch initial data once user is loaded
  const fetchInitialData = useCallback(
    (role: string, id: string) => {
      // Fetch both transactions and count in parallel for faster loading
      const fetchTransactionsPromise = fetchPendingWithdrawals({
        page: 1,
        limit,
        sortByCreatedAt: "asc",
        transassistantId: role === "transassistant" ? id : null,
      });

      const fetchCountPromise = getWithdrawalsTotalCount(
        role === "transassistant" ? id : null
      );

      // Execute both calls in parallel
      Promise.all([fetchTransactionsPromise, fetchCountPromise])
        .then(([transactionResult, countResult]) => {
          // Handle transaction result
          if (!transactionResult.success || !transactionResult.data) {
            throw new Error(
              transactionResult.message || "Failed to fetch withdrawals"
            );
          }

          const fetchedTransactions = transactionResult.data;

          if (fetchedTransactions.length < limit) {
            setHasMore(false);
          } else {
            setHasMore(true);
          }

          // Update latest creation date if needed
          if (fetchedTransactions.length > 0) {
            const lastTransaction =
              fetchedTransactions[fetchedTransactions.length - 1];
            latestCreatedAtRef.current = lastTransaction.$createdAt;
          }

          setTransactions(fetchedTransactions as Transaction[]);

          // Handle count result
          if (countResult.success && countResult.count !== undefined) {
            setTotalPendingCount(countResult.count);
          }
        })
        .catch((error) => {
          console.error("Error in initial data fetch:", error);
          setError("Failed to load withdrawal data");
        })
        .finally(() => {
          setLoading(false);
          setLoadingCount(false);
        });
    },
    [limit]
  );

  // Load user data with optimistic loading
  useEffect(() => {
    const fetchUser = async () => {
      try {
        setLoading(true); // Set loading state while fetching user data

        // Start user authentication
        const userPromise = getLoggedInUser();

        // Optimistically start preloading some data while user auth is happening
        // This reduces perceived loading time
        const user = await userPromise;

        if (!user) {
          window.location.href = "/sign-in";
          return;
        }

        // Set user data immediately
        setUserRole(user.role);
        setUserId(user.userId);

        // If user is not admin, transactor, or transassistant, redirect to home
        if (
          user.role !== "admin" &&
          user.role !== "transactor" &&
          user.role !== "transassistant"
        ) {
          window.location.href = "/";
          return;
        }

        // Start fetching data immediately after role validation
        fetchInitialData(user.role, user.userId);
      } catch (error) {
        console.error("Error fetching user data:", error);
        setLoading(false);
      }
    };

    fetchUser();
  }, [fetchInitialData]);

  // Progressive loading effect - gradually show content

  // Check if the current user can update status
  const canUpdateStatus = useCallback(
    (transaction: Transaction) => {
      if (userRole === "admin") return true;
      if (userRole !== "transactor" && userRole !== "transassistant")
        return false;
      if (transaction.odrStatus !== "pending") return false;
      return true;
    },
    [userRole]
  );

  // Handle status update
  const handleStatusUpdate = useCallback(
    async (transaction: Transaction, newStatus: "completed" | "failed") => {
      if (
        !confirm(
          `Are you sure you want to mark transaction ${transaction.odrId} as ${newStatus}?`
        )
      ) {
        return;
      }

      // Add transaction to updating set
      setUpdatingTransactions((prev) => new Set(prev).add(transaction.$id));

      try {
        const result = await updateTransactionStatus(
          transaction.$id,
          newStatus
        );

        // Handle the server response
        if (result && typeof result === "object") {
          if ("success" in result) {
            if (!result.success) {
              throw new Error(
                result.message || "Failed to update transaction status"
              );
            }
            // Success - no toast notification
          } else if (!("$id" in result)) {
            throw new Error("Invalid response format");
          }
          // Success - no toast notification
        } else {
          throw new Error("Invalid response from server");
        }
      } catch (error) {
        console.error("Error updating transaction status:", error);
        toast({
          variant: "destructive",
          description:
            error instanceof Error
              ? error.message
              : "Failed to update transaction status",
        });
      } finally {
        // Remove transaction from updating set
        setUpdatingTransactions((prev) => {
          const newSet = new Set(prev);
          newSet.delete(transaction.$id);
          return newSet;
        });
      }
    },
    [toast]
  );

  // Helper function to filter out duplicate transactions
  const removeDuplicates = (transactions: Transaction[]): Transaction[] => {
    const uniqueIds = new Set<string>();
    return transactions.filter((transaction) => {
      if (uniqueIds.has(transaction.$id)) {
        return false;
      }
      uniqueIds.add(transaction.$id);
      return true;
    });
  };

  // Fetch total count of pending transactions
  const fetchTotalPendingCount = useCallback(async () => {
    try {
      setLoadingCount(true);
      // Use server action instead of direct database query
      // For transassistant, only count their assigned transactions
      const result = await getWithdrawalsTotalCount(
        userRole === "transassistant" ? userId : null
      );
      if (result.success && result.count !== undefined) {
        setTotalPendingCount(result.count);
      } else {
        console.error("Error fetching total pending count:", result.message);
      }
    } catch (error) {
      console.error("Error fetching total pending count:", error);
    } finally {
      setLoadingCount(false);
    }
  }, [userRole, userId]);

  // Fetch withdraw transactions with improved loading states
  const fetchTransactions = useCallback(
    async (pageNum: number, append = false, preload = false) => {
      try {
        // Set appropriate loading state
        if (append && !preload) {
          setLoadingMore(true);
        } else if (preload) {
          setIsPreloading(true);
        } else {
          setLoading(true);
        }

        // Use server action instead of direct database query
        // For transassistant users, only fetch their assigned transactions
        const result = await fetchPendingWithdrawals({
          page: pageNum,
          limit,
          sortByCreatedAt: "asc",
          transassistantId: userRole === "transassistant" ? userId : null,
        });

        if (!result.success || !result.data) {
          throw new Error(result.message || "Failed to fetch withdrawals");
        }

        const fetchedTransactions = result.data;

        if (fetchedTransactions.length < limit) {
          setHasMore(false);
        } else {
          setHasMore(true);
        }

        // Update latest creation date if needed
        if (fetchedTransactions.length > 0) {
          const lastTransaction =
            fetchedTransactions[fetchedTransactions.length - 1];
          if (
            !latestCreatedAtRef.current ||
            new Date(lastTransaction.$createdAt) >
              new Date(latestCreatedAtRef.current)
          ) {
            latestCreatedAtRef.current = lastTransaction.$createdAt;
          }
        }

        setTransactions((prev) => {
          const newTransactions = append
            ? [...prev, ...(fetchedTransactions as Transaction[])]
            : (fetchedTransactions as Transaction[]);

          // Remove any potential duplicates
          return removeDuplicates(newTransactions);
        });

        // Fetch total count when loading the first page or when not appending
        if (!append && !preload) {
          fetchTotalPendingCount();
        }

        if (fetchedTransactions.length === 0 && pageNum === 1) {
          setError("No withdraw transactions found");
        } else {
          setError(null);
        }

        // Adjust skeleton count based on fetched data
        if (append && fetchedTransactions.length > 0) {
          setSkeletonCount(Math.min(fetchedTransactions.length, 3));
        }
      } catch (error) {
        console.error("Error fetching withdraw transactions:", error);
        setError("Failed to load withdrawal data");
      } finally {
        // Clear appropriate loading state
        if (append && !preload) {
          setLoadingMore(false);
        } else if (preload) {
          setIsPreloading(false);
        } else {
          setLoading(false);
        }
      }
    },
    [fetchTotalPendingCount, userRole, userId, limit]
  );

  // Setup QR code preloading with Intersection Observer
  useEffect(() => {
    // Create QR preloading observer
    qrObserverRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const transactionId = entry.target.getAttribute(
              "data-transaction-id"
            );
            if (transactionId && !preloadedQRs.has(transactionId)) {
              setPreloadedQRs((prev) => new Set(prev).add(transactionId));
            }
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: "200px", // Start preloading 200px before the element comes into view
      }
    );

    return () => {
      if (qrObserverRef.current) {
        qrObserverRef.current.disconnect();
      }
    };
  }, [preloadedQRs]); // Include preloadedQRs dependency

  // Setup infinite scroll with Intersection Observer and preloading
  useEffect(() => {
    // Main infinite scroll observer
    const observer = new IntersectionObserver(
      (entries) => {
        const target = entries[0];
        if (target.isIntersecting && !loading && !loadingMore) {
          // Check if any transactions are currently transitioning to prevent unnecessary fetches
          const hasTransitioningTransactions = transactions.some(
            (t) => t.isTransitioning
          );

          if (hasMore && !hasTransitioningTransactions) {
            const currentPage = Math.floor(transactions.length / limit) + 1;
            fetchTransactions(currentPage, true);
          } else if (
            totalPendingCount > transactions.length &&
            !hasTransitioningTransactions
          ) {
            // Only fetch if no transactions are transitioning to avoid timing conflicts
            // This helps when new transactions are created but not loaded at the bottom
            setHasMore(true);
            const currentPage = Math.floor(transactions.length / limit) + 1;
            fetchTransactions(currentPage, true);
          }
        }
      },
      { threshold: 0.1 } // Reduced threshold for better responsiveness
    );

    // Preload observer - triggers earlier to reduce perceived loading time
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
                fetchTransactions(currentPage, true, true); // preload = true
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

    const currentLoaderRef = loaderRef.current;

    if (currentLoaderRef) {
      observer.observe(currentLoaderRef);
    }

    // Observe transaction cards for preloading
    const transactionCards = document.querySelectorAll("[data-index]");
    transactionCards.forEach((card) => {
      if (preloadObserverRef.current) {
        preloadObserverRef.current.observe(card);
      }
    });

    return () => {
      if (currentLoaderRef) {
        observer.unobserve(currentLoaderRef);
      }

      if (preloadObserverRef.current) {
        preloadObserverRef.current.disconnect();
      }
    };
  }, [
    hasMore,
    loading,
    loadingMore,
    isPreloading,
    fetchTransactions,
    transactions.length,
    totalPendingCount,
    preloadThreshold,
    transactions,
    limit,
  ]);

  // Function to reload data when a transaction might have been assigned to this user
  const reloadAssignedTransactions = useCallback(async () => {
    // First check if there are any newly assigned transactions
    const countResult = await getWithdrawalsTotalCount(
      userRole === "transassistant" ? userId : null
    );

    if (countResult.success && countResult.count !== undefined) {
      setTotalPendingCount(countResult.count);

      // If there are transactions assigned to this user, but we're not showing any,
      // or if there are more transactions than we're currently showing, reload the data
      if (
        (countResult.count > 0 && transactions.length === 0) ||
        countResult.count > transactions.length
      ) {
        fetchTransactions(1);
      }
    }
  }, [userRole, userId, transactions.length, fetchTransactions]);

  // Setup realtime subscription ONLY for updates and deletes, not creates
  // Defer setup by 2 seconds to improve initial loading performance
  useEffect(() => {
    const setupRealtimeSubscription = () => {
      try {
        // Subscribe to transaction updates
        const unsubscribe = client.subscribe(
          `databases.${appwriteConfig.databaseId}.collections.${appwriteConfig.odrtransCollectionId}.documents`,
          (response: RealtimeResponseEvent<Transaction>) => {
            const eventType = response.events[0];
            const document = response.payload;

            // Only process withdraw transactions
            if (document.odrType === "withdraw") {
              // For transassistant users, check if they are assigned to this transaction
              if (userRole === "transassistant") {
                // Check if the user document is loaded for this transaction
                const isAssignedToUser = (() => {
                  // If users is a string (document ID), we can't determine if this user is assigned
                  // We'll need to reload data to be sure
                  if (typeof document.users === "string") {
                    // Reload data to check if this transaction is assigned to this user
                    setTimeout(() => reloadAssignedTransactions(), 100); // Reduced delay to 100ms
                    return false;
                  }

                  // If users is an object with userId, check if it matches current user
                  if (document.users && typeof document.users === "object") {
                    if (document.users.userId === userId) {
                      return true;
                    }
                  }

                  return false;
                })();

                // For transassistant users, only show transactions assigned to them
                if (!isAssignedToUser) {
                  // If the transaction is being assigned to this user or updated with this user,
                  // we need to detect that and update our view
                  if (eventType.endsWith(".update")) {
                    // Reload data to check for newly assigned transactions
                    setTimeout(() => reloadAssignedTransactions(), 100); // Reduced delay to 100ms
                  }

                  // Skip processing this transaction further
                  return;
                }
              }

              // Handle transaction assignment event for transactors
              if (userRole === "transactor" && eventType.endsWith(".update")) {
                // If we're a transactor and the transaction was just updated,
                // check if it's being assigned to someone (users field changed)
                if (document.users) {
                  // This transaction is now assigned to someone, find and remove it with animation
                  setTransactions((prev) => {
                    const transactionExists = prev.some(
                      (t) => t.$id === document.$id
                    );
                    if (transactionExists) {
                      // Mark for transition first, then remove from main list
                      return prev.map((t) =>
                        t.$id === document.$id
                          ? { ...t, isTransitioning: true }
                          : t
                      );
                    }
                    return prev;
                  });

                  // Remove after animation
                  setTimeout(() => {
                    setTransactions((prev) =>
                      prev.filter((t) => t.$id !== document.$id)
                    );

                    // Update count immediately after removing
                    fetchTotalPendingCount();
                  }, 200); // Faster transition to reduce perceived gap
                }
              }

              // Update total count when there are any changes
              if (
                eventType.endsWith(".create") ||
                eventType.endsWith(".update") ||
                eventType.endsWith(".delete")
              ) {
                // For status changes that remove transactions from pending, delay the count update
                // to prevent timing conflicts with the UI removal animation
                const isStatusChangeToNonPending =
                  eventType.endsWith(".update") &&
                  document.odrStatus !== "pending";
                const delay = isStatusChangeToNonPending ? 350 : 50; // Longer delay for status changes

                setTimeout(() => {
                  fetchTotalPendingCount();

                  // If we have a create event, check if we need to re-enable hasMore
                  if (
                    eventType.endsWith(".create") &&
                    document.odrStatus === "pending"
                  ) {
                    // Set hasMore to true if we detect new pending transactions
                    setHasMore(true);
                  }
                }, delay);
              }

              // For create events, check if it's a new transaction we should add to the top
              if (
                eventType.endsWith(".create") &&
                document.odrStatus === "pending"
              ) {
                // Only add if we're showing the first page of transactions (no appends yet)
                // This prevents disrupting the infinite scroll experience
                if (transactions.length <= limit) {
                  setTransactions((prev) => {
                    // Make sure it's not already in the list
                    if (prev.some((t) => t.$id === document.$id)) {
                      return prev;
                    }

                    // Add new transaction with fade-in effect
                    const newTransaction = {
                      ...document,
                      isTransitioning: false, // Start visible
                    };

                    // Find the correct position to insert based on creation date (ascending order)
                    const updatedTransactions = [...prev];
                    const insertIndex = updatedTransactions.findIndex(
                      (t) =>
                        new Date(t.$createdAt) > new Date(document.$createdAt)
                    );

                    // If no position found, add to the end
                    if (insertIndex === -1) {
                      updatedTransactions.push(newTransaction);
                    } else {
                      // Insert at the correct position
                      updatedTransactions.splice(
                        insertIndex,
                        0,
                        newTransaction
                      );
                    }

                    return removeDuplicates(updatedTransactions);
                  });
                }
              }
              // Handle update events for existing transactions
              else if (eventType.endsWith(".update")) {
                // Check if this is a transaction we previously removed
                const wasRemoved = removedIdsRef.current.has(document.$id);

                // If status changed to pending and it was previously removed, just remove from tracking
                // Let the create event handle re-adding if needed
                if (document.odrStatus === "pending" && wasRemoved) {
                  removedIdsRef.current.delete(document.$id);
                }

                // Handle status changes for transactions in the current list
                setTransactions((prev) => {
                  // Check if this transaction already exists in our list
                  const existingTransaction = prev.find(
                    (t) => t.$id === document.$id
                  );

                  if (existingTransaction) {
                    // If status changed to non-pending, mark for transition and removal
                    if (document.odrStatus !== "pending") {
                      return prev.map((t) =>
                        t.$id === document.$id
                          ? { ...document, isTransitioning: true }
                          : t
                      );
                    } else {
                      // If status is pending, just update it
                      return prev.map((t) =>
                        t.$id === document.$id ? document : t
                      );
                    }
                  }
                  return prev;
                });

                // If status is not pending, remove after animation and track it
                if (document.odrStatus !== "pending") {
                  // Track this ID as removed
                  removedIdsRef.current.add(document.$id);

                  setTimeout(() => {
                    setTransactions((prev) =>
                      prev.filter((t) => t.$id !== document.$id)
                    );

                    // Update total count after removing the transaction to prevent timing conflicts
                    setTimeout(() => {
                      fetchTotalPendingCount();
                    }, 100);
                  }, 200); // Reduced transition time to prevent flickering
                }
              } else if (eventType.endsWith(".delete")) {
                // Mark for transition first, then remove from main list
                setTransactions((prev) =>
                  prev.map((t) =>
                    t.$id === document.$id ? { ...t, isTransitioning: true } : t
                  )
                );

                // Remove after animation
                setTimeout(() => {
                  setTransactions((prev) =>
                    prev.filter((t) => t.$id !== document.$id)
                  );

                  // Remove from tracking if it was there
                  removedIdsRef.current.delete(document.$id);
                }, 200); // Reduced transition time to prevent flickering
              }
            }
          }
        );

        unsubscribeRef.current = unsubscribe;
      } catch (error) {
        console.error("Error setting up realtime subscription:", error);
      }
    };

    // Defer realtime subscription setup to improve initial loading
    const timer = setTimeout(() => {
      setupRealtimeSubscription();
    }, 2000); // Wait 2 seconds after component mount

    return () => {
      clearTimeout(timer);
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [
    fetchTotalPendingCount,
    transactions.length,
    limit,
    userRole,
    userId,
    fetchTransactions,
    reloadAssignedTransactions,
  ]);

  // Monitor for discrepancy between total pending count and displayed transactions
  useEffect(() => {
    // Check if any transactions are currently transitioning to prevent timing conflicts
    const hasTransitioningTransactions = transactions.some(
      (t) => t.isTransitioning
    );

    if (
      !loading &&
      !loadingCount &&
      totalPendingCount > transactions.length &&
      !hasMore &&
      !hasTransitioningTransactions &&
      !discrepancyFixedRef.current
    ) {
      // There's a discrepancy, enable hasMore to trigger more loading
      discrepancyFixedRef.current = true;
      setHasMore(true);

      // Reset the flag after a delay to allow future discrepancy checks
      setTimeout(() => {
        discrepancyFixedRef.current = false;
      }, 1000);
    }
  }, [
    totalPendingCount,
    transactions.length,
    loading,
    loadingCount,
    hasMore,
    transactions,
  ]);

  // Memoized expensive components
  const MemoizedQRCodeDisplay = memo(QRCodeDisplay);
  const MemoizedRandomizeIcons = memo(RandomizeIcons);

  // Lazy loading QR component
  const LazyQRCode = memo(function LazyQRCode({
    transaction,
  }: {
    transaction: Transaction;
  }) {
    // Always show QR codes immediately - removed lazy loading to fix the "Loading QR..." issue
    return (
      <MemoizedQRCodeDisplay
        sourceType="vietqr"
        bankCode={transaction.bankCode}
        accountNumber={transaction.bankReceiveNumber}
        amount={transaction.unPaidAmount}
        additionalInfo={transaction.odrId}
        width={160}
        height={160}
        status={transaction.odrStatus}
        bankName={transaction.bankReceiveName}
        unavailableMessage="QR not available"
        ribbon={getRibbonType(transaction.merchantOrdId)}
        blur={transaction.isSuspicious}
        blurByDefault={transaction.isSuspicious}
        warningText={transaction.isSuspicious ? "Suspicious IP" : undefined}
        showHideToggle={transaction.isSuspicious}
        hideMessage={
          transaction.isSuspicious ? "Hide Suspicious QR" : "Hide QR Code"
        }
        showMessage={
          transaction.isSuspicious ? "View Suspicious QR" : "Show QR Code"
        }
      />
    );
  });

  // Get ribbon type based on merchantOrdId
  const getRibbonType = useCallback((merchantOrdId?: string): RibbonType => {
    if (!merchantOrdId) return null;

    const orderId = merchantOrdId.toUpperCase();

    if (orderId.includes("TEST")) return "test";
    if (orderId.includes("DISCOUNT")) return "discount";
    if (orderId.includes("TRENDING")) return "trending";
    if (orderId.includes("SPECIAL")) return "special";

    return null;
  }, []);

  // Format currency with memoization
  const formatCurrency = useCallback((amount: number) => {
    return new Intl.NumberFormat("vi-VN", {
      style: "currency",
      currency: "VND",
    }).format(amount);
  }, []);

  // Get status badge color
  const getStatusColor = (status: string) => {
    switch (status) {
      case "pending":
        return "bg-yellow-100 text-yellow-800";
      case "processing":
        return "bg-blue-100 text-blue-800";
      case "completed":
        return "bg-green-100 text-green-800";
      case "failed":
        return "bg-red-100 text-red-800";
      case "canceled":
        return "bg-gray-100 text-gray-800";
      default:
        return "bg-gray-100 text-gray-800";
    }
  };

  // Filter transactions to show only pending ones or those that are transitioning out
  const displayTransactions = useMemo(() => {
    const filtered = removeDuplicates(transactions).filter(
      (t) => t.odrStatus === "pending" || t.isTransitioning
    );

    return filtered;
  }, [transactions]);

  // Count suspicious transactions
  const suspiciousTransactionCount = useMemo(() => {
    return displayTransactions.filter((t) => t.isSuspicious).length;
  }, [displayTransactions]);

  // Helper function to format user display
  const formatUserDisplay = (user: Record<string, unknown>): string => {
    if (
      typeof user.firstName === "string" &&
      typeof user.lastName === "string" &&
      user.firstName &&
      user.lastName
    ) {
      return `${user.firstName} ${user.lastName}`;
    }

    if (typeof user.email === "string" && user.email) {
      return user.email;
    }

    if (typeof user.userId === "string" && user.userId) {
      return user.userId;
    }

    if (typeof user.$id === "string" && user.$id) {
      return user.$id;
    }

    return "Unknown User";
  };

  // Handle payment ID input change
  const handlePaymentIdChange = useCallback(
    (transactionId: string, value: string) => {
      setPaymentIds((prev) => ({
        ...prev,
        [transactionId]: value,
      }));
    },
    []
  );

  // Toggle transaction actions visibility
  const toggleTransactionActions = useCallback((transactionId: string) => {
    setShowTransactionActions((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(transactionId)) {
        newSet.delete(transactionId);
        // Clear validation results when hiding
        setPaymentValidationResults((prevResults) => ({
          ...prevResults,
          [transactionId]: null,
        }));
        setPaymentIds((prevIds) => ({
          ...prevIds,
          [transactionId]: "",
        }));
      } else {
        newSet.add(transactionId);
      }
      return newSet;
    });
  }, []);

  // Validate payment ID with API (validation only, no auto-processing)
  const validatePaymentId = useCallback(
    async (transaction: Transaction, paymentId: string) => {
      if (!paymentId.trim()) {
        toast({
          variant: "destructive",
          description: "Please enter a payment ID",
        });
        return;
      }

      // Add transaction to validating set
      setValidatingPayment((prev) => new Set(prev).add(transaction.$id));

      try {
        //console.log('Attempting to validate payment ID:', paymentId);

        // Step 1: Only validate the payment (no auto-processing)
        const response = await fetch(
          `/api/validate-payment?paymentId=${encodeURIComponent(
            paymentId
          )}&orderId=${encodeURIComponent(transaction.odrId)}&amount=${
            transaction.unPaidAmount
          }&transactionType=withdraw`,
          {
            method: "GET",
          }
        );

        // Handle non-200 responses
        if (response.status !== 200) {
          // Different error messages based on status code
          let errorMessage = `There is no payment with this payment ID: ${paymentId}`;

          if (response.status === 500) {
            errorMessage = `Server error when checking payment ID. Please try again later or contact support.`;
          } else if (response.status === 401 || response.status === 403) {
            errorMessage = `Authorization error. Please check API key configuration.`;
          }

          toast({
            variant: "destructive",
            description: errorMessage,
          });

          // Store failed validation result
          setPaymentValidationResults((prev) => ({
            ...prev,
            [transaction.$id]: null,
          }));

          return;
        }

        // Parse the validation response
        let validationResult: PaymentValidationResponse & {
          validation?: {
            extractedOrderId?: string;
            expectedOrderId?: string;
            orderIdMatch?: boolean;
            expectedAmount?: number;
            amountMatch?: boolean;
            isValid?: boolean;
          };
        };

        try {
          validationResult = await response.json();
          //console.log('validationResult',validationResult);
        } catch (parseError) {
          console.error("Error parsing API response:", parseError);
          toast({
            variant: "destructive",
            description: "Error parsing payment validation response",
          });

          // Clear validation result on parse error
          setPaymentValidationResults((prev) => ({
            ...prev,
            [transaction.$id]: null,
          }));

          return;
        }

        // Store validation result
        setPaymentValidationResults((prev) => ({
          ...prev,
          [transaction.$id]: validationResult,
        }));

        // If no payment data found, show error and exit
        if (validationResult.error !== 0 || !validationResult.data) {
          toast({
            variant: "destructive",
            description: `There is no payment with this payment ID: ${paymentId}`,
          });
          return;
        }

        // Show success message for validation
        toast({
          variant: "default",
          description:
            "Payment validated successfully! Review details and choose action.",
        });
      } catch (error) {
        console.error("Error validating payment:", error);
        toast({
          variant: "destructive",
          description:
            "Network or server error. Please check your connection and try again.",
        });

        // Clear validation result on error
        setPaymentValidationResults((prev) => ({
          ...prev,
          [transaction.$id]: null,
        }));
      } finally {
        // Remove transaction from validating set
        setValidatingPayment((prev) => {
          const newSet = new Set(prev);
          newSet.delete(transaction.$id);
          return newSet;
        });
      }
    },
    [toast]
  );

  // Handle bulk assignment of all unassigned withdrawals
  const handleBulkAssignment = useCallback(async () => {
    // Find unassigned transactions (those without users assigned)
    const unassignedTransactions = displayTransactions.filter(
      (transaction) => !transaction.users
    );

    if (unassignedTransactions.length === 0) {
      toast({
        variant: "default",
        description: "All transactions are already assigned to users.",
      });
      return;
    }

    if (
      !confirm(
        `Are you sure you want to assign ${unassignedTransactions.length} unassigned withdrawal(s) to users?`
      )
    ) {
      return;
    }

    // Mark as bulk assigning
    setAssigningTransactions(new Set(unassignedTransactions.map((t) => t.$id)));

    let successCount = 0;
    let failureCount = 0;
    const results: string[] = [];

    try {
      // Process assignments in parallel for better performance
      const assignmentPromises = unassignedTransactions.map(
        async (transaction) => {
          try {
            const assignedUserId = await assignWithdrawalToUser(
              transaction.$id
            );
            if (assignedUserId) {
              successCount++;
              results.push(`✓ ${transaction.odrId} → User ${assignedUserId}`);
              return { success: true, transaction, assignedUserId };
            } else {
              failureCount++;
              results.push(`✗ ${transaction.odrId} → No available users`);
              return {
                success: false,
                transaction,
                error: "No available users",
              };
            }
          } catch (error) {
            failureCount++;
            results.push(
              `✗ ${transaction.odrId} → Error: ${
                error instanceof Error ? error.message : "Unknown error"
              }`
            );
            return { success: false, transaction, error };
          }
        }
      );

      // Wait for all assignments to complete
      await Promise.all(assignmentPromises);

      // Show summary toast
      if (successCount > 0 && failureCount === 0) {
        toast({
          variant: "default",
          description: `Successfully assigned ${successCount} withdrawal(s) to users.`,
        });
      } else if (successCount > 0 && failureCount > 0) {
        toast({
          variant: "default",
          description: `Assigned ${successCount} withdrawal(s) successfully. ${failureCount} failed - check console for details.`,
        });
        console.log("Assignment results:", results);
      } else {
        toast({
          variant: "destructive",
          description: `Failed to assign ${failureCount} withdrawal(s). No available users or system error.`,
        });
        console.error("Assignment results:", results);
      }
    } catch (error) {
      console.error("Error during bulk assignment:", error);
      toast({
        variant: "destructive",
        description: "Failed to complete bulk assignment. Please try again.",
      });
    } finally {
      // Clear assigning state
      setAssigningTransactions(new Set());
    }
  }, [displayTransactions, toast]);

  // Process payment after staff confirmation
  const processPayment = useCallback(
    async (transaction: Transaction, paymentId: string) => {
      if (!paymentId.trim()) {
        toast({
          variant: "destructive",
          description: "Please enter a payment ID",
        });
        return;
      }

      // Prevent processing of already processed payments
      if (paymentValidationResults[transaction.$id]?.alreadyProcessed) {
        toast({
          variant: "destructive",
          description:
            "Cannot process: This payment was already successfully processed.",
        });
        return;
      }

      // Confirmation for Force Process (only Order ID mismatches now, since amount and debit type must be exact)
      const validationResult = paymentValidationResults[transaction.$id];

      if (
        validationResult &&
        !validationResult.validation?.orderIdMatch &&
        !validationResult.alreadyProcessed
      ) {
        const confirmMessage = `⚠️ Force Process Confirmation

        Order ID mismatch detected:
        • Expected Order ID: ${validationResult?.validation?.expectedOrderId}
        • Found in Payment: ${
          validationResult?.validation?.extractedOrderId || "None"
        }

        Order ID: ${transaction.odrId}
        Payment ID: ${paymentId}
        Amount: ${transaction.unPaidAmount.toLocaleString()} VND

        Are you certain this payment belongs to this order?

        Click OK to proceed or Cancel to abort.`;

        if (!confirm(confirmMessage)) {
          toast({
            variant: "default",
            description: "Force Process cancelled by user",
          });
          return;
        }
      }

      // Add transaction to processing set
      setProcessingPayments((prev) => new Set(prev).add(transaction.$id));

      try {
        // Call the processing API endpoint
        const processResponse = await fetch("/api/validate-payment", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            paymentId,
            orderId: transaction.odrId,
            expectedAmount: transaction.unPaidAmount,
            transactionType: "withdraw",
          }),
        });

        // Parse the processing response
        const processResult = await processResponse.json();

        if (processResponse.ok && processResult.success) {
          // Success - mark as processed and show success message
          toast({
            variant: "default",
            description: `Payment processed successfully! Transaction ID: ${processResult.transactionId}`,
          });

          // Mark this transaction as validated AND just processed
          setValidatedTransactions((prev) =>
            new Set(prev).add(transaction.$id)
          );
          setJustProcessedTransactions((prev) =>
            new Set(prev).add(transaction.$id)
          );

          // Auto-hide transaction actions after successful processing
          setTimeout(() => {
            setShowTransactionActions((prev) => {
              const newSet = new Set(prev);
              newSet.delete(transaction.$id);
              return newSet;
            });
          }, 3000); // Hide after 3 seconds
        } else {
          // Error processing payment
          let errorMessage =
            processResult.message || "Failed to process payment";

          if (processResult.status === "duplicated") {
            errorMessage = "This payment has already been processed";
            // Even though there was an error, if it's just because it was already processed,
            // we can still mark it as validated for UI purposes
            setValidatedTransactions((prev) =>
              new Set(prev).add(transaction.$id)
            );
          } else {
            // For actual errors, show the error message
            toast({
              variant: "destructive",
              description: errorMessage,
            });
          }
        }
      } catch (processError) {
        console.error("Error processing payment:", processError);
        toast({
          variant: "destructive",
          description: "Server error processing payment. Please try again.",
        });
      } finally {
        // Remove transaction from processing set
        setProcessingPayments((prev) => {
          const newSet = new Set(prev);
          newSet.delete(transaction.$id);
          return newSet;
        });
      }
    },
    [toast, paymentValidationResults]
  );

  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">
          <HeaderBox
            type="greeting"
            title="Pending Withdrawals"
            subtext="Solving pending withdrawals first in first out"
          />
          {/* Total pending count and bulk assignment button */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="text-lg font-medium text-gray-700 flex items-center gap-2">
              {t("totalPendingCount") || "Total Pending Orders"}:{" "}
              <span className="text-blue-600 font-bold">
                {totalPendingCount}
              </span>
              {suspiciousTransactionCount > 0 && (
                <span className="text-red-600 font-bold ml-4 flex items-center">
                  <X className="h-4 w-4 mr-1" />
                  Suspicious: {suspiciousTransactionCount}
                </span>
              )}
            </div>

            {/* Bulk assignment button for admin and transactor */}
            {(userRole === "admin" || userRole === "transactor") && (
              <Button
                onClick={handleBulkAssignment}
                disabled={assigningTransactions.size > 0 || loading}
                className="form-btn-shadow"
                size="sm"
              >
                {assigningTransactions.size > 0 ? (
                  <>
                    <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    {t("assigning") || "Assigning..."}
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    {t("reassignAllOrders") || "Reassign All Orders"}
                  </>
                )}
              </Button>
            )}
          </div>
        </header>

        <div className="w-full">
          {loading && transactions.length === 0 ? (
            // Show skeleton cards immediately for better perceived performance
            <div className="grid grid-cols-1 gap-6">
              {Array.from({ length: 5 }, (_, i) => (
                <Card
                  key={`initial-skeleton-${i}`}
                  className="overflow-hidden border-l-4 border-l-gray-200 animate-pulse"
                >
                  <CardContent className="p-0">
                    <div className="bg-gray-50 p-4 border-b">
                      <div className="flex justify-between items-center mb-2">
                        <div className="flex items-center gap-2">
                          <div className="h-6 bg-gray-200 rounded w-32"></div>
                          <div className="h-4 w-4 bg-gray-200 rounded"></div>
                        </div>
                        <div className="h-6 bg-gray-200 rounded w-20"></div>
                      </div>
                      <div className="h-4 bg-gray-200 rounded w-48"></div>
                    </div>
                    <div className="p-4 flex flex-col md:flex-row gap-4">
                      <div className="w-40 h-40 bg-gray-200 rounded"></div>
                      <div className="flex-1 space-y-4">
                        <div className="bg-gray-100 rounded-lg p-3">
                          <div className="space-y-2">
                            <div className="h-4 bg-gray-200 rounded w-full"></div>
                            <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="space-y-3">
                            <div className="h-12 bg-gray-200 rounded"></div>
                            <div className="h-8 bg-gray-200 rounded"></div>
                          </div>
                          <div className="space-y-3">
                            <div className="h-8 bg-gray-200 rounded"></div>
                            <div className="h-8 bg-gray-200 rounded"></div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : error && transactions.length === 0 ? (
            <div className="text-center py-8 text-gray-500">{error}</div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-6">
                {displayTransactions.map((transaction, index) => (
                  <Card
                    key={`${transaction.$id}-${transaction.odrId}`}
                    data-index={index} // Add data-index for preload observer
                    className={`overflow-hidden transition-all duration-500 hover:shadow-lg border-l-4 border-l-blue-500 ${
                      transaction.isTransitioning
                        ? "opacity-0 transform translate-y-4"
                        : "opacity-100 transform translate-y-0"
                    }`}
                  >
                    <CardContent className="p-0">
                      {/* Header Section */}
                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 border-b">
                        <div className="flex justify-between items-center mb-2">
                          <div className="flex items-center gap-1">
                            <h3 className="font-bold text-lg text-gray-800">
                              #{index + 1}{" "}
                              <span className="text-blue-600">
                                {transaction.odrId}
                              </span>
                            </h3>
                            <CopyButton
                              text={transaction.odrId}
                              tooltipText="Copy Order ID"
                              tooltipSide="right"
                            />
                          </div>
                          <span
                            className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusColor(
                              transaction.odrStatus
                            )}`}
                          >
                            {transaction.odrStatus.toUpperCase()}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-sm text-gray-600">
                          <span>
                            {t("merchantOrderID") || "Merchant Ref ID"}:
                          </span>
                          <span className="font-medium">
                            {transaction.merchantOrdId || "-"}
                          </span>
                          {transaction.merchantOrdId && (
                            <CopyButton
                              text={transaction.merchantOrdId}
                              tooltipText="Copy Merchant ID"
                              tooltipSide="right"
                              size="sm"
                              variant="ghost"
                            />
                          )}
                        </div>
                      </div>

                      {/* Main Content Section - QR Code and Transaction Details */}
                      <div className="p-4 flex flex-col md:flex-row gap-4">
                        {/* QR Code Section - Left Side */}
                        <div
                          data-transaction-id={transaction.$id}
                          ref={(el) => {
                            if (el && qrObserverRef.current) {
                              qrObserverRef.current.observe(el);
                            }
                          }}
                        >
                          <LazyQRCode transaction={transaction} />
                        </div>

                        {/* Transaction Details Section - Right Side */}
                        <div className="flex-1 space-y-4">
                          {/* Amount Information */}
                          <div className="bg-gray-50 rounded-lg p-3">
                            <div className="grid grid-cols-1 gap-3">
                              <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600">
                                  {t("amount") || "Amount"}:
                                </span>
                                <span className="font-bold text-lg text-green-600">
                                  {formatCurrency(transaction.amount)}
                                </span>
                              </div>
                              <div className="flex justify-between items-center">
                                <span className="text-sm text-gray-600">
                                  {t("unpaidAmount") || "Unpaid"}:
                                </span>
                                <span className="font-semibold text-amber-600">
                                  {formatCurrency(transaction.unPaidAmount)}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Reorganized layout with two columns */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Left Column - Bank Information */}
                            <div className="space-y-3">
                              <div>
                                <div className="mb-3">
                                  <MemoizedRandomizeIcons
                                    seed={transaction.odrId}
                                    size={50}
                                    className="text-blue-600"
                                  />
                                </div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide">
                                  {t("bankAccount") || "Bank Account"}
                                </p>
                                <p className="font-medium text-gray-800">
                                  {transaction.bankReceiveNumber || "-"}
                                </p>
                              </div>

                              <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide">
                                  {t("accountName") || "Account Name"}
                                </p>
                                <p className="font-medium text-gray-800">
                                  {transaction.bankReceiveOwnerName || "-"}
                                </p>
                              </div>
                            </div>

                            {/* Right Column - Created At, IP, Assigned User */}
                            <div className="space-y-3">
                              <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide">
                                  {t("createdAt") || "Created At"}
                                </p>
                                <p className="font-medium text-gray-800 text-sm">
                                  {new Date(
                                    transaction.$createdAt
                                  ).toLocaleString()}
                                </p>
                              </div>

                              {/* IP Address display */}
                              <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide">
                                  {t("createdIp") || "IP Address"}
                                </p>
                                <div
                                  className={`font-medium text-sm ${
                                    transaction.isSuspicious
                                      ? "text-red-600"
                                      : "text-gray-800"
                                  }`}
                                >
                                  {transaction.createdIp || "-"}
                                  {transaction.isSuspicious && (
                                    <span className="ml-2 text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
                                      Suspicious
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Display assigned user */}
                              <div>
                                <p className="text-xs text-gray-500 uppercase tracking-wide">
                                  {t("assignedUser") || "Assigned To"}
                                </p>
                                <div className="font-medium text-sm text-gray-800">
                                  {transaction.users ? (
                                    <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs">
                                      {typeof transaction.users === "object"
                                        ? formatUserDisplay(transaction.users)
                                        : transaction.users}
                                    </span>
                                  ) : (
                                    <span className="text-gray-500">
                                      Unassigned
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Action buttons for pending transactions */}
                      {canUpdateStatus(transaction) && (
                        <div className="bg-gray-50 border-t p-4">
                          {!showTransactionActions.has(transaction.$id) ? (
                            // Show only the toggle button when actions are hidden
                            <div className="flex justify-center">
                              <Button
                                variant="outline"
                                onClick={() =>
                                  toggleTransactionActions(transaction.$id)
                                }
                                className="border-orange-500 text-orange-600 hover:bg-orange-50"
                                size="sm"
                              >
                                <AlertTriangle className="mr-2 h-4 w-4" />
                                Validate Payment
                              </Button>
                            </div>
                          ) : (
                            // Show full transaction actions when expanded
                            <>
                              <div className="flex items-center justify-between mb-3">
                                <h4 className="text-sm font-semibold text-gray-700 flex items-center">
                                  <span className="w-2 h-2 bg-blue-500 rounded-full mr-2"></span>
                                  Transaction Actions
                                </h4>
                                <Button
                                  variant="ghost"
                                  onClick={() =>
                                    toggleTransactionActions(transaction.$id)
                                  }
                                  size="sm"
                                  className="text-gray-500 hover:text-gray-700"
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                              {updatingTransactions.has(transaction.$id) ? (
                                <div className="flex justify-center py-4">
                                  <div className="flex flex-col items-center">
                                    <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
                                    <p className="mt-2 text-sm text-gray-600">
                                      Updating status...
                                    </p>
                                  </div>
                                </div>
                              ) : (
                                <div className="flex flex-col gap-2">
                                  <div className="flex gap-2">
                                    <Input
                                      type="text"
                                      placeholder="Enter payment ID"
                                      value={paymentIds[transaction.$id] || ""}
                                      onChange={(e) =>
                                        handlePaymentIdChange(
                                          transaction.$id,
                                          e.target.value
                                        )
                                      }
                                      className="flex-1"
                                      disabled={
                                        validatingPayment.has(
                                          transaction.$id
                                        ) ||
                                        processingPayments.has(transaction.$id)
                                      }
                                    />
                                    <Button
                                      variant="outline"
                                      onClick={() =>
                                        validatePaymentId(
                                          transaction,
                                          paymentIds[transaction.$id] || ""
                                        )
                                      }
                                      className="border-blue-500 text-blue-600 hover:bg-blue-50"
                                      size="sm"
                                      disabled={
                                        validatingPayment.has(
                                          transaction.$id
                                        ) ||
                                        processingPayments.has(transaction.$id)
                                      }
                                    >
                                      {validatingPayment.has(
                                        transaction.$id
                                      ) ? (
                                        <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                      ) : (
                                        <Check className="mr-2 h-4 w-4" />
                                      )}
                                      {validatingPayment.has(transaction.$id)
                                        ? "Validating..."
                                        : "Validate"}
                                    </Button>
                                  </div>

                                  {/* Show payment validation status and action buttons */}
                                  {paymentValidationResults[
                                    transaction.$id
                                  ] && (
                                    <>
                                      {validatedTransactions.has(
                                        transaction.$id
                                      ) ? (
                                        <div className="text-xs text-white bg-green-500 p-2 rounded flex items-center justify-center mt-2">
                                          <Check className="h-3 w-3 mr-1" />
                                          {justProcessedTransactions.has(
                                            transaction.$id
                                          )
                                            ? "Payment processed successfully!"
                                            : "Payment was previously processed"}
                                        </div>
                                      ) : paymentValidationResults[
                                          transaction.$id
                                        ]?.error === 0 &&
                                        paymentValidationResults[
                                          transaction.$id
                                        ]?.data ? (
                                        <div className="mt-3 space-y-3">
                                          {/* Payment Info Card */}
                                          <div className="bg-white border border-gray-200 rounded-lg p-3">
                                            <div className="flex items-center justify-between">
                                              <div>
                                                <div className="text-lg font-semibold text-gray-900">
                                                  {paymentValidationResults[
                                                    transaction.$id
                                                  ]?.data?.amount?.toLocaleString()}{" "}
                                                  VND
                                                </div>
                                                <div className="text-sm text-gray-600">
                                                  {paymentValidationResults[
                                                    transaction.$id
                                                  ]?.data
                                                    ?.corresponsiveName && (
                                                    <>
                                                      from{" "}
                                                      {
                                                        paymentValidationResults[
                                                          transaction.$id
                                                        ]?.data
                                                          ?.corresponsiveName
                                                      }
                                                    </>
                                                  )}
                                                </div>
                                              </div>
                                              <div
                                                className={`px-3 py-1 rounded-full text-sm font-medium ${
                                                  paymentValidationResults[
                                                    transaction.$id
                                                  ]?.alreadyProcessed
                                                    ? "bg-red-100 text-red-700"
                                                    : paymentValidationResults[
                                                        transaction.$id
                                                      ]?.validation?.isValid
                                                    ? "bg-green-100 text-green-700"
                                                    : !paymentValidationResults[
                                                        transaction.$id
                                                      ]?.validation
                                                        ?.isDebitTransaction ||
                                                      !paymentValidationResults[
                                                        transaction.$id
                                                      ]?.validation?.amountMatch
                                                    ? "bg-red-100 text-red-700"
                                                    : "bg-yellow-100 text-yellow-700"
                                                }`}
                                              >
                                                {paymentValidationResults[
                                                  transaction.$id
                                                ]?.alreadyProcessed
                                                  ? "Already Processed"
                                                  : paymentValidationResults[
                                                      transaction.$id
                                                    ]?.validation?.isValid
                                                  ? "Perfect Match"
                                                  : !paymentValidationResults[
                                                      transaction.$id
                                                    ]?.validation
                                                      ?.isDebitTransaction ||
                                                    !paymentValidationResults[
                                                      transaction.$id
                                                    ]?.validation?.amountMatch
                                                  ? "Invalid Transaction"
                                                  : "Needs Review"}
                                              </div>
                                            </div>
                                          </div>

                                          {/* Action Buttons */}
                                          {paymentValidationResults[
                                            transaction.$id
                                          ]?.alreadyProcessed ? (
                                            <div className="space-y-2">
                                              <div className="flex gap-2">
                                                <Button
                                                  variant="outline"
                                                  onClick={() => {
                                                    setPaymentValidationResults(
                                                      (prev) => ({
                                                        ...prev,
                                                        [transaction.$id]: null,
                                                      })
                                                    );
                                                    setPaymentIds((prev) => ({
                                                      ...prev,
                                                      [transaction.$id]: "",
                                                    }));
                                                  }}
                                                  size="sm"
                                                  disabled={processingPayments.has(
                                                    transaction.$id
                                                  )}
                                                  className="w-full"
                                                >
                                                  Cancel
                                                </Button>
                                              </div>
                                              <div className="text-xs text-red-600 bg-red-50 p-2 rounded space-y-1">
                                                <div className="font-semibold">
                                                  ❌ PAYMENT ALREADY PROCESSED
                                                </div>
                                                <div>
                                                  This payment was already
                                                  successfully processed in the
                                                  system.
                                                </div>
                                                <div className="font-semibold text-red-700 mt-1">
                                                  Processing is not allowed for
                                                  already processed payments.
                                                </div>
                                              </div>
                                            </div>
                                          ) : paymentValidationResults[
                                              transaction.$id
                                            ]?.validation?.isValid ? (
                                            <Button
                                              onClick={() =>
                                                processPayment(
                                                  transaction,
                                                  paymentIds[transaction.$id] ||
                                                    ""
                                                )
                                              }
                                              className="w-full bg-green-600 hover:bg-green-700"
                                              disabled={processingPayments.has(
                                                transaction.$id
                                              )}
                                            >
                                              {processingPayments.has(
                                                transaction.$id
                                              ) ? (
                                                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                              ) : (
                                                <Check className="mr-2 h-4 w-4" />
                                              )}
                                              {processingPayments.has(
                                                transaction.$id
                                              )
                                                ? "Processing..."
                                                : "Process Payment"}
                                            </Button>
                                          ) : (
                                            <div className="space-y-2">
                                              {/* Only show Force Process if it's a debit transaction AND amount matches */}
                                              {paymentValidationResults[
                                                transaction.$id
                                              ]?.validation
                                                ?.isDebitTransaction &&
                                              paymentValidationResults[
                                                transaction.$id
                                              ]?.validation?.amountMatch ? (
                                                <>
                                                  <div className="flex gap-2">
                                                    <Button
                                                      onClick={() =>
                                                        processPayment(
                                                          transaction,
                                                          paymentIds[
                                                            transaction.$id
                                                          ] || ""
                                                        )
                                                      }
                                                      className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-semibold"
                                                      disabled={processingPayments.has(
                                                        transaction.$id
                                                      )}
                                                    >
                                                      {processingPayments.has(
                                                        transaction.$id
                                                      ) ? (
                                                        <>
                                                          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                                                          Processing...
                                                        </>
                                                      ) : (
                                                        <>
                                                          <AlertTriangle className="mr-2 h-4 w-4" />
                                                          Force Process
                                                        </>
                                                      )}
                                                    </Button>
                                                    <Button
                                                      variant="outline"
                                                      onClick={() => {
                                                        setPaymentValidationResults(
                                                          (prev) => ({
                                                            ...prev,
                                                            [transaction.$id]:
                                                              null,
                                                          })
                                                        );
                                                        setPaymentIds(
                                                          (prev) => ({
                                                            ...prev,
                                                            [transaction.$id]:
                                                              "",
                                                          })
                                                        );
                                                      }}
                                                      disabled={processingPayments.has(
                                                        transaction.$id
                                                      )}
                                                    >
                                                      Cancel
                                                    </Button>
                                                  </div>
                                                  <div className="text-xs text-yellow-700 bg-yellow-50 p-2 rounded space-y-1">
                                                    <div>
                                                      ⚠️ Validation Issues
                                                      Detected:
                                                    </div>
                                                    {!paymentValidationResults[
                                                      transaction.$id
                                                    ]?.validation
                                                      ?.orderIdMatch && (
                                                      <div>
                                                        • Order ID mismatch
                                                      </div>
                                                    )}
                                                    <div className="mt-1 font-medium">
                                                      Use &quot;Force
                                                      Process&quot; only if
                                                      you&apos;re certain this
                                                      payment belongs to this
                                                      order.
                                                    </div>
                                                  </div>
                                                </>
                                              ) : (
                                                <>
                                                  <div className="flex gap-2">
                                                    <Button
                                                      variant="outline"
                                                      onClick={() => {
                                                        setPaymentValidationResults(
                                                          (prev) => ({
                                                            ...prev,
                                                            [transaction.$id]:
                                                              null,
                                                          })
                                                        );
                                                        setPaymentIds(
                                                          (prev) => ({
                                                            ...prev,
                                                            [transaction.$id]:
                                                              "",
                                                          })
                                                        );
                                                      }}
                                                      disabled={processingPayments.has(
                                                        transaction.$id
                                                      )}
                                                      className="w-full"
                                                    >
                                                      Cancel
                                                    </Button>
                                                  </div>
                                                  <div className="text-xs text-red-600 bg-red-50 p-2 rounded space-y-1">
                                                    <div className="font-semibold">
                                                      ❌ INVALID TRANSACTION
                                                    </div>
                                                    {!paymentValidationResults[
                                                      transaction.$id
                                                    ]?.validation
                                                      ?.isDebitTransaction && (
                                                      <div>
                                                        • Not a debit
                                                        transaction (withdraw
                                                        orders must have
                                                        negative amounts)
                                                      </div>
                                                    )}
                                                    {!paymentValidationResults[
                                                      transaction.$id
                                                    ]?.validation
                                                      ?.amountMatch && (
                                                      <div>
                                                        • Amount mismatch:
                                                        Expected{" "}
                                                        {paymentValidationResults[
                                                          transaction.$id
                                                        ]?.validation?.expectedAmount?.toLocaleString()}{" "}
                                                        VND, Found{" "}
                                                        {paymentValidationResults[
                                                          transaction.$id
                                                        ]?.validation?.actualAmount?.toLocaleString()}{" "}
                                                        VND
                                                      </div>
                                                    )}
                                                    <div className="font-semibold text-red-700 mt-1">
                                                      Processing is not allowed
                                                      for invalid transactions.
                                                    </div>
                                                  </div>
                                                </>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      ) : null}
                                    </>
                                  )}

                                  {/* Add back the Mark as Failed button */}
                                  <Button
                                    variant="destructive"
                                    onClick={() =>
                                      handleStatusUpdate(transaction, "failed")
                                    }
                                    className="light-btn"
                                    size="sm"
                                    disabled={
                                      validatingPayment.has(transaction.$id) ||
                                      processingPayments.has(transaction.$id)
                                    }
                                  >
                                    <X className="mr-2 h-4 w-4" />
                                    Mark as Failed
                                  </Button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Loading indicators for infinite scroll */}
              {loadingMore && (
                <div className="grid grid-cols-1 gap-6">
                  {Array.from({ length: skeletonCount }, (_, i) => (
                    <Card
                      key={`skeleton-${i}`}
                      className="overflow-hidden border-l-4 border-l-gray-200 animate-pulse"
                    >
                      <CardContent className="p-0">
                        <div className="bg-gray-50 p-4 border-b">
                          <div className="flex justify-between items-center mb-2">
                            <div className="flex items-center gap-2">
                              <div className="h-6 bg-gray-200 rounded w-32"></div>
                              <div className="h-4 w-4 bg-gray-200 rounded"></div>
                            </div>
                            <div className="h-6 bg-gray-200 rounded w-20"></div>
                          </div>
                          <div className="h-4 bg-gray-200 rounded w-48"></div>
                        </div>
                        <div className="p-4 flex flex-col md:flex-row gap-4">
                          <div className="w-40 h-40 bg-gray-200 rounded"></div>
                          <div className="flex-1 space-y-4">
                            <div className="bg-gray-100 rounded-lg p-3">
                              <div className="space-y-2">
                                <div className="h-4 bg-gray-200 rounded w-full"></div>
                                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-3">
                                <div className="h-12 bg-gray-200 rounded"></div>
                                <div className="h-8 bg-gray-200 rounded"></div>
                              </div>
                              <div className="space-y-3">
                                <div className="h-8 bg-gray-200 rounded"></div>
                                <div className="h-8 bg-gray-200 rounded"></div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {/* Traditional loading spinner for initial load */}
              {loading && transactions.length > 0 && !loadingMore && (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              )}

              {/* Subtle preloading indicator */}
              {isPreloading && !loadingMore && (
                <div className="flex justify-center py-2">
                  <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                </div>
              )}

              {/* Intersection observer target */}
              {hasMore && !loading && <div ref={loaderRef} className="h-10" />}

              {/* No more transactions indicator */}
              {!hasMore &&
                !loading &&
                displayTransactions.length > 0 &&
                totalPendingCount <= displayTransactions.length && (
                  <div className="text-center py-6 text-gray-500 border-t mt-6">
                    <p>All transactions loaded</p>
                    {totalPendingCount === 0 ? (
                      <p className="text-sm mt-1">
                        No pending transactions available
                      </p>
                    ) : (
                      <p className="text-sm mt-1">
                        Showing {displayTransactions.length} of{" "}
                        {totalPendingCount} total pending transactions
                      </p>
                    )}
                  </div>
                )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
