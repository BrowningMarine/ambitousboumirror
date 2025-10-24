import { getTranslations } from "next-intl/server";
import HeaderBox from "@/components/HeaderBox";
import React from "react";
import RightSidebar from "@/components/RightSidebar";
import TotalBalanceBox from "@/components/TotalBalanceBox";
import { appConfig } from "@/lib/appconfig";
import { cache } from "react";
import { getLoggedInUser } from "@/lib/actions/user.actions";
import { getBanksByUserId } from "@/lib/actions/bank.actions";
import {
  getBankTransactionEntriesByBankId,
  BankTransactionDocument,
} from "@/lib/actions/bankTransacionEntry.action";
import { getAccountsByUserId } from "@/lib/actions/account.actions";
import { Bank, Account } from "@/types";
import StatisticsDisplay from "@/components/StatisticsDisplay";
import { redirect } from "next/navigation";

// Enable ISR for this page
export const revalidate = 60; // seconds

// Cached versions of data fetching functions
const getLoggedInUserCached = cache(getLoggedInUser);
const getBanksByUserIdCached = cache(getBanksByUserId);
const getAccountsByUserIdCached = cache(getAccountsByUserId);

interface SearchParamProps {
  params: {
    id: string;
    locale: string;
  };
  searchParams?: {
    page?: string;
  };
}

// Define a bank type that matches our TotalBalanceBox data needs
interface BankData {
  $id: string;
  bankId: string;
  bankName: string;
  accountNumber: string;
  cardNumber: string;
  currentBalance: number;
  realBalance: number;
  ownerName: string;
  appwriteItemId: string;
  id?: string;
  [key: string]: string | number | boolean | object | undefined | null;
}

// Define the Transaction interface for display
interface DisplayTransaction {
  id: string;
  $id: string;
  name: string;
  paymentChannel: string;
  type: string;
  accountId: string;
  amount: number;
  pending: boolean;
  category: string;
  date: string;
  image: string;
  $createdAt: string;
  channel: string;
  senderBankId: string;
  receiverBankId: string;
}

// Define dashboard data interface
interface DashboardData {
  bankAccounts: Bank[];
  accountsData: BankData[];
  totalCurrentBalance: number;
  userAccounts?: Account[];
}

// Convert BankTransactionDocument to Transaction type for display
const mapBankTransactionToDisplayFormat = (
  transaction: BankTransactionDocument
): DisplayTransaction => {
  return {
    id: transaction.$id,
    $id: transaction.$id,
    name: `${
      transaction.transactionType === "credit" ? "Received from" : "Sent to"
    } ${transaction.bankName}`,
    paymentChannel: "bank",
    type: transaction.transactionType,
    accountId: transaction.bankAccountNumber,
    amount: transaction.amount,
    pending: transaction.status === "pending",
    category: transaction.transactionType === "credit" ? "income" : "expense",
    date: transaction.transactionDate,
    image: "",
    $createdAt: transaction.$createdAt,
    channel: "bank",
    senderBankId:
      transaction.transactionType === "debit"
        ? transaction.bankId || transaction.$id || ""
        : "",
    receiverBankId:
      transaction.transactionType === "credit"
        ? transaction.bankId || transaction.$id || ""
        : "",
  };
};

// Consolidated data fetching function
const getDashboardData = cache(
  async (userId: string): Promise<DashboardData> => {
    // Parallel data fetching
    const [banksResponse] = await Promise.all([
      getBanksByUserIdCached({ userId }),
    ]);

    const bankAccounts = banksResponse.documents || [];

    // Process bank accounts data
    const accountsData: BankData[] = bankAccounts.map((bank) => ({
      $id: bank.$id || "",
      bankId: bank.bankId || "",
      bankName: bank.bankName || "Bank Account",
      accountNumber: bank.accountNumber || "",
      cardNumber: bank.cardNumber || "",
      currentBalance: bank.currentBalance || 0,
      realBalance: bank.realBalance || 0,
      ownerName: bank.ownerName || "",
      appwriteItemId: bank.$id || "",
      id: bank.$id || "",
    }));

    let totalCurrentBalance = 0;
    let userAccounts: Account[] = [];

    // If user has no banks, fetch their accounts collection instead
    if (bankAccounts.length === 0) {
      const accountsResponse = await getAccountsByUserIdCached({ userId });
      userAccounts = accountsResponse.documents || [];

      // Calculate total balance from accounts
      totalCurrentBalance = userAccounts.reduce(
        (sum, account) => sum + (account.currentBalance || 0),
        0
      );
    } else {
      // Calculate total balance from banks
      totalCurrentBalance = accountsData.reduce(
        (sum, account) => sum + account.realBalance,
        0
      );
    }

    return {
      bankAccounts,
      accountsData,
      totalCurrentBalance,
      userAccounts,
    };
  }
);

