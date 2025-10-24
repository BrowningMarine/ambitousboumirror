import { NextResponse } from 'next/server';
import { getAllScheduledJobs } from '@/lib/redisJobScheduler';
import { processAllExpiredTransactions } from '@/lib/actions/transaction.actions';
import { headers } from 'next/headers';


export async function POST() {
  try {
    const headersList = await headers();
    const authHeader = headersList.get('authorization') || '';
    const internalApiSecret = authHeader.replace('Bearer ', '');

    // Always require authorization
    if (!internalApiSecret || (process.env.INTERNAL_API_SECRET && internalApiSecret !== process.env.INTERNAL_API_SECRET)) {
      console.log('❌ Unauthorized access attempt to process expired transactions');
      return NextResponse.json(
        {
          success: false,
          message: 'Unauthorized: Invalid or missing API secret'
        },
        { status: 401 }
      );
    }

    // Skip Redis processing as it could cause redundant processing
    // and go straight to the database scan, which is more efficient
    console.log('🔍 Processing expired transactions directly from database scan...');
    const dbResults = await processAllExpiredTransactions(internalApiSecret);

    return NextResponse.json({
      success: dbResults.success,
      message: dbResults.message,
      processed: dbResults.processed || 0,
      failed: dbResults.failed || 0,
      details: dbResults
    });

  } catch (error) {
    console.error('❌ Error processing expired transactions:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// GET endpoint for monitoring
export async function GET() {
  try {
    const headersList = await headers();
    const authHeader = headersList.get('authorization') || '';
    const internalApiSecret = authHeader.replace('Bearer ', '');

    // Always require authorization for monitoring endpoint too
    if (!internalApiSecret || (process.env.INTERNAL_API_SECRET && internalApiSecret !== process.env.INTERNAL_API_SECRET)) {
      console.log('❌ Unauthorized access attempt to monitoring endpoint');
      return NextResponse.json(
        {
          success: false,
          message: 'Unauthorized: Invalid or missing API secret'
        },
        { status: 401 }
      );
    }

    const allJobs = await getAllScheduledJobs();
    const now = Date.now();

    const jobsWithStatus = allJobs.map(job => {
      const timeRemaining = job.scheduledFor - now;
      const isExpired = timeRemaining <= 0;

      return {
        transactionId: job.transactionId,
        odrId: job.odrId,
        createdAt: job.createdAt,
        scheduledFor: new Date(job.scheduledFor).toISOString(),
        timeRemaining: Math.max(0, timeRemaining),
        isExpired,
        status: isExpired ? 'expired' : 'waiting',
        overdue: isExpired ? Math.abs(timeRemaining) : 0
      };
    });

    const expiredJobs = jobsWithStatus.filter(job => job.isExpired);
    const waitingJobs = jobsWithStatus.filter(job => !job.isExpired);

    return NextResponse.json({
      success: true,
      totalJobs: allJobs.length,
      expiredCount: expiredJobs.length,
      waitingCount: waitingJobs.length,
      allJobs: jobsWithStatus,
      expiredJobs,
      waitingJobs
    });
  } catch (error) {
    console.error('❌ Error getting scheduled jobs:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 