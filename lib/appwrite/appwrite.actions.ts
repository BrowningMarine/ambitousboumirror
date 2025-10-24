"use server";

import { Client, Account, Databases, Users, Query , ID } from "node-appwrite";
import { cookies } from "next/headers";
import { appConfig } from "../appconfig";

const COOKIE_NAME = appConfig.cookie_name; 
export async function createSessionClient() {  
  const client = new Client()  
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)  
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!);  

  const cookieStore = await cookies();  
  const session = cookieStore.get(COOKIE_NAME);  
  
  if (!session || !session.value) {  
    return {   
      account: null,   
      isAuthenticated: false,  
      error: "No session"   
    };  
  }  
  
  try {
    // Our cookie now contains a base64 encoded JSON with id and secret
    // We need to extract just the secret
    let sessionSecret = session.value;
    
    try {
      // Parse the custom token format (from signIn function)
      const decoded = Buffer.from(session.value, 'base64').toString('utf-8');
      const tokenData = JSON.parse(decoded);
      
      // If we have a valid format, extract the secret
      if (tokenData && tokenData.secret) {
        sessionSecret = tokenData.secret;
      }
    } catch (parseError) {
      // If parsing fails, assume the token is already the raw secret
      console.error('Error parsing session token:', parseError);
    }
    
    // Set the session with the extracted secret
    client.setSession(sessionSecret);  
    
    // Test the session by creating an account instance  
    const account = new Account(client);  
    
    // We don't need to call account.get() here which might throw scope errors
    // Just return the account object and let the caller handle any specific API calls
    return {  
      account,  
      isAuthenticated: true,  
      error: null  
    };  
  } catch (error) {  
    // Log the specific error for debugging
    console.error('Session client creation error:', error);

    // Handle specific error types
    let errorMessage = "Invalid session";
    if (error instanceof Error) {
      errorMessage = error.message;
      
      // Handle specific Appwrite errors
      if (error.message.includes('missing scope')) {
        errorMessage = "User missing required permission scope";
      }
    }
    
    // Session is invalid or expired  
    return {   
      account: null,   
      isAuthenticated: false,  
      error: errorMessage
    };  
  }  
}

export async function createAdminClient() {
  const client = new Client()
    .setEndpoint(process.env.NEXT_PUBLIC_APPWRITE_ENDPOINT!)
    .setProject(process.env.NEXT_PUBLIC_APPWRITE_PROJECT_ID!)
    .setKey(process.env.APPWRITE_KEY!);

  return {
    get account() {
      return new Account(client);
    },
    get database() {
      return new Databases(client);
    },
    get user() {
      return new Users(client);
    }
  };
}
//appwrite backup-restore
// Define base document type  
interface appwriteDocument {  
  $id: string;  
  $createdAt: string;  
  $updatedAt: string;  
  [key: string]: unknown;  
}

interface appwriteUserData {  
  $id: string;  
  $createdAt: string;  
  $updatedAt: string;  
  name: string;  
  email: string;  
  phone?: string;  
  emailVerification: boolean;  
  phoneVerification: boolean;  
  status: boolean;  
  labels?: string[];  
  prefs?: Record<string, unknown>;  
} 

// Define types for backup data  
interface appwriteCollectionAttribute {
  key: string;
  type: string;
  status: string;
  required: boolean;
  array?: boolean;
  size?: number;
  xdefault?: unknown;
  elements?: string[];
  min?: number;
  max?: number;
  format?: string;
}

interface appwriteCollectionBackup {  
  name: string;
  enabled: boolean;
  documentSecurity: boolean;
  attributes: appwriteCollectionAttribute[];
  documents: appwriteDocument[];  
}

export interface appwriteDatabaseBackup {  
  timestamp: string;  
  collections: {  
      [key: string]: appwriteCollectionBackup;  
  };
  users: appwriteUserData[];
} 

interface appwriteCollectionBackupData {  
  timestamp: string;  
  collectionId: string;  
  documents: appwriteDocument[];  
}