const Home = async (searchParams: SearchParamProps) => {
  const { params, searchParams: queryParams } = searchParams;
  const awaitedParams = await params;

  // Get current page from query params or default to 1
  const awaitedQueryParams = await queryParams;

  // Validate locale
  let locale = awaitedParams.locale || "en";
  if (!appConfig.locales.includes(locale)) {
    locale = "en";
  }

  const t = await getTranslations({ locale, namespace: "root" });
  const headerTitle = t("headerTitle");

  // Get user data - cached
  const loggedIn = await getLoggedInUserCached();
  if (loggedIn?.role === "transassistant") {
    redirect(`/${locale}/withdraw-list`);
  }
  const userName = loggedIn?.firstName || t("guest");
  const welcomeMessage = t("welcomeName", { name: userName });

  // Only fetch bank data if user is logged in
  let accountsData: BankData[] = [];
  let totalCurrentBalance = 0;
  let bankAccounts: Bank[] = [];
  let transactions: DisplayTransaction[] = [];
  let selectedBankId = "";
  let userAccounts: Account[] = [];

  if (loggedIn) {
    // Get dashboard data - cached and consolidated
    const dashboardData = await getDashboardData(loggedIn.$id);
    accountsData = dashboardData.accountsData;
    totalCurrentBalance = dashboardData.totalCurrentBalance;
    bankAccounts = dashboardData.bankAccounts;
    userAccounts = dashboardData.userAccounts || [];

    // Get selected bank ID
    const idFromQueryParams =
      awaitedQueryParams &&
      typeof awaitedQueryParams === "object" &&
      "id" in awaitedQueryParams
        ? String(awaitedQueryParams.id)
        : undefined;

    if (idFromQueryParams && accountsData.length > 0) {
      const selectedBank = accountsData.find(
        (bank) => bank.$id === idFromQueryParams
      );
      selectedBankId = selectedBank ? selectedBank.$id : accountsData[0].$id;
    } else if (accountsData.length > 0) {
      selectedBankId = accountsData[0].$id;
    }

    // Only fetch transactions if we have a selected bank
    if (selectedBankId) {
      const transactionsResult = await getBankTransactionEntriesByBankId(
        selectedBankId,
        10
      );
      if (transactionsResult.success && transactionsResult.entries) {
        transactions = transactionsResult.entries.map(
          mapBankTransactionToDisplayFormat
        );
      }
    }
  }

  const account = { transactions };

  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">
          <HeaderBox
            type="greeting"
            title={headerTitle}
            user={welcomeMessage}
            subtext={t("accessAndManage")}
          />
          <TotalBalanceBox
            accounts={
              accountsData.length > 0
                ? accountsData
                : userAccounts.map((account) => ({
                    $id: account.$id,
                    currentBalance: account.currentBalance,
                    accountName: account.accountName,
                  }))
            }
            totalCurrentBalance={totalCurrentBalance}
            useAccountsCollection={accountsData.length === 0}
          />
        </header>
        {/* <RecentTransactions
          accounts={accountsData}
          transactions={account.transactions}
          appwriteItemId={selectedBankId}
          page={currentPage}
        /> */}
        <StatisticsDisplay />
      </div>
      <RightSidebar
        user={
          loggedIn || {
            $id: "",
            userId: "",
            email: "",
            firstName: t("guest"),
            lastName: "",
            role: "guest",
          }
        }
        transactions={account.transactions || []}
        banks={bankAccounts.slice(0, 2) || []}
      />
    </section>
  );
};

export default Home;
