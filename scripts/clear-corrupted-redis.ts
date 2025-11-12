/**
 * Clear corrupted Redis keys from old setex bug
 * Run with: node --env-file=.env.local scripts/clear-corrupted-redis.js
 * Or manually set env vars: set UPSTASH_REDIS_REST_URL=... && npx tsx scripts/clear-corrupted-redis.ts
 */

import { Redis } from '@upstash/redis';

async function clearCorruptedKeys() {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    console.error('❌ Redis env vars not set');
    process.exit(1);
  }

  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });

  console.log('🔍 Scanning for corrupted keys...');

  // List of known corrupted orders
  const corruptedOrders = [
    'FDO20251112CGOS478',
    'FDO20251112KU1G9WN',
  ];

  for (const odrId of corruptedOrders) {
    try {
      // Check webhook cache
      const webhookKey = `webhook:${odrId}`;
      const webhookData = await redis.get(webhookKey);
      if (webhookData === '[object Object]') {
        console.log(`🗑️  Deleting corrupted webhook key: ${webhookKey}`);
        await redis.del(webhookKey);
      } else {
        console.log(`✅ Webhook key OK: ${webhookKey}`);
      }

      // Check order state cache
      const orderKey = `fallback:order:${odrId}`;
      const orderData = await redis.get(orderKey);
      if (orderData === '[object Object]') {
        console.log(`🗑️  Deleting corrupted order key: ${orderKey}`);
        await redis.del(orderKey);
      } else {
        console.log(`✅ Order key OK: ${orderKey}`);
      }

      // Check callback flag
      const callbackKey = `fallback:callback:sent:${odrId}`;
      const exists = await redis.exists(callbackKey);
      if (exists) {
        console.log(`🗑️  Deleting callback flag: ${callbackKey}`);
        await redis.del(callbackKey);
      }
    } catch (error) {
      console.error(`❌ Error processing ${odrId}:`, error);
    }
  }

  console.log('✅ Cleanup complete!');
}

clearCorruptedKeys().catch(console.error);
