/**
 * API endpoint to clear corrupted Redis keys
 * GET /api/clear-redis?orders=FDO123,FDO456
 */

import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const ordersParam = searchParams.get('orders');
    
    if (!ordersParam) {
      return NextResponse.json({
        success: false,
        message: 'Missing orders parameter. Use: /api/clear-redis?orders=FDO123,FDO456'
      }, { status: 400 });
    }

    const orders = ordersParam.split(',').map(o => o.trim());

    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      return NextResponse.json({
        success: false,
        message: 'Redis env vars not configured'
      }, { status: 500 });
    }

    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });

    const results: Record<string, {
      webhook: { deleted: boolean; value: unknown; error?: string };
      order: { deleted: boolean; value: unknown; error?: string };
      callback: { deleted: boolean; exists: boolean; error?: string };
    }> = {};

    for (const odrId of orders) {
      results[odrId] = {
        webhook: { deleted: false, value: null },
        order: { deleted: false, value: null },
        callback: { deleted: false, exists: false }
      };

      // Check and delete webhook cache
      const webhookKey = `webhook:${odrId}`;
      try {
        const webhookData = await redis.get(webhookKey);
        results[odrId].webhook.value = webhookData;
        if (webhookData) {
          await redis.del(webhookKey);
          results[odrId].webhook.deleted = true;
        }
      } catch (error) {
        results[odrId].webhook.error = String(error);
      }

      // Check and delete order state cache
      const orderKey = `fallback:order:${odrId}`;
      try {
        const orderData = await redis.get(orderKey);
        results[odrId].order.value = orderData;
        if (orderData) {
          await redis.del(orderKey);
          results[odrId].order.deleted = true;
        }
      } catch (error) {
        results[odrId].order.error = String(error);
      }

      // Check and delete callback flag
      const callbackKey = `fallback:callback:sent:${odrId}`;
      try {
        const exists = await redis.exists(callbackKey);
        results[odrId].callback.exists = exists === 1;
        if (exists) {
          await redis.del(callbackKey);
          results[odrId].callback.deleted = true;
        }
      } catch (error) {
        results[odrId].callback.error = String(error);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Processed ${orders.length} orders`,
      results
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      message: 'Failed to clear Redis keys',
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
