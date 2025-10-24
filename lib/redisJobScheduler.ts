import { Redis } from '@upstash/redis';
import { appConfig } from './appconfig';

/**
 * Redis Job Scheduler for Transaction Expiry
 * 
 * ARCHITECTURE NOTE:
 * - Redis stores scheduled jobs primarily for MONITORING purposes (GET endpoint)
 * - Actual expiry processing uses DATABASE SCANS (more reliable)
 * - Keys auto-expire after 16 minutes via Redis TTL (automatic cleanup)
 * - Manual cancellation is OPTIONAL and rarely needed (saves Redis commands)
 * 
 * OPTIMIZATION:
 * - Schedule jobs: 2 Redis commands (SET + ZADD)
 * - Let Redis TTL handle cleanup automatically
 * - Database scan filters by odrStatus='processing' anyway
 * - Result: ~50% fewer Redis commands vs manual cancellation
 */

// Use your existing Redis instance
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || '',
  token: process.env.UPSTASH_REDIS_REST_TOKEN || '',
});

interface TransactionJob {
  transactionId: string;
  odrId: string;
  createdAt: string;
  scheduledFor: number; // timestamp when job should execute
}

/**
 * Schedule a transaction to expire after 15 minutes
 */
export async function scheduleTransactionExpiry(
  transactionId: string,
  odrId: string,
  createdAt: string
): Promise<void> {
  const creationTime = new Date(createdAt).getTime();
  const expiryTime = creationTime + (appConfig.paymentWindowSeconds * 1000);
  
  const job: TransactionJob = {
    transactionId,
    odrId,
    createdAt,
    scheduledFor: expiryTime
  };
  
  // Store job with expiry time as score for easy retrieval
  const jobKey = `transaction_job:${transactionId}`;
  const indexKey = `transaction_jobs_index`;
  
  // Store the job data
  await redis.set(jobKey, job, { ex: 16 * 60 }); // Expire after 16 minutes (cleanup)
  
  // Add to sorted set for time-based retrieval
  await redis.zadd(indexKey, { score: expiryTime, member: transactionId });
  
  console.log(`📅 Scheduled transaction ${odrId} to expire at ${new Date(expiryTime).toISOString()}`);
}

/**
 * Cancel a scheduled transaction expiry (OPTIONAL - for manual cleanup only)
 * 
 * NOTE: This function is rarely needed because:
 * 1. Redis keys auto-expire after 16 minutes (TTL cleanup)
 * 2. The expiry processor uses database scans and filters by odrStatus='processing'
 * 3. Calling this unnecessarily wastes Redis commands (2 per call)
 * 
 * Only use this if you need immediate cleanup for monitoring dashboards.
 */
export async function cancelTransactionExpiry(transactionId: string): Promise<void> {
  const jobKey = `transaction_job:${transactionId}`;
  const indexKey = `transaction_jobs_index`;
  
  // Remove from both storage and index
  await Promise.all([
    redis.del(jobKey),
    redis.zrem(indexKey, transactionId)
  ]);
  
  console.log(`❌ Cancelled expiry job for transaction ${transactionId}`);
}

/**
 * Get all scheduled jobs (both pending and expired) for monitoring
 */
export async function getAllScheduledJobs(): Promise<TransactionJob[]> {
  const indexKey = `transaction_jobs_index`;
  
  // Get all transaction IDs from the sorted set
  const allIds = await redis.zrange(indexKey, 0, -1);
  
  if (!allIds.length) {
    return [];
  }
  
  // Get job details for all transactions
  const jobKeys = (allIds as string[]).map(id => `transaction_job:${id}`);
  const jobs = await redis.mget<TransactionJob[]>(...jobKeys);
  
  // Filter out null results and return valid jobs
  return jobs.filter((job): job is TransactionJob => job !== null);
}