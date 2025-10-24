import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { createAdminClient } from "@/lib/appwrite/appwrite.actions";
import { ID } from "appwrite";

const DATABASE_ID = appwriteConfig.databaseId;
const TRANSACTION_LOG_COLLECTION_ID = appwriteConfig.logWebhookCollectionId;

/**  
 * Sends a webhook notification to a specified URL  
 * @param url The callback URL to send the notification to  
 * @param data The data payload to send in the webhook  
 * @param apikey Optional API key for authorization  
 * @returns A promise that resolves to an object with success status and message  
 */
export async function sendWebhookNotification(
  url: string,
  data: Record<string, unknown>,
  apikey?: string,
  writelog: boolean = true,
  sourceLog: string = 'webhook-notification'
) {
  if (!url) {
    // Log the failure
    if (writelog) {
      await logWebhookTransaction({
        success: false,
        message: "Webhook URL not provided",
        orderId: data.odrId as string || "",
        orderReference: data.merchantOrdId as string || "",
        status: data.odrStatus as string || "",
        amount: typeof data.amount === 'number' ? data.amount : 0,
        data: JSON.stringify({ error: "Webhook URL not provided" }),
        source: sourceLog
      });
    }

    return {
      success: false,
      message: "Webhook URL not provided",
      requestDetails: null,
      responseDetails: null
    };
  }

  // Prepare request headers  
  const headers = {
    "Content-Type": "application/json",
    ...(apikey && { "x-api-key": apikey }),
  };

  try {
    // VERCEL OPTIMIZATION: Use shorter timeouts and connection limits for free tier
    const controller = new AbortController();
    
    // Vercel free tier has 10s max execution time, use 6s for webhook calls
    const WEBHOOK_TIMEOUT = process.env.VERCEL ? 6000 : 12000;
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT);

    console.log(`Sending webhook notification to ${url} for order ${data.odrId || 'unknown'}`);

    // OPTIMIZATION: Add connection-specific timeout and improved headers
    const fetchOptions: RequestInit = {
      method: "POST",
      headers: {
        ...headers,
        'Connection': 'close', // Prevent connection reuse issues on Vercel
        'User-Agent': 'AmbitiousBoy-Webhook/1.0',
        'Accept': 'application/json, */*',
      },
      body: JSON.stringify(data),
      signal: controller.signal,
      // Add keep-alive and timeout configurations
      keepalive: false, // Disable keep-alive for better resource management
    };

    const response = await fetch(url, fetchOptions);

    // Clear the timeout immediately after success
    clearTimeout(timeoutId);

    // Capture response body  
    const responseBody = await response.text();
    let parsedResponseBody;
    try {
      // Try to parse JSON response  
      parsedResponseBody = JSON.parse(responseBody);
    } catch {
      // If not JSON, use raw text  
      parsedResponseBody = responseBody;
    }

    // Capture response headers  
    const responseHeaders = Object.fromEntries(response.headers.entries());

    // Log the result
    if (writelog) {
      await logWebhookTransaction({
        success: response.ok,
        message: response.ok
          ? `Webhook notification sent successfully (${response.status})`
          : `Failed to send webhook notification. Status: ${response.status}`,
        orderId: data.odrId as string || "",
        orderReference: data.merchantOrdId as string || "",
        status: data.odrStatus as string || "",
        amount: typeof data.amount === 'number' ? data.amount : 0,
        data: JSON.stringify({
          requestUrl: url,
          requestHeaders: headers,
          requestBody: JSON.stringify(data),
          responseStatus: response.status || 'unknown',
          responseHeaders: responseHeaders || 'unknown',
          responseBody: typeof parsedResponseBody === 'string' && parsedResponseBody.length > 100
            ? parsedResponseBody.substring(0, 100) + '...'
            : parsedResponseBody
        }),
        source: sourceLog
      });
    }

    console.log(`Webhook notification ${response.ok ? 'succeeded' : 'failed'} for order ${data.odrId || 'unknown'}: ${response.status}`);

    return {
      success: response.ok,
      message: response.ok
        ? "Webhook notification sent successfully"
        : `Failed to send webhook notification. Status: ${response.status}`,
      requestDetails: {
        url,
        method: "POST",
        headers,
        body: data
      },
      responseDetails: {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: parsedResponseBody
      }
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Webhook notification failed to ${url} for order ${data.odrId || 'unknown'}:`, error);

    // ENHANCED ERROR DETECTION: Better handling for Vercel deployment errors
    const errorCode = (error as Error & { code?: number })?.code;
    const isNetworkError =
      error instanceof TypeError && errorMessage.includes('fetch failed') ||
      error instanceof DOMException && (errorMessage.includes('aborted') || errorMessage.includes('The operation was aborted')) ||
      errorCode === 20 || // AbortError code
      errorMessage.includes('ENOTFOUND') ||
      errorMessage.includes('ECONNRESET') ||
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('timeout');

    // TIMEOUT DETECTION: Specific detection for timeout vs other abort reasons
    const isTimeoutError = 
      (error instanceof DOMException && errorMessage.includes('aborted')) ||
      errorCode === 20 ||
      errorMessage.includes('timeout');

    // RETRY MECHANISM: Implement single retry for timeout/network errors
    // IMPORTANT: Disable retry for cron jobs to prevent double-processing (cron will retry in next run)
    const shouldRetry = (isTimeoutError || isNetworkError) && 
                        !url.includes('localhost') && 
                        !url.includes('127.0.0.1') &&
                        !sourceLog.includes('retry') &&
                        !sourceLog.includes('cron-retry-no-retry'); // Prevent retry for cron jobs
    
    if (shouldRetry) {
      console.log(`Retrying webhook notification for order ${data.odrId || 'unknown'} due to ${isTimeoutError ? 'timeout' : 'network'} error`);
      
      // Wait a short moment before retry
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Recursive retry with modified sourceLog to prevent infinite retries
      return await sendWebhookNotification(url, data, apikey, writelog, `${sourceLog}-retry`);
    }

    // Enhanced error categorization for logging
    const errorCategory = isTimeoutError ? 'timeout' : (isNetworkError ? 'network' : 'unknown');
    const enhancedErrorMessage = isTimeoutError 
      ? `Webhook timeout after ${process.env.VERCEL ? '6' : '12'}s (Vercel limit: 10s)` 
      : `Error sending webhook notification: ${errorMessage}`;

    // Log the error with enhanced information
    if (writelog) {
      await logWebhookTransaction({
        success: false,
        message: enhancedErrorMessage,
        orderId: data.odrId as string || "",
        orderReference: data.merchantOrdId as string || "",
        status: data.odrStatus as string || "",
        amount: typeof data.amount === 'number' ? data.amount : 0,
        data: JSON.stringify({
          requestUrl: url,
          requestHeaders: headers,
          requestBody: JSON.stringify(data),
          error: errorMessage,
          errorCategory,
          isNetworkError,
          isTimeoutError,
          isVercelDeployment: !!process.env.VERCEL,
          retryAttempted: shouldRetry
        }),
        source: sourceLog
      });
    }

    return {
      success: false,
      message: enhancedErrorMessage,
      networkError: isNetworkError,
      timeoutError: isTimeoutError,
      errorCategory,
      retryAttempted: shouldRetry,
      requestDetails: {
        url,
        method: "POST",
        headers: headers,
        body: data,
        timeout: process.env.VERCEL ? '6s' : '12s'
      },
      responseDetails: null,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        code: errorCode,
        cause: error.cause ? String(error.cause) : undefined
      } : String(error)
    };
  }
}

/**  
 * Logs webhook transaction information to the database  
 * @param logData Object containing log information  
 */
export async function logWebhookTransaction(logData: {
  success: boolean;
  message: string;
  orderId?: string;
  orderReference?: string;
  status?: string;
  amount?: number;
  data?: string;
  source?: string;
}) {
  try {
    // Ensure we have a valid database ID and collection ID
    if (!DATABASE_ID || !TRANSACTION_LOG_COLLECTION_ID) {
      console.error('Missing database or collection ID for webhook logging');
      return;
    }

    const { database } = await createAdminClient();

    // Sanitize data to prevent errors
    const sanitizedData = typeof logData.data === 'string' ?
      (logData.data.length > 5000 ? logData.data.substring(0, 5000) + '...' : logData.data) :
      JSON.stringify(logData.data || {});

    // Create a simplified log object with max 10 attributes  
    const logEntry = {
      // Required fields  
      success: logData.success,
      type: 'webhook',
      timestamp: new Date().toISOString(),

      // Conditional fields  
      orderId: logData.orderId || '',
      orderReference: logData.orderReference || '',
      status: logData.status || 'unknown',
      amount: logData.amount || 0,
      message: logData.message && logData.message.length > 1000 ?
        logData.message.substring(0, 1000) + '...' :
        logData.message || (logData.success ? 'Success' : 'Error'),
      data: sanitizedData,
      source: logData.source || 'payment-webhook'
    };

    // Add retry logic
    let retries = 3;
    let success = false;
    let lastError = null;

    while (retries > 0 && !success) {
      try {
        await database.createDocument(
          DATABASE_ID,
          TRANSACTION_LOG_COLLECTION_ID,
          ID.unique(),
          logEntry
        );
        success = true;
      } catch (error) {
        lastError = error;
        retries--;
        if (retries > 0) {
          // Wait a bit before retrying
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }
    }

    if (!success) {
      console.error('Failed to log webhook transaction after retries:', lastError);
    }
  } catch (error) {
    console.error('Error logging webhook transaction:', error);
  }
}