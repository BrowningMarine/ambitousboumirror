import { getLoggedInUser } from "@/lib/actions/user.actions";
import { redirect } from "next/navigation";
import Link from "next/link";
import HeaderBox from "@/components/HeaderBox";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { Account } from "@/types";
import { EditAccountForm } from "./edit-account-form";
import { getAccount } from "@/lib/actions/account.actions";
import { getTranslations } from "next-intl/server"; 

interface EditAccountPageProps {
  params: {
    id: string;
    locale: string;
  };
}

const EditAccountPage = async (searchParams: EditAccountPageProps) => {
  const { params } = searchParams;
  const awaitedParams = await params;
  //console.log("Locale from params:", params.locale);
  //console.log("awaitedParams:", awaitedParams);
  const accountId = awaitedParams.id;
  const locale = awaitedParams.locale || 'en';
  const t = await getTranslations({ locale, namespace: 'accounts' });
  const headerTitle = t("headerTitle");
  //console.log("accountId:", accountId);
  const loggedInUser = await getLoggedInUser();

  if (!loggedInUser) {
    redirect("/sign-in");
  }

  const account = (await getAccount(accountId)) as Account | null;
  if (!account) {
    redirect("/accounts");
  }
  const headerSubtext = t("headerSubtext", {
    account: account.accountName,                
  });
  const relatedUserId = account.users?.userId || null;
  
  //console.log("relatedUserId:", relatedUserId);
  // Check user permission based on role
  const hasPermission = 
    // Admin can edit any account
    loggedInUser.role === "admin" || 
    // Transactor is referenceUserId of
    (loggedInUser.role === "transactor") ||
    // User owns this account
    relatedUserId === loggedInUser.userId;
  
  if (!hasPermission) {
    redirect("/accounts");
  }

  // Check if merchant is trying to edit an inactive account
  if (loggedInUser.role === "merchant" && !account.status) {
    redirect(`/accounts`);
  }

  //console.log("accounts-edit-page account:", account);
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
            <Link href={"/accounts"}>
              <Button className="flex items-center gap-2 light-btn">
                <ChevronLeft className="h-4 w-4" />
                {t("backToAccounts")}
              </Button>
            </Link>
          </div>
        </header>

        <div className="mt-6 bg-white rounded-lg border p-8">
          <EditAccountForm account={account} userRole={loggedInUser.role} />
        </div>
      </div>
    </section>
  );
};

export default EditAccountPage;
