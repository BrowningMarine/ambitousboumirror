import { getLoggedInUser, getAllUsers } from "@/lib/actions/user.actions";
import { redirect } from "next/navigation";
import HeaderBox from "@/components/HeaderBox";
import CreateAccountForm from "./create-account-form";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";

const CreateAccountPage = async () => {
  const loggedInUser = await getLoggedInUser();

  if (!loggedInUser) {
    redirect("/sign-in");
  }
  // Only admins can create accounts
  if (loggedInUser.role !== "admin") {
    redirect("/unauthorized");
  }

  // Fetch all users for admin to select from
  const { users } = await getAllUsers();

  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">
          <div className="flex justify-between items-center w-full">
            <HeaderBox
              type="title"
              title="Create New Account"
              subtext="Create a new payment account for a user"
            />
            <Link href="/accounts">
              <Button className="light-btn flex items-center gap-2">
                <ChevronLeft className="h-4 w-4" />
                Back to Accounts
              </Button>
            </Link>
          </div>
        </header>

        <div className="mt-6 bg-white rounded-lg border p-8">
          <CreateAccountForm users={users} />
        </div>
      </div>
    </section>
  );
};

export default CreateAccountPage;
