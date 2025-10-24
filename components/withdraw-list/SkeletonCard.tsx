import React from "react";
import { Card, CardContent } from "@/components/ui/card";

interface SkeletonCardProps {
  index: number;
}

const SkeletonCard: React.FC<SkeletonCardProps> = ({ index }) => {
  return (
    <Card
      key={`skeleton-${index}`}
      className="overflow-hidden border-l-4 border-l-gray-200 animate-pulse"
    >
      <CardContent className="p-0">
        <div className="bg-gray-50 p-4 border-b">
          <div className="flex justify-between items-center mb-2">
            <div className="flex items-center gap-2">
              <div className="h-6 bg-gray-200 rounded w-32"></div>
              <div className="h-4 w-4 bg-gray-200 rounded"></div>
            </div>
            <div className="h-6 bg-gray-200 rounded w-20"></div>
          </div>
          <div className="h-4 bg-gray-200 rounded w-48"></div>
        </div>
        <div className="p-4 flex flex-col md:flex-row gap-4">
          <div className="w-40 h-40 bg-gray-200 rounded"></div>
          <div className="flex-1 space-y-4">
            <div className="bg-gray-100 rounded-lg p-3">
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 rounded w-full"></div>
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-3">
                <div className="h-12 bg-gray-200 rounded"></div>
                <div className="h-8 bg-gray-200 rounded"></div>
              </div>
              <div className="space-y-3">
                <div className="h-8 bg-gray-200 rounded"></div>
                <div className="h-8 bg-gray-200 rounded"></div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default SkeletonCard;
