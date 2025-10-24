import HeaderBox from "@/components/HeaderBox";
import UserTable from "./user-table";
import { getAllUsers, getLoggedInUser } from "@/lib/actions/user.actions";
import { redirect } from "next/navigation";

// Fetch users server-side
async function getUsers() {
  try {
    const data = await getAllUsers(); // Assuming this function fetches all users from the database
    //console.log("Fetched users:", data); // Log the fetched users for debugging
    return data.users;
  } catch (error) {
    console.error("Error loading users:", error);
    return [];
  }
}

const UserList = async () => {
  const loggedInUser = await getLoggedInUser();

  if (!loggedInUser) {
    redirect("/sign-in");
  }

  if (loggedInUser.role === "merchant") {
    redirect("/"); // Redirect merchants to home page
  }

  // Serialize the data if needed
  const users = await getUsers();
  //console.log("users", users);
  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">
          <HeaderBox
            type="title"
            title="User Lists"
            subtext="Manage Administrators & Merchants"
          />
        </header>

        <div className="size-full pt-5 space-y-5">
          {/* Only pass the data, no functions */}
          <UserTable users={users} />
        </div>
      </div>
    </section>
  );
};

export default UserList;
