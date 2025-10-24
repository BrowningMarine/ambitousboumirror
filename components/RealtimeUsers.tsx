"use client";

import { useState, useEffect } from "react";
import { subscribeToUsers, User } from "@/lib/client/appwriteUserSubscriptions";

interface RealtimeUsersProps {
  initialUsers: User[];
}

export default function RealtimeUsers({ initialUsers }: RealtimeUsersProps) {
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [isConnected, setIsConnected] = useState(true);

  useEffect(() => {
    // Handle real-time updates
    const unsubscribe = subscribeToUsers(
      (newUser) => {
        setUsers((prevUsers) => [newUser, ...prevUsers]);
      },
      (updatedUser) => {
        setUsers((prevUsers) =>
          prevUsers.map((user) =>
            user.$id === updatedUser.$id ? updatedUser : user
          )
        );
      },
      (deletedUserId) => {
        setUsers((prevUsers) =>
          prevUsers.filter((user) => user.$id !== deletedUserId)
        );
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Users ({users.length})</h2>
        <div
          className={`px-3 py-1 rounded-full text-sm ${
            isConnected
              ? "bg-green-100 text-green-800"
              : "bg-red-100 text-red-800"
          }`}
        >
          {isConnected ? "Connected" : "Disconnected"}
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {users.map((user) => (
          <div
            key={user.$id}
            className="p-4 border rounded-lg shadow-sm hover:shadow-md transition-shadow"
          >
            <h3 className="font-semibold text-lg">
              {user.firstName} {user.lastName}
            </h3>
            <p className="text-gray-600">{user.email}</p>
            {/* Include other user fields as needed */}
          </div>
        ))}
      </div>
    </div>
  );
}
