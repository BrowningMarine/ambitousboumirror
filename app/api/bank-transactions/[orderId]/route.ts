import { NextRequest, NextResponse } from "next/server";
import { getAllBankTransactionEntriesByOrderId } from "@/lib/actions/bankTransacionEntry.action";

export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const { orderId } = await params;
    
    // Always get ALL bank transactions for this orderId
    // Role-based filtering is handled on the client side
    const result = await getAllBankTransactionEntriesByOrderId(orderId, null);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching bank transactions:", error);
    return NextResponse.json(
      { 
        success: false, 
        message: "Failed to fetch bank transactions",
        entries: []
      },
      { status: 500 }
    );
  }
} 