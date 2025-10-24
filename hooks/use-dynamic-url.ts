import { useState, useEffect } from 'react';
import { getClientBaseUrl } from '@/lib/appconfig';

/**
 * Custom hook to get the dynamic base URL for the current domain
 * @returns The base URL for the current domain
 */
export function useDynamicUrl() {
    const [baseUrl, setBaseUrl] = useState<string>('');

    useEffect(() => {
        // Get the dynamic base URL on client-side
        setBaseUrl(getClientBaseUrl());
    }, []);

    return baseUrl;
}

/**
 * Custom hook to generate dynamic URLs for specific paths
 * @param path - The path to append to the base URL
 * @returns The complete URL for the current domain
 */
export function useDynamicPath(path: string) {
    const baseUrl = useDynamicUrl();
    return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
} 