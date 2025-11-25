/**
 * Centralized Webhook Notification System
 * 
 * This module provides a single function to send webhook notifications
 * with support for batch/legacy modes per order type (deposit/withdraw).
 * 
 * Usage: import { sendWebhookNotifications } from '@/lib/webhook/send-notifications'
 */

import { sendWebhookNotification } from '@/utils/webhook';

/**
 * Order data interface for webhook notifications
 */
export interface WebhookOrderData {
  odrId: string;
  merchantOrdId?: string;
  orderType: 'deposit' | 'withdraw';
  odrStatus: string;
  bankReceiveNumber?: string;
  bankReceiveOwnerName?: string;
  amount: number;
  url_callback: string;
  apiKey?: string;
  transactionId?: string; // For updating notification status
}

/**
 * Webhook configuration per order type
 */
interface WebhookModeConfig {
  deposit: 'batch' | 'legacy';
  withdraw: 'batch' | 'legacy';
}

/**
 * Get webhook mode configuration from app config
 */
async function getWebhookModeConfig(): Promise<WebhookModeConfig> {
  const { loadAppConfig } = await import('@/lib/json/config-loader');
  const config = loadAppConfig();
  const webhookSettings = config.webhookSettings || {};
  
  // Support both old format (single enableCallbackBatching) and new format (per order type)
  const defaultMode = webhookSettings.enableCallbackBatching ?? true ? 'batch' : 'legacy';
  
  return {
    deposit: (webhookSettings.depositWebhookMode as 'batch' | 'legacy') || defaultMode,
    withdraw: (webhookSettings.withdrawWebhookMode as 'batch' | 'legacy') || defaultMode,
  };
}

/**
 * UNIVERSAL: Send webhook notifications for one or more orders
 * 
 * This function handles:
 * - Single order or multiple orders
 * - Batch mode (group by URL + order type, send as array)
 * - Legacy mode (send each order separately)
 * - Separate configuration for deposit and withdraw orders
 * - Automatic notification status updates
 * 
 * @param orders Single order or array of orders
 * @param source Source identifier for logging (e.g., 'webhook-payment', 'manual-resend')
 * @returns Promise with success status and details
 */
export async function sendWebhookNotifications(
  orders: WebhookOrderData | WebhookOrderData[],
  source: string = 'webhook-notification'
): Promise<{
  success: boolean;
  total: number;
  successful: number;
  failed: number;
  mode: 'batch' | 'legacy' | 'mixed';
  errors: Array<{ orderId: string; error: string }>;
}> {
  // Normalize to array
  const orderArray = Array.isArray(orders) ? orders : [orders];
  
  if (orderArray.length === 0) {
    return {
      success: true,
      total: 0,
      successful: 0,
      failed: 0,
      mode: 'batch',
      errors: [],
    };
  }

  // Get webhook mode configuration
  const modeConfig = await getWebhookModeConfig();
  
  // Separate orders by type and mode
  const depositOrders = orderArray.filter(o => o.orderType === 'deposit');
  const withdrawOrders = orderArray.filter(o => o.orderType === 'withdraw');
  
  const depositMode = modeConfig.deposit;
  const withdrawMode = modeConfig.withdraw;
  
  // Determine overall mode for response
  const isMixed = depositOrders.length > 0 && withdrawOrders.length > 0 && depositMode !== withdrawMode;
  const overallMode: 'batch' | 'legacy' | 'mixed' = isMixed ? 'mixed' : (depositOrders.length > 0 ? depositMode : withdrawMode);
  
  console.log(`📨 Sending ${orderArray.length} webhook notifications`);
  console.log(`   Deposit: ${depositOrders.length} orders (${depositMode} mode)`);
  console.log(`   Withdraw: ${withdrawOrders.length} orders (${withdrawMode} mode)`);

  const results = {
    success: true,
    total: orderArray.length,
    successful: 0,
    failed: 0,
    mode: overallMode,
    errors: [] as Array<{ orderId: string; error: string }>,
  };

  // Process deposit orders
  if (depositOrders.length > 0) {
    const depositResults = await sendOrdersByMode(depositOrders, depositMode, `${source}-deposit`);
    results.successful += depositResults.successful;
    results.failed += depositResults.failed;
    results.errors.push(...depositResults.errors);
  }

  // Process withdraw orders
  if (withdrawOrders.length > 0) {
    const withdrawResults = await sendOrdersByMode(withdrawOrders, withdrawMode, `${source}-withdraw`);
    results.successful += withdrawResults.successful;
    results.failed += withdrawResults.failed;
    results.errors.push(...withdrawResults.errors);
  }

  results.success = results.failed === 0;

  return results;
}

/**
 * Send orders using specified mode (batch or legacy)
 */
