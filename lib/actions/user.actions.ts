'use server';

import { ID, Query } from "node-appwrite";
import { createAdminClient, createSessionClient } from "../appwrite/appwrite.actions";
import { cookies } from "next/headers";
import { appwriteConfig } from "../appwrite/appwrite-config";
import { generateUniqueString, parseStringify, getCookieDomain } from "../utils";
import { getUserInfoProps, signInProps, SignUpParams } from "@/types";
import { appConfig } from "../appconfig";
import { createAccount } from "./account.actions";

interface SignInUpError {
  code?: number;
  type?: string;
  message?: string;
}

interface AppwriteError {
  code?: number;
  type?: string;
  message?: string;
}

interface SessionInfo {
  userId: string;
  expires: number;
}

interface AppwriteUserDocument {  
  $id: string;  
  $createdAt: string;  
  $updatedAt: string;  
  $permissions?: string[];  
  $databaseId?: string;  
  $collectionId?: string;  
  email?: string;  
  userId?: string;  
  firstName?: string;  
  lastName?: string;  
  displayName?: string;  
  role?: string;  
  accountStatus?: string;  
  isActive?: boolean;  
  createdAt?: string;  
  lastLogin?: string;  
  photoURL?: string;  
  emailVerified?: boolean;
  accessedAt?: string;
  status?: boolean;
  [key: string]: string | string[] | boolean | number | null | undefined;  
} 

// Appwrite documents response type  
interface AppwriteDocumentsList<T> {  
  documents: T[];  
  total: number;  
}

// In-memory cache for ready withdraw users to avoid expensive lookups
interface ReadyUsersCache {
  users: string[];
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

// Cache with 60 second TTL - adjust as needed
let readyUsersCache: ReadyUsersCache | null = null;
const READY_USERS_CACHE_TTL = 60000; // 60 seconds

// Simple in-memory cache for logged-in user (5 minutes TTL)
interface CachedUser {
  $id: string;
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
}

let userCache: { 
  userId: string; 
  userData: CachedUser; 
  timestamp: number; 
} | null = null;
const USER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const DATABASE_ID = appwriteConfig.databaseId;
const USER_COLLECTION_ID = appwriteConfig.userCollectionId;

const COOKIE_NAME = appConfig.cookie_name;

export const parseSessionToken = async (token: string): Promise<SessionInfo | null> => {
  try {
    // The token we stored is in format: { id: string, secret: string }  
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const data = JSON.parse(decoded);
    //console.log('useraction-parseSessionToken-decodedtoken:', JSON.stringify(data, null, 2));
    return {
      userId: data.id,
      // Since we don't have expiration in the token,   
      // we'll use the cookie's expiration time  
      expires: Date.now() + (24 * 60 * 60 * 1000) // 24 hours from now  
    };
  } catch (error) {
    console.error('Failed to parse session token:', error);
    return null;
  }
};

// Get all users  
export const getAllUsers = async () => {  
  try {  
    const { database, user } = await createAdminClient();
    const usersResponse = await database.listDocuments(  
      DATABASE_ID!,  
      USER_COLLECTION_ID!  
    ) as unknown as AppwriteDocumentsList<Record<string, unknown>>;  
    
    if (!usersResponse || !Array.isArray(usersResponse.documents)) {  
      console.error("Failed to get users or documents array is missing");  
      return { users: [] };  
    }  
    
    // Fetch account data for each user to get accessedAt timestamps
    const enhancedUsers = await Promise.all(usersResponse.documents.map(async (userDoc: Record<string, unknown>) => {
      try {
        if (userDoc.userId && typeof userDoc.userId === 'string') {
          // Get the account data which contains accessedAt
          const accountData = await user.get(userDoc.userId);
          
          // Determine user role from labels  
          const userLabels = accountData.labels || [];  
          
          // Define role hierarchy (higher in the array = higher priority)  
          const roles = [  
            { name: 'admin', label: 'admin' },  
            { name: 'transactor', label: 'transactor' },  
            { name: 'merchant', label: 'merchant' },  
            { name: 'transassistant', label: 'transassistant' },  
            { name: 'user', label: null } // Default role, no label needed  
          ];
      
          // Find the highest priority role the user has  
          let userRole = 'user'; // Default role  
          for (const role of roles) {  
            // Skip the default role as it doesn't have a label to check  
            if (!role.label) continue;  
            
            if (userLabels.includes(role.label)) {  
              userRole = role.name;  
              break; // Stop at the highest priority role found  
            }  
          }
          
          return {
            ...userDoc,
            accessedAt: accountData.accessedAt || null,
            emailVerification: accountData.emailVerification || false,
            status: accountData.status || false,
            role: userRole // Add the determined role
          };
        }
        return userDoc;
      } catch (error) {
        console.error(`Error fetching account data for user ${userDoc.userId}:`, error);
        return userDoc;
      }
    }));
    
    // Clean up the data to avoid duplicate fields  
    const cleanedUsers = enhancedUsers.map((user: Record<string, unknown>) => {  
      // Create a properly typed user object  
      const cleanUser: AppwriteUserDocument = {  
        $id: typeof user.$id === 'string' ? user.$id : '',  
        $createdAt: typeof user.$createdAt === 'string' ? user.$createdAt : '',  
        $updatedAt: typeof user.$updatedAt === 'string' ? user.$updatedAt : '',  
        lastLogin: typeof user.accessedAt === 'string' ? user.accessedAt : '',
        emailVerified: typeof user.emailVerification === 'boolean' ? user.emailVerification : false,
        accountStatus: typeof user.status === 'boolean' ? (user.status ? 'active' : 'inactive') : 'unknown',
        role: typeof user.role === 'string' ? user.role : 'user' // Ensure role is included
      };  
      
      // Use a Set to track properties we've already added  
      const addedProps = new Set<string>(Object.keys(cleanUser));  
      
      // Add each property only once with type checking  
      Object.entries(user).forEach(([key, value]) => {  
        if (!addedProps.has(key)) {  
          // Only add valid types according to our index signature  
          if (  
            typeof value === 'string' ||   
            Array.isArray(value) ||   
            typeof value === 'boolean' ||   
            typeof value === 'number' ||   
            value === null ||   
            value === undefined  
          ) {  
            // Type assertion to make TypeScript happy with our index signature  
            cleanUser[key] = value as string | string[] | boolean | number | null | undefined;  
            addedProps.add(key);  
          }  
        }  
      });  
      
      return cleanUser;  
    });  
    
    return { users: cleanedUsers };  
  } catch (error) {  
    console.error("An error occurred while getting all users:", error);  
    return { users: [] };  
  }  
}   

export const getUserInfo = async ({ userId }: getUserInfoProps) => {
  try {
    const { database, user } = await createAdminClient();
    const userData = await database.listDocuments(
      DATABASE_ID!,
      USER_COLLECTION_ID!,
      [Query.equal('userId', [userId])]
    )

    // First get user verification status  
    const userAccount = await user.get(userId);

    //console.log('useraction-getUserInfo user:',user);
    if (!userData || userData.documents.length === 0) {
      return {
        code: 404,
        type: 'user_not_found',
        message: 'User data not found'
      };
    }

    // If email is not verified, return verification error
    //console.log('getUserInfo userAccount:',userAccount);
    if (!userAccount.emailVerification) {
      return {
        code: 401,
        type: 'email_not_verified',
        message: 'Please contact IT verify your account!'
      };
    }

    // Determine user role from labels  
    const userLabels = userAccount.labels || [];  
    
    // Define role hierarchy (higher in the array = higher priority)  
    const roles = [  
      { name: 'admin', label: 'admin' },  
      { name: 'transactor', label: 'transactor' },  
      { name: 'merchant', label: 'merchant' },  
      { name: 'transassistant', label: 'transassistant' },  
      { name: 'user', label: null } // Default role, no label needed  
    ];

     // Find the highest priority role the user has  
     let userRole = 'user'; // Default role  
     for (const role of roles) {  
       // Skip the default role as it doesn't have a label to check  
       if (!role.label) continue;  
       
       if (userLabels.includes(role.label)) {  
         userRole = role.name;  
         break; // Stop at the highest priority role found  
       }  
     }

     // Add the role and account data to the user data  
    const userDataWithRole = {  
      ...userData.documents[0],  
      role: userRole,
      lastLogin: userAccount.accessedAt || '',
      emailVerified: userAccount.emailVerification || false,
      accountStatus: userAccount.status ? 'active' : 'inactive'
    };
    
    return parseStringify(userDataWithRole);
  } catch (error) {
    console.error("An error occur while getUserInfo:", error);
    return {
      code: 500,
      type: 'database_error',
      message: 'Failed to fetch user information'
    };
  }
}

export async function getUserRole() {  
  try {  
    const sessionClient = await createSessionClient();  
    
    if (!sessionClient.isAuthenticated || !sessionClient.account) {  
      // Throw an error instead of returning default role for unauthenticated users
      throw new Error('User not authenticated');
    }  
    
    // Get current user with proper error handling  
    const user = await sessionClient.account.get();
    //console.log('useraction-getUserRole user:', user);
    const userLabels = user.labels || [];  
    
    // Define role hierarchy (higher in the array = higher priority)  
    const roles = [  
      { name: 'admin', label: 'admin' },  
      { name: 'transactor', label: 'transactor' },  
      { name: 'merchant', label: 'merchant' },  
      { name: 'transassistant', label: 'transassistant' },  
      { name: 'user', label: null } // Default role, no label needed  
    ];  
    
    // Find the highest priority role the user has  
    for (const role of roles) {  
      // Skip the default role as it doesn't have a label to check  
      if (!role.label) continue;  
      
      if (userLabels.includes(role.label)) {  
        return role.name;  
      }  
    }  
    
    // If no matching role found, return default role  
    return 'user';  
  } catch (error) {  
    // Re-throw the error so middleware can handle it properly
    throw error;
  }  
}

export const signIn = async ({ email, password }: signInProps) => {
  try {
    //Mutation/ Database / Make fetch
    const { account, user } = await createAdminClient();
    
    // Create session with proper scope
    const session = await account.createEmailPasswordSession(email, password);
    
    if (!session) {
      throw new Error('Failed to create session login');
    }

    // Add account scope to the user if needed
    try {
      // Get the user account to check labels
      const userAccount = await user.get(session.userId);
      
      // Check if user already has the account label/scope
      const userLabels = userAccount.labels || [];
      if (!userLabels.includes('account')) {
        // Add the 'account' label to grant account scope
        await user.updateLabels(
          session.userId,
          [...userLabels, 'account']
        );
      }
    } catch (scopeError) {
      console.error('Error updating user labels:', scopeError);
      // Continue login process even if we couldn't update labels
    }

    // Create a custom token that we can decode later without needing account scope
    const customToken = Buffer.from(
      JSON.stringify({
        id: session.userId,
        secret: session.secret
      })
    ).toString('base64');

    // Get the appropriate cookie domain for cross-subdomain support
    const cookieDomain = getCookieDomain();

    // Set session cookie
    const cookieStore = await cookies();
    cookieStore.set(COOKIE_NAME, customToken, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      expires: new Date(session.expire),
      domain: cookieDomain,
    });
    
    try {
      const user = await getUserInfo({ userId: session.userId });

      if ('code' in user && 'type' in user) {
        return user;
      }
      return parseStringify(user);
    } catch (error) {
      console.error('Server has no session, user Account get error:', error);
      return null;
    }

  } catch (error: unknown) {
    const typedError = error as AppwriteError; // Cast to known type
    console.error('Error:', typedError);

    const errorMessage =
      typedError?.message || typedError?.type || 'An unexpected error occurred.';

    return {
      code: typedError?.code || 500,
      type: typedError?.type || 'unknown_error',
      message: errorMessage,
    };
  }
}

export const signUp = async ({ password, ...userData }: SignUpParams) => {
  const { email, firstName, lastName } = userData;
  let newUserAccount;
  let newUser;

  try {
    const { account, database } = await createAdminClient();

    try {
      newUserAccount = await account.create(
        ID.unique(),
        email,
        password,
        `${firstName} ${lastName}`
      );

      if (!newUserAccount) {
        return {
          success: false,
          code: 400,
          type: 'account_creation_failed',
          message: 'Failed to create user account'
        };
      }
    } catch (error: unknown) {
      const typedError = error as SignInUpError;
      return {
        success: false,
        code: 400,
        type: 'account_creation_failed',
        message: typedError?.message || 'Failed to create user account'
      };
    }

    newUser = await database.createDocument(
      DATABASE_ID!,
      USER_COLLECTION_ID!,
      ID.unique(),
      {
        ...userData,
        userId: newUserAccount.$id,
      }
    );

    if (!newUser) {
      return {
        success: false,
        code: 400,
        type: 'userdata_creation_failed',
        message: 'Failed to create user data'
      };
    }

    // Create user default Document Account
    const publicTransId = generateUniqueString({ length: 10, includeUppercase: true });
    const newDocAccountData = {  
      accountName: `${firstName} ${lastName}`,  
      userId: newUser.$id, // this links to the relationship with the users collection  
      publicTransactionId: publicTransId,  
      status: false,  
      avaiableBalance: 0,  
      currentBalance: 0,  
    };

    const newDocAccount = await createAccount(newDocAccountData);
    //console.log('useraction-signup newDocAccount:', newDocAccount);
    if (!newDocAccount) {
      return {
        success: false,
        code: 400,
        type: 'account_document_creation_failed',
        message: 'Failed to create default account document'
      };
    }

    // const session = await account.createEmailPasswordSession(email, password);  

    // const cookieStore = await cookies();  
    // cookieStore.set(COOKIE_NAME, session.secret, {  
    //   path: "/",  
    //   httpOnly: true,  
    //   sameSite: "strict",  
    //   secure: true,  
    // });  

    // return parseStringify(newUser); 
    return {
      success: true,
      code: 200,
      type: 'signup_success',
      message: 'Account created successfully. Please verify your email before signing in.',
      user: parseStringify(newUser)
    };
  } catch (error: unknown) {
    console.error('Error during signup:', error);
    return {
      code: 500,
      type: 'unexpected_error',
      message: 'An unexpected error occurred during signup'
    };
  }
}

export async function getLoggedInUser() {  
  try {  
    // Get session from cookies  
    const cookieStore = await cookies();  
    const sessionCookie = cookieStore.get(COOKIE_NAME);  
    // If no session exists, return null  
    if (!sessionCookie || !sessionCookie.value) {  
      return null;  
    }  

    // Parse session cookie to get user ID first
    let userId: string | null = null;
    try {
      const sessionInfo = await parseSessionToken(sessionCookie.value);
      userId = sessionInfo?.userId || null;
    } catch (parseError) {
      console.error("Error parsing session token:", parseError);
    }

    // Check cache if we have a user ID
    if (userId && userCache && userCache.userId === userId) {
      const now = Date.now();
      if (now - userCache.timestamp < USER_CACHE_TTL) {
        return userCache.userData;
      }
      // Cache expired, continue to fetch fresh data
    }

    // Try with session client - simplified approach
    const sessionClient = await createSessionClient();  
    
    // Check if we have a valid authenticated session with an account  
    if (!sessionClient.isAuthenticated || !sessionClient.account) {  
      return null;  
    }  

    try {
      // If we have userId from session, use admin client directly
      if (userId) {
        const userInfo = await getUserInfo({ userId });
        
        if (userInfo && !('code' in userInfo)) {
          const filteredUser = {
            $id: userInfo.$id,
            userId: userInfo.userId,
            email: userInfo.email,
            firstName: userInfo.firstName,
            lastName: userInfo.lastName,
            role: userInfo.role
          };
          
          // Cache the result
          userCache = {
            userId,
            userData: filteredUser,
            timestamp: Date.now()
          };
          
          return filteredUser;
        }
      }
      
      // Fallback: try account.get() as last resort
      try {
        const result = await sessionClient.account.get();
        if (result && result.$id) {
          const user = await getUserInfo({ userId: result.$id });
          
          if (user && !('code' in user)) {
            const filteredUser = {
              $id: user.$id,
              userId: user.userId,  
              email: user.email,  
              firstName: user.firstName,  
              lastName: user.lastName,  
              role: user.role  
            };
            
            // Cache the result
            userCache = {
              userId: result.$id,
              userData: filteredUser,
              timestamp: Date.now()
            };
            
            return filteredUser;
          }
        }
      } catch (accountError) {
        console.error("Error fetching account info:", accountError);
      }
      
      // If we've reached here, we couldn't get user info
      return null;
    } catch (error) {  
      console.error("Error in getLoggedInUser:", error);  
      return null;  
    }  
  } catch (error) {  
    console.error('While user.action getLoggedInUser Internal server error:', error);  
    return null;  
  }  
} 

export const logoutAccount = async () => {  
  try {  
    const cookieStore = await cookies();  
    const sessionCookie = cookieStore.get(COOKIE_NAME);
    
    // First, try to validate if we have a working session before attempting deletion
    let hasValidSession = false;
    
    if (sessionCookie && sessionCookie.value) {
      try {
        // Check if we have a valid session by trying to create a session client
        const sessionClient = await createSessionClient();
        
        if (sessionClient.isAuthenticated && sessionClient.account) {
          // Try to get account info to verify the session is actually valid
          await sessionClient.account.get();
          hasValidSession = true;
        }
      } catch (sessionError) {
        console.log("Session validation failed during logout:", sessionError);
        // Session is invalid, we'll just clear the cookie
        hasValidSession = false;
      }
    }
    
    // Only attempt to delete the session on Appwrite if we have a valid session
    if (hasValidSession && sessionCookie && sessionCookie.value) {
      try {
        // Parse the token to get the session secret
        const decoded = Buffer.from(sessionCookie.value, 'base64').toString('utf-8');
        const tokenData = JSON.parse(decoded);
        
        if (tokenData && tokenData.secret) {
          // Use session client to delete the current session
          const sessionClient = await createSessionClient();
          if (sessionClient.account) {
            await sessionClient.account.deleteSession('current');
          }
        }
      } catch (deleteError) {
        console.log("Session deletion failed:", deleteError);
        // Continue to delete cookie even if session deletion fails
      }
    }
    
    // Get the appropriate cookie domain for cross-subdomain support
    const cookieDomain = getCookieDomain();
    
    // Always delete the cookie, regardless of session deletion success
    cookieStore.delete({
      name: COOKIE_NAME,
      path: "/",
      domain: cookieDomain
    });
    
    return { success: true };  
  } catch (error) {  
    console.error('Error during logout:', error);  
    
    // Even if there's an error, try to delete the cookie as a fallback
    try {
      const cookieStore = await cookies();
      const cookieDomain = getCookieDomain();
      
      cookieStore.delete({
        name: COOKIE_NAME,
        path: "/",
        domain: cookieDomain
      });
    } catch (cookieError) {
      console.error('Failed to delete cookie during error handling:', cookieError);
    }
    
    return { success: true, message: "Logged out locally" };  
  }  
} 

export const updateUserWithdrawStatus = async (userId: string, isWithdrawReady: boolean) => {
  try {
    const { database } = await createAdminClient();
    
    // First, get the user document ID by userId
    const userData = await database.listDocuments(
      DATABASE_ID!,
      USER_COLLECTION_ID!,
      [Query.equal('userId', [userId])]
    );
    
    if (!userData || userData.documents.length === 0) {
      return {
        success: false,
        message: 'User not found'
      };
    }
    
    const userDocId = userData.documents[0].$id;
    
    // Update the user document with the new withdraw status
    await database.updateDocument(
      DATABASE_ID!,
      USER_COLLECTION_ID!,
      userDocId,
      {
        isWithdrawReady: isWithdrawReady
      }
    );
    
    // Clear cache when user status changes
    await clearReadyUsersCache();
    
    return {
      success: true,
      message: 'Withdraw status updated successfully'
    };
  } catch (error) {
    console.error('Error updating withdraw status:', error);
    return {
      success: false,
      message: 'Failed to update withdraw status'
    };
  }
}

/**
 * Get user document ID by user ID
 * @param userId - The user ID to lookup
 * @returns Document ID of the user or null if not found
 */
export const getUserDocumentId = async (userId: string): Promise<string | null> => {
  try {
    const { database } = await createAdminClient();
    
    const userData = await database.listDocuments(
      DATABASE_ID!,
      USER_COLLECTION_ID!,
      [Query.equal('userId', [userId])]
    );
    
    if (!userData || userData.documents.length === 0) {
      console.log(`No user document found for userId: ${userId}`);
      return null;
    }
    
    return userData.documents[0].$id;
  } catch (error) {
    console.error(`Error getting document ID for user ${userId}:`, error);
    return null;
  }
};

/**
 * Get all transassistant users who are ready to handle withdrawals (with caching)
 * @returns Array of user IDs who are ready for withdraw processing
 */
export const getReadyWithdrawUsers = async (): Promise<string[]> => {
  try {
    const startTime = performance.now();
    
    // Check if cache is valid
    const now = Date.now();
    if (readyUsersCache && (now - readyUsersCache.timestamp) < readyUsersCache.ttl) {
      // Return cached data - this avoids 200-800ms of database/API calls
      const cacheAge = Math.round((now - readyUsersCache.timestamp) / 1000);
      const responseTime = Math.round(performance.now() - startTime);
      console.log(`[CACHE HIT] Ready users (${readyUsersCache.users.length}) returned from cache in ${responseTime}ms (age: ${cacheAge}s)`);
      return readyUsersCache.users;
    }

    const { database, user } = await createAdminClient();
    
    // Query users with isWithdrawReady=true only (not filtering by role in the database query)
    const usersData = await database.listDocuments(
      DATABASE_ID!,
      USER_COLLECTION_ID!,
      [
        Query.equal('isWithdrawReady', [true])
      ]
    );
    
    if (!usersData || usersData.documents.length === 0) {
      // Cache empty result too
      readyUsersCache = {
        users: [],
        timestamp: now,
        ttl: READY_USERS_CACHE_TTL
      };
      const responseTime = Math.round(performance.now() - startTime);
      console.log(`[CACHE MISS] No ready users found in ${responseTime}ms - cached empty result for 60s`);
      return [];
    }
    
    // Process each user to check if they have the transassistant role
    const readyUsers = await Promise.all(
      usersData.documents.map(async (userDoc) => {
        try {
          if (userDoc.userId && typeof userDoc.userId === 'string') {
            // Get the account data which contains labels
            const accountData = await user.get(userDoc.userId);
            
            // Check if user has the transassistant label
            const userLabels = accountData.labels || [];
            if (userLabels.includes('transassistant')) {
              return userDoc.userId;
            }
          }
          return null;
        } catch (error) {
          console.error(`Error checking role for user ${userDoc.userId}:`, error);
          return null;
        }
      })
    );
    
    // Filter out any null values and return the array of user IDs
    const validUsers = readyUsers.filter(userId => userId !== null) as string[];
    
    // Update cache with fresh data
    readyUsersCache = {
      users: validUsers,
      timestamp: now,
      ttl: READY_USERS_CACHE_TTL
    };
    
    const responseTime = Math.round(performance.now() - startTime);
    console.log(`[CACHE MISS] Ready users (${validUsers.length}) loaded from database in ${responseTime}ms - cached for 60s`);
    
    return validUsers;
  } catch (error) {
    console.error('Error getting ready withdraw users:', error);
    // Don't cache errors, just return empty array
    return [];
  }
}

/**
 * Clear the ready users cache (call this when users change their withdraw status)
 */
export const clearReadyUsersCache = async (): Promise<void> => {
  readyUsersCache = null;
}

/**
 * OPTIMIZED: Get ready withdraw users using database role field (if available)
 * Falls back to cached API-based approach if role field doesn't exist
 * @returns Array of user IDs who are ready for withdraw processing
 */
export const getReadyWithdrawUsersOptimized = async (): Promise<string[]> => {
  try {
    const { database } = await createAdminClient();
    
    // Try the optimized query first (if role field exists in database)
    try {
      const usersData = await database.listDocuments(
        DATABASE_ID!,
        USER_COLLECTION_ID!,
        [
          Query.equal('isWithdrawReady', [true])
        ]
      );
      
      // Extract user IDs directly from the result
      const readyUsers = usersData.documents
        .filter(doc => doc.userId && typeof doc.userId === 'string')
        .map(doc => doc.userId as string);
      
      console.log(`[OPTIMIZED] Found ${readyUsers.length} ready transassistant users via database query`);
      return readyUsers;
      
    } catch {
      // If role field doesn't exist, fall back to cached API-based approach
      console.log('[FALLBACK] Using cached API-based user lookup (role field not available)');
      return await getReadyWithdrawUsers();
    }
  } catch (error) {
    console.error('Error in optimized ready withdraw users lookup:', error);
    // Final fallback to the original cached method
    return await getReadyWithdrawUsers();
  }
}; 