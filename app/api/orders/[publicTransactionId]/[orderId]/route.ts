import { NextRequest, NextResponse } from "next/server";
import { verifyApiKeyAndAccount } from "@/lib/utils";
import { getTransactionByOrderId } from "@/lib/actions/transaction.actions";

// GET /api/orders/[publicTransactionId]/[orderId] - Get a specific order with payment details  
export async function GET(  
  request: NextRequest,  
  { params }: { params: { publicTransactionId: string; orderId: string } }  
) {  
  try {  
    // Get API key from Authorization header  
    const apiKey = request.headers.get('x-api-key');  
    
    if (!apiKey) {  
      return NextResponse.json(  
        { success: false, message: 'API key is required' },  
        { status: 401 }  
      );  
    }  
    
    const { publicTransactionId, orderId } = await params;  
    
    // Verify API key and account  
    const account = await verifyApiKeyAndAccount(apiKey, publicTransactionId);  
    
    if (!account) {  
      return NextResponse.json(  
        { success: false, message: 'Invalid API key or account' },  
        { status: 401 }  
      );  
    }
    
    // Get the order  
    const order = await getTransactionByOrderId(orderId)
    
    if (!order) {  
      return NextResponse.json(  
        { success: false, message: 'Order not found' },  
        { status: 404 }  
      );  
    }  
    
    // Verify that the order belongs to this account  
    if (order.positiveAccount !== publicTransactionId) {  
      return NextResponse.json(  
        { success: false, message: 'Order does not belong to this account' },  
        { status: 403 }  
      );  
    }

    return NextResponse.json({  
      success: true,  
      data: {  
        odrId: order.odrId,
        odrType: order.odrType,
        odrStatus: order.odrStatus,
        amount: order.amount,
      }  
    });  
    
  } catch (error) {  
    console.error('Error getting order transaction:', error);  
    return NextResponse.json(  
      { success: false, message: 'Internal server error' },  
      { status: 500 }  
    );  
  }  
}  
