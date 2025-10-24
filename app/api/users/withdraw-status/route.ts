import { NextRequest, NextResponse } from 'next/server';
import { updateUserWithdrawStatus } from '@/lib/actions/user.actions';

export async function POST(request: NextRequest) {
  try {
    const { userId, isWithdrawReady } = await request.json();
    
    if (!userId) {
      return NextResponse.json({ success: false, message: 'User ID is required' }, { status: 400 });
    }
    
    if (typeof isWithdrawReady !== 'boolean') {
      return NextResponse.json({ success: false, message: 'isWithdrawReady must be a boolean' }, { status: 400 });
    }
    
    const result = await updateUserWithdrawStatus(userId, isWithdrawReady);
    
    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }
    
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error in withdraw status API:', error);
    return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
  }
} 