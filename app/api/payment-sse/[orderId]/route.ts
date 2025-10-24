import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-Sent Events (SSE) endpoint for real-time payment status updates
 * This allows you to manually trigger status updates that affect ALL connected clients
 * 
 * USAGE:
 * 1. Clients connect via: GET /api/payment-sse/[orderId]
 * 2. Trigger updates via: POST /api/payment-sse/[orderId] with { status, apiKey }
 */

// Store active connections per order ID
const connections = new Map<string, Set<ReadableStreamDefaultController>>();

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET: Subscribe to status updates for a specific order
 * Clients call this to receive real-time updates
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  const { orderId } = await params;

  // Create a new ReadableStream for SSE
  const stream = new ReadableStream({
    start(controller) {
      // Add this connection to the connections map
      if (!connections.has(orderId)) {
        connections.set(orderId, new Set());
      }
      connections.get(orderId)!.add(controller);

      console.log(`🔔 [SSE] Client connected to order: ${orderId}. Total: ${connections.get(orderId)!.size}`);

      // Send initial connection message
      const data = JSON.stringify({ 
        type: 'connected',
        orderId,
        timestamp: new Date().toISOString()
      });
      controller.enqueue(`data: ${data}\n\n`);

      // Setup heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(`: heartbeat\n\n`);
        } catch {
          console.log(`💔 [SSE] Heartbeat failed for order ${orderId}`);
          clearInterval(heartbeat);
        }
      }, 30000); // Every 30 seconds

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        console.log(`🔕 [SSE] Client disconnected from order: ${orderId}`);
        clearInterval(heartbeat);
        const orderConnections = connections.get(orderId);
        if (orderConnections) {
          orderConnections.delete(controller);
          if (orderConnections.size === 0) {
            connections.delete(orderId);
            console.log(`🧹 [SSE] Cleaned up order: ${orderId}`);
          }
        }
        try {
          controller.close();
        } catch {
          // Controller already closed
        }
      });
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable buffering in nginx
    },
  });
}

/**
 * POST: Trigger a status update (broadcasts to ALL connected clients)
 * 
 * Body: {
 *   status: 'completed' | 'failed' | 'canceled' | 'processing' | 'pending',
 *   apiKey: 'your-internal-api-secret',
 *   message?: 'Optional custom message'
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const { orderId } = await params;
    const body = await request.json();
    const { status, apiKey, message } = body;

    // Security: Validate API key
    const validApiKey = process.env.INTERNAL_API_SECRET;
    if (!validApiKey || apiKey !== validApiKey) {
      console.warn(`⚠️ [SSE] Invalid API key attempt for order: ${orderId}`);
      return NextResponse.json(
        { success: false, message: 'Invalid API key' },
        { status: 401 }
      );
    }

    // Validate status
    const validStatuses = ['completed', 'failed', 'canceled', 'processing', 'pending'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, message: `Invalid status. Must be: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    // Get all connections for this order
    const orderConnections = connections.get(orderId);
    
    if (!orderConnections || orderConnections.size === 0) {
      console.log(`📭 [SSE] No active connections for order: ${orderId}`);
      return NextResponse.json({
        success: true,
        message: 'Status update received, but no active viewers',
        activeConnections: 0,
        orderId,
        status
      });
    }

    // Broadcast to all connected clients
    const eventData = JSON.stringify({
      type: 'status_update',
      orderId,
      status,
      message: message || null,
      timestamp: new Date().toISOString()
    });

    let successCount = 0;
    let failCount = 0;

    orderConnections.forEach((controller) => {
      try {
        controller.enqueue(`data: ${eventData}\n\n`);
        successCount++;
      } catch (error) {
        console.error(`❌ [SSE] Failed to send to client:`, error);
        failCount++;
        orderConnections.delete(controller);
      }
    });

    console.log(`📢 [SSE] Broadcast complete for ${orderId}: ${successCount} ✅, ${failCount} ❌`);

    return NextResponse.json({
      success: true,
      message: 'Status update broadcasted to all viewers',
      activeConnections: successCount,
      failedConnections: failCount,
      orderId,
      status
    });

  } catch (error) {
    console.error('❌ [SSE] Error broadcasting:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to broadcast update' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/payment-sse/active-connections
 * Debug endpoint to see active connections
 */
export async function OPTIONS(
  request: NextRequest, // eslint-disable-line @typescript-eslint/no-unused-vars
  { params }: { params: { orderId: string } }
) {
  const { orderId } = await params;
  const orderConnections = connections.get(orderId);
  
  return NextResponse.json({
    orderId,
    activeConnections: orderConnections?.size || 0,
    totalOrders: connections.size
  });
}
