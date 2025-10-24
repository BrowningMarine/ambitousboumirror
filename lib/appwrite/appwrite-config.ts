export const appwriteConfig = {
  endpoint: process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!,
  projectId: process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!,
  databaseId: process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
  userCollectionId: process.env.NEXT_PUBLIC_APPWRITE_USER_COLLECTION_ID!,
  payPortalTransCollectionId: process.env.NEXT_PUBLIC_APPWRITE_PAYPORTALTRANS_COLLECTION_ID!,
  accountsCollectionId: process.env.NEXT_PUBLIC_APPWRITE_ACCOUNTS_COLLECTION_ID!,
  banksCollectionId: process.env.NEXT_PUBLIC_APPWRITE_BANKS_COLLECTION_ID!,
  odrtransCollectionId: process.env.NEXT_PUBLIC_APPWRITE_ODRTRANS_COLLECTION_ID!,
  logWebhookCollectionId: process.env.NEXT_PUBLIC_APPWRITE_LOG_WEBHOOK_COLLECTION_ID!,
  bankTransactionEntryCollectionId: process.env.NEXT_PUBLIC_APPWRITE_BANK_TRANSACTION_ENTRY_COLLECTION_ID!,
  banksControlCollectionId: process.env.NEXT_PUBLIC_APPWRITE_BANKS_CONTROL_COLLECTION_ID!,
  statisticsCollectionId: process.env.NEXT_PUBLIC_APPWRITE_STATISTICS_COLLECTION_ID!,
} 