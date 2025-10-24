import { NextRequest } from "next/server";
import { getResendProgress } from "@/lib/webhook/progress";

// GET /api/webhook/resend-progress
// Server-Sent Events endpoint for progress updates
export async function GET(request: NextRequest) {
    // Set headers for SSE
    const headers = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    };

    // Create a readable stream
    const stream = new ReadableStream({
        start(controller) {
            let isClosed = false;

            // Function to safely close the controller
            const safeClose = () => {
                if (!isClosed) {
                    isClosed = true;
                    controller.close();
                }
            };

            // Send initial progress
            const progress = getResendProgress();
            const data = JSON.stringify({
                total: progress.total,
                processed: progress.processed,
                success: progress.success,
                failed: progress.failed,
                inProgress: progress.inProgress,
                errors: progress.errors.slice(-5) // Only send the last 5 errors
            });

            controller.enqueue(`data: ${data}\n\n`);

            // Set up interval to send updates
            const intervalId = setInterval(() => {
                // Only continue if the connection is still open
                if (request.signal.aborted) {
                    clearInterval(intervalId);
                    safeClose();
                    return;
                }

                // Send current progress
                const progress = getResendProgress();

                const data = JSON.stringify({
                    total: progress.total,
                    processed: progress.processed,
                    success: progress.success,
                    failed: progress.failed,
                    inProgress: progress.inProgress,
                    errors: progress.errors.slice(-5) // Only send the last 5 errors
                });

                controller.enqueue(`data: ${data}\n\n`);

                // If the process is complete and we've sent at least one update,
                // close the connection after a short delay
                if (!progress.inProgress) {
                    setTimeout(() => {
                        try {
                            // Send one final update with the latest progress
                            const finalProgress = getResendProgress();

                            const finalData = JSON.stringify({
                                total: finalProgress.total,
                                processed: finalProgress.processed,
                                success: finalProgress.processed, // Use processed count as success count
                                failed: finalProgress.failed,
                                inProgress: false,
                                errors: finalProgress.errors.slice(-5)
                            });

                            // Check if controller is not closed before enqueueing
                            if (!isClosed) {
                                controller.enqueue(`data: ${finalData}\n\n`);
                            }
                        } catch (error) {
                            console.error("Error sending final progress update:", error);
                        } finally {
                            // Now close the connection
                            clearInterval(intervalId);
                            safeClose();
                        }
                    }, 2000); // Give client 2 seconds to process the final update
                }
            }, 1000); // Send updates every second

            // Clean up on request abort
            request.signal.addEventListener('abort', () => {
                clearInterval(intervalId);
                safeClose();
            });
        }
    });

    return new Response(stream, { headers });
} 