/**
 * Fallback Mode Order Status API
 * 
 * PURPOSE:
 * Allows payment pages to check order status when in fallback mode (no database).
 * Status is stored in Redis temporarily (24 hours).
 * 
 * USAGE:
 * GET /api/fallback-status/{odrId}
 * Returns: { success: true, odrStatus: 'processing' | 'completed', paidAmount, completedAt }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getOrderState } from '@/lib/cache/fallback-order-cache';

export async function GET(
  request: NextRequest,
  { params }: { params: { odrId: string } }
) {
  try {
    const { odrId } = await params;
    
    if (!odrId) {
      return NextResponse.json({
        success: false,
        message: 'Order ID is required'
      }, { status: 400 });
    }
    
    // Get order state from Redis
    const orderState = await getOrderState(odrId);
    
    if (!orderState) {
      return NextResponse.json({
        success: false,
        message: 'Order not found or expired'
      }, { status: 404 });
    }
    
    return NextResponse.json({
      success: true,
      odrId: orderState.odrId,
      odrStatus: orderState.odrStatus,
      odrType: orderState.odrType,
      amount: orderState.amount,
      paidAmount: orderState.paidAmount,
      unpaidAmount: orderState.unpaidAmount,
      createdAt: orderState.createdAt,
      completedAt: orderState.completedAt,
      lastPaymentDate: orderState.lastPaymentDate
    });
    
  } catch (error) {
    console.error('❌ [Fallback Status API] Error:', error);
    return NextResponse.json({
      success: false,
      message: 'Internal server error'
    }, { status: 500 });
  }
}
