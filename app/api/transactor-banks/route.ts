import { NextResponse } from "next/server";
import { Query } from "appwrite";
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { getLoggedInUser } from "@/lib/actions/user.actions";
import { getBanksByUserId } from "@/lib/actions/bank.actions";

// Environment variables
const DATABASE_ID = appwriteConfig.databaseId;
const BANKS_COLLECTION_ID = appwriteConfig.banksCollectionId;

export async function GET() {
  try {
    // Verify user is authenticated using session
    const user = await getLoggedInUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only allow transactor and admin roles to access transactor banks
    if (!["admin", "transactor"].includes(user.role || "")) {
      return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
    }

    interface BankResponse {
      bankId: string;
      bankName: string;
      accountNumber: string;
      ownerName: string;
      bankBinCode?: string;
    }

    let filteredBanks: BankResponse[] = [];

    if (user.role === "transactor") {
      // Use the existing getBanksByUserId function for transactors
      const userBanks = await getBanksByUserId({ userId: user.$id });
      
      if (userBanks.documents && userBanks.documents.length > 0) {
        // Filter for withdrawal banks (isDeposit = false) and include bank code
        filteredBanks = userBanks.documents
          .filter(bank => {
            const bankData = bank as unknown as Record<string, unknown>;
            return bankData.isDeposit === false && bankData.isActivated === true;
          })
          .map(bank => {
            const bankData = bank as unknown as Record<string, unknown>;
            return {
              bankId: bank.bankId || bank.$id || '',
              bankName: bank.bankName || 'Unknown Bank',
              accountNumber: bank.accountNumber || '',
              ownerName: bank.ownerName || 'Unknown Owner',
              bankBinCode: (bankData.bankBinCode as string) || '',
            };
          });
      } else {
        console.warn(`No banks found for user ${user.$id}. User may need to add banks first.`);
      }
    } else if (user.role === "admin") {
      // For admin, get all active withdrawal banks using direct query
      const { database } = await createAdminClient();
      
      const allBanks = await database.listDocuments(
        DATABASE_ID!,
        BANKS_COLLECTION_ID!,
        [
          Query.equal("isActivated", [true]),
          Query.equal("isDeposit", [false]), // Changed to false for withdrawal banks
        ]
      );
    
      filteredBanks = allBanks.documents.map(bank => ({
        bankId: bank.bankId || '',
        bankName: bank.bankName || '',
        accountNumber: bank.accountNumber || '',
        ownerName: bank.ownerName || '',
        bankBinCode: bank.bankBinCode || '', // Add bank code for icon lookup
      }));
    }

    return NextResponse.json({
      success: true,
      data: filteredBanks,
      debug: {
        totalFound: filteredBanks.length,
        userId: user.$id,
        userRole: user.role
      }
    });

  } catch (error) {
    console.error("Error getting transactor banks:", error);
    return NextResponse.json(
      { success: false, message: "Internal server error" },
      { status: 500 }
    );
  }
} 