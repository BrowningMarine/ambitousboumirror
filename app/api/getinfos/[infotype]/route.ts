// app/api/getinfos/[infotype]/route.ts  
import { NextRequest, NextResponse } from "next/server";  
import { Query } from "appwrite";  
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";  
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";  
import { verifyApiKeyAndAccount } from "@/lib/utils";  
import { VietQRCache } from "@/lib/cache/vietqr-cache";

// Environment variables  
const DATABASE_ID = appwriteConfig.databaseId;   
const BANKS_COLLECTION_ID = appwriteConfig.banksCollectionId;  

// Function to get bank codes from VietQR API (now with caching)
async function getBankCodes() {  
  try {  
    // Use the shared VietQR cache utility
    const result = await VietQRCache.getPublicBankList();
    return result;
  } catch (error) {  
    console.error('Error getting bank codes:', error);  
    return {  
      success: false,  
      message: 'Error getting bank codes'  
    };  
  }  
}  

// GET /api/getinfos/[infotype] - Get different types of information  
export async function GET(  
  request: NextRequest,  
  { params }: { params: { infotype: string } }  
) {  
  try {  
    const { infotype } = await params;  

    // Validate supported info types  
    const supportedTypes = ['transactorBanks', 'bankList'];  
    if (!supportedTypes.includes(infotype)) {  
      return NextResponse.json(  
        {   
          success: false,   
          message: `Unsupported info type: ${infotype}. Supported types are: ${supportedTypes.join(', ')}`   
        },  
        { status: 400 }  
      );  
    }  

    // Special case for bankList which doesn't require authentication  
    if (infotype === 'bankList') {  
      return NextResponse.json(await getBankCodes());  
    }

    // For all other info types, require authentication  
    // Get API key from headers  
    const clientId = request.headers.get('x-client-id');  
    const apiKey = request.headers.get('x-api-key');  
    
    // Validate that both headers are present  
    if (!clientId || !apiKey) {  
      return NextResponse.json(  
        {   
          success: false,   
          message: `${!clientId ? 'x-client-id' : 'x-api-key'} header is required`  
        },  
        { status: 401 }  
      );  
    }  

    // Use the existing verifyApiKeyAndAccount function  
    const account = await verifyApiKeyAndAccount(apiKey, clientId);  
    //console.log('Account:', account);
    if (!account) {  
      return NextResponse.json(  
        { success: false, message: 'Invalid credentials' },  
        { status: 401 }  
      );  
    }

    const referenceUserId = account.referenceUserId;  

    if (!referenceUserId) {  
      return NextResponse.json(  
        { success: false, message: 'Your account does not belong to any Transactor, please contact Administrator' },  
        { status: 401 }  
      );  
    } 

    // Handle different info types  
    if (infotype === 'transactorBanks') {  
      // Get admin client  
      const { database } = await createAdminClient();  
      
      // Query for active banks  
      const banks = await database.listDocuments(  
        DATABASE_ID!,  
        BANKS_COLLECTION_ID!,  
        [  
          Query.equal("isActivated", [true]),
          Query.equal("isDeposit", [true]),
          Query.equal("userId", [referenceUserId]),  
        ]  
      );  

      // Map the response to only include the fields you want  
      const filteredBanks = banks.documents.map(bank => ({  
        bankId: bank.bankId,  
        bankName: bank.bankName,  
        accountNumber: bank.accountNumber,  
        ownerName: bank.ownerName,  
      }));  
      
      return NextResponse.json({  
        success: true,  
        data: filteredBanks  
      });  
    }  
    
    // This should never happen due to validation above, but included for completeness  
    return NextResponse.json(  
      { success: false, message: 'Unsupported info type' },  
      { status: 400 }  
    );  
    
  } catch (error) {  
    console.error(`Error getting ${params.infotype}:`, error);  
    return NextResponse.json(  
      { success: false, message: 'Internal server error' },  
      { status: 500 }  
    );  
  }  
}