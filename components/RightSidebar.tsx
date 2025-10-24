"use client";

import Image from "next/image";
import Link from "next/link";
import React from "react";
import BankCard from "./BankCard";
import { countTransactionCategories } from "@/lib/utils";
import Category from "./Category";
import { CategoryCount, Bank, Transaction, User } from "@/types";

// Create properly typed props interface
interface UpdatedRightSidebarProps {
  user: User | null;
  transactions: Transaction[];
  banks: Bank[];
}

const RightSidebar = ({
  user,
  transactions,
  banks,
}: UpdatedRightSidebarProps) => {
  const categories: CategoryCount[] = countTransactionCategories(
    transactions || []
  );
  const hasBanks = banks && banks.length > 0;
  const hasCategories = categories && categories.length > 0;

  return (
    <aside className="right-sidebar">
      <section className="flex flex-col pb-8">
        <div className="profile-banner" />
        <div className="profile">
          <div className="profile-img">
            {user ? (
              <span className="text-5xl font-bold text-blue-500">
                {user.firstName ? user.firstName[0] : "U"}
              </span>
            ) : (
              <span className="text-5xl font-bold text-blue-500">U</span>
            )}
          </div>

          <div className="profile-details">
            <h1 className="profile-name">
              {user ? `${user.firstName} ${user.lastName}` : "Guest User"}
            </h1>
            <p className="profile-email">
              {user ? user.email : "Not logged in"}
            </p>
          </div>
        </div>
      </section>

      {/* Only render the categories section if there are categories */}
      {hasBanks && (
        <section className="banks">
          <div className="flex w-full justify-between items-center">
            <h2 className="header-2">My Banks</h2>
            <Link href="/my-banks" className="flex gap-2">
              <Image src="/icons/plus.svg" width={20} height={20} alt="plus" />
              <h2 className="text-14 font-semibold text-gray-600">Add Bank</h2>
            </Link>
          </div>

          {user && (
            <div className="relative flex flex-1 flex-col items-center justify-center gap-5">
              <div className="relative z-10">
                <BankCard
                  key={banks[0].$id}
                  account={banks[0]}
                  userName={`${user.firstName} ${user.lastName}`}
                  showBalance={false}
                />
              </div>
              {banks[1] && (
                <div className="absolute right-0 top-8 z-0 w-[90%]">
                  <BankCard
                    key={banks[1].$id}
                    account={banks[1]}
                    userName={`${user.firstName} ${user.lastName}`}
                    showBalance={false}
                  />
                </div>
              )}
            </div>
          )}

          {hasCategories && (
            <div className="mt-10 flex flex-1 flex-col gap-6">
              <h2 className="header-2 ">Top categories</h2>
              <div className="space-y-5">
                {categories.map((category) => (
                  <Category key={category.name} category={category} />
                ))}
              </div>
            </div>
          )}
        </section>
      )}
    </aside>
  );
};

export default RightSidebar;
