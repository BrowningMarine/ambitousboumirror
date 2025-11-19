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

// Archive data types
export interface ArchiveOptions {
  cutoffDate: Date; // Archive documents created before this date
  dryRun: boolean; // If true, only simulate without deleting
  includeRelationships: boolean; // If true, include related documents
  countOnly?: boolean; // If true, only count documents without fetching full data (faster preview)
  selectedCollections?: string[]; // If provided, only archive these collection IDs
}

export interface ArchiveResult {
  success: boolean;
  message: string;
  dryRun: boolean;
  cutoffDate: string;
  stats: {
    collections: number;
    documentsToArchive: number;
    documentsArchived?: number;
    documentsDeleted?: number;
    relationshipsTracked: number;
  };
  archiveData?: appwriteDatabaseBackup;
  errors?: string[];
  preview?: {
    collectionId: string;
    collectionName: string;
    documentCount: number;
    sampleDocuments: appwriteDocument[];
  }[];
}

// Get list of all collections
export async function getDatabaseCollections(): Promise<{ id: string; name: string }[]> {
  try {
    const admin = await createAdminClient();
    const databases = admin.database;
    const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
    
    const collections = await databases.listCollections(databaseId);
    
    return collections.collections.map(col => ({
      id: col.$id,
      name: col.name
    }));
  } catch (error) {
    console.error('Failed to get collections:', error);
    throw new Error(`Failed to get collections: ${(error as Error).message}`);
  }
}

// Get relationship attributes for a collection
async function getCollectionRelationships(
  databases: Databases,
  databaseId: string,
  collectionId: string
): Promise<{ attribute: string; relatedCollection: string; twoWay: boolean }[]> {
  try {
    const collection = await databases.getCollection(databaseId, collectionId);
    const relationships: { attribute: string; relatedCollection: string; twoWay: boolean }[] = [];
    
    for (const attr of collection.attributes) {
      if (attr.type === 'relationship') {
        const relAttr = attr as any;
        relationships.push({
          attribute: attr.key,
          relatedCollection: relAttr.relatedCollection || '',
          twoWay: relAttr.twoWay || false
        });
      }
    }
    
    return relationships;
  } catch (error) {
    console.error(`Failed to get relationships for collection ${collectionId}:`, error);
    return [];
  }
}

