"use client";
import React, { useState, useEffect, useRef, useCallback } from "react";
import AnimatedCounter from "./AnimatedCounter";
import DoughnutChart from "./DoughnutChart";
import { client } from "@/lib/appwrite/appwrite-client";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { Models } from "appwrite";
import { useTranslations } from "next-intl";

// Type for bank data
interface BankDocument extends Models.Document {
  bankId: string;
  bankName: string;
  accountNumber: string;
  cardNumber?: string;
  currentBalance: number;
  ownerName?: string;
  [key: string]: string | number | boolean | object | undefined | null;
}

// Props for the component
interface TotalBalanceBoxProps {
  accounts: Array<{
    $id: string;
    currentBalance: number;
    [key: string]: string | number | boolean | object | undefined | null;
  }>;
  totalCurrentBalance: number;
  useAccountsCollection?: boolean; // Flag to indicate if we should subscribe to accounts collection instead of banks
}

// Initial data comes from props, then gets updated in real-time
const TotalBalanceBox = ({
  accounts = [],
  totalCurrentBalance,
  useAccountsCollection = false,
}: TotalBalanceBoxProps) => {
  const t = useTranslations("dashboard");
  // State to store the latest data
  const [liveBanks, setLiveBanks] = useState<BankDocument[]>(
    accounts as unknown as BankDocument[]
  );
  const [liveTotalBalance, setLiveTotalBalance] = useState(totalCurrentBalance);

  // Keep previous balance for animation
  const [previousBalance, setPreviousBalance] = useState(0); // Start from 0 on initial load
  const animationDirectionRef = useRef<boolean>(true); // true = counting up, false = counting down

  // Flag to track if this is initial load vs. real-time update
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Ref to track if component is mounted
  const isMountedRef = useRef(true);
  // Ref to store unsubscribe function
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Effect to handle the initial animation from 0
  useEffect(() => {
    if (isInitialLoad) {
      // Start from 0 for initial animation
      setPreviousBalance(0);
      animationDirectionRef.current = true;
      setIsInitialLoad(false);
    }
  }, [isInitialLoad]);

  // Update previous balance when live balance changes (for real-time updates)
  useEffect(() => {
    // Skip initial render
    if (isMountedRef.current) {
      isMountedRef.current = false;
      return;
    }

    // Skip if it's initial load animation
    if (isInitialLoad) return;

    // Only run this effect if the liveTotalBalance is different from the previous value
    const prevBalance = previousBalance; // Capture current value to avoid dependency loop

    if (liveTotalBalance !== prevBalance) {
      // Determine direction of animation for real-time updates
      animationDirectionRef.current = liveTotalBalance > prevBalance;

      // Update the previous balance for the next animation
      setPreviousBalance(liveTotalBalance);
    }
  }, [liveTotalBalance, isInitialLoad, previousBalance]);

  // Process bank updates efficiently
  const processBankUpdate = useCallback((updatedBank: BankDocument) => {
    setLiveBanks((prev) => {
      try {
        // Find if the bank already exists
        const bankIndex = prev.findIndex(
          (bank) => bank.$id === updatedBank.$id
        );

        // Store the previous total for animation
        const oldTotalBalance = prev.reduce(
          (sum, bank) => sum + (Number(bank.currentBalance) || 0),
          0
        );

        // Create new array with updated or added bank
        const updatedBanks =
          bankIndex >= 0
            ? prev.map((bank) =>
                bank.$id === updatedBank.$id
                  ? { ...bank, ...updatedBank }
                  : bank
              )
            : [...prev, updatedBank];

        // Recalculate total balance
        const newTotalBalance = updatedBanks.reduce(
          (sum, bank) => sum + (Number(bank.currentBalance) || 0),
          0
        );

        // Update animation values
        setPreviousBalance(oldTotalBalance);
        animationDirectionRef.current = newTotalBalance > oldTotalBalance;
        setLiveTotalBalance(newTotalBalance);

        return updatedBanks;
      } catch (err) {
        console.error("Error processing bank update:", err);
        return prev;
      }
    });
  }, []);

  // Process bank deletion efficiently
  const processBankDeletion = useCallback((deletedBank: BankDocument) => {
    setLiveBanks((prev) => {
      try {
        // Store the previous total for animation
        const oldTotalBalance = prev.reduce(
          (sum, bank) => sum + (Number(bank.currentBalance) || 0),
          0
        );

        // Filter out the deleted bank
        const filteredBanks = prev.filter(
          (bank) => bank.$id !== deletedBank.$id
        );

        // Recalculate total balance
        const newTotalBalance = filteredBanks.reduce(
          (sum, bank) => sum + (Number(bank.currentBalance) || 0),
          0
        );

        // Update animation values
        setPreviousBalance(oldTotalBalance);
        animationDirectionRef.current = false;
        setLiveTotalBalance(newTotalBalance);

        return filteredBanks;
      } catch (err) {
        console.error("Error processing bank deletion:", err);
        return prev;
      }
    });
  }, []);

  // Subscribe to real-time updates
  useEffect(() => {
    // Initialize with props data
    setLiveBanks(accounts as unknown as BankDocument[]);
    setLiveTotalBalance(totalCurrentBalance);

    // Initial load animation will start from 0
    setIsInitialLoad(true);

    // Only subscribe if Appwrite client and configs are available
    const collectionId = useAccountsCollection
      ? appwriteConfig.accountsCollectionId
      : appwriteConfig.banksCollectionId;

    if (!client || !appwriteConfig.databaseId || !collectionId) {
      console.error("Appwrite client or configuration missing");
      return;
    }

    try {
      // Subscribe to collection changes - store in ref for cleanup
      unsubscribeRef.current = client.subscribe(
        `databases.${appwriteConfig.databaseId}.collections.${collectionId}.documents`,
        (response) => {
          try {
            // Handle different event types
            if (
              response.events.includes(
                "databases.*.collections.*.documents.*.create"
              ) ||
              response.events.includes(
                "databases.*.collections.*.documents.*.update"
              )
            ) {
              processBankUpdate(response.payload as BankDocument);
            }

            // Handle document deletion
            if (
              response.events.includes(
                "databases.*.collections.*.documents.*.delete"
              )
            ) {
              processBankDeletion(response.payload as BankDocument);
            }
          } catch (err) {
            console.error("Error in subscription event handler:", err);
          }
        }
      );
    } catch (err) {
      console.error("Error setting up Appwrite subscription:", err);
    }

    // Cleanup subscription on component unmount
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [
    accounts,
    totalCurrentBalance,
    processBankUpdate,
    processBankDeletion,
    useAccountsCollection,
  ]);

  return (
    <section className="total-balance">
      <div className="total-balance-chart">
        <DoughnutChart
          data={liveBanks as unknown as Record<string, unknown>[]}
          valueKey="currentBalance"
          labelKey="bankName"
        />
      </div>

      <div className="flex flex-col gap-6">
        <h2 className="header-2">
          {useAccountsCollection
            ? t("totalBalance")
            : t("bankAccounts", { count: liveBanks.length })}
        </h2>
        <div className="flex flex-col gap-2">
          <p className="total-balance-label">
            {useAccountsCollection
              ? t("currentBalance")
              : t("totalCurrentBalance")}
          </p>
          <div className="total-balance-amount flex-center gap-2">
            <AnimatedCounter
              amount={liveTotalBalance}
              start={previousBalance}
              isCountDown={!animationDirectionRef.current}
              suffix=" ₫"
              decimals={0}
              dynamicDuration={true}
              minDuration={0.5}
              maxDuration={3}
            />
          </div>
        </div>
      </div>
    </section>
  );
};

export default TotalBalanceBox;
