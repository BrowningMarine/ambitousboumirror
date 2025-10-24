import { NextRequest, NextResponse } from "next/server";
import { Query } from "appwrite";  
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";

// Environment variables  
const DATABASE_ID = appwriteConfig.databaseId;  
const ORDER_TRANS_COLLECTION_ID = appwriteConfig.odrtransCollectionId;

// GET /api/payment-status/[orderId] - Get payment status for public display  
export async function GET(  
  request: NextRequest,  
  { params }: { params: { orderId: string } }  
) {  
  try {  
    const { orderId } = await params;  
    
    // Get admin client  
    const { database } = await createAdminClient();  
    
    // Find the order by odrId (not the document ID)  
    const orders = await database.listDocuments(  
      DATABASE_ID!,  
      ORDER_TRANS_COLLECTION_ID!,  
      [Query.equal("odrId", [orderId])]  
    );  
    
    if (orders.total === 0) {  
      return NextResponse.json({ success: false, message: 'Order not found' }, { status: 404 });  
    }  
    
    const order = orders.documents[0];  
    
    // Return just the necessary information for the payment status page  
    return NextResponse.json({  
      success: true,  
      data: {  
        odrId: order.odrId,  
        odrStatus: order.odrStatus,  
        amount: order.amount,  
        paidAmount: order.paidAmount,  
        redirectUrl: order.odrStatus === 'completed' ? order.urlSuccess :   
                    order.odrStatus === 'failed' ? order.urlFailed : order.urlCanceled  
      }  
    });  
    
  } catch (error) {  
    console.error('Error getting payment status:', error);  
    return NextResponse.json(  
      { success: false, message: 'Internal server error' },  
      { status: 500 }  
    );  
  }  
}