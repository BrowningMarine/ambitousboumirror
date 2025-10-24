// lib/appwrite-client.ts  

import { Client, Account, Databases } from 'appwrite';  
import { appwriteConfig } from './appwrite-config';  

const appwriteClient = new Client()  
  .setEndpoint(appwriteConfig.endpoint)  
  .setProject(appwriteConfig.projectId);  

const account = new Account(appwriteClient);  
const databases = new Databases(appwriteClient);  

export { appwriteClient as client, account, databases };