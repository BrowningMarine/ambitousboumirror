import { getTranslations } from "next-intl/server";
import { getLoggedInUser } from "@/lib/actions/user.actions";
import { redirect } from "next/navigation";
import Link from "next/link";
import AccountTable from "./account-table";
import HeaderBox from "@/components/HeaderBox";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";
import UnauthorizedPage from "@/components/page";
import { getAccountsByUserRole } from "@/lib/actions/account.actions";

interface SearchParamProps {
  params: {
    locale: string;
  };
  searchParams: {
    page?: string;
    limit?: string;
  };
}
const AccountsPage = async ({ params, searchParams }: SearchParamProps) => {
  const awaitedParams = await params;
  const locale = awaitedParams.locale || "en";
  const t = await getTranslations({ locale, namespace: "accounts" });
  const title = t("account");

  // Parse pagination parameters
  const awaitedSearchParams = await searchParams;
  const page = Number(awaitedSearchParams.page) || 1;
  const limit = Number(awaitedSearchParams.limit) || 10;

  const loggedInUser = await getLoggedInUser();

  if (!loggedInUser) {
    redirect("/sign-in");
  }
  // Check role access first
  const allowedRoles = ["admin", "transactor", "merchant"];

  // Instead of redirecting, render an unauthorized component inline
  if (!allowedRoles.includes(loggedInUser.role)) {
    return <UnauthorizedPage />;
  }

  // Get accounts with pagination
  const accounts = await getAccountsByUserRole(
    loggedInUser.$id,
    loggedInUser.role,
    page,
    limit
  );

  // Format account length string with total count
  const accountLength = t("accountLength", { length: accounts.total || 0 });

  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">
          <div className="flex justify-between items-center w-full">
            <HeaderBox type="title" title={title} subtext={accountLength} />
            {/* Only admins can create new accounts */}
            {loggedInUser.role === "admin" && (
              <Link href="/accounts/create">
                <Button className="flex items-center gap-2 light-btn">
                  <PlusCircle className="h-4 w-4" />
                  {t("newAccount")}
                </Button>
              </Link>
            )}
          </div>
        </header>

        <div className="mt-6">
          {/* Added explicit check for empty accounts */}
          {accounts.total === 0 ? (
            <div className="bg-white rounded-lg border p-8 text-center">
              <p className="text-gray-500 mb-2">{t("noAccountfound")}</p>
              {loggedInUser.role === "admin" && (
                <Link href="/accounts/create">
                  <Button className="mt-4">
                    <PlusCircle className="h-4 w-4 mr-2" />
                    {t("createFirstAccount")}
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <AccountTable
              initialAccounts={accounts.documents}
              totalAccounts={accounts.total || 0}
              userRole={loggedInUser.role}
              loggedInUser={loggedInUser}
              initialPage={page}
              initialPageSize={limit}
            />
          )}
        </div>
      </div>
    </section>
  );
};

export default AccountsPage;
