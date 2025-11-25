import { NextResponse } from 'next/server';
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

// GET endpoint for monitoring - DEPRECATED: Redis job scheduling removed
// Transaction expiry now uses database scans exclusively
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

    // Redis job monitoring has been removed
    // Use database queries to check processing transactions instead
    return NextResponse.json({
      success: true,
      message: 'Redis job monitoring has been removed. Transaction expiry uses database scans exclusively.',
      totalJobs: 0,
      expiredCount: 0,
      waitingCount: 0,
      note: 'Query the database directly for processing transactions to monitor payment windows'
    });
  } catch (error) {
    console.error('❌ Error in monitoring endpoint:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 