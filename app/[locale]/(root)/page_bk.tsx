import HeaderBox from "@/components/HeaderBox";
import RecentTransactions from "@/components/RecentTransactions";
import RightSidebar from "@/components/RightSidebar";
import TotalBalanceBox from "@/components/TotalBalanceBox";
import { getAccount, getAccounts } from "@/lib/actions/bank.actions";
import { getLoggedInUser } from "@/lib/actions/user.actions";
import { redirect } from "next/navigation";
import React from "react";

const Home = async (props: SearchParamProps) => {
  // Get the searchParams after the component starts executing
  const { searchParams } = props;
  const params = await searchParams;

  // Move this logic after all async operations
  const loggedIn = await getLoggedInUser();

  // Add null check here
  if (!loggedIn) {
    redirect("/sign-in");
    // return null;
  }

  const accounts = await getAccounts({
    userId: loggedIn.$id,
  });

  if (!accounts) return null;

  const accountsData = accounts?.data;

  // Handle searchParams after async operations
  const pageParam = params.page;
  const currentPage =
    Number(Array.isArray(pageParam) ? pageParam[0] : pageParam) || 1;

  const idParam = params.id;
  const appwriteItemId =
    (Array.isArray(idParam) ? idParam[0] : idParam) ||
    accountsData[0]?.appwriteItemId;

  const account = await getAccount({ appwriteItemId });

  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">
          <HeaderBox
            type="greeting"
            title="welcome"
            user={loggedIn?.firstName || "Guest"}
            subtext="Access and manage your account and transactions efficiantly."
          />

          <TotalBalanceBox
            accounts={accountsData}
            totalBanks={accounts?.totalBanks}
            totalCurrentBalance={accounts?.totalCurrentBalance}
          />
        </header>
        <RecentTransactions
          accounts={accountsData}
          transactions={account?.transactions}
          appwriteItemId={appwriteItemId}
          page={currentPage}
        />
      </div>
      <RightSidebar
        user={loggedIn}
        transactions={account?.transactions}
        banks={accountsData?.slice(0, 2)}
      />
    </section>
  );
};

export default Home;
