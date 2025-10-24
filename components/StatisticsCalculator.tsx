"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { format } from "date-fns";
import { CalendarIcon, BarChart2, Loader2 } from "lucide-react";
import {
  calculateDailyStatistics,
  calculateStatisticsRange,
} from "@/lib/actions/statistics.actions";
import { useToast } from "@/hooks/use-toast";
import type { DateRange } from "react-day-picker";

const StatisticsCalculator = () => {
  const { toast } = useToast();
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [dateRange, setDateRange] = useState<DateRange>({
    from: undefined,
    to: undefined,
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    console.log("Date range updated:", dateRange);
  }, [dateRange]);

  // Convert local date to UTC date at 00:00:00
  const toUTCDate = (localDate: Date): Date => {
    const year = localDate.getFullYear();
    const month = localDate.getMonth();
    const day = localDate.getDate();
    return new Date(Date.UTC(year, month, day, 0, 0, 0));
  };

  const handleCalculateDaily = async () => {
    if (!date) {
      toast({
        title: "Date Required",
        description: "Please select a date to calculate statistics",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // Convert to UTC date
      const utcDate = toUTCDate(date);
      console.log("Local date:", date);
      console.log("UTC date:", utcDate);

      const result = await calculateDailyStatistics(utcDate);

      if (result.success) {
        toast({
          title: "Statistics Calculated",
          description: `Successfully calculated statistics for ${format(
            date,
            "PPP"
          )}`,
        });
      } else {
        toast({
          title: "Calculation Failed",
          description: result.message || "Failed to calculate statistics",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An error occurred while calculating statistics",
        variant: "destructive",
      });
      console.error("Statistics calculation error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCalculateRange = async () => {
    if (!dateRange.from || !dateRange.to) {
      toast({
        title: "Date Range Required",
        description: "Please select both start and end dates",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      // Convert to UTC dates
      const utcStartDate = toUTCDate(dateRange.from);
      const utcEndDate = toUTCDate(dateRange.to);

      console.log("Local date range:", dateRange.from, "to", dateRange.to);
      console.log("UTC date range:", utcStartDate, "to", utcEndDate);

      const result = await calculateStatisticsRange(utcStartDate, utcEndDate);

      if (result.success) {
        toast({
          title: "Statistics Calculated",
          description: `Successfully calculated statistics for date range ${format(
            dateRange.from,
            "PP"
          )} to ${format(dateRange.to, "PP")}`,
        });
      } else {
        toast({
          title: "Calculation Failed",
          description: result.message || "Failed to calculate statistics",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "An error occurred while calculating statistics",
        variant: "destructive",
      });
      console.error("Statistics range calculation error:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart2 className="h-5 w-5" />
          Statistics Calculator
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Single Day Statistics */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Calculate Daily Statistics</h3>
            <div className="flex flex-col sm:flex-row gap-4">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full sm:w-[240px] justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {date ? format(date, "PPP") : <span>Pick a date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    className="bg-white"
                    mode="single"
                    selected={date}
                    onSelect={setDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Button
                onClick={handleCalculateDaily}
                disabled={loading || !date}
                className="w-full sm:w-auto"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Calculating...
                  </>
                ) : (
                  "Calculate Daily Statistics"
                )}
              </Button>
            </div>
            {date && (
              <div className="text-xs text-muted-foreground">
                Selected date will be processed as:{" "}
                {format(toUTCDate(date), "yyyy-MM-dd")} UTC
              </div>
            )}
          </div>

          {/* Date Range Statistics */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">
              Calculate Date Range Statistics
            </h3>
            <div className="flex flex-col sm:flex-row gap-4">
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full sm:w-[240px] justify-start text-left font-normal"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {dateRange.from ? (
                      dateRange.to ? (
                        <>
                          {format(dateRange.from, "PP")} -{" "}
                          {format(dateRange.to, "PP")}
                        </>
                      ) : (
                        format(dateRange.from, "PP")
                      )
                    ) : (
                      <span>Pick a date range</span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    className="bg-white"
                    mode="range"
                    selected={dateRange}
                    onSelect={(range) => {
                      console.log("Calendar onSelect called with:", range);
                      if (range) {
                        setDateRange(range);
                      } else {
                        setDateRange({ from: undefined, to: undefined });
                      }
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
              <Button
                onClick={handleCalculateRange}
                disabled={loading || !dateRange.from || !dateRange.to}
                className="w-full sm:w-auto"
              >
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Calculating...
                  </>
                ) : (
                  "Calculate Range Statistics"
                )}
              </Button>
            </div>
            {dateRange.from && dateRange.to && (
              <div className="text-xs text-muted-foreground">
                Selected range will be processed as:{" "}
                {format(toUTCDate(dateRange.from), "yyyy-MM-dd")} to{" "}
                {format(toUTCDate(dateRange.to), "yyyy-MM-dd")} UTC
              </div>
            )}
          </div>

          <div className="text-sm text-muted-foreground mt-4 p-3 bg-blue-50 rounded-md">
            <p>
              <strong>Note:</strong> Dates are converted to UTC timezone
              (00:00:00) when sent to the server to ensure consistent
              calculation regardless of your local timezone.
            </p>
            <p className="mt-2">
              This will calculate statistics for the selected date(s) and store
              them in the statistics collection. The calculation includes total
              orders, amounts, completed/failed transactions, and average
              processing time.
            </p>
            <p className="mt-2 text-green-700 font-medium">
              <strong>New:</strong> Statistics are now automatically updated
              whenever transactions are created, processed via webhook, or have
              their status changed manually. This calculator can still be used
              for manual recalculation if needed.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default StatisticsCalculator;