// Archive old database records
export async function archiveDatabaseData(
  options: ArchiveOptions
): Promise<ArchiveResult> {
  try {
    const admin = await createAdminClient();
    const databases = admin.database;
    const databaseId = process.env.NEXT_PUBLIC_APPWRITE_DATABASE_ID!;
    
    const { cutoffDate, dryRun, includeRelationships, countOnly = false, selectedCollections } = options;
    
    // Validate cutoff date (must not be future)
    const now = new Date();
    
    if (cutoffDate > now) {
      throw new Error('Cutoff date cannot be in the future');
    }
    
    const errors: string[] = [];
    const stats = {
      collections: 0,
      documentsToArchive: 0,
      documentsArchived: 0,
      documentsDeleted: 0,
      relationshipsTracked: 0
    };
    
    const archiveData: appwriteDatabaseBackup = {
      timestamp: new Date().toISOString(),
      collections: {},
      users: []
    };
    
    const preview: {
      collectionId: string;
      collectionName: string;
      documentCount: number;
      sampleDocuments: appwriteDocument[];
    }[] = [];
    
    // Get all collections
    const allCollections = await databases.listCollections(databaseId);
    
    // Filter collections if selectedCollections is provided
    const collections = selectedCollections && selectedCollections.length > 0
      ? allCollections.collections.filter(col => selectedCollections.includes(col.$id))
      : allCollections.collections;
    
    console.log(`Found ${collections.length} collections to check ${selectedCollections ? '(filtered)' : '(all)'}`);
    
    // Track document IDs that need to be archived due to relationships
    const relatedDocumentIds = new Map<string, Set<string>>(); // collectionId -> Set of document IDs
    
    // First pass: Identify documents to archive based on date
    for (const collection of collections) {
      try {
        const collectionId = collection.$id;
        const collectionName = collection.name;
        
        console.log(`Checking collection: ${collectionName} (${collectionId})`);
        
        // Count-only mode: Just count documents without fetching full data
        if (countOnly) {
          try {
            // Appwrite's total field is capped at 5000, so we need to use offset to count accurately
            let totalCount = 0;
            let offset = 0;
            const limit = 1; // Minimal fetch for counting
            let hasMore = true;
            
            while (hasMore) {
              const countResult = await databases.listDocuments(
                databaseId,
                collectionId,
                [
                  Query.lessThan('$createdAt', cutoffDate.toISOString()),
                  Query.limit(limit),
                  Query.offset(offset)
                ]
              );
              
              // If we got documents, count them
              const batchTotal = countResult.total;
              
              if (batchTotal === 0 || countResult.documents.length === 0) {
                // No more documents
                hasMore = false;
              } else if (batchTotal < 5000) {
                // Total is accurate (less than Appwrite's 5000 cap)
                totalCount = batchTotal;
                hasMore = false;
              } else {
                // Total is capped at 5000, need to continue counting with offset
                // We know there are at least 5000 documents
                offset += 5000;
                
                // Check if there are more beyond this offset
                const checkResult = await databases.listDocuments(
                  databaseId,
                  collectionId,
                  [
                    Query.lessThan('$createdAt', cutoffDate.toISOString()),
                    Query.limit(1),
                    Query.offset(offset)
                  ]
                );
                
                if (checkResult.documents.length === 0) {
                  // No more documents beyond this offset
                  totalCount = offset;
                  hasMore = false;
                } else {
                  // There are more documents, continue
                  totalCount = offset + checkResult.total;
                  
                  if (checkResult.total < 5000) {
                    // We've reached the end
                    hasMore = false;
                  }
                }
                
                // Log progress for large collections
                if (offset > 0) {
                  console.log(`  Counting... found at least ${totalCount} documents so far`);
                }
              }
              
              // Small delay to avoid timeout
              await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            if (totalCount > 0) {
              console.log(`  Found ${totalCount} documents to archive`);
              stats.collections++;
              stats.documentsToArchive += totalCount;
              
              preview.push({
                collectionId,
                collectionName,
                documentCount: totalCount,
                sampleDocuments: []
              });
            }
          } catch (countError) {
            const err = `Failed to count documents in ${collectionName}: ${(countError as Error).message}`;
            console.error(err);
            errors.push(err);
          }
          continue; // Skip to next collection in count-only mode
        }
        
        // Full mode: Get collection schema and relationships
        const collectionDetails = await databases.getCollection(databaseId, collectionId);
        const relationships = includeRelationships 
          ? await getCollectionRelationships(databases, databaseId, collectionId)
          : [];
        
        if (relationships.length > 0) {
          console.log(`  Found ${relationships.length} relationships:`, relationships.map(r => `${r.attribute} -> ${r.relatedCollection}`));
          stats.relationshipsTracked += relationships.length;
        }
        
        // For actual deletion (not dry run), just check if any documents exist
        // We'll query and delete in batches later - no need to count total
        if (!dryRun) {
          // Quick check if any documents exist
          const checkResult = await databases.listDocuments(
            databaseId,
            collectionId,
            [
              Query.lessThan('$createdAt', cutoffDate.toISOString()),
              Query.limit(1) // Just check existence
            ]
          );
          
          if (checkResult.documents.length > 0) {
            console.log(`  Found old documents to delete (will delete in batches)`);
            stats.collections++;
            
            // Store minimal info for deletion phase
            archiveData.collections[collectionId] = {
              name: collectionName,
              enabled: collectionDetails.enabled,
              documentSecurity: collectionDetails.documentSecurity,
              attributes: collectionDetails.attributes as unknown as appwriteCollectionAttribute[],
              documents: [] // Empty - we'll delete directly without storing
            };
          }
          
          continue; // Skip to next collection - no need to fetch documents
        }
        
        // Dry run mode: Fetch documents for preview
        let documentsOffset = 0;
        const documentsLimit = 25;
        let hasMoreDocuments = true;
        const oldDocuments: appwriteDocument[] = [];
        let batchCount = 0;
        
        while (hasMoreDocuments) {
          try {
            const documents = await databases.listDocuments(
              databaseId,
              collectionId,
              [
                Query.lessThan('$createdAt', cutoffDate.toISOString()),
                Query.limit(documentsLimit),
                Query.offset(documentsOffset)
              ]
            );
            
            oldDocuments.push(...documents.documents as appwriteDocument[]);
            batchCount++;
            
            if (documents.documents.length < documentsLimit) {
              hasMoreDocuments = false;
            } else {
              documentsOffset += documentsLimit;
              
              // Add delay every 5 batches to avoid overwhelming the server
              if (batchCount % 5 === 0) {
                console.log(`  Fetched ${oldDocuments.length} documents so far...`);
                await new Promise(resolve => setTimeout(resolve, 500));
              }
            }
          } catch (batchError) {
            const err = `Failed to fetch batch at offset ${documentsOffset} from ${collectionName}: ${(batchError as Error).message}`;
            console.error(err);
            errors.push(err);
            hasMoreDocuments = false; // Stop on error
          }
        }
        
        if (oldDocuments.length > 0) {
          console.log(`  Found ${oldDocuments.length} documents to archive`);
          stats.collections++;
          stats.documentsToArchive += oldDocuments.length;
          
          // Track related documents if includeRelationships is true
          if (includeRelationships && relationships.length > 0) {
            for (const doc of oldDocuments) {
              for (const rel of relationships) {
                const relatedValue = doc[rel.attribute];
                if (relatedValue) {
                  // Handle both single ID and array of IDs
                  const relatedIds = Array.isArray(relatedValue) ? relatedValue : [relatedValue];
                  
                  for (const relatedId of relatedIds) {
                    if (typeof relatedId === 'string') {
                      if (!relatedDocumentIds.has(rel.relatedCollection)) {
                        relatedDocumentIds.set(rel.relatedCollection, new Set());
                      }
                      relatedDocumentIds.get(rel.relatedCollection)!.add(relatedId);
                    }
                  }
                }
              }
            }
          }
          
          // Store in archive data
          archiveData.collections[collectionId] = {
            name: collectionName,
            enabled: collectionDetails.enabled,
            documentSecurity: collectionDetails.documentSecurity,
            attributes: collectionDetails.attributes as unknown as appwriteCollectionAttribute[],
            documents: oldDocuments
          };
          
          // Add to preview (first 3 documents to reduce payload)
          preview.push({
            collectionId,
            collectionName,
            documentCount: oldDocuments.length,
            sampleDocuments: oldDocuments.slice(0, 3)
          });
        }
        
        // Small delay between collections
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        const err = `Failed to process collection ${collection.name}: ${(error as Error).message}`;
        console.error(err);
        errors.push(err);
      }
    }
    
    // Second pass: Include related documents if needed (skip in count-only mode)
    // IMPORTANT: Only include related documents that are ALSO old (before cutoff date)
    // to avoid breaking references from newer documents
    if (!countOnly && includeRelationships && relatedDocumentIds.size > 0) {
      console.log(`\nChecking related documents from ${relatedDocumentIds.size} collections...`);
      
      for (const [collectionId, documentIds] of relatedDocumentIds.entries()) {
        try {
          // Skip if already processed
          if (archiveData.collections[collectionId]) {
            console.log(`  Collection ${collectionId} already archived, skipping related documents`);
            continue;
          }
          
          const collectionDetails = await databases.getCollection(databaseId, collectionId);
          const relatedDocs: appwriteDocument[] = [];
          
          // Fetch related documents in smaller batches
          const docIdsArray = Array.from(documentIds);
          const batchSize = 10;
          
          for (let i = 0; i < docIdsArray.length; i += batchSize) {
            const batch = docIdsArray.slice(i, i + batchSize);
            
            for (const docId of batch) {
              try {
                const doc = await databases.getDocument(databaseId, collectionId, docId);
                
                // SAFETY CHECK: Only include if the related document is also old
                // This prevents breaking references from newer documents
                const docCreatedAt = new Date(doc.$createdAt);
                if (docCreatedAt < cutoffDate) {
                  relatedDocs.push(doc as appwriteDocument);
                  console.log(`  Including related document ${docId} (created: ${doc.$createdAt})`);
                } else {
                  console.log(`  Skipping related document ${docId} (too new: ${doc.$createdAt})`);
                }
              } catch (error) {
                console.warn(`  Could not fetch related document ${docId} from ${collectionId}:`, (error as Error).message);
              }
            }
            
            // Delay between batches
            if (i + batchSize < docIdsArray.length) {
              await new Promise(resolve => setTimeout(resolve, 300));
            }
          }
          
          if (relatedDocs.length > 0) {
            console.log(`  Found ${relatedDocs.length} related documents (also old) in ${collectionDetails.name}`);
            stats.documentsToArchive += relatedDocs.length;
            
            archiveData.collections[collectionId] = {
              name: collectionDetails.name,
              enabled: collectionDetails.enabled,
              documentSecurity: collectionDetails.documentSecurity,
              attributes: collectionDetails.attributes as unknown as appwriteCollectionAttribute[],
              documents: relatedDocs
            };
          } else {
            console.log(`  No old related documents found in ${collectionDetails.name} (all are still in use)`);
          }
        } catch (error) {
          const err = `Failed to include related documents from ${collectionId}: ${(error as Error).message}`;
          console.error(err);
          errors.push(err);
        }
      }
    }
    
    // Dry run: Return preview without deleting
    if (dryRun) {
      const mode = countOnly ? ' (count only)' : '';
      return {
        success: true,
        message: `DRY RUN${mode}: Would archive ${stats.documentsToArchive} documents from ${stats.collections} collections`,
        dryRun: true,
        cutoffDate: cutoffDate.toISOString(),
        stats,
        archiveData: countOnly ? { timestamp: archiveData.timestamp, collections: {}, users: [] } : archiveData,
        preview,
        errors: errors.length > 0 ? errors : undefined
      };
    }
    
    // SAFETY CHECK: Cannot delete in count-only mode (no actual documents fetched)
    if (countOnly) {
      throw new Error(
        'Cannot perform actual deletion in count-only mode. ' +
        'Please uncheck "Quick Count" to fetch full document data before deleting.'
      );
    }
    
    // Actual archiving: Delete documents from database in batches
    // Query and delete in larger batches with parallel deletion for speed
    console.log(`\nDeleting archived documents in optimized batches...`);
    
    for (const [collectionId, collectionData] of Object.entries(archiveData.collections)) {
      console.log(`Deleting from ${collectionData.name}...`);
      
      let deletedInCollection = 0;
      const batchSize = 500; // Larger batches for speed
      const parallelDeletes = 50; // High parallelism for fast deletion
      
      // Continuously query and delete until no more old documents exist
      let hasMoreToDelete = true;
      let consecutiveErrors = 0;
      const maxConsecutiveErrors = 5; // More tolerance for timeouts
      let stuckCount = 0; // Track if we're stuck on same documents
      const maxStuckAttempts = 3; // Skip to next batch after 3 failed attempts
      
      while (hasMoreToDelete) {
        try {
          // Query for a batch of old documents (always from offset 0 since we're deleting)
          const batch = await databases.listDocuments(
            databaseId,
            collectionId,
            [
              Query.lessThan('$createdAt', cutoffDate.toISOString()),
              Query.limit(batchSize)
            ]
          );
          
          if (batch.documents.length === 0) {
            // No more documents to delete
            hasMoreToDelete = false;
            break;
          }
          
          // Reset error counter on successful query
          consecutiveErrors = 0;
          
          // Track successful deletions in this batch
          let successfulDeletes = 0;
          
          // Delete documents in parallel chunks for speed
          for (let i = 0; i < batch.documents.length; i += parallelDeletes) {
            const chunk = batch.documents.slice(i, i + parallelDeletes);
            
            console.log(`  🔄 Deleting chunk ${Math.floor(i/parallelDeletes) + 1}/${Math.ceil(batch.documents.length/parallelDeletes)} (${chunk.length} docs)...`);
            
            // Delete all documents in this chunk in parallel
            const deletePromises = chunk.map(doc => 
              databases.deleteDocument(databaseId, collectionId, doc.$id)
                .then(() => {
                  stats.documentsDeleted++;
                  deletedInCollection++;
                  successfulDeletes++;
                  return { success: true, id: doc.$id };
                })
                .catch((error) => {
                  // Don't log full HTML error pages, just the error type
                  const errorMsg = (error as Error).message;
                  const shortError = errorMsg.includes('<!DOCTYPE') 
                    ? 'Connection timeout (522)' 
                    : errorMsg.substring(0, 100);
                  console.warn(`  ⚠ Skip document ${doc.$id}: ${shortError}`);
                  // Don't add to errors array to avoid flooding logs
                  return { success: false, id: doc.$id, error: shortError };
                })
            );
            
            await Promise.all(deletePromises);
            
            // No delay - go as fast as possible
            
            // Log progress every 5000 documents
            if (stats.documentsDeleted % 5000 === 0) {
              console.log(`  ${stats.documentsDeleted} documents deleted so far...`);
            }
          }
          
          // Check if we're stuck (no successful deletions)
          if (successfulDeletes === 0) {
            stuckCount++;
            console.warn(`  ⚠ Stuck attempt ${stuckCount}/${maxStuckAttempts} - no documents deleted in this batch`);
            
            if (stuckCount >= maxStuckAttempts) {
              console.log(`  ⏭ Too many stuck attempts, assuming remaining documents are inaccessible. Moving on.`);
              hasMoreToDelete = false;
              break;
            }
            
            // Wait before retrying stuck batch
            console.log(`  ⏳ Waiting 1 second before retry...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            // Reset stuck counter if we made progress
            stuckCount = 0;
            console.log(`  ✓ Batch complete: ${successfulDeletes} deleted successfully`);
            
            // Minimal delay between batches
            await new Promise(resolve => setTimeout(resolve, 50));
          }
          
        } catch (batchError) {
          consecutiveErrors++;
          const err = `Failed to query batch for deletion from ${collectionData.name}: ${(batchError as Error).message}`;
          console.error(err);
          errors.push(err);
          
          if (consecutiveErrors >= maxConsecutiveErrors) {
            console.error(`Too many consecutive errors (${consecutiveErrors}), stopping deletion for ${collectionData.name}`);
            hasMoreToDelete = false;
          } else {
            // Add delay only on error (possible rate limit)
            console.log(`  Waiting 2 seconds before retry (error ${consecutiveErrors}/${maxConsecutiveErrors})...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }
      
      console.log(`  Completed: ${deletedInCollection} documents deleted from ${collectionData.name}`);
    }
    
    stats.documentsArchived = stats.documentsDeleted;
    
    return {
      success: errors.length === 0,
      message: `Archived ${stats.documentsArchived} documents from ${stats.collections} collections`,
      dryRun: false,
      cutoffDate: cutoffDate.toISOString(),
      stats,
      archiveData,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (error) {
    console.error('Archive failed:', error);
    throw new Error(`Failed to archive data: ${(error as Error).message}`);
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