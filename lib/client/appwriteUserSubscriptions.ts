// lib/client/userSubscriptions.ts  

"use client";  

import { client } from '@/lib/appwrite/appwrite-client';  
import { RealtimeResponseEvent } from 'appwrite';  
import { appwriteConfig } from '@/lib/appwrite/appwrite-config';  

export type User = {  
  $id: string;  
  email: string;  
  firstName: string;  
  lastName: string;  
  // Include other user fields as needed  
};  

export const subscribeToUsers = (  
  onCreate: (user: User) => void,  
  onUpdate: (user: User) => void,  
  onDelete: (userId: string) => void  
): (() => void) => {  
  const subscription = client.subscribe(  
    `databases.${appwriteConfig.databaseId}.collections.${appwriteConfig.userCollectionId}.documents`,  
    (response: RealtimeResponseEvent<User>) => {  
      const eventType = response.events[0];  
      const user = response.payload;  

      if (eventType.endsWith('.create')) {  
        onCreate(user);  
      } else if (eventType.endsWith('.update')) {  
        onUpdate(user);  
      } else if (eventType.endsWith('.delete')) {  
        onDelete(user.$id);  
      }  
    }  
  );  

  // Return unsubscribe function  
  return () => {  
    subscription();  
  };  
};