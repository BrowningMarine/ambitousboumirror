import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function TransactorDashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 bg-gray-200 rounded animate-pulse" />
            <div className="h-8 w-48 bg-gray-200 rounded animate-pulse" />
          </div>
          <div className="flex gap-4">
            <Badge variant="default" className="bg-gray-100 text-gray-400 border border-gray-200">
              <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
            </Badge>
            <Badge variant="default" className="bg-gray-100 text-gray-400 border border-gray-200">
              <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
            </Badge>
          </div>
        </div>
        
        <div className="h-9 w-20 bg-gray-200 rounded animate-pulse" />
      </div>

      {/* User grid skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Card key={index} className="animate-pulse">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div className="h-4 w-16 bg-gray-200 rounded" />
                <div className="w-2 h-2 rounded-full bg-gray-200" />
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-col items-center text-center space-y-3">
                {/* Avatar skeleton */}
                <div className="relative">
                  <div className="w-16 h-16 bg-gray-200 rounded-full flex items-center justify-center">
                    <div className="w-8 h-8 bg-gray-300 rounded-full" />
                  </div>
                  
                  {/* Random badge skeleton */}
                  {index % 3 === 0 && (
                    <div className="absolute -top-1 -right-1 h-6 w-6 rounded-full bg-gray-300" />
                  )}
                </div>

                {/* User info skeleton */}
                <div className="space-y-1 w-full">
                  <div className="h-5 bg-gray-200 rounded mx-auto w-3/4" />
                  <div className="h-4 bg-gray-200 rounded mx-auto w-5/6" />
                </div>

                {/* Stats skeleton */}
                <div className="flex gap-4 text-sm w-full">
                  <div className="text-center flex-1">
                    <div className="h-5 w-6 bg-gray-200 rounded mx-auto mb-1" />
                    <div className="h-3 w-12 bg-gray-200 rounded mx-auto" />
                  </div>
                  <div className="text-center flex-1">
                    <div className="h-5 w-6 bg-gray-200 rounded mx-auto mb-1" />
                    <div className="h-3 w-10 bg-gray-200 rounded mx-auto" />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
} 