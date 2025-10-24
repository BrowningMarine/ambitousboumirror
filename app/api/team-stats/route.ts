import { NextResponse } from "next/server";
import { databases } from "@/lib/appwrite/appwrite-client";
import { Query } from "appwrite";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { getLoggedInUser } from "@/lib/actions/user.actions";

interface TransactionDocument {
  $id: string;
  $createdAt: string;
  $updatedAt: string;
  users?: string | { $id: string };
  odrStatus: string;
  [key: string]: unknown;
}

// Helper function to fetch all pages in parallel
async function fetchAllPages(
  collectionId: string, 
  queries: string[], 
  batchSize = 100
) {
  // First, get total count with a single record
  const initialQuery = await databases.listDocuments(
    appwriteConfig.databaseId,
    collectionId,
    [...queries, Query.limit(1)]
  );

  const total = initialQuery.total;
  if (total === 0) return { documents: [], total: 0 };

  // Calculate number of pages needed
  const pages = Math.ceil(total / batchSize);
  
  // Prepare all page queries
  const pagePromises = Array.from({ length: pages }, (_, i) => {
    return databases.listDocuments(
      appwriteConfig.databaseId,
      collectionId,
      [...queries, Query.limit(batchSize), Query.offset(i * batchSize)]
    );
  });

  // Fetch all pages in parallel
  const results = await Promise.all(pagePromises);
  
  // Combine all documents
  const documents = results.flatMap(result => result.documents);
  
  return { documents, total };
}

// Helper function to calculate average processing time in minutes
function calculateAverageProcessingTime(transactions: TransactionDocument[]): number {
  if (transactions.length === 0) return 0;
  
  const processingTimes = transactions.map(transaction => {
    const createdAt = new Date(transaction.$createdAt);
    const completedAt = new Date(transaction.$updatedAt);
    return (completedAt.getTime() - createdAt.getTime()) / (1000 * 60); // Convert to minutes
  });
  
  const totalTime = processingTimes.reduce((sum, time) => sum + time, 0);
  return Math.round(totalTime / processingTimes.length);
}

export async function GET() {
  try {
    // Check authentication and role
    const currentUser = await getLoggedInUser();
    if (!currentUser) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 }
      );
    }

    const allowedRoles = ["transactor", "admin", "transassistant"];
    if (!allowedRoles.includes(currentUser.role || "")) {
      return NextResponse.json(
        { 
          success: false, 
          message: "Forbidden - insufficient permissions",
          userRole: currentUser.role,
          allowedRoles
        },
        { status: 403 }
      );
    }

    // Get today's date range
    const today = new Date();
    const startOfDay = new Date(today.setHours(0, 0, 0, 0)).toISOString();
    const endOfDay = new Date(today.setHours(23, 59, 59, 999)).toISOString();

    // Fetch all data in parallel with pagination
    const [usersResponse, pendingWithdrawals, completedTodayWithdrawals] = await Promise.all([
      // Fetch all withdraw-ready users
      fetchAllPages(
        appwriteConfig.userCollectionId,
        [Query.equal("isWithdrawReady", true).toString()]
      ),
      // Fetch all pending withdrawals for today
      fetchAllPages(
        appwriteConfig.odrtransCollectionId,
        [
          Query.equal("odrType", "withdraw").toString(),
          Query.equal("odrStatus", "pending").toString(),
          Query.greaterThanEqual("$createdAt", startOfDay).toString(),
          Query.lessThanEqual("$createdAt", endOfDay).toString()
        ]
      ),
      // Fetch all completed withdrawals for today
      fetchAllPages(
        appwriteConfig.odrtransCollectionId,
        [
          Query.equal("odrType", "withdraw").toString(),
          Query.equal("odrStatus", "completed").toString(),
          Query.greaterThanEqual("$updatedAt", startOfDay).toString(),
          Query.lessThanEqual("$updatedAt", endOfDay).toString()
        ]
      )
    ]);

    console.log(`[team-stats] Fetched data:`, {
      users: usersResponse.total,
      pending: pendingWithdrawals.total,
      completed: completedTodayWithdrawals.total
    });

    const users = usersResponse.documents;

    // Count transactions per user (today only)
    const userStats = users.map((user) => {
      // Count pending transactions assigned to this user (today only)
      const pendingCount = pendingWithdrawals.documents.filter((transaction) => {
        const typedTransaction = transaction as unknown as TransactionDocument;
        if (!typedTransaction.users) return false;
        let assignedUserDocId: string | null = null;
        const transactionUsers = typedTransaction.users;
        if (typeof transactionUsers === "string") {
          assignedUserDocId = transactionUsers;
        } else if (typeof transactionUsers === "object" && transactionUsers.$id) {
          assignedUserDocId = transactionUsers.$id as string;
        }
        return assignedUserDocId === user.$id;
      }).length;

      // Count completed today transactions assigned to this user
      const userCompletedToday = completedTodayWithdrawals.documents.filter((transaction) => {
        const typedTransaction = transaction as unknown as TransactionDocument;
        if (!typedTransaction.users) return false;
        let assignedUserDocId: string | null = null;
        const transactionUsers = typedTransaction.users;
        if (typeof transactionUsers === "string") {
          assignedUserDocId = transactionUsers;
        } else if (typeof transactionUsers === "object" && transactionUsers.$id) {
          assignedUserDocId = transactionUsers.$id as string;
        }
        return assignedUserDocId === user.$id;
      });

      const completedTodayCount = userCompletedToday.length;
      const avgProcessingTime = calculateAverageProcessingTime(
        userCompletedToday.map(doc => doc as unknown as TransactionDocument)
      );

      // Access the actual fields from the schema with proper typing
      const userDoc = user as { email?: string; firstName?: string; lastName?: string; userId?: string };
      const email = userDoc.email || 'No Email';
      const firstName = userDoc.firstName || '';
      const lastName = userDoc.lastName || '';
      const userId = userDoc.userId || '';
      
      // Build display name from firstName + lastName
      const displayName = firstName && lastName ? `${firstName} ${lastName}` : firstName || lastName || email;

      return {
        $id: user.$id,
        userId: userId,
        name: displayName,
        email: email,
        avatar: '',
        role: 'transassistant',
        pendingCount,
        completedTodayCount,
        avgProcessingTimeMinutes: avgProcessingTime
      };
    });

    // Use the actual totals from the paginated results
    const totalPending = pendingWithdrawals.total;
    const totalCompletedToday = completedTodayWithdrawals.total;

    // Calculate team average processing time for today
    const teamAvgProcessingTime = calculateAverageProcessingTime(
      completedTodayWithdrawals.documents.map(doc => doc as unknown as TransactionDocument)
    );

    return NextResponse.json({
      success: true,
      users: userStats,
      totalPending,
      totalCompletedToday,
      teamAverageProcessingTimeMinutes: teamAvgProcessingTime,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error("Error in team-stats API:", error);
    return NextResponse.json(
      { 
        success: false, 
        message: "Internal server error",
        error: error instanceof Error ? error.message : "Unknown error"
      },
      { status: 500 }
    );
  }
} 