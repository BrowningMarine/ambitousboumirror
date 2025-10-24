import { NextRequest, NextResponse } from "next/server";
import { log, logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const testId = Math.random().toString(36).substring(7);
  const timestamp = new Date().toISOString();
  
  console.log("=== BETTERSTACK LOGGING TEST STARTED ===");
  console.log("Test ID:", testId);
  console.log("Timestamp:", timestamp);
  console.log("Environment:", process.env.NODE_ENV);
  console.log("BetterStack Token exists:", !!process.env.BETTERSTACK_SOURCE_TOKEN);
  console.log("Logger instance exists:", !!logger);

  // Test 1: Basic Info Log
  console.log("\n--- Test 1: Basic Info Log ---");
  await log.info("BetterStack logging test - INFO level", {
    testId,
    testType: "basic-info",
    timestamp,
    environment: process.env.NODE_ENV
  });

  // Test 2: Warning Log
  console.log("\n--- Test 2: Warning Log ---");
  await log.warn("BetterStack logging test - WARN level", {
    testId,
    testType: "warning",
    timestamp,
    warningReason: "This is a test warning"
  });

  // Test 3: Error Log
  console.log("\n--- Test 3: Error Log ---");
  const testError = new Error("This is a test error for BetterStack");
  await log.error("BetterStack logging test - ERROR level", testError, {
    testId,
    testType: "error",
    timestamp,
    errorContext: "Testing error logging functionality"
  });

  // Test 4: Debug Log (only in non-production)
  console.log("\n--- Test 4: Debug Log ---");
  await log.debug("BetterStack logging test - DEBUG level", {
    testId,
    testType: "debug",
    timestamp,
    debugInfo: "This debug log should only appear in non-production"
  });

  // Test 5: Request Log
  console.log("\n--- Test 5: Request Log ---");
  const requestLike = {
    method: request.method,
    url: request.url,
    headers: Object.fromEntries(request.headers.entries())
  };
  await log.request(requestLike, {
    testId,
    testType: "request",
    timestamp
  });

  // Test 6: Performance Log
  console.log("\n--- Test 6: Performance Log ---");
  await log.performance("test-operation", 123.45, {
    testId,
    testType: "performance",
    timestamp
  });

  // Test 7: User Action Log
  console.log("\n--- Test 7: User Action Log ---");
  await log.userAction("test-user-123", "test-logging-endpoint", {
    testId,
    testType: "user-action",
    timestamp
  });

  // Test 8: Direct Logtail Test (if available)
  console.log("\n--- Test 8: Direct Logtail Test ---");
  if (logger) {
    try {
      await logger.info("Direct Logtail test", {
        testId,
        testType: "direct-logtail",
        timestamp,
        message: "This is sent directly to Logtail"
      });
      console.log("Direct Logtail test sent successfully");
    } catch (error) {
      console.error("Direct Logtail test failed:", error);
    }
  } else {
    console.log("Logtail logger not available - check BETTERSTACK_SOURCE_TOKEN");
  }

  // Test 9: Flush logs to ensure they're sent
  console.log("\n--- Test 9: Flushing Logs ---");
  if (logger) {
    try {
      await logger.flush();
      console.log("Logs flushed successfully");
    } catch (error) {
      console.error("Log flush failed:", error);
    }
  }

  console.log("\n=== BETTERSTACK LOGGING TEST COMPLETED ===");

  // Return comprehensive test results
  return NextResponse.json({
    success: true,
    testId,
    timestamp,
    environment: process.env.NODE_ENV,
    betterStackConfigured: !!process.env.BETTERSTACK_SOURCE_TOKEN,
    loggerInitialized: !!logger,
    testsPerformed: [
      "basic-info",
      "warning", 
      "error",
      "debug",
      "request",
      "performance",
      "user-action",
      "direct-logtail",
      "flush"
    ],
    instructions: {
      checkConsole: "Check your server console for detailed test output",
      checkBetterStack: "Check your BetterStack dashboard for logs with testId: " + testId,
      searchTip: "Search for testId in BetterStack to find all test logs",
      timeframe: "Logs should appear within 1-2 minutes"
    },
    troubleshooting: {
      noLogs: "If no logs appear in BetterStack, check BETTERSTACK_SOURCE_TOKEN environment variable",
      consoleOnly: "If you only see console logs, BetterStack token might be missing or invalid",
      partialLogs: "If only some logs appear, there might be rate limiting or network issues"
    }
  });
}

export async function POST(request: NextRequest) {
  const testId = Math.random().toString(36).substring(7);
  
  try {
    const body = await request.json();
    
    await log.info("BetterStack POST test with payload", {
      testId,
      testType: "post-request",
      payload: body,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json({
      success: true,
      testId,
      message: "POST test completed - check BetterStack for logs",
      receivedPayload: body
    });
  } catch (error) {
    await log.error("BetterStack POST test failed", 
      error instanceof Error ? error : new Error(String(error)), 
      {
        testId,
        testType: "post-error"
      });

    return NextResponse.json({
      success: false,
      testId,
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
} 