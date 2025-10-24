"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2, Send, AlertTriangle, Calendar } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

export default function WebhookNotificationManager() {
  const [isUpdating, setIsUpdating] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [markAsSent, setMarkAsSent] = useState(true);
  const [dateRange, setDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({
    from: undefined,
    to: undefined,
  });

  // Progress state - initialize from localStorage if available
  const [progress, setProgress] = useState(() => {
    if (typeof window !== "undefined") {
      const savedProgress = localStorage.getItem("webhookProgress");
      if (savedProgress) {
        try {
          const parsed = JSON.parse(savedProgress);
          // If there's a saved in-progress operation, restore the operation state
          if (parsed.inProgress) {
            if (parsed.operation === "update") {
              setIsUpdating(true);
            } else if (parsed.operation === "resend") {
              setIsResending(true);
            }
            // Connect to SSE to continue receiving updates
            setTimeout(() => connectToSSE(parsed.operation), 500);
          }
          return parsed;
        } catch (e: unknown) {
          console.error("Error parsing saved progress", e);
        }
      }
    }
    return {
      total: 0,
      processed: 0,
      success: 0,
      failed: 0,
      percentage: 0,
      errors: [] as string[],
      inProgress: false,
      operation: null,
    };
  });

  // Function to connect to SSE and receive updates
  const connectToSSE = (operation: "update" | "resend") => {
    const eventSource = new EventSource("/api/webhook/resend-progress");

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);

      const updatedProgress = {
        total: data.total,
        processed: data.processed,
        success: data.success,
        failed: data.failed,
        percentage:
          data.total > 0 ? Math.round((data.processed / data.total) * 100) : 0,
        errors: data.errors || [],
        inProgress: data.inProgress,
        operation,
      };

      setProgress(updatedProgress);

      // Save to localStorage
      localStorage.setItem("webhookProgress", JSON.stringify(updatedProgress));

      if (!data.inProgress) {
        eventSource.close();
        if (operation === "update") {
          setIsUpdating(false);
        } else {
          setIsResending(false);
        }

        // Use processed count if success count is 0 but processed is greater than 0
        const successCount = data.success > 0 ? data.success : data.processed;

        if (operation === "update") {
          toast.success(`Successfully updated ${successCount} transactions`);
        } else {
          const failedCount = data.failed;
          toast.success(
            `Successfully processed ${data.processed} notifications (${successCount} sent, ${failedCount} failed)`
          );
        }

        // Clear from localStorage when done
        localStorage.removeItem("webhookProgress");
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
      if (operation === "update") {
        setIsUpdating(false);
      } else {
        setIsResending(false);
      }
      // Process might still be running in the background
    };

    return eventSource;
  };

  // Function to update all notifications
  const updateAllNotifications = async () => {
    if (isUpdating || isResending) return;

    try {
      setIsUpdating(true);

      // Show initial toast
      toast.info(
        `Starting update process (Setting notifications to ${
          markAsSent ? "sent" : "unsent"
        })...`
      );

      // Format dates to ensure they cover the entire day in the local timezone
      const dateRangePayload = {
        from: dateRange.from
          ? new Date(
              Date.UTC(
                dateRange.from.getFullYear(),
                dateRange.from.getMonth(),
                dateRange.from.getDate(),
                0,
                0,
                0,
                0
              )
            ).toISOString()
          : undefined,
        to: dateRange.to
          ? new Date(
              Date.UTC(
                dateRange.to.getFullYear(),
                dateRange.to.getMonth(),
                dateRange.to.getDate(),
                23,
                59,
                59,
                999
              )
            ).toISOString()
          : undefined,
      };

      // console.log("Date range being sent:", {
      //   original: { from: dateRange.from, to: dateRange.to },
      //   payload: dateRangePayload,
      // });

      const response = await fetch("/api/webhook/update-all-notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: markAsSent,
          dateRange: dateRangePayload,
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Initialize progress in localStorage
        const initialProgress = {
          total: 0,
          processed: 0,
          success: 0,
          failed: 0,
          percentage: 0,
          errors: [],
          inProgress: true,
          operation: "update" as const,
        };
        localStorage.setItem(
          "webhookProgress",
          JSON.stringify(initialProgress)
        );
        setProgress(initialProgress);

        // Connect to SSE
        connectToSSE("update");
      } else {
        toast.error(
          `Failed to start update process: ${result.message || "Unknown error"}`
        );
        setIsUpdating(false);
      }
    } catch (error) {
      console.error("Error updating notifications:", error);
      toast.error("Error updating notification status");
      setIsUpdating(false);
    }
  };

  // Function to resend all failed notifications
  const resendAllFailedNotifications = async () => {
    if (isUpdating || isResending) return;

    try {
      setIsResending(true);

      // Show initial toast
      toast.info("Starting resend process...");

      // Initialize progress
      const initialProgress = {
        total: 0,
        processed: 0,
        success: 0,
        failed: 0,
        percentage: 0,
        errors: [],
        inProgress: true,
        operation: "resend" as const,
      };
      localStorage.setItem("webhookProgress", JSON.stringify(initialProgress));
      setProgress(initialProgress);

      // Format dates to ensure they cover the entire day in the local timezone
      const dateRangePayload = {
        from: dateRange.from
          ? new Date(
              Date.UTC(
                dateRange.from.getFullYear(),
                dateRange.from.getMonth(),
                dateRange.from.getDate(),
                0,
                0,
                0,
                0
              )
            ).toISOString()
          : undefined,
        to: dateRange.to
          ? new Date(
              Date.UTC(
                dateRange.to.getFullYear(),
                dateRange.to.getMonth(),
                dateRange.to.getDate(),
                23,
                59,
                59,
                999
              )
            ).toISOString()
          : undefined,
      };

      // console.log("Date range being sent for resend:", {
      //   original: { from: dateRange.from, to: dateRange.to },
      //   payload: dateRangePayload,
      // });

      // Start the resend process
      const response = await fetch("/api/webhook/resend-all-notifications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          dateRange: dateRangePayload,
        }),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Connect to SSE
        connectToSSE("resend");
      } else {
        toast.error(
          `Failed to start resend process: ${result.message || "Unknown error"}`
        );
        setIsResending(false);
        localStorage.removeItem("webhookProgress");
      }
    } catch (error) {
      console.error("Error resending notifications:", error);
      toast.error("Error resending notifications");
      setIsResending(false);
      localStorage.removeItem("webhookProgress");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook Notification Management</CardTitle>
        <CardDescription>
          Manage webhook notifications for all transactions
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="border-t pt-4">
          <div className="flex flex-col space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="mark-as-sent-toggle">Status to Set</Label>
                <p className="text-sm text-gray-500">
                  Choose whether to mark notifications as sent or unsent
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-500">Unsent</span>
                <Switch
                  id="mark-as-sent-toggle"
                  checked={markAsSent}
                  onCheckedChange={setMarkAsSent}
                  disabled={isUpdating || isResending}
                />
                <span className="text-sm text-gray-500">Sent</span>
              </div>
            </div>

            <div>
              <Label>Date Range (Optional)</Label>
              <p className="text-sm text-gray-500 mb-2">
                Filter transactions by date range
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full sm:w-[240px] justify-start text-left font-normal",
                        !dateRange.from && "text-muted-foreground"
                      )}
                      disabled={isUpdating || isResending}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {dateRange.from
                        ? format(dateRange.from, "PPP")
                        : "From date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      className="bg-white"
                      mode="single"
                      selected={dateRange.from}
                      onSelect={(date) =>
                        setDateRange((prev) => ({ ...prev, from: date }))
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>

                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant={"outline"}
                      className={cn(
                        "w-full sm:w-[240px] justify-start text-left font-normal",
                        !dateRange.to && "text-muted-foreground"
                      )}
                      disabled={isUpdating || isResending}
                    >
                      <Calendar className="mr-2 h-4 w-4" />
                      {dateRange.to ? format(dateRange.to, "PPP") : "To date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <CalendarComponent
                      className="bg-white"
                      mode="single"
                      selected={dateRange.to}
                      onSelect={(date) =>
                        setDateRange((prev) => ({ ...prev, to: date }))
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>

                {(dateRange.from || dateRange.to) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setDateRange({ from: undefined, to: undefined })
                    }
                    disabled={isUpdating || isResending}
                  >
                    Clear dates
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {(isUpdating || isResending) && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {isUpdating ? "Updating..." : "Resending..."}
              </span>
              <span className="text-sm">
                {progress.processed} / {progress.total} ({progress.percentage}%)
              </span>
            </div>
            <Progress value={progress.percentage} className="h-2" />
            <div className="text-sm text-gray-500 flex items-center justify-between">
              <span>Success: {progress.success}</span>
              <span>Failed: {progress.failed}</span>
            </div>

            {progress.errors.length > 0 && (
              <Alert variant="destructive" className="mt-4">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <div className="text-sm font-medium mb-1">Recent errors:</div>
                  <ul className="text-xs list-disc pl-5">
                    {progress.errors.map((error: string, i: number) => (
                      <li key={i}>{error}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter>
        <div className="flex space-x-2 w-full">
          <Button
            className="flex-1"
            variant="outline"
            onClick={updateAllNotifications}
            disabled={isUpdating || isResending}
          >
            {isUpdating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Updating...
              </>
            ) : (
              <>Mark All as {markAsSent ? "Sent" : "Unsent"}</>
            )}
          </Button>
          <Button
            className="flex-1"
            variant="default"
            onClick={resendAllFailedNotifications}
            disabled={isUpdating || isResending}
          >
            {isResending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Resending...
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Resend All Failed
              </>
            )}
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
