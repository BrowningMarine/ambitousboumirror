import { NextRequest, NextResponse } from 'next/server';
import QRLocal, { QRLocalParams } from '@/lib/qr_local';

export async function POST(request: NextRequest) {
  try {
    // Verify internal API secret
    const apiSecret = request.headers.get('x-internal-api-secret');
    const expectedSecret = process.env.INTERNAL_API_SECRET;
    
    if (!apiSecret || !expectedSecret || apiSecret !== expectedSecret) {
      return NextResponse.json({
        success: false,
        message: 'Unauthorized: Invalid or missing internal API secret'
      }, { status: 401 });
    }

    const params: QRLocalParams = await request.json();

    // Validate required parameters
    if (!params.bankBin || !params.accountNumber || !params.amount) {
      return NextResponse.json({
        success: false,
        message: 'Missing required parameters: bankBin, accountNumber, or amount'
      }, { status: 400 });
    }

    // Validate bank BIN is supported
    if (!QRLocal.isSupportedBankBin(params.bankBin)) {
      return NextResponse.json({
        success: false,
        message: `Bank BIN ${params.bankBin} is not supported`
      }, { status: 400 });
    }

    // Generate QR code
    const result = await QRLocal.generateQR(params);

    if (result.success) {
      return NextResponse.json(result);
    } else {
      return NextResponse.json(result, { status: 500 });
    }

  } catch (error) {
    console.error('QR Local API error:', error);
    
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  // Verify internal API secret
  const apiSecret = request.headers.get('x-internal-api-secret');
  const expectedSecret = process.env.INTERNAL_API_SECRET;
  
  if (!apiSecret || !expectedSecret || apiSecret !== expectedSecret) {
    return NextResponse.json({
      success: false,
      message: 'Unauthorized: Invalid or missing internal API secret'
    }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  
  const bankBin = searchParams.get('bankBin');
  const accountNumber = searchParams.get('accountNumber');
  const amount = searchParams.get('amount');
  const orderId = searchParams.get('orderId');

  if (!bankBin || !accountNumber || !amount) {
    return NextResponse.json({
      success: false,
      message: 'Missing required parameters: bankBin, accountNumber, or amount'
    }, { status: 400 });
  }

  try {
    const params: QRLocalParams = {
      bankBin,
      accountNumber,
      amount: parseInt(amount),
      orderId: orderId || undefined
    };

    const result = await QRLocal.generateQR(params);
    return NextResponse.json(result);

  } catch (error) {
    console.error('QR Local GET error:', error);
    
    return NextResponse.json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error'
    }, { status: 500 });
  }
}