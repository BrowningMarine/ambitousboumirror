import { NextResponse } from 'next/server';
import { calculateDailyStatistics } from '@/lib/actions/statistics.actions';
import { headers } from 'next/headers';

export async function POST() {
    try {
        // Get authorization header
        const headersList = await headers();
        const authHeader = headersList.get('authorization') || '';
        const internalApiSecret = authHeader.replace('Bearer ', '');
        //console.log('internalApiSecret', internalApiSecret);

        // Always require authorization
        if (!internalApiSecret || (process.env.INTERNAL_API_SECRET && internalApiSecret !== process.env.INTERNAL_API_SECRET)) {
            console.log('❌ Unauthorized access attempt');
            return NextResponse.json(
                {
                    success: false,
                    message: 'Unauthorized: Invalid or missing API secret'
                },
                { status: 401 }
            );
        }

        // Calculate statistics for today (the day that's ending)
        console.log('📊 Calculating daily statistics for today...');
        const today = new Date();
        const result = await calculateDailyStatistics(today);

        return NextResponse.json({
            success: result.success,
            message: result.message,
            data: result.data
        });

    } catch (error) {
        console.error('❌ Error calculating daily statistics:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}

export async function GET() {
    return NextResponse.json(
        {
            message: 'method not allowed'
        },
        { status: 500 }
    );
}