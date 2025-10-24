'use server';

// This file is marked with 'use server' to ensure it runs in the Node.js environment
// rather than the Edge environment, allowing it to use Node.js-specific APIs
import { getUserRole, parseSessionToken } from './actions/user.actions';
import { createSessionClient } from './appwrite/appwrite.actions';

// Define session info type
export interface SessionInfo {
    userId: string;
    expires: number;
}

// Function to get user information from cookie
export async function getUserInfoFromCookie(cookieValue: string) {
    if (!cookieValue) {
        return null;
    }

    try {
        return await parseSessionToken(cookieValue);
    } catch (error) {
        console.error('Error parsing session token:', error);
        return null;
    }
}

// Function to check user role
export async function checkUserRole() {
    try {
        const role = await getUserRole();
        return role || 'guest';
    } catch (error: unknown) {
        // Check if this is an authentication/authorization error from Appwrite
        const appwriteError = error as { code?: number; type?: string; message?: string };
        
        if (appwriteError?.code === 401 || 
            appwriteError?.type === 'general_unauthorized_scope' ||
            appwriteError?.message?.includes('missing scope') ||
            appwriteError?.message?.includes('User (role: guests)')) {
            // Re-throw authentication errors so middleware can handle session cleanup
            throw error;
        }
        
        console.error('Error checking user role:', error);
        return 'guest';
    }
}

// Function to refresh session - this needs to return the same interface as createSessionClient
export async function refreshSession(sessionInfo: SessionInfo) {
    try {
        const oneHour = 60 * 60 * 1000;
        const shouldRefresh = sessionInfo.expires - Date.now() < oneHour &&
            sessionInfo.expires - Date.now() > 5 * 60 * 1000;

        if (!shouldRefresh) {
            return { account: null, isAuthenticated: false };
        }

        return await createSessionClient();
    } catch (error) {
        console.warn("Failed to refresh session:", error);
        return { account: null, isAuthenticated: false };
    }
} 