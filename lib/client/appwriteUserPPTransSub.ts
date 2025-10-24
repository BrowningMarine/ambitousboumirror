"use client";  

import { client } from '@/lib/appwrite/appwrite-client';  
import { RealtimeResponseEvent } from 'appwrite';  
import { appwriteConfig } from '@/lib/appwrite/appwrite-config';  
import { PayPortalTrans, User } from '@/types';  


interface SubscriptionHandlers {  
  onUserChange?: (user: User) => void;  
  onTransactionChange?: (  
    transaction: PayPortalTrans,  
    changedFields: MonitoredFields[] | 'created' | 'deleted'  
  ) => void;  
} 

export interface RealtimeUser extends User {  
    $previous?: Partial<User>;  
}

export interface RealtimePayPortalTrans extends PayPortalTrans {  
    $previous?: Partial<PayPortalTrans>;  
}

// Define which fields to monitor   
export const MONITORED_FIELDS = ['status', 'lsDocumentNo', 'payPortalName', 'payPortalOrder', 'callbackPaymentTime','amount'] as const;  
export type MonitoredFields = typeof MONITORED_FIELDS[number]; 

export const subcribePayportalTrans = (  
  userId: string,  
  storeIds: string[],  
  fieldsToMonitor: readonly MonitoredFields[],  
  handlers: SubscriptionHandlers  
): (() => void) => {  
  const userSubscription = client.subscribe(  
    `databases.${appwriteConfig.databaseId}.collections.${appwriteConfig.userCollectionId}.documents.${userId}`,  
    (response: RealtimeResponseEvent<RealtimeUser>) => {  
      handlers.onUserChange?.(response.payload);  
    }  
  );  

  const transSubscription = client.subscribe(  
    `databases.${appwriteConfig.databaseId}.collections.${appwriteConfig.payPortalTransCollectionId}.documents`,  
    (response: RealtimeResponseEvent<RealtimePayPortalTrans>) => {  
      const transaction = response.payload;  
      
      // If storeIds has "0", process all transactions  
      // Otherwise check if transaction's terminalId matches any of the storeIds  
      const hasZeroStore = storeIds.some(store => store === "0");  
      if (!hasZeroStore && !storeIds.includes(transaction.terminalId)) {  
        return;  
      }  

      const { $previous, ...transactionData } = transaction;  

      // Handle different event types  
      if (response.events.includes('databases.*.collections.*.documents.*.create')) {  
        handlers.onTransactionChange?.(transactionData, 'created');  
      }  
      else if (response.events.includes('databases.*.collections.*.documents.*.delete')) {  
        handlers.onTransactionChange?.(transactionData, 'deleted');  
      }  
      else if (response.events.includes('databases.*.collections.*.documents.*.update')) {  
        const previousData = transaction.$previous || {};  
        const changedFields = fieldsToMonitor.filter(field =>  
          previousData[field] !== transaction[field]  
        ) as MonitoredFields[];  

        if (changedFields.length > 0) {  
          handlers.onTransactionChange?.(transactionData, changedFields);  
        }  
      }  
    }  
  );  

  return () => {  
    userSubscription();  
    transSubscription();  
  };  
};