interface appwriteRestoreResult {  
  success: boolean;  
  message: string;  
  errors?: string[];  
  stats: {  
      users: number;  
      documents: number;  
  };  
}

export async function backupDatabaseAndAuth(): Promise<appwriteDatabaseBackup> {  
  try {  
    const admin = await createAdminClient();  
    const databases = admin.database;  
    const users = admin.user;  
    
    // Backup collections  
    const collections = await databases.listCollections(  
        process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!  
    );  

    const backupData: appwriteDatabaseBackup = {  
        timestamp: new Date().toISOString(),  
        collections: {},  
        users: []  
    };  

    // Backup each collection with pagination  
    for (const collection of collections.collections) {  
      let documentsOffset = 0;  
      const documentsLimit = 100; // Appwrite's maximum limit per request  
      let hasMoreDocuments = true;  
      const allDocuments: appwriteDocument[] = [];
      
      // Get collection attributes/schema
      const collectionDetails = await databases.getCollection(
        process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
        collection.$id
      );
      
      while (hasMoreDocuments) {
        console.log(`Backing up collection ${collection.name}: ${allDocuments.length} documents so far...`);
        const documents = await databases.listDocuments(  
          process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,  
          collection.$id,  
          [  
            Query.limit(documentsLimit),  
            Query.offset(documentsOffset)  
          ]  
        );  

        allDocuments.push(...documents.documents as appwriteDocument[]);  

        if (documents.documents.length < documentsLimit) {  
          hasMoreDocuments = false;  
        } else {  
          documentsOffset += documentsLimit;  
        }  
      }  
      
      backupData.collections[collection.$id] = {  
        name: collection.name,
        enabled: collectionDetails.enabled,
        documentSecurity: collectionDetails.documentSecurity,
        attributes: (collectionDetails.attributes || []) as unknown as appwriteCollectionAttribute[],
        documents: allDocuments  
      };  
    }  

    // Backup users  
    let offset = 0;  
    const limit = 100; // Appwrite's maximum limit per request  
    let hasMoreUsers = true;  

    while (hasMoreUsers) {  
      const usersList = await users.list(  
        [  
          Query.limit(limit),  
          Query.offset(offset)  
        ]  
      );  

      backupData.users.push(...usersList.users as appwriteUserData[]);  

      if (usersList.users.length < limit) {  
        hasMoreUsers = false;  
      } else {  
        offset += limit;  
      }  
    }  

    return backupData;  
  } catch (error) {  
    console.error('Backup failed:', error);  
    throw new Error('Failed to create backup');  
  }  
}

export async function appwriteBackupCollection(collectionId: string): Promise<appwriteCollectionBackupData> {  
  try {  
      const admin = await createAdminClient();  
      const databases = admin.database;  

      const documents = await databases.listDocuments(  
          process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,  
          collectionId  
      );  

      return {  
          timestamp: new Date().toISOString(),  
          collectionId,  
          documents: documents.documents as appwriteDocument[]  
      };  
  } catch (error) {  
      console.error(`Failed to backup collection ${collectionId}:`, error);  
      throw new Error(`Failed to backup collection ${collectionId}`);  
  }  
}  

// Helper function to infer attribute type from value
function inferAttributeType(value: unknown): { type: string; size?: number } {
  if (value === null || value === undefined) {
    return { type: 'string', size: 255 };
  }
  
  if (typeof value === 'string') {
    // Check if it's an Appwrite document ID (relationship)
    if (value.match(/^[a-f0-9]{20}$/) || value.match(/^[a-zA-Z0-9]{20}$/)) {
      return { type: 'string', size: 36 }; // Treat relationships as string IDs
    }
    // Check if it's an email
    if (value.includes('@') && value.includes('.')) {
      return { type: 'email' };
    }
    // Check if it's a URL
    if (value.startsWith('http://') || value.startsWith('https://')) {
      return { type: 'url' };
    }
    // Check if it's a datetime ISO string
    if (value.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/)) {
      return { type: 'datetime' };
    }
    return { type: 'string', size: Math.max(255, value.length + 50) };
  }
  
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { type: 'integer' } : { type: 'double' };
  }
  
  if (typeof value === 'boolean') {
    return { type: 'boolean' };
  }
  
  if (Array.isArray(value)) {
    if (value.length > 0) {
      const elementType = inferAttributeType(value[0]);
      return { ...elementType, array: true } as { type: string; size?: number };
    }
    return { type: 'string', size: 255 };
  }
  
  return { type: 'string', size: 255 };
}

