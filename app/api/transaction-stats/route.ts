import { NextRequest, NextResponse } from 'next/server';
import { getDetailedTransactionStats } from '@/lib/actions/transaction.actions';

// Use Node.js runtime for database operations
export const runtime = 'nodejs';

// In-memory cache for historical data (non-today dates)
const statsCache = new Map<string, {
  data: unknown;
  timestamp: number;
  expiresAt: number;
}>();

// Cache duration: 24 hours for historical data, 5 minutes for today
const HISTORICAL_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
const TODAY_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Helper function to check if a date is today
function isToday(date: Date): boolean {
  const today = new Date();
  return date.getDate() === today.getDate() &&
         date.getMonth() === today.getMonth() &&
         date.getFullYear() === today.getFullYear();
}

// Helper function to generate cache key
function generateCacheKey(fromDate?: Date, toDate?: Date): string {
  const from = fromDate ? fromDate.toISOString().split('T')[0] : 'undefined';
  const to = toDate ? toDate.toISOString().split('T')[0] : 'undefined';
  return `stats_${from}_${to}`;
}

// Clean expired cache entries
function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of statsCache.entries()) {
    if (entry.expiresAt < now) {
      statsCache.delete(key);
    }
  }
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    // Parse dates if provided
    const fromDate = dateFrom ? new Date(dateFrom) : undefined;
    const toDate = dateTo ? new Date(dateTo) : undefined;

    // Determine if this is a today query
    const isTodayQuery = !fromDate || !toDate || 
      (isToday(fromDate) && isToday(toDate));

    // Generate cache key
    const cacheKey = generateCacheKey(fromDate, toDate);

    // Clean expired cache entries periodically
    if (Math.random() < 0.1) { // 10% chance to clean on each request
      cleanExpiredCache();
    }

    // Check cache for historical data (not today)
    if (!isTodayQuery) {
      const cachedEntry = statsCache.get(cacheKey);
      if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
        console.log(`Cache hit for ${cacheKey}`);
        return NextResponse.json({ 
          success: true, 
          data: cachedEntry.data,
          cached: true,
          cacheTimestamp: cachedEntry.timestamp
        });
      }
    }

    // Fetch fresh data
    console.log(`Fetching fresh data for ${cacheKey}`);
    const result = await getDetailedTransactionStats(fromDate, toDate);

    if (result.success) {
      // Cache the result if it's historical data or today with longer cache
      const cacheDuration = isTodayQuery ? TODAY_CACHE_DURATION : HISTORICAL_CACHE_DURATION;
      const now = Date.now();
      
      statsCache.set(cacheKey, {
        data: result.data,
        timestamp: now,
        expiresAt: now + cacheDuration
      });

      return NextResponse.json({ 
        success: true, 
        data: result.data,
        cached: false,
        fetchTimestamp: now
      });
    } else {
      return NextResponse.json({ 
        success: false, 
        message: result.message 
      }, { status: 500 });
    }
  } catch (error) {
    console.error('API Error fetching transaction stats:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Internal server error' 
    }, { status: 500 });
  }
} 