async function sendOrdersByMode(
  orders: WebhookOrderData[],
  mode: 'batch' | 'legacy',
  source: string
): Promise<{
  successful: number;
  failed: number;
  errors: Array<{ orderId: string; error: string }>;
}> {
  const results = {
    successful: 0,
    failed: 0,
    errors: [] as Array<{ orderId: string; error: string }>,
  };

  if (mode === 'batch') {
    // BATCH MODE: Group by callback URL and send as arrays
    const groupedByCallback = new Map<string, WebhookOrderData[]>();
    
    for (const order of orders) {
      const callbackUrl = order.url_callback;
      if (!groupedByCallback.has(callbackUrl)) {
        groupedByCallback.set(callbackUrl, []);
      }
      groupedByCallback.get(callbackUrl)!.push(order);
    }

    console.log(`📦 [Batch Mode - ${orders[0].orderType}] Grouped ${orders.length} orders into ${groupedByCallback.size} unique callback URLs`);

    // Send one webhook per unique callback URL (always as array)
    const webhookPromises = Array.from(groupedByCallback.entries()).map(
      async ([url, orderGroup]) => {
        try {
          // Create webhook data array (always array, even for single item)
          const webhookDataArray = orderGroup.map(order => ({
            odrId: order.odrId,
            merchantOrdId: order.merchantOrdId || '',
            orderType: order.orderType,
            odrStatus: order.odrStatus,
            bankReceiveNumber: order.bankReceiveNumber || '',
            bankReceiveOwnerName: order.bankReceiveOwnerName || '',
            amount: order.amount,
          }));

          // Get API key from first order (all should have same merchant/key)
          const apiKey = orderGroup[0].apiKey || '';

          // Send as array
          const result = await sendWebhookNotification(
            url,
            webhookDataArray,
            apiKey,
            true,
            orderGroup.length === 1 ? `${source}-batch-single` : `${source}-batch-bulk`
          );

          if (result.success) {
            // Update notification status for all orders in this batch
            for (const order of orderGroup) {
              await updateNotificationStatus(order.transactionId, order.odrId, true);
              results.successful++;
            }

            console.log(`✅ [Batch Mode] Sent webhook to ${url} with array[${orderGroup.length}] ${orders[0].orderType} orders`);
          } else {
            // All orders in this batch failed
            for (const order of orderGroup) {
              results.failed++;
              results.errors.push({
                orderId: order.odrId,
                error: result.message || 'Unknown error'
              });
            }
            console.error(`❌ [Batch Mode] Failed to send webhook to ${url}:`, result.message);
          }
        } catch (error) {
          // All orders in this batch failed
          const errorMsg = error instanceof Error ? error.message : String(error);
          for (const order of orderGroup) {
            results.failed++;
            results.errors.push({
              orderId: order.odrId,
              error: errorMsg
            });
          }
          console.error(`❌ [Batch Mode] Error sending webhook to ${url}:`, error);
        }
      }
    );

    // Wait for all webhook batches to complete
    await Promise.allSettled(webhookPromises);

  } else {
    // LEGACY MODE: Send each order separately
    console.log(`🔀 [Legacy Mode - ${orders[0].orderType}] Sending ${orders.length} webhooks separately`);

    const webhookPromises = orders.map(async (order) => {
      try {
        const webhookData = {
          odrId: order.odrId,
          merchantOrdId: order.merchantOrdId || '',
          orderType: order.orderType,
          odrStatus: order.odrStatus,
          bankReceiveNumber: order.bankReceiveNumber || '',
          bankReceiveOwnerName: order.bankReceiveOwnerName || '',
          amount: order.amount,
        };

        const apiKey = order.apiKey || '';

        const result = await sendWebhookNotification(
          order.url_callback,
          webhookData,
          apiKey,
          true,
          `${source}-legacy`
        );

        if (result.success) {
          await updateNotificationStatus(order.transactionId, order.odrId, true);
          results.successful++;
          console.log(`✅ [Legacy Mode] Sent webhook for ${order.orderType} order ${order.odrId}`);
        } else {
          results.failed++;
          results.errors.push({
            orderId: order.odrId,
            error: result.message || 'Unknown error'
          });
          console.error(`❌ [Legacy Mode] Failed webhook for ${order.odrId}:`, result.message);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        results.failed++;
        results.errors.push({
          orderId: order.odrId,
          error: errorMsg
        });
        console.error(`❌ [Legacy Mode] Error for ${order.odrId}:`, error);
      }
    });

    // Wait for all webhooks to complete
    await Promise.allSettled(webhookPromises);
  }

  return results;
}

/**
 * Update notification status in database
 */
async function updateNotificationStatus(
  transactionId: string | undefined,
  orderId: string,
  success: boolean
): Promise<void> {
  if (!transactionId) return;

  try {
    const { dbManager } = await import('@/lib/database/connection-manager');
    const { appwriteConfig } = await import('@/lib/appwrite/appwrite-config');
    
    await dbManager.updateDocument(
      appwriteConfig.databaseId,
      appwriteConfig.odrtransCollectionId,
      transactionId,
      { isSentCallbackNotification: success },
      `update-notification-status:${orderId}`
    );
  } catch (error) {
    console.error(`Error updating notification status for ${orderId}:`, error);
    // Don't throw - status update failures shouldn't block webhook processing
  }
}

/**
 * BACKWARD COMPATIBILITY: Export config getter
 */
export async function getWebhookConfig() {
  return await getWebhookModeConfig();
}
