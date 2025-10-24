import { Client, Databases, Account } from 'appwrite';  

// Create a new client instance  
const client = new Client()  
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)  
    .setProject(process.env.NEXT_PUBLIC_PROJECT_ID!);  

// Create databases instance  
const databases = new Databases(client);  

// Create account instance  
const account = new Account(client);  

// Export all instances  
export { client, databases, account };