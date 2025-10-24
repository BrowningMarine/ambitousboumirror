import { useEffect, useState, useCallback } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import TransactorDashboardSkeleton from "./TransactorDashboardSkeleton";

interface UserStats {
  $id: string;
  userId: string;
  name: string;
  email: string;
  avatar?: string;
  role: string;
  pendingCount: number;
  completedTodayCount: number;
  avgProcessingTimeMinutes: number;
  recentCompletedCount: number;
  isOnline?: boolean;
}

export default function TransactorDashboard() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [totalPending, setTotalPending] = useState(0);
  const [totalCompletedToday, setTotalCompletedToday] = useState(0);
  const [teamAvgProcessingTime, setTeamAvgProcessingTime] = useState(0);

  // Fetch user statistics
  const fetchUserStats = useCallback(
    async (showRefreshEffect = false) => {
      try {
        if (showRefreshEffect) {
          setIsRefreshing(true);
        } else {
          setLoading(true);
        }

        const response = await fetch("/api/team-stats", {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          // Get detailed error information
          let errorDetails;
          try {
            errorDetails = await response.json();
          } catch {
            errorDetails = {
              message: `HTTP ${response.status}: ${response.statusText}`,
            };
          }

          console.error("API Error Details:", errorDetails);

          // Show more specific error messages
          if (response.status === 403) {
            throw new Error(
              `Access denied: ${
                errorDetails.message || "Insufficient permissions"
              }${
                errorDetails.userRole
                  ? ` (Your role: ${errorDetails.userRole})`
                  : ""
              }`
            );
          } else if (response.status === 401) {
            throw new Error("Authentication required. Please log in again.");
          } else {
            throw new Error(
              errorDetails.message || "Failed to fetch user statistics"
            );
          }
        }

        const data = await response.json();

        if (data.success) {
          setUsers(data.users || []);
          setTotalPending(data.totalPending || 0);
          setTotalCompletedToday(data.totalCompletedToday || 0);
          setTeamAvgProcessingTime(data.teamAverageProcessingTimeMinutes || 0);
        } else {
          throw new Error(data.message || "Failed to fetch user statistics");
        }
      } catch (error) {
        console.error("Error fetching user stats:", error);
        toast({
          variant: "destructive",
          description: "Failed to load user statistics",
        });
      } finally {
        if (showRefreshEffect) {
          setTimeout(() => setIsRefreshing(false), 500);
        } else {
          setLoading(false);
        }
      }
    },
    [toast]
  );

  // Initial load
  useEffect(() => {
    fetchUserStats();
  }, [fetchUserStats]);

  // Manual refresh
  const handleRefresh = useCallback(() => {
    fetchUserStats(true);
  }, [fetchUserStats]);

  // Get initials for avatar fallback
  const getInitials = (name: string) => {
    return name
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase())
      .slice(0, 2)
      .join("");
  };

  // Format processing time
  const formatProcessingTime = (minutes: number) => {
    if (minutes === 0) return "N/A";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  };

  // Get status color based on activity
  const getStatusColor = (user: UserStats) => {
    if (user.pendingCount > 0) return "bg-yellow-500";
    if (user.completedTodayCount > 0) return "bg-green-500";
    return "bg-gray-400";
  };

  if (loading) {
    return <TransactorDashboardSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* Header with stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-gray-600" />
            <h1 className="text-2xl font-bold">Team Dashboard</h1>
          </div>
          <div className="flex gap-4">
            <Badge
              variant="default"
              className="bg-yellow-50 text-yellow-700 border border-yellow-200"
            >
              {totalPending} Total Pending
            </Badge>
            <Badge
              variant="default"
              className="bg-green-50 text-green-700 border border-green-200"
            >
              {totalCompletedToday} Completed Today
            </Badge>
            <div title="Average processing time for completed transactions (last 7 days)">
              <Badge
                variant="default"
                className="bg-blue-50 text-blue-700 border border-blue-200"
              >
                {teamAvgProcessingTime}min Avg Processing
              </Badge>
            </div>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2"
        >
          <RefreshCw
            className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {/* User grid */}
      <div
        className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 transition-opacity duration-300 ${
          isRefreshing ? "opacity-60" : "opacity-100"
        }`}
      >
        {users.map((user) => (
          <Card key={user.$id} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium text-gray-600">
                  {user.role === "transassistant" ? "Assistant" : user.role}
                </CardTitle>
                <div
                  className={`w-2 h-2 rounded-full ${getStatusColor(user)}`}
                  title={
                    user.pendingCount > 0
                      ? "Has pending transactions"
                      : user.completedTodayCount > 0
                      ? "Active today"
                      : "Idle"
                  }
                />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-col items-center text-center space-y-3">
                {/* Avatar with stats overlay */}
                <div className="relative">
                  <Avatar className="w-16 h-16">
                    <AvatarImage src={user.avatar} alt={user.name} />
                    <AvatarFallback className="text-lg font-semibold">
                      {getInitials(user.name)}
                    </AvatarFallback>
                  </Avatar>

                  {/* Pending count badge */}
                  {user.pendingCount > 0 && (
                    <Badge
                      className="absolute -top-1 -right-1 h-6 w-6 rounded-full p-0 flex items-center justify-center text-xs bg-red-500 hover:bg-red-500"
                      variant="default"
                    >
                      {user.pendingCount}
                    </Badge>
                  )}

                  {/* Completed today badge */}
                  {user.completedTodayCount > 0 && user.pendingCount === 0 && (
                    <Badge
                      className="absolute -top-1 -right-1 h-6 w-6 rounded-full p-0 flex items-center justify-center text-xs bg-green-500 hover:bg-green-500"
                      variant="default"
                    >
                      {user.completedTodayCount}
                    </Badge>
                  )}
                </div>

                {/* User info */}
                <div className="space-y-1">
                  <h3 className="font-semibold text-gray-900">{user.name}</h3>
                  <p className="text-sm text-gray-500">{user.email}</p>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="text-center">
                    <div className="font-semibold text-orange-600">
                      {user.pendingCount}
                    </div>
                    <div className="text-gray-500 text-xs">Pending</div>
                  </div>
                  <div className="text-center">
                    <div className="font-semibold text-green-600">
                      {user.completedTodayCount}
                    </div>
                    <div className="text-gray-500 text-xs">Today</div>
                  </div>
                  <div
                    className="text-center"
                    title={`Average processing time: ${user.avgProcessingTimeMinutes} minutes (based on ${user.recentCompletedCount} transactions in last 7 days)`}
                  >
                    <div className="font-semibold text-blue-600">
                      {formatProcessingTime(user.avgProcessingTimeMinutes)}
                    </div>
                    <div className="text-gray-500 text-xs">Avg Time</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {users.length === 0 && (
        <div className="text-center py-12">
          <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            No users found
          </h3>
          <p className="text-gray-500">
            No team members are currently available.
          </p>
        </div>
      )}
    </div>
  );
}
