import { AddBank } from "@/components/AddBank";
import BankCard from "@/components/BankCard";
import HeaderBox from "@/components/HeaderBox";
import { getBanksByUserId } from "@/lib/actions/bank.actions";
import { getLoggedInUser } from "@/lib/actions/user.actions";
import { BankAccount } from "@/types";
import { redirect } from "next/navigation";
import React from "react";

const MyBanks = async () => {
  const loggedIn = await getLoggedInUser();

  if (!loggedIn) {
    redirect("/sign-in");
  }

  if (loggedIn.role !== "admin" && loggedIn.role !== "transactor") {
    redirect("/unauthorized");
  }

  const accounts = await getBanksByUserId({
    userId: loggedIn.$id,
  });

  return (
    <section className="flex">
      <div className="my-banks">
        <HeaderBox
          title="My Bank Accounts"
          subtext="Effortlessly manage your banking activities."
        />
        <AddBank userId={loggedIn.$id} />
        <div className="space-y-4">
          <h2 className="header-2">Your cards</h2>
          <div className="flex flex-wrap gap-6">
            {accounts.documents.map((account: BankAccount) => (
              <BankCard
                key={account.$id}
                account={{
                  $id: account.$id,
                  bankName: account.bankName,
                  accountNumber: account.accountNumber,
                  cardNumber: account.cardNumber,
                  currentBalance: account.currentBalance,
                  ownerName: account.ownerName,
                }}
                userName={account.ownerName}
                showBalance={true}
              />
            ))}

            {accounts?.documents?.length === 0 && (
              <p className="text-gray-500">
                You do not have any bank accounts yet. Add one to get started!
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default MyBanks;