// Helper function to create collection from document data
async function createCollectionFromDocuments(
  databases: Databases,
  databaseId: string,
  collectionId: string,
  collectionName: string,
  documents: appwriteDocument[]
): Promise<string[]> {
  const errors: string[] = [];
  
  try {
    // Create the collection first
    await databases.createCollection(
      databaseId,
      collectionId,
      collectionName,
      undefined, // permissions
      false, // documentSecurity
      true // enabled
    );
    
    console.log(`Created collection: ${collectionName} (${collectionId})`);
    
    // Analyze all documents to determine required attributes
    const attributeMap = new Map<string, { type: string; size?: number; required: boolean }>();
    
    for (const doc of documents) {
      const { $id, $createdAt, $updatedAt, $databaseId, $collectionId, $permissions, ...data } = doc;
      
      for (const [key, value] of Object.entries(data)) {
        const inferredType = inferAttributeType(value);
        const existing = attributeMap.get(key);
        
        if (!existing) {
          attributeMap.set(key, {
            ...inferredType,
            required: false // Make all inferred attributes optional
          });
        } else if (existing.type === 'string' && inferredType.type === 'string') {
          // Update string size if this value is longer
          const newSize = Math.max(existing.size || 255, inferredType.size || 255);
          attributeMap.set(key, { ...existing, size: newSize });
        }
      }
    }
    
    // Create attributes
    for (const [key, attrInfo] of attributeMap) {
      try {
        console.log(`Creating inferred attribute: ${key} (${attrInfo.type}) for collection ${collectionName}`);
        
        switch (attrInfo.type) {
          case 'string':
            await databases.createStringAttribute(
              databaseId,
              collectionId,
              key,
              attrInfo.size || 255,
              attrInfo.required,
              undefined,
              false
            );
            break;
          case 'integer':
            await databases.createIntegerAttribute(
              databaseId,
              collectionId,
              key,
              attrInfo.required,
              undefined,
              undefined,
              undefined,
              false
            );
            break;
          case 'double':
            await databases.createFloatAttribute(
              databaseId,
              collectionId,
              key,
              attrInfo.required,
              undefined,
              undefined,
              undefined,
              false
            );
            break;
          case 'boolean':
            await databases.createBooleanAttribute(
              databaseId,
              collectionId,
              key,
              attrInfo.required,
              undefined,
              false
            );
            break;
          case 'datetime':
            await databases.createDatetimeAttribute(
              databaseId,
              collectionId,
              key,
              attrInfo.required,
              undefined,
              false
            );
            break;
          case 'email':
            await databases.createEmailAttribute(
              databaseId,
              collectionId,
              key,
              attrInfo.required,
              undefined,
              false
            );
            break;
          case 'url':
            await databases.createUrlAttribute(
              databaseId,
              collectionId,
              key,
              attrInfo.required,
              undefined,
              false
            );
            break;
        }
        
        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (attrError) {
        const error = `Failed to create inferred attribute ${key} for collection ${collectionName}: ${(attrError as Error).message}`;
        console.error(error);
        errors.push(error);
      }
    }
    
  } catch (createError) {
    const error = `Failed to create collection ${collectionName}: ${(createError as Error).message}`;
    console.error(error);
    errors.push(error);
  }
  
  return errors;
}

// Enhanced restore function that handles both old and new backup formats
export async function appwriteRestoreData(backupData: appwriteDatabaseBackup | any): Promise<appwriteRestoreResult> {  
  try {  
      const admin = await createAdminClient();  
      const databases = admin.database;  
      const users = admin.user;
      
            // Check if the target database exists, if not create it
      let actualDatabaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
      try {
        await databases.get(actualDatabaseId);
        console.log(`Database ${actualDatabaseId} exists and is accessible`);
      } catch {
        // Database doesn't exist or isn't accessible, try to create it
        try {
          console.log(`Creating database: ${actualDatabaseId}`);
          await databases.create(
            actualDatabaseId,
            'Restored Database',
            true // enabled
          );
          console.log(`Successfully created database: ${actualDatabaseId}`);
          
          // Add a small delay to ensure database is fully created
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (createDbError) {
          console.error('Failed to create database:', (createDbError as Error).message);
          
          // If database creation fails, try to list available databases and suggest alternatives
          try {
            const availableDatabases = await databases.list();
            if (availableDatabases.databases.length > 0) {
              const suggestion = availableDatabases.databases[0];
              console.log(`Available database found: ${suggestion.name} (${suggestion.$id})`);
              console.log(`Consider updating NEXT_PUBLIC_APPWRITE_DATABASE_ID to: ${suggestion.$id}`);
              
              // Use the first available database as fallback
              actualDatabaseId = suggestion.$id;
              console.log(`Using fallback database: ${actualDatabaseId}`);
            } else {
              throw new Error(`No databases available and cannot create new database: ${(createDbError as Error).message}`);
            }
          } catch {
            throw new Error(`Database ${actualDatabaseId} not found and cannot create or list databases. Please check your Appwrite configuration and API key permissions.`);
          }
        }
      }  
      const errors: string[] = [];  
      const stats = {  
          users: 0,  
          documents: 0,  
          skipped: 0  
      };  

      // Restore users first (if users array exists)
      if (backupData.users && Array.isArray(backupData.users)) {
        for (const userData of backupData.users) {  
          try {  
              const {   
                  $id,   
                  $createdAt,   
                  $updatedAt,   
                  email,  
                  name,  
                  ...userDataToRestore   
              } = userData;  
              
              const existingUsers = await users.list([  
                  Query.equal('email', email)  
              ]);  

              if (existingUsers.total === 0) {  
                  const temporaryPassword = ID.unique();  
                  await users.create(  
                      ID.unique(),  
                      email,  
                      undefined,  
                      temporaryPassword,  
                      name  
                  );  
                  stats.users++;  
              } else {  
                  stats.skipped++;  
              }  
          } catch (e) {  
              const error = `Failed to restore user ${userData.email}: ${(e as Error).message}`;  
              console.error(error);  
              errors.push(error);  
          }  
        }
      }  

      // Check if this is a new format backup (with collection schema) or old format
      const isNewFormat = backupData.collections && 
        Object.values(backupData.collections).some((col: any) => 
          col.attributes !== undefined && col.enabled !== undefined
        );
      
      // Handle new format with full collection schema
      if (isNewFormat) {
        for (const [collectionId, data] of Object.entries(backupData.collections)) {  
          const { documents, name, enabled, documentSecurity, attributes } = data as appwriteCollectionBackup;
          
          // Try to create collection if it doesn't exist
          try {
            await databases.getCollection(
              actualDatabaseId,
              collectionId
            );
            console.log(`Collection ${name} already exists, skipping creation`);
          } catch (collectionError) {
            // Collection doesn't exist, create it
            try {
              console.log(`Creating collection: ${name} (${collectionId})`);
              await databases.createCollection(
                actualDatabaseId,
                collectionId,
                name,
                undefined, // permissions (optional)
                documentSecurity,
                enabled
              );
              
              // Create attributes for the collection
              for (const attr of attributes) {
                try {
                  console.log(`Creating attribute: ${attr.key} (${attr.type}) for collection ${name}`);
                  
                  // Create attributes based on type
                  switch (attr.type) {
                    case 'string':
                      await databases.createStringAttribute(
                        process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
                        collectionId,
                        attr.key,
                        attr.size || 255,
                        attr.required,
                        attr.xdefault as string || undefined,
                        attr.array || false
                      );
                      break;
                    case 'integer':
                      await databases.createIntegerAttribute(
                        process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
                        collectionId,
                        attr.key,
                        attr.required,
                        attr.min,
                        attr.max,
                        attr.xdefault as number || undefined,
                        attr.array || false
                      );
                      break;
                    case 'double':
                      await databases.createFloatAttribute(
                        process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
                        collectionId,
                        attr.key,
                        attr.required,
                        attr.min,
                        attr.max,
                        attr.xdefault as number || undefined,
                        attr.array || false
                      );
                      break;
                    case 'boolean':
                      await databases.createBooleanAttribute(
                        process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
                        collectionId,
                        attr.key,
                        attr.required,
                        attr.xdefault as boolean || undefined,
                        attr.array || false
                      );
                      break;
                    case 'datetime':
                      await databases.createDatetimeAttribute(
                        process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
                        collectionId,
                        attr.key,
                        attr.required,
                        attr.xdefault as string || undefined,
                        attr.array || false
                      );
                      break;
                    case 'email':
                      await databases.createEmailAttribute(
                        process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
                        collectionId,
                        attr.key,
                        attr.required,
                        attr.xdefault as string || undefined,
                        attr.array || false
                      );
                      break;
                    case 'enum':
                      await databases.createEnumAttribute(
                        process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
                        collectionId,
                        attr.key,
                        attr.elements || [],
                        attr.required,
                        attr.xdefault as string || undefined,
                        attr.array || false
                      );
                      break;
                    case 'url':
                      await databases.createUrlAttribute(
                        process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
                        collectionId,
                        attr.key,
                        attr.required,
                        attr.xdefault as string || undefined,
                        attr.array || false
                      );
                      break;
                    case 'relationship':
                      try {
                        console.log(`Creating relationship attribute: ${attr.key} for collection ${name}`);
                        // For now, create as string attribute to avoid relationship complexity
                        // Relationships need both collections to exist first
                        await databases.createStringAttribute(
                          actualDatabaseId,
                          collectionId,
                          attr.key,
                          36, // Standard ID length
                          attr.required,
                          attr.xdefault as string || undefined,
                          attr.array || false
                        );
                        console.log(`Created relationship ${attr.key} as string attribute (ID reference)`);
                      } catch (relError) {
                        const error = `Failed to create relationship attribute ${attr.key} for collection ${name}: ${(relError as Error).message}`;
                        console.error(error);
                        errors.push(error);
                      }
                      break;
                    default:
                      console.log(`Unknown attribute type: ${attr.type} for ${attr.key}`);
                  }
                  
                  // Add a small delay to avoid rate limiting
                  await new Promise(resolve => setTimeout(resolve, 100));
                } catch (attrError) {
                  const error = `Failed to create attribute ${attr.key} for collection ${name}: ${(attrError as Error).message}`;
                  console.error(error);
                  errors.push(error);
                }
              }
              
              console.log(`Successfully created collection: ${name}`);
            } catch (createError) {
              const error = `Failed to create collection ${name}: ${(createError as Error).message}`;
              console.error(error);
              errors.push(error);
              continue; // Skip to next collection
            }
          }  
          
          // Restore documents for new format
          for (const doc of documents) {  
              try {  
                  // Remove all system attributes  
                  const {   
                      $id,   
                      $createdAt,   
                      $updatedAt,  
                      $databaseId,    // Remove database ID  
                      $collectionId,  // Remove collection ID  
                      $permissions,   // Remove permissions  
                      ...documentData
                  } = doc;  

                  try {  
                      // Try to get document by ID  
                      await databases.getDocument(  
                          process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,  
                          collectionId,  
                          $id  
                      );  
                      // If document exists, skip it  
                      stats.skipped++;  
                      console.log(`Skipped existing document ID: ${$id} in ${collectionId}`);  
                      continue;  
                  } catch {  
                      // If document doesn't exist (404 error), create it  
                      await databases.createDocument(  
                          process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,  
                          collectionId,  
                          ID.unique(), // Generate new ID  
                          documentData  
                      );  
                      stats.documents++;  
                  }  
              } catch (e) {  
                  const error = `Failed to process document in ${collectionId}: ${(e as Error).message}`;  
                  console.error(error);  
                  errors.push(error);  
              }  
          }  
        }
      } else {
        // Handle old format backup (like from appwriteBackupCollection)
        // Check if it's a single collection backup or multiple collections
        if (backupData.collectionId && backupData.documents) {
          // Single collection backup format
          const collectionId = backupData.collectionId;
          const documents = backupData.documents as appwriteDocument[];
          const collectionName = `Collection_${collectionId}`;
          
          // Try to get collection, if it doesn't exist, create it
          try {
            await databases.getCollection(
              process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
              collectionId
            );
            console.log(`Collection ${collectionName} already exists, skipping creation`);
          } catch {
            // Create collection from document analysis
            const createErrors = await createCollectionFromDocuments(
              databases,
              process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
              collectionId,
              collectionName,
              documents
            );
            errors.push(...createErrors);
          }
          
          // Restore documents
          for (const doc of documents) {  
              try {  
                  // Remove all system attributes  
                  const {   
                      $id,   
                      $createdAt,   
                      $updatedAt,  
                      $databaseId,    
                      $collectionId,  
                      $permissions,   
                      ...documentData
                  } = doc;  

                  try {  
                      await databases.getDocument(  
                          process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,  
                          collectionId,  
                          $id  
                      );  
                      stats.skipped++;  
                      console.log(`Skipped existing document ID: ${$id} in ${collectionId}`);  
                      continue;  
                  } catch {  
                      await databases.createDocument(  
                          process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,  
                          collectionId,  
                          ID.unique(),  
                          documentData  
                      );  
                      stats.documents++;  
                  }  
              } catch (e) {  
                  const error = `Failed to process document in ${collectionId}: ${(e as Error).message}`;  
                  console.error(error);  
                  errors.push(error);  
              }  
          }
        } else if (backupData.collections) {
          // Multiple collections without schema info
          for (const [collectionId, data] of Object.entries(backupData.collections)) {
            const documents = (data as any).documents as appwriteDocument[];
            const collectionName = (data as any).name || `Collection_${collectionId}`;
            
            // Try to get collection, if it doesn't exist, create it
            try {
              await databases.getCollection(
                process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
                collectionId
              );
              console.log(`Collection ${collectionName} already exists, skipping creation`);
            } catch {
              // Create collection from document analysis
              const createErrors = await createCollectionFromDocuments(
                databases,
                process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,
                collectionId,
                collectionName,
                documents
              );
              errors.push(...createErrors);
            }
            
            // Restore documents
            for (const doc of documents) {  
                try {  
                    const {   
                        $id,   
                        $createdAt,   
                        $updatedAt,  
                        $databaseId,    
                        $collectionId,  
                        $permissions,   
                        ...documentData
                    } = doc;  

                    try {  
                        await databases.getDocument(  
                            process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,  
                            collectionId,  
                            $id  
                        );  
                        stats.skipped++;  
                        continue;  
                    } catch {  
                        await databases.createDocument(  
                            process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!,  
                            collectionId,  
                            ID.unique(),  
                            documentData  
                        );  
                        stats.documents++;  
                    }  
                } catch (e) {  
                    const error = `Failed to process document in ${collectionId}: ${(e as Error).message}`;  
                    console.error(error);  
                    errors.push(error);  
                }  
            }
          }
        }
      }  

      return {  
          success: errors.length === 0,  
          message: `Restore completed: ${stats.documents} created, ${stats.skipped} skipped`,  
          errors: errors.length > 0 ? errors : undefined,  
          stats  
      };  
  } catch (error) {  
      console.error('Restore failed:', error);  
      throw new Error('Failed to restore data');  
  }  
}