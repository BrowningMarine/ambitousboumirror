/* eslint-disable no-prototype-builtins */
import { type ClassValue, clsx } from "clsx";
import qs from "query-string";
import { twMerge } from "tailwind-merge";
import { z } from "zod";
import CryptoJS from 'crypto-js';
import { verifiedAccount, AccountTypes, CategoryCount, Transaction } from "@/types";
import { DatabaseQueryOptimizer } from "@/lib/database-query-optimizer";
import { appConfig } from "./appconfig";

// Interface for database account result
interface DatabaseAccount {
  $id: string;
  publicTransactionId: string;
  avaiableBalance?: number;
  status: boolean;
  referenceUserId: string;
  minDepositAmount?: number;
  maxDepositAmount?: number;
  minWithdrawAmount?: number;
  maxWithdrawAmount?: number;
  depositWhitelistIps?: string[];
  withdrawWhitelistIps?: string[];
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface DateFormatOptions {  
  dateTime?: Intl.DateTimeFormatOptions;  
  dateDay?: Intl.DateTimeFormatOptions;  
  date?: Intl.DateTimeFormatOptions;  
  time?: Intl.DateTimeFormatOptions;  
}  

export interface FormattedDateResult {  
  dateTime: string;  
  dateDay: string;  
  date: string;  
  time: string;  
}  

// Your default options  
const defaultOptions: DateFormatOptions = {  
  dateTime: {  
    year: "numeric",  
    month: "short",  
    day: "numeric",  
    hour: "2-digit",  
    minute: "2-digit",  
    second: "2-digit"  
  },  
  dateDay: {  
    year: "numeric",  
    month: "short",  
    day: "numeric",  
    weekday: "short"  
  },  
  date: {  
    year: "numeric",  
    month: "short",  
    day: "numeric"  
  },  
  time: {  
    hour: "2-digit",  
    minute: "2-digit",  
    second: "2-digit"  
  }  
};  

export interface StringGeneratorOptions {  
  length?: number;  
  includeLowercase?: boolean;  
  includeUppercase?: boolean;  
  includeNumbers?: boolean;  
  includeSpecial?: boolean;  
}

// Format date  
export function formatDate(dateString: string | null | undefined) {  
  if (!dateString) {  
    return 'N/A'; // Return a placeholder for null/undefined dates  
  }  
  
  try {  
    const date = new Date(dateString);  
    
    // Check if date is valid  
    if (isNaN(date.getTime())) {  
      console.warn(`Invalid date string: ${dateString}`);  
      return 'Invalid date';  
    }  
    
    return new Intl.DateTimeFormat('en-US', {  
      year: 'numeric',  
      month: 'short',  
      day: 'numeric'  
    }).format(date);  
  } catch (error) {  
    console.error(`Error formatting date: ${dateString}`, error);  
    return 'Error formatting date';  
  }  
}

export const formatDateTime = (  
  dateString: Date | string,  
  locale: string = "en-US",  
  useClientTimezone: boolean = true, // Changed to default to true  
  customOptions?: DateFormatOptions  
): FormattedDateResult => {  
  // Set timeZone based on parameter  
  const timeZone = useClientTimezone ? undefined : "UTC";  
  
  // Merge options with defaults  
  const options = {   
    dateTime: {   
      ...defaultOptions.dateTime,   
      timeZone,  
      hour12: false,  
      ...(customOptions?.dateTime || {})   
    },  
    dateDay: {   
      ...defaultOptions.dateDay,   
      timeZone,  
      ...(customOptions?.dateDay || {})   
    },  
    date: {   
      ...defaultOptions.date,   
      timeZone,  
      ...(customOptions?.date || {})   
    },  
    time: {   
      ...defaultOptions.time,   
      hour12: false,  
      timeZone,  
      ...(customOptions?.time || {})   
    }  
  };  

  try {  
    // Convert to Date object if it's a string  
    const dateObj = dateString instanceof Date ? dateString : new Date(dateString);  
    
    // Use Intl.DateTimeFormat directly instead of toLocaleString  
    const formattedDateTime = new Intl.DateTimeFormat(  
      locale,  
      options.dateTime  
    ).format(dateObj);  

    const formattedDateDay = new Intl.DateTimeFormat(  
      locale,  
      options.dateDay  
    ).format(dateObj);  

    const formattedDate = new Intl.DateTimeFormat(  
      locale,  
      options.date  
    ).format(dateObj);  

    const formattedTime = new Intl.DateTimeFormat(  
      locale,  
      options.time  
    ).format(dateObj);  

    return {  
      dateTime: formattedDateTime,  
      dateDay: formattedDateDay,  
      date: formattedDate,  
      time: formattedTime,  
    };  
  } catch (error) {  
    console.error(`Error formatting date for locale ${locale}:`, error);  
    // Make sure we pass all parameters in the right order for the recursive call  
    return formatDateTime(dateString, "en-US", useClientTimezone, customOptions);  
  }  
};

// export function formatAmount(amount: number): string {
//   const formatter = new Intl.NumberFormat("en-US", {
//     style: "currency",
//     currency: "USD",
//     minimumFractionDigits: 2,
//   });

//   return formatter.format(amount);
// }

export function formatAmount(amount: number): string {
  const formatter = new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    minimumFractionDigits: 0,
  });

  return formatter.format(amount);
}

//export const parseStringify = (value: any) => JSON.parse(JSON.stringify(value));
export const parseStringify = (value: unknown) => JSON.parse(JSON.stringify(value));

export const removeSpecialCharacters = (value: string) => {
  return value.replace(/[^\w\s]/gi, "");
};

interface UrlQueryParams {
  params: string;
  key: string;
  value: string;
}

export function formUrlQuery({ params, key, value }: UrlQueryParams) {
  const currentUrl = qs.parse(params);

  currentUrl[key] = value;

  return qs.stringifyUrl(
    {
      url: window.location.pathname,
      query: currentUrl,
    },
    { skipNull: true }
  );
}

export function getAccountTypeColors(type: AccountTypes) {
  switch (type) {
    case "depository":
      return {
        bg: "bg-blue-25",
        lightBg: "bg-blue-100",
        title: "text-blue-900",
        subText: "text-blue-700",
      };

    case "credit":
      return {
        bg: "bg-success-25",
        lightBg: "bg-success-100",
        title: "text-success-900",
        subText: "text-success-700",
      };

    default:
      return {
        bg: "bg-green-25",
        lightBg: "bg-green-100",
        title: "text-green-900",
        subText: "text-green-700",
      };
  }
}

export function countTransactionCategories(
  transactions: Transaction[]
): CategoryCount[] {
  const categoryCounts: { [category: string]: number } = {};
  let totalCount = 0;

  // Iterate over each transaction
  if (transactions) {  
    transactions.forEach((transaction) => {  
      const category = transaction.category;  

      if (categoryCounts.hasOwnProperty(category)) {  
        categoryCounts[category]++;  
      } else {  
        categoryCounts[category] = 1;  
      }  

      totalCount++;  
    });  
  }

  // Convert the categoryCounts object to an array of objects
  const aggregatedCategories: CategoryCount[] = Object.keys(categoryCounts).map(
    (category) => ({
      name: category,
      count: categoryCounts[category],
      totalCount,
    })
  );

  // Sort the aggregatedCategories array by count in descending order
  aggregatedCategories.sort((a, b) => b.count - a.count);

  return aggregatedCategories;
}

export function extractCustomerIdFromUrl(url: string) {
  // Split the URL string by '/'
  const parts = url.split("/");

  // Extract the last part, which represents the customer ID
  const customerId = parts[parts.length - 1];

  return customerId;
}

export function encryptId(id: string) {
  return btoa(id);
}

export function decryptId(id: string) {
  return atob(id);
}

//Zalopay
export function encryptHmacSHA256(data:string, key: string){
  return CryptoJS.HmacSHA256(data, key).toString();
}

export function verifyHmacSHA256(originalData: string, key: string, hashToVerify: string) {  
  const generatedHash = encryptHmacSHA256(originalData, key);  
  return generatedHash === hashToVerify;
}

//Galaxypay
export const hashWithSHA256 = (plainText: string) => {
  return CryptoJS.SHA256(plainText);
};

export const genDateTimeNow = () => {
  return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
};

//generate UID
// Method 1: Using crypto.randomUUID() - Recommended for unique IDs  
export function generateUID(): string {  
  return crypto.randomUUID();  
}  

// Method 2: Custom format with timestamp and random string  
export function generateCustomUID(prefix: string = ''): string {  
  const timestamp = Date.now();  
  const randomStr = Math.random().toString(36).substring(2, 8);  
  return `${prefix}${timestamp}-${randomStr}`;  
}  

// Method 3: Short random ID (good for temporary IDs)  
export function generateShortUID(length: number = 8): string {  
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';  
  let result = '';  
  const cryptoValues = new Uint32Array(length);  
  crypto.getRandomValues(cryptoValues);  
  
  for (let i = 0; i < length; i++) {  
    result += chars[cryptoValues[i] % chars.length];  
  }  
  
  return result;  
}  

// Method 4: Nanoid-like format (URL-friendly)  
export function generateNanoID(size: number = 21): string {  
  const urlAlphabet = 'useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict';  
  let id = '';  
  const cryptoValues = new Uint32Array(size);  
  crypto.getRandomValues(cryptoValues);  
  
  for (let i = 0; i < size; i++) {  
    id += urlAlphabet[cryptoValues[i] % urlAlphabet.length];  
  }  
  
  return id;  
}  

// Method 5: Sequential ID with random suffix  
let counter = 0;  
export function generateSequentialUID(): string {  
  const timestamp = Date.now();  
  const count = (counter++).toString().padStart(4, '0');  
  const random = Math.random().toString(36).substring(2, 6);  
  return `${timestamp}-${count}-${random}`;  
}
//end generate UID

export const getTransactionStatus = (date: Date) => {
  const today = new Date();
  const twoDaysAgo = new Date(today);
  twoDaysAgo.setDate(today.getDate() - 2);

  return date > twoDaysAgo ? "Processing" : "Success";
};

export const authFormSchema = (type: string) => z.object({
  // sign up
  firstName: type === 'sign-in' ? z.string().optional() : z.string().min(3),
  lastName: type === 'sign-in' ? z.string().optional() : z.string().min(3),
  // both
  email: z.string().email(),
  password: z.string().min(8),
})

export function generateUniqueString(options?: StringGeneratorOptions): string {  
  // Set default options  
  const config = {  
    length: options?.length || 5,  
    includeLowercase: options?.includeLowercase ?? true,  
    includeUppercase: options?.includeUppercase ?? false,  
    includeNumbers: options?.includeNumbers ?? true,  
    includeSpecial: options?.includeSpecial ?? false,  
  };  
  
  // Validate length  
  if (config.length < 1 || config.length > 32) {  
    throw new Error('Length must be between 1 and 32 characters');  
  }  
  
  // Prepare character sets  
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';  
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';  
  const numbers = '0123456789';  
  const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';  
  
  // Build character pool based on options  
  let characters = '';  
  if (config.includeLowercase) characters += lowercase;  
  if (config.includeUppercase) characters += uppercase;  
  if (config.includeNumbers) characters += numbers;  
  if (config.includeSpecial) characters += special;  
  
  // Ensure at least one character type is selected  
  if (characters.length === 0) {  
    characters = uppercase + numbers; // Default to original behavior  
  }  
  
  // Generate random string  
  let result = '';  
  for (let i = 0; i < config.length; i++) {  
    const randomIndex = Math.floor(Math.random() * characters.length);  
    result += characters.charAt(randomIndex);  
  }  
  
  return result;  
}



/**  
 * Verify API key and account  
 * @param apiKey The API key to verify  
 * @param publicTransactionId The public transaction ID to verify  
 * @returns The verified account or null  
 */  
export async function verifyApiKeyAndAccount(  
  apiKey: string,  
  publicTransactionId: string  
): Promise<verifiedAccount | null> {  
  try {  
    // Use optimized API key verification with caching (30-40% faster)
    const account = await DatabaseQueryOptimizer.verifyApiKeyOptimized(apiKey, publicTransactionId);

    if (!account) {  
      return null;  
    }  

    const accountData = account as DatabaseAccount; // Type assertion for database result
    return {
      $id: accountData.$id,  
      publicTransactionId: accountData.publicTransactionId,  
      avaiableBalance: accountData.avaiableBalance || 0,  
      status: accountData.status,
      referenceUserId: accountData.referenceUserId,
      minDepositAmount: accountData.minDepositAmount || 0,
      maxDepositAmount: accountData.maxDepositAmount || 0,
      minWithdrawAmount: accountData.minWithdrawAmount || 0,
      maxWithdrawAmount: accountData.maxWithdrawAmount || 0,
      depositWhitelistIps: accountData.depositWhitelistIps || [],
      withdrawWhitelistIps: accountData.withdrawWhitelistIps || [],
    };  
  } catch (error) {  
    console.error("Error verifying API key and account:", error);  
    return null;  
  }  
}


/**  
 * Calculates if a payment has expired based on its timestamp  
 * @param timestamp ISO string timestamp when the payment was created  
 * @returns Object containing seconds left and boolean indicating if expired  
 */  
export function calculatePaymentTimeRemaining(timestamp: string): {   
  secondsLeft: number;  
  isExpired: boolean;  
  formattedTime: string;  
} {  
  // If no timestamp, consider expired  
  if (!timestamp) {  
    return {   
      secondsLeft: 0,   
      isExpired: true,  
      formattedTime: "00:00"  
    };  
  }  

  const createdAt = new Date(timestamp);  
  const expiresAt = new Date(createdAt.getTime() + appConfig.paymentWindowSeconds * 1000);  
  const now = new Date();  
  
  // Calculate seconds left (with a minimum of 0)  
  const secondsLeft = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000));  
  
  // Format time as MM:SS  
  const minutes = Math.floor(secondsLeft / 60);  
  const seconds = secondsLeft % 60;  
  const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;  
  
  return {  
    secondsLeft,  
    isExpired: secondsLeft === 0,  
    formattedTime  
  };  
}  

/**  
 * Determines the payment status considering both server status and expiration  
 * @param serverStatus The status returned from the server (processing, completed, failed, etc)  
 * @param timestamp ISO string timestamp when the payment was created  
 * @returns The effective status accounting for time expiration  
 */  
export function getEffectivePaymentStatus(serverStatus: string, timestamp: string): string {  
  // If payment is already completed or failed, respect the server status  
  if (serverStatus !== 'processing' && serverStatus !== 'pending') {  
    return serverStatus;  
  }  
  
  // For processing payments, check if they've expired  
  const { isExpired } = calculatePaymentTimeRemaining(timestamp);  
  
  // If processing but expired, return 'expired'  
  if (isExpired) {  
    return 'expired';  
  }  
  
  // Otherwise return the original status  
  return serverStatus;  
}  

/**
 * Extracts the appropriate domain for cookies from the site URL or current request
 * For subdomain sharing, returns the root domain with a leading dot (e.g., ".example.com")
 */
export function getCookieDomain(currentHost?: string): string | undefined {
  // Use current host if provided, otherwise fall back to environment variable
  const siteUrl = currentHost ? `https://${currentHost}` : process.env.NEXT_PUBLIC_SITE_URL;
  
  if (!siteUrl) {
    return undefined;
  }

  try {
    const url = new URL(siteUrl);
    const hostname = url.hostname;
    
    // Check if hostname is an IP address
    const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
    
    if (!isIpAddress && hostname !== 'localhost') {
      // Extract root domain for subdomains to share cookies
      // This turns "app.example.com" into ".example.com"
      const parts = hostname.split('.');
      if (parts.length > 1) {
        // For domains like example.com or subdomain.example.com
        const rootDomain = `.${parts.slice(-2).join('.')}`;
        return rootDomain;
      } else {
        // For single-part domains
        return hostname;
      }
    }
  } catch (error) {
    console.error('Error parsing site URL:', error);
  }
  
  return undefined;
}

/**
 * Get current domain from window object (client-side only)
 * @returns Current domain or null if not available
 */
export function getCurrentDomain(): string | null {
  if (typeof window !== 'undefined') {
    return window.location.host;
  }
  return null;
}

// Function to extract valid order ID from description - copied from webhook handler
export function extractOrderIdFromPaymentDescription(description: string): string | null {
  if (!description) return null;

  const orderPrefix = appConfig.odrPrefix;
  
  // Escape special regex characters in the prefix
  const escapedPrefix = orderPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\__CODE_BLOCK_0__');

  // First, look for the specific pattern orderPrefix + 8 digits + 7 alphanumeric characters
  const orderIdPattern = new RegExp(`${escapedPrefix}\\d{8}[A-Z0-9]{7}`);
  const match = description.match(orderIdPattern);

  if (match) {
    return match[0];
  }

  // Second, try to find orderPrefix followed by any characters
  const prefixPattern = new RegExp(`${escapedPrefix}[A-Z0-9\\-]+`);
  const prefixMatch = description.match(prefixPattern);

  if (prefixMatch) {
    // Clean up the result - remove any trailing non-alphanumeric characters
    const cleanedId = prefixMatch[0].split(/[-\s]/)[0];
    return cleanedId;
  }

  // Third, check if there's a reference code that might be an order ID
  if (description.includes(orderPrefix)) {
    // Extract text after orderPrefix up to a space or delimiter
    const parts = description.split(orderPrefix);
    if (parts.length > 1) {
      const potentialId = orderPrefix + parts[1].trim().split(/[\s\-]/)[0];
      return potentialId;
    }
  }

  // Last resort - just check if the first word looks like an order reference
  const words = description.split(/\s+/);
  for (const word of words) {
    // Look for a word that's at least 10 characters (likely to be an ID)
    if (word.length >= 10 && /^[A-Z0-9\-]+$/.test(word)) {
      return word;
    }
  }

  return null;
}

/**
 * Converts a date string in YYYY-MM-DD format to UTC Date
 * for database queries
 */
export function fromLocalDateString(dateString: string): Date {
  // For YYYY-MM-DD format, create UTC date at midnight
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = dateString.split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }
  return new Date(dateString);
}

/**
 * Sets UTC time to start of day (00:00:00.000)
 */
export function setStartOfDay(date: Date): Date {
  const newDate = new Date(date);
  newDate.setUTCHours(0, 0, 0, 0);
  return newDate;
}

/**
 * Sets UTC time to end of day (23:59:59.999)
 */
export function setEndOfDay(date: Date): Date {
  const newDate = new Date(date);
  newDate.setUTCHours(23, 59, 59, 999);
  return newDate;
}

/**
 * Converts a Date object to YYYY-MM-DD format
 * Used only for filter inputs
 */
export function toLocalDateString(date: Date | undefined): string | undefined {
  if (!date) return undefined;
  return date.toISOString().split('T')[0];
}

/**
 * Convert local date to UTC start time
 * For example: 
 * If user in Asia/Bangkok (UTC+7) selects July 5th
 * 00:00:00 July 5th Bangkok = 17:00:00 July 4th UTC
 */
export function getStartOfDayUTC(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  
  // Create UTC date first
  const utcDate = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  
  // Subtract 7 hours to get the equivalent UTC time for Bangkok midnight
  utcDate.setUTCHours(utcDate.getUTCHours() - 7);
  
  return utcDate.toISOString();
}

/**
 * Convert local date to UTC end time
 * For example:
 * If user in Asia/Bangkok (UTC+7) selects July 5th
 * 23:59:59 July 5th Bangkok = 16:59:59 July 5th UTC
 */
export function getEndOfDayUTC(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  
  // Create UTC date first
  const utcDate = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
  
  // Subtract 7 hours to get the equivalent UTC time for Bangkok end of day
  utcDate.setUTCHours(utcDate.getUTCHours() - 7);
  
  return utcDate.toISOString();
}