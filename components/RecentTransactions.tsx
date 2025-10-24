"use client";

import Link from "next/link";
import React, { useState, useEffect } from "react";
import { BankTabItem } from "./BankTabItem";
import BankInfo from "./BankInfo";
import TransactionsTable from "./TransactionsTable";
import { Pagination } from "./Pagination";
import { useRouter, useSearchParams } from "next/navigation";
import DynamicTabs from "@/components/ui/DynamicTabs";

// Define the interfaces that were missing
interface Account {
  id?: string;
  $id: string;
  bankId: string;
  appwriteItemId: string;
  bankName: string;
  accountNumber: string;
  currentBalance: number;
  ownerName?: string;
  cardNumber?: string;
  [key: string]: string | number | boolean | object | undefined | null;
}

// Define Transaction interface to match TransactionsTable
interface Transaction {
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
  image?: string;
  $createdAt: string;
  channel: string;
  senderBankId?: string;
  receiverBankId?: string;
}

interface RecentTransactionsProps {
  accounts: Account[];
  transactions: Transaction[];
  appwriteItemId: string;
  page?: number;
}

const RecentTransactions = ({
  accounts,
  transactions = [],
  appwriteItemId: initialAppwriteItemId,
  page = 1,
}: RecentTransactionsProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get the current ID from URL params or use the initial one
  const idFromUrl = searchParams.get("id");
  const [activeItemId, setActiveItemId] = useState<string>(
    idFromUrl || initialAppwriteItemId
  );

  // Update active ID when URL changes
  useEffect(() => {
    if (idFromUrl) {
      setActiveItemId(idFromUrl);
    }
  }, [idFromUrl]);

  // Handle tab change manually
  const handleTabChange = (value: string) => {
    setActiveItemId(value);

    // Update URL with the new ID
    const currentUrl = new URL(window.location.href);
    currentUrl.searchParams.set("id", value);
    router.push(currentUrl.pathname + currentUrl.search, { scroll: false });
  };

  const rowsPerPage = 10;
  const totalPages = Math.ceil(transactions.length / rowsPerPage);
  const indexOfLastTransaction = page * rowsPerPage;
  const indexOfFirstTransaction = indexOfLastTransaction - rowsPerPage;
  const currentTransactions = transactions.slice(
    indexOfFirstTransaction,
    indexOfLastTransaction
  );

  // Create dynamic tab items from accounts
  const dynamicTabItems = accounts.map((account) => ({
    id: account.appwriteItemId,
    label: (
      <BankTabItem
        key={account.id || account.$id}
        account={account}
        appwriteItemId={activeItemId}
      />
    ),
    content: (
      <>
        <BankInfo account={account} appwriteItemId={activeItemId} type="full" />
        <TransactionsTable transactions={currentTransactions} />
        {totalPages > 1 && (
          <div className="my-4 w-full">
            <Pagination totalPages={totalPages} page={page} />
          </div>
        )}
      </>
    ),
    contentClassName: "space-y-4",
    triggerClassName:
      "border-b-2 border-transparent data-[state=active]:border-blue-600 data-[state=active]:bg-transparent rounded-none px-4",
  }));

  return (
    <section className="recent-transactions">
      <header className="flex items-center justify-between">
        <h2 className="recent-transactions-label">Recent Transactions</h2>
        <Link
          //href={`/transaction-history/?id=${activeItemId}`}
          href="#"
          onClick={(e) => e.preventDefault()}
          className="view-all-btn"
        >
          View all
        </Link>
      </header>
      <DynamicTabs
        items={dynamicTabItems}
        activeTab={activeItemId}
        onTabChange={handleTabChange}
        className="w-full"
        tabsListClassName="recent-transactions-tablist"
        triggerClassName="hover:text-blue-600 transition-colors"
      />
    </section>
  );
};

export default RecentTransactions;
