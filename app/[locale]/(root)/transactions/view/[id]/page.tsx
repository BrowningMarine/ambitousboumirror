import { getTransactionByOrderId } from "@/lib/actions/transaction.actions";
import {
  getAllBankTransactionEntriesByOrderId,
} from "@/lib/actions/bankTransacionEntry.action";
import { redirect } from "next/navigation";
import HeaderBox from "@/components/HeaderBox";
import UnauthorizedPage from "@/components/page";
import { getLoggedInUser } from "@/lib/actions/user.actions";
import TransactionDetails from "./transaction-details";
import { getTranslations } from "next-intl/server";

const TransactionViewPage = async ({ params }: { params: { id: string } }) => {
  const loggedInUser = await getLoggedInUser();
  const t = await getTranslations("transactions");

  if (!loggedInUser) {
    redirect("/sign-in");
  }

  const { id } = await params;

  // Check role access first
  const allowedRoles = ["admin", "transactor", "merchant"];

  // Instead of redirecting, render an unauthorized component inline
  if (!allowedRoles.includes(loggedInUser.role)) {
    return <UnauthorizedPage />;
  }

  const transaction = await getTransactionByOrderId(id);

  if (!transaction) {
    return (
      <section className="home">
        <div className="home-content">
          <header className="home-header">
            <HeaderBox
              type="title"
              title={t("transactionNotFoundTitle")}
              subtext={t("transactionNotFoundMessage")}
            />
          </header>
          <div className="mt-6 bg-white p-8 rounded-lg border text-center">
            <p className="text-gray-500">
              {t("transactionNotFoundId", { id })}
            </p>
          </div>
        </div>
      </section>
    );
  }

  // Fetch bank transactions on the server side
  // Always use getAllBankTransactionEntriesByOrderId to ensure proper orderId mapping
  const showAllTransactions =
    loggedInUser.role === "admin" || loggedInUser.role === "transactor";
  
  // Always fetch ALL transactions for this orderId, then filter by role in the component
  const bankTransactionsResult = await getAllBankTransactionEntriesByOrderId(
    transaction.odrId,
    null
  );

  const bankTransactions = bankTransactionsResult.success
    ? bankTransactionsResult.entries || []
    : [];

  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">
          <HeaderBox
            type="title"
            title={t("viewTitle", { orderId: transaction.odrId })}
            subtext={t("viewSubtext")}
          />
        </header>

        <div className="mt-6">
          <TransactionDetails
            transaction={transaction}
            userRole={loggedInUser.role}
            initialBankTransactions={bankTransactions}
            showAllTransactions={showAllTransactions}
          />
        </div>
      </div>
    </section>
  );
};

export default TransactionViewPage;
