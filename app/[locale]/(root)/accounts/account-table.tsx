"use client";

import { DynamicTable } from "@/components/DynamicTable";
import { Badge } from "@/components/ui/badge";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { subscribeToCollectionDocuments } from "@/lib/client/appwriteSubcriptions";
import { formatAmount } from "@/lib/utils";
import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Edit, Trash2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  deleteAccount,
  getAccountsByUserRole,
} from "@/lib/actions/account.actions";
import { Account, User } from "@/types";
import { useTranslations } from "next-intl";
import { client } from "@/lib/appwrite/appwrite-client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

// Define props interface for the component
interface AccountTableProps {
  initialAccounts: Account[] | undefined;
  totalAccounts: number;
  userRole: string;
  loggedInUser: User;
  initialPage: number;
  initialPageSize: number;
}

interface AppwriteDocument {
  $id: string;
  $collectionId: string;
  $databaseId: string;
  $createdAt: string;
  $updatedAt: string;
  [key: string]: unknown;
}

interface AppwriteRealtimeResponse {
  events: string[];
  payload: AppwriteDocument;
  channels: string[];
}

export default function AccountTable({
  initialAccounts = [],
  totalAccounts,
  userRole,
  loggedInUser,
  initialPage = 1,
  initialPageSize = 10,
}: AccountTableProps) {
  const t = useTranslations("accounts");
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // State for accounts and pagination
  const [accounts, setAccounts] = useState<Account[]>(
    Array.isArray(initialAccounts) ? initialAccounts : []
  );
  const [currentPage, setCurrentPage] = useState<number>(initialPage);
  const [pageSize, setPageSize] = useState<number>(initialPageSize);
  const [total, setTotal] = useState<number>(totalAccounts);

  // UI state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [subscriptionActive, setSubscriptionActive] = useState(false);

  // Component mounted ref
  const isMounted = useRef(true);

  // IDs of accounts currently displayed
  const accountIds = useRef<string[]>(
    Array.isArray(initialAccounts) ? initialAccounts.map((acc) => acc.$id) : []
  );

  // Update URL when pagination changes
  const updateURL = useCallback(
    (page: number, limit: number) => {
      const params = new URLSearchParams(searchParams);
      params.set("page", page.toString());
      params.set("limit", limit.toString());
      router.push(`${pathname}?${params.toString()}`);
    },
    [searchParams, router, pathname]
  );

  // Fetch accounts with pagination
  const fetchAccounts = useCallback(
    async (page: number, size: number) => {
      setIsLoading(true);
      try {
        const result = await getAccountsByUserRole(
          loggedInUser.$id,
          userRole,
          page,
          size
        );

        if (isMounted.current && result?.documents) {
          setAccounts(result.documents);
          setTotal(result.total || 0);

          // Update account IDs for subscription with proper typing
          accountIds.current = result.documents.map(
            (account: Account) => account.$id
          );

          setLastUpdated(new Date());
          updateURL(page, size);
        }
      } catch (error) {
        console.error("Error fetching accounts:", error);
        if (isMounted.current) {
          toast({
            variant: "destructive",
            description: t("errorFetchingAccounts", {
              defaultValue: "Failed to fetch accounts",
            }),
          });
        }
      } finally {
        if (isMounted.current) {
          setIsLoading(false);
        }
      }
    },
    [loggedInUser.$id, userRole, toast, t, updateURL]
  );

  // Handle page change
  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(page);
      fetchAccounts(page, pageSize);
    },
    [fetchAccounts, pageSize]
  );

  // Handle page size change
  const handlePageSizeChange = useCallback(
    (size: number) => {
      setPageSize(size);
      setCurrentPage(1); // Reset to first page when changing page size
      fetchAccounts(1, size);
    },
    [fetchAccounts]
  );

  // Manual refresh function
  const refreshAccounts = useCallback(() => {
    fetchAccounts(currentPage, pageSize);
  }, [fetchAccounts, currentPage, pageSize]);

  // Initial load effect
  useEffect(() => {
    // Set accounts from props on first load
    setAccounts(Array.isArray(initialAccounts) ? initialAccounts : []);
    setTotal(totalAccounts);

    // Initialize account IDs for subscription
    accountIds.current = Array.isArray(initialAccounts)
      ? initialAccounts.map((account) => account.$id)
      : [];

    // Cleanup function
    return () => {
      isMounted.current = false;
    };
  }, [initialAccounts, totalAccounts]);

  // Set up direct Appwrite real-time subscription
  useEffect(() => {
    if (accountIds.current.length === 0) {
      setSubscriptionActive(false);
      return () => {}; // No cleanup needed
    }

    try {
      // Use the optimized version for multiple document subscriptions
      const unsubscribe = subscribeToCollectionDocuments<Account>(
        appwriteConfig.databaseId,
        appwriteConfig.accountsCollectionId,
        accountIds.current,
        (updatedAccount) => {
          // For merchants, only update if it's their account
          if (
            userRole === "merchant" &&
            updatedAccount.users?.userId !== loggedInUser.userId
          ) {
            return;
          }

          if (isMounted.current) {
            setAccounts((prevAccounts) => {
              // Update existing account
              return prevAccounts.map((account) =>
                account.$id === updatedAccount.$id ? updatedAccount : account
              );
            });

            setLastUpdated(new Date());
            setSubscriptionActive(true);
          }
        }
      );

      // Setup second subscription for deleted documents
      const deleteChannel = `databases.${appwriteConfig.databaseId}.collections.${appwriteConfig.accountsCollectionId}.documents`;

      const deleteSubscription = client.subscribe(
        deleteChannel,
        (response: AppwriteRealtimeResponse) => {
          // Check if it's a delete event
          if (response.events.some((event) => event.endsWith(".delete"))) {
            // The payload should be an AppwriteDocument with an $id
            const deletedId = response.payload.$id;

            if (
              deletedId &&
              accountIds.current.includes(deletedId) &&
              isMounted.current
            ) {
              // Remove account from state
              setAccounts((prevAccounts) =>
                prevAccounts.filter((account) => account.$id !== deletedId)
              );

              // Update total count
              setTotal((prev) => Math.max(0, prev - 1));

              setLastUpdated(new Date());

              // Refresh if we deleted the last item on a page
              if (accounts.length === 1 && currentPage > 1) {
                handlePageChange(currentPage - 1);
              }
            }
          }
        }
      );

      // Indicate subscription is active
      setSubscriptionActive(true);

      // Clean up both subscriptions when component unmounts
      return () => {
        unsubscribe();
        deleteSubscription();
      };
    } catch (error) {
      console.error("Error setting up subscription:", error);
      setSubscriptionActive(false);

      // Fallback to polling if subscription fails
      const pollingInterval = setInterval(() => {
        if (isMounted.current) {
          refreshAccounts();
        }
      }, 30000); // Poll every 30 seconds

      return () => {
        clearInterval(pollingInterval);
      };
    }
  }, [
    accounts.length,
    currentPage,
    loggedInUser,
    refreshAccounts,
    userRole,
    handlePageChange,
  ]);

  // Function to handle deleting an account
  const handleDeleteAccount = async (id: string) => {
    if (confirm(t("confirmDeleteAccount"))) {
      setDeletingId(id);

      try {
        await deleteAccount(id);
        toast({
          description: t("accountDeleted"),
        });

        // Manually update the local state
        setAccounts((prevAccounts) =>
          prevAccounts.filter((account) => account.$id !== id)
        );

        // Update total count
        setTotal((prev) => Math.max(0, prev - 1));

        setLastUpdated(new Date());

        // Refresh if we deleted the last item on a page
        if (accounts.length === 1 && currentPage > 1) {
          handlePageChange(currentPage - 1);
        }
      } catch (error) {
        toast({
          variant: "destructive",
          description: t("accountDeleteError"),
        });
        console.error(error);
      }

      setDeletingId(null);
    }
  };

  // Define columns
  const columns = [
    {
      header: t("accountName"),
      cell: (account: Account) => (
        <div className="flex flex-col">
          <span className="font-medium">{account.accountName}</span>
          <span className="text-sm text-gray-500">
            ID: {account.accountId.substring(0, 8)}...
          </span>
        </div>
      ),
    },
    {
      header: t("publicTransactionsID"),
      cell: (account: Account) => (
        <div className="flex items-center">
          <span className="font-mono text-sm">
            {account.publicTransactionId}
          </span>
        </div>
      ),
    },
    {
      header: t("availableBalance"),
      cell: (account: Account) => (
        <span className="font-medium">
          {formatAmount(account.avaiableBalance)}
        </span>
      ),
    },
    {
      header: t("currentBalance"),
      cell: (account: Account) => (
        <span className="font-medium">
          {formatAmount(account.currentBalance)}
        </span>
      ),
    },
    {
      header: t("status"),
      cell: (account: Account) => {
        const isActive = account.status;

        // Use a properly typed variant
        const variant: "info" | "danger" = isActive ? "info" : "danger";

        return (
          <Badge variant={variant}>
            {isActive ? t("accountActivated") : t("accountInactivated")}
          </Badge>
        );
      },
    },
    {
      header: t("apikey"),
      cell: (account: Account) => (
        <span className="font-mono text-xs">
          {account.apiKey ? (
            `${account.apiKey.substring(0, 8)}...`
          ) : (
            <span className="text-gray-400">{t("notset")}</span>
          )}
        </span>
      ),
    },
    {
      header: t("actions"),
      cell: (account: Account) => (
        <div className="flex space-x-2">
          {/* Edit button available to admins and to merchants for their own accounts */}
          {(userRole === "admin" ||
            userRole === "transactor" ||
            (userRole === "merchant" &&
              account.users.userId === loggedInUser.userId &&
              account.status)) && (
            <Link href={`/accounts/edit/${account.$id}`}>
              <Button variant="outline" size="sm" className="h-8 w-8 p-0">
                <Edit className="h-4 w-4" />
                <span className="sr-only">Edit</span>
              </Button>
            </Link>
          )}

          {/* Delete button only for admins */}
          {userRole === "admin" && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
              onClick={() => handleDeleteAccount(account.$id)}
              disabled={deletingId === account.$id}
            >
              <Trash2 className="h-4 w-4" />
              <span className="sr-only">Delete</span>
            </Button>
          )}
        </div>
      ),
    },
  ];

  // Row styling based on status
  const getAccountRowClassName = (account: Account) => {
    return account.status
      ? "bg-emerald-50 hover:bg-emerald-100"
      : "bg-red-50 hover:bg-red-100";
  };

  // Calculate pagination properties expected by the DynamicTable component
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div>
      {/* Real-time status indicator */}
      {/* <div className="flex justify-between items-center mb-3">
        <div className="flex items-center text-xs text-gray-500">
          <div
            className={`w-2 h-2 rounded-full mr-1 ${
              subscriptionActive ? "bg-green-500" : "bg-amber-500"
            }`}
          ></div>
          {subscriptionActive
            ? t("realtimeActive", { defaultValue: "Real-time updates active" })
            : t("pollingActive", { defaultValue: "Periodic updates active" })}
          {lastUpdated && (
            <span className="ml-2">
              • {t("lastUpdated", { defaultValue: "Last updated" })}:{" "}
              {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={refreshAccounts}
          disabled={isLoading}
          className="flex items-center gap-1 text-xs"
        >
          <RefreshCw className={`h-3 w-3 ${isLoading ? "animate-spin" : ""}`} />
          {t("refresh", { defaultValue: "Refresh" })}
        </Button>
      </div> */}

      {/* Correctly match props to DynamicTable's expected interface */}
      <DynamicTable
        data={accounts}
        columns={columns}
        rowClassName={getAccountRowClassName}
        pagination={true}
        pageSize={pageSize}
        pageSizeOptions={[5, 10, 25, 50, 100]}
        currentPage={currentPage}
        totalPages={totalPages}
        totalItems={total}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
        externalPagination={true}
      />
    </div>
  );
}
