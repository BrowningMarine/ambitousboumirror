"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import HeaderBox from "@/components/HeaderBox";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Loader2 } from "lucide-react";
import { Account } from "@/types";
import { EditAccountForm } from "./edit-account-form";
import { getAccount } from "@/lib/actions/account.actions";
import { useTranslations } from "next-intl";
import { getLoggedInUser } from "@/lib/actions/user.actions";

interface UserData {
  userId: string;
  role: string;
  email?: string;
  name?: string;
  status?: boolean;
}

// Client component for handling data fetching and UI
export function EditAccountClient({ id }: { id: string }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [user, setUser] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  // Use client-side translations
  const t = useTranslations("accounts");

  // Load data with the ID
  useEffect(() => {
    async function loadData() {
      try {
        //console.log("Fetching account with ID:", id);

        // Load user data
        const userData = await getLoggedInUser();
        if (!userData) {
          //console.log("No user data found, redirecting to sign-in");
          router.push("/sign-in");
          return;
        }
        //console.log("User data loaded:", userData);
        setUser(userData as UserData);

        // Try first with getAccount (publicTransactionId)
        let accountData = await getAccount(id);

        // If account wasn't found, the ID might actually be a document ID
        // This could happen if the URL was created using document ID instead of publicTransactionId
        if (!accountData) {
          try {
            // Try to import getAccountById dynamically to avoid circular dependencies
            const { getAccountById } = await import(
              "@/lib/actions/account.actions"
            );
            accountData = await getAccountById(id);
          } catch (getByIdError) {
            console.error("Error trying getAccountById:", getByIdError);
          }
        }

        //console.log("Account data loaded:", accountData);

        if (!accountData) {
          //console.log("No account found, redirecting to accounts");
          router.push("/accounts");
          return;
        }

        setAccount(accountData as Account);

        // Check permissions
        const relatedUserId = accountData.users?.userId || null;
        // console.log(
        //   "Related user ID:",
        //   relatedUserId,
        //   "Current user ID:",
        //   userData.userId
        // );

        const hasPermission =
          userData.role === "admin" ||
          userData.role === "transactor" ||
          relatedUserId === userData.userId;

        // console.log(
        //   "Has permission:",
        //   hasPermission,
        //   "User role:",
        //   userData.role
        // );

        if (!hasPermission) {
          //console.log("No permission, redirecting to accounts");
          router.push("/accounts");
          return;
        }

        // Check if merchant trying to edit inactive account
        if (userData.role === "merchant" && !accountData.status) {
          //console.log("Merchant trying to edit inactive account, redirecting");
          router.push("/accounts");
          return;
        }
      } catch (err) {
        console.error("Error loading data:", err);
        setError("Failed to load account data");
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [id, router]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-lg font-medium">{t("loading")}</p>
        </div>
      </div>
    );
  }

  // Show error state
  if (error || !account || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <p className="text-lg font-medium text-red-500">
            {error || t("accountNotFound")}
          </p>
          <Link href="/accounts">
            <Button className="light-btn">{t("backToAccounts")}</Button>
          </Link>
        </div>
      </div>
    );
  }

  const headerTitle = t("headerTitle");
  const headerSubtext = t("headerSubtext", { account: account.accountName });

  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">
          <div className="flex justify-between items-center w-full">
            <HeaderBox
              type="title"
              title={headerTitle}
              subtext={headerSubtext}
            />
            <Link href="/accounts">
              <Button className="flex items-center gap-2 light-btn">
                <ChevronLeft className="h-4 w-4" />
                {t("backToAccounts")}
              </Button>
            </Link>
          </div>
        </header>

        <div className="mt-6 bg-white rounded-lg border p-8">
          <EditAccountForm account={account} userRole={user.role} />
        </div>
      </div>
    </section>
  );
}
