import { NextRequest, NextResponse } from "next/server";
import { fetchTransbotTransactionsSecure } from "@/lib/actions/transbot.action";
import { headers } from 'next/headers';

export async function GET(request: NextRequest) {
  try {
    const headersList = await headers();
    const authHeader = headersList.get('authorization') || '';
    const xRequestedWith = headersList.get('x-requested-with') || '';
    const contentType = headersList.get('content-type') || '';
    const userAgent = headersList.get('user-agent') || '';
    
    // Check for internal API secret (for server-to-server calls)
    const internalApiSecret = authHeader.replace('Bearer ', '');
    const isInternalApiCall = internalApiSecret && internalApiSecret === process.env.INTERNAL_API_SECRET;
    
    // For non-internal API calls, require specific headers that can only be set by JavaScript
    if (!isInternalApiCall) {
      // Check for required headers that indicate this is an AJAX request from our app
      const hasRequiredHeaders = xRequestedWith === 'XMLHttpRequest' || 
                                 contentType.includes('application/json');
      
      // Check if it's a direct browser navigation (these won't have the required headers)
      const isDirectBrowserAccess = !hasRequiredHeaders && 
                                   userAgent.includes('Mozilla') && 
                                   !xRequestedWith;
      
      if (isDirectBrowserAccess) {
        console.log('❌ Direct browser access blocked to transbot API');
        return new NextResponse(
          `<!DOCTYPE html>
<html>
<head>
    <title>Access Denied</title>
    <style>
        body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
        .error { color: #e74c3c; }
        .message { color: #7f8c8d; margin: 20px 0; }
    </style>
</head>
<body>
    <h1 class="error">Direct Access Not Allowed</h1>
    <p class="message">This API endpoint can only be accessed through the application interface.</p>
    <p>Please use the TransBot page in the application.</p>
</body>
</html>`,
          { 
            status: 403,
            headers: {
              'Content-Type': 'text/html',
            }
          }
        );
      }
      
      // Additional security: Check for a custom header that we'll set in our JavaScript
      const customAuthToken = headersList.get('x-app-token');
      if (!customAuthToken || customAuthToken !== 'transbot-secure-access') {
        console.log('❌ Missing required app token for transbot API');
        return NextResponse.json(
          {
            status: false,
            error: 'Missing required authentication token'
          },
          { status: 401 }
        );
      }
    }

    const { searchParams } = new URL(request.url);
    
    // Extract parameters from URL
    const chatId = searchParams.get("chat_id");
    const currentPage = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("limit") || "10");
    
    // Extract filters
    const filters = {
      entryType: searchParams.get("entryType") || "all",
      fromDate: searchParams.get("from_date") || "",
      toDate: searchParams.get("to_date") || "",
      orderBy: searchParams.get("order_by") || "createdAt",
      order: searchParams.get("order") || "desc",
      search: searchParams.get("search") || "",
    };

    if (!chatId) {
      return NextResponse.json(
        { 
          status: false, 
          error: "chat_id is required" 
        },
        { status: 400 }
      );
    }

    // Call the server action
    const result = await fetchTransbotTransactionsSecure({
      chatId,
      currentPage,
      pageSize,
      filters,
    });

    return NextResponse.json(result);

  } catch (error) {
    console.error("API Error:", error);
    return NextResponse.json(
      { 
        status: false, 
        error: error instanceof Error ? error.message : "Internal server error" 
      },
      { status: 500 }
    );
  }
}