  //this API user for payment page to get data
  import { NextRequest, NextResponse } from "next/server";  
  import { createAdminClient } from "@/lib/appwrite/appwrite.actions";  
  import { appwriteConfig } from "@/lib/appwrite/appwrite-config";  
  import { Query } from "appwrite";

  // Environment variables  
  const DATABASE_ID = appwriteConfig.databaseId;  
  const ORDER_TRANS_COLLECTION_ID = appwriteConfig.odrtransCollectionId;  
  const BANKS_COLLECTION_ID = appwriteConfig.banksCollectionId;  

  export async function GET(  
    request: NextRequest,  
    { params }: { params: { orderId: string } }  
  ) {  
    try {  
      const { orderId } = await params;  
      
      // Get admin client  
      const { database } = await createAdminClient();  
      
      // Look up the order by ID  
      const ordersList = await database.listDocuments(  
        DATABASE_ID,  
        ORDER_TRANS_COLLECTION_ID,  
        [Query.equal("odrId", orderId)]
      );  
      
      if (!ordersList) {  
        return NextResponse.json(  
          { success: false, message: 'Payment not found' },  
          { status: 404 }  
        );  
      }  
      
      const order = ordersList.documents[0];
      //console.log('order',order);
      // Look up bank details
      let bank;
      let bankInfo;
      if (order.odrType === 'deposit') {
        bank = await database.listDocuments(  
          DATABASE_ID,  
          BANKS_COLLECTION_ID,  
          [Query.equal("bankId", [order.bankId])]  
        );  
        
        if (bank.total === 0) {  
          return NextResponse.json(  
            { success: false, message: 'Bank information not found' },  
            { status: 404 }  
          );  
        }
        bankInfo = bank.documents[0];
      }
      
      // // Format the timestamp  
      // const { date, time } = formatDateTime(order.$createdAt, "en-US", true);  
      // const formattedDate = `${date.replace(/\//g, '-').split('-').reverse().join('-')} ${time}`;
      
      // Return payment details including QR code  
      return NextResponse.json({  
        success: true,  
        data: {  
          odrId: order.odrId,  
          merchantOrdId: order.merchantOrdId || '',  
          odrStatus: order.odrStatus,  
          bankName: order.odrType === 'deposit' ? bankInfo?.bankName : '' ,  
          accountNumber: order.odrType === 'deposit' ? bankInfo?.accountNumber : order.bankReceiveNumber,  
          accountName: order.odrType === 'deposit' ? bankInfo?.ownerName : order.bankReceiveOwnerName,  
          amount: order.amount,  
          timestamp: order.$createdAt,  
          qrCode: order.qrCode || null,  
          urlSuccess: order.urlSuccess || '',  
          urlFailed: order.urlFailed || '',  
          urlCanceled: order.urlCanceled || '',  
          urlCallBack: order.urlCallBack || '',  
        }  
      });  
      
    } catch (error) {  
      console.error('Error fetching payment details:', error);  
      return NextResponse.json(  
        { success: false, message: 'Internal server error' },  
        { status: 500 }  
      );  
    }  
  }