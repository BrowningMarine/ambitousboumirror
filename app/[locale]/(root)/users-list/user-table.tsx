"use client";

import { DynamicTable } from "@/components/DynamicTable";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { subscribeToCollection } from "@/lib/client/appwriteSubcriptions";
import { formatDistanceToNow } from "date-fns";
import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";

// Define the User interface
interface User {
  id?: string;
  $id?: string;
  displayName?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  accountStatus?: string;
  isActive?: boolean;
  createdAt?: string | null;
  lastLogin?: string | null;
  accessedAt?: string | null;
  photoURL?: string;
  userId?: string;
  $createdAt?: string;
  $updatedAt?: string;
  $permissions?: string[];
  emailVerified?: boolean;
  status?: boolean;
  isWithdrawReady?: boolean;
}

// Define props interface for the component
interface UserTableProps {
  users: User[] | undefined;
}

export default function UserTable({ users = [] }: UserTableProps) {
  // Ensure users is always an array even if undefined is passed
  //const safeUsers = Array.isArray(users) ? users : [];
  const [realtimeUsers, setRealtimeUsers] = useState<User[]>(  
    Array.isArray(users) ? users : []  
  );

  // Set up Appwrite real-time subscription  
  useEffect(() => {  
    // Initialize with the passed users  
    setRealtimeUsers(Array.isArray(users) ? users : []);  

    // Set up subscription  
    const unsubscribe = subscribeToCollection<User>(  
      appwriteConfig.databaseId,  
      appwriteConfig.userCollectionId,  
      // On Create  
      (newUser) => {  
        setRealtimeUsers((prevUsers) => [...prevUsers, newUser]);  
      },  
      // On Update  
      (updatedUser) => {  
        setRealtimeUsers((prevUsers) =>  
          prevUsers.map((user) =>  
            user.$id === updatedUser.$id 
              ? { 
                  ...user,  // Keep existing user data
                  ...updatedUser,  // Apply updates
                  // Preserve important fields that might be missing in the update
                  role: updatedUser.role || user.role,
                  accountStatus: updatedUser.accountStatus || user.accountStatus,
                  isActive: updatedUser.isActive !== undefined ? updatedUser.isActive : user.isActive,
                  status: updatedUser.status !== undefined ? updatedUser.status : user.status,
                  emailVerified: updatedUser.emailVerified !== undefined ? updatedUser.emailVerified : user.emailVerified,
                } 
              : user
          )  
        );  
      },  
      // On Delete  
      (deletedUserId) => {  
        setRealtimeUsers((prevUsers) =>  
          prevUsers.filter((user) => user.$id !== deletedUserId)  
        );  
      }  
    );  

    // Clean up subscription when component unmounts  
    return () => {  
      unsubscribe();  
    };  
  }, [users]);

  // Function to handle withdraw status toggle
  const handleWithdrawStatusToggle = async (userId: string | undefined, isWithdrawReady: boolean) => {
    if (!userId) return;
    
    try {
      const response = await fetch('/api/users/withdraw-status', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId, isWithdrawReady }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        toast.success('Withdraw status updated successfully');
        
        // Update only the isWithdrawReady field in the local state
        setRealtimeUsers((prevUsers) =>
          prevUsers.map((user) =>
            user.userId === userId 
              ? { ...user, isWithdrawReady } 
              : user
          )
        );
      } else {
        toast.error(data.message || 'Failed to update withdraw status');
      }
    } catch (error) {
      console.error('Error updating withdraw status:', error);
      toast.error('Failed to update withdraw status');
    }
  };

  // Define all columns and rendering logic inside the client component
  const columns = [
    {
      header: "",
      width: "60px",
      cell: (user: User) => {
        const initials =
          user.firstName && user.lastName
            ? `${user.firstName[0]}${user.lastName[0]}`
            : user.displayName?.substring(0, 2) || "U";

        return (
          <Avatar className="h-9 w-9">
            <AvatarImage
              src={user.photoURL || ""}
              alt={user.displayName || "User"}
            />
            <AvatarFallback>{initials.toUpperCase()}</AvatarFallback>
          </Avatar>
        );
      },
    },
    {
      header: "Name",
      cell: (user: User) => {
        const displayName =
          user.displayName ||
          `${user.firstName || ""} ${user.lastName || ""}`.trim() ||
          "No Name";

        return (
          <div className="flex flex-col">
            <span className="font-medium">{displayName}</span>
            <span className="text-sm text-gray-500">{user.email}</span>
          </div>
        );
      },
    },
    {
      header: "Role",
      accessorKey: "role" as keyof User,
      cell: (user: User) => (
        <span className="capitalize">{user.role || "User"}</span>
      ),
    },
    {
      header: "Status",
      cell: (user: User) => {
        // Determine status from either accountStatus or status boolean
        const statusText = user.accountStatus || 
          (user.status === true ? "Active" : 
           user.status === false ? "Inactive" : 
           user.emailVerified === true ? "Active" : "Pending");
        
        const isActive = user.isActive !== undefined ? user.isActive : 
                         user.status !== undefined ? user.status : 
                         user.emailVerified === true;

        // Fixed: Use a properly typed variant
        let variant: "default" | "success" | "warning" | "danger" | "urgent" | "info";

        switch (statusText.toLowerCase()) {
          case "active":
            variant = "info";
            break;
          case "pending":
            variant = "warning";
            break;
          case "suspended":
          case "inactive":
            variant = "danger";
            break;
          default:
            variant = "default";
        }

        return (
          <div className="flex flex-col">
            <Badge variant={variant}>{statusText}</Badge>
            {!isActive && (
              <span className="text-xs text-gray-500 mt-1">Inactive</span>
            )}
          </div>
        );
      },
    },
    {
      header: "Joined",
      cell: (user: User) => {
        const createdDate = user.$createdAt || user.createdAt;
        if (!createdDate) return <span className="text-gray-500">N/A</span>;
        return (
          <span>
            {formatDistanceToNow(new Date(createdDate), { addSuffix: true })}
          </span>
        );
      },
    },
    {
      header: "Last Login",
      cell: (user: User) => {
        // Use lastLogin or accessedAt, whichever is available
        const lastLoginTime = user.lastLogin || user.accessedAt;
        
        if (!lastLoginTime)
          return <span className="text-gray-500">Never</span>;
        
        try {
          return (
            <span>
              {formatDistanceToNow(new Date(lastLoginTime), { addSuffix: true })}
            </span>
          );
        } catch (error) {
          console.error("Error formatting date:", error, "Date value:", lastLoginTime);
          return <span className="text-gray-500">Invalid date</span>;
        }
      },
    },
    // Add withdraw status toggle column for transassistant users
    {
      header: "Withdraw Ready",
      cell: (user: User) => {
        // Only show toggle for transassistant users
        if (user.role !== 'transassistant') {
          return <span className="text-gray-500">N/A</span>;
        }
        
        return (
          <div className="flex items-center space-x-2">
            <Switch
              id={`withdraw-toggle-${user.userId}`}
              checked={user.isWithdrawReady || false}
              onCheckedChange={(checked) => handleWithdrawStatusToggle(user.userId, checked)}
            />
            <Label htmlFor={`withdraw-toggle-${user.userId}`}>
              {user.isWithdrawReady ? 'Ready' : 'Not Ready'}
            </Label>
          </div>
        );
      },
    },
  ];

  // Row styling based on status - defined inside client component
  const getUserRowClassName = (user: User) => {
    // Determine if user is active from any of the available fields
    const isActive = user.isActive !== undefined ? user.isActive : 
                     user.status !== undefined ? user.status : 
                     user.emailVerified === true;
    
    if (!isActive) return "bg-gray-50 hover:bg-gray-100";

    // Get status text from available fields
    const statusText = user.accountStatus || 
      (user.status === true ? "Active" : 
       user.status === false ? "Inactive" : 
       user.emailVerified === true ? "Active" : "Pending");

    switch (statusText.toLowerCase()) {
      case "active":
        return "bg-emerald-50 hover:bg-emerald-100";
      case "pending":
        return "bg-yellow-50 hover:bg-yellow-100";
      case "suspended":
      case "inactive":
        return "bg-red-50 hover:bg-red-100";
      default:
        return "hover:bg-gray-50";
    }
  };

  return (
    <DynamicTable
      data={realtimeUsers}
      columns={columns}
      rowClassName={getUserRowClassName}
      pagination={true}
      pageSize={10}
      pageSizeOptions={[5, 10, 25, 50, 100]}
    />
  );
}
