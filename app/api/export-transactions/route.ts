import { NextRequest, NextResponse } from "next/server";
import { getLoggedInUser } from "@/lib/actions/user.actions";
import { exportTransactionsStreaming } from "@/lib/actions/transaction.actions";

export async function POST(req: NextRequest) {
  try {
    // Verify user is authenticated
    const user = await getLoggedInUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Parse request body
    const { filters, userRole } = await req.json();

    // Validate required fields
    if (!filters || !userRole) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Validate user role
    if (!["admin", "transactor", "merchant"].includes(userRole)) {
      return NextResponse.json({ error: "Invalid user role" }, { status: 403 });
    }

    console.log(`🔄 Starting large export for user ${user.$id} (${userRole}) with ${JSON.stringify(filters)}`);

    // Use streaming export for better performance with large datasets
    const exportResult = await exportTransactionsStreaming(
      user.$id,
      userRole,
      filters
    );

    if (!exportResult.success) {
      console.error("Export failed:", exportResult.message);
      return NextResponse.json(
        { error: exportResult.message || "Export failed" },
        { status: 500 }
      );
    }

    console.log(`✅ Export completed: ${exportResult.data?.transactions?.length || 0} records`);

    // Return the export data
    return NextResponse.json({
      success: true,
      data: exportResult.data,
      message: exportResult.message
    });

  } catch (error) {
    console.error("Error in export API route:", error);
    
    // Handle specific error types
    if (error instanceof Error) {
      if (error.message.includes("Memory usage too high")) {
        return NextResponse.json(
          { error: "Dataset too large for current server capacity. Please try with smaller date range or contact support." },
          { status: 413 }
        );
      }
      
      if (error.message.includes("timeout")) {
        return NextResponse.json(
          { error: "Export operation timed out. Please try with smaller date range." },
          { status: 408 }
        );
      }
    }

    return NextResponse.json(
      { error: "Internal server error during export" },
      { status: 500 }
    );
  }
}

// Set longer timeout for large exports
export const maxDuration = 300; // 5 minutes for Vercel Pro plans 