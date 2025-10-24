"use client";

import DynamicTotalCard from "./DynamicStatisticsCard";

// Sample icons
const UsersIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-6 h-6"
  >
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const RevenueIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-6 h-6"
  >
    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
  </svg>
);

const ShoppingIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-6 h-6"
  >
    <circle cx="8" cy="21" r="1" />
    <circle cx="19" cy="21" r="1" />
    <path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12" />
  </svg>
);

const ConversionIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-6 h-6"
  >
    <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
  </svg>
);

// Mini sparkline component
const MiniSparkline = ({ trend }: { trend: "up" | "down" | "volatile" }) => {
  const paths = {
    up: "M1 6L3 4L5 3L7 2L9 1L11 0",
    down: "M1 0L3 1L5 2L7 3L9 4L11 6",
    volatile: "M1 3L3 1L5 4L7 2L9 5L11 3",
  };

  return (
    <svg
      width="40"
      height="12"
      viewBox="0 0 12 6"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d={paths[trend]}
        stroke={
          trend === "up" ? "#10B981" : trend === "down" ? "#EF4444" : "#6366F1"
        }
        strokeWidth="1"
      />
    </svg>
  );
};

// More advanced chart components
const LineChart = () => (
  <div className="h-16 w-full relative">
    {/* Chart background grid */}
    <div className="absolute inset-0 grid grid-cols-6 grid-rows-4">
      {Array(24)
        .fill(0)
        .map((_, i) => (
          <div
            key={i}
            className="border-r border-t border-gray-100 dark:border-gray-800"
          ></div>
        ))}
    </div>

    {/* Line chart */}
    <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 40">
      {/* Gradient fill */}
      <defs>
        <linearGradient id="line-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#3B82F6" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Area fill */}
      <path
        d="M0,30 L5,28 L10,32 L15,25 L20,27 L25,24 L30,20 L35,22 L40,19 L45,16 L50,18 L55,15 L60,13 L65,16 L70,12 L75,9 L80,11 L85,7 L90,5 L95,8 L100,4 L100,40 L0,40 Z"
        fill="url(#line-gradient)"
      />

      {/* Line */}
      <path
        d="M0,30 L5,28 L10,32 L15,25 L20,27 L25,24 L30,20 L35,22 L40,19 L45,16 L50,18 L55,15 L60,13 L65,16 L70,12 L75,9 L80,11 L85,7 L90,5 L95,8 L100,4"
        fill="none"
        stroke="#3B82F6"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Data points */}
      {[
        30, 28, 32, 25, 27, 24, 20, 22, 19, 16, 18, 15, 13, 16, 12, 9, 11, 7, 5,
        8, 4,
      ].map((y, i) => (
        <circle
          key={i}
          cx={i * 5}
          cy={y}
          r="1"
          fill="#3B82F6"
          stroke="#fff"
          strokeWidth="1"
        />
      ))}
    </svg>
  </div>
);

const BarChart = () => (
  <div className="h-16 w-full flex items-end space-x-1">
    {[40, 25, 60, 35, 50, 70, 45, 60, 35, 45, 55, 65].map((height, i) => (
      <div key={i} className="flex-1 group">
        <div
          className="bg-gradient-to-t from-blue-600 to-blue-400 rounded-t w-full transition-all duration-300 group-hover:from-blue-700 group-hover:to-blue-500"
          style={{ height: `${height}%` }}
        >
          <div className="invisible group-hover:visible absolute -top-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white text-xs px-1 py-0.5 rounded">
            {height}%
          </div>
        </div>
      </div>
    ))}
  </div>
);

const PieChart = () => (
  <div className="h-16 w-full flex justify-center">
    <svg
      width="64"
      height="64"
      viewBox="0 0 42 42"
      className="transform -rotate-90"
    >
      {/* Pie segments */}
      <circle
        cx="21"
        cy="21"
        r="15.91549430918954"
        fill="transparent"
        stroke="#3B82F6"
        strokeWidth="6"
        strokeDasharray="30 100"
        strokeDashoffset="0"
      />
      <circle
        cx="21"
        cy="21"
        r="15.91549430918954"
        fill="transparent"
        stroke="#10B981"
        strokeWidth="6"
        strokeDasharray="25 100"
        strokeDashoffset="-30"
      />
      <circle
        cx="21"
        cy="21"
        r="15.91549430918954"
        fill="transparent"
        stroke="#F59E0B"
        strokeWidth="6"
        strokeDasharray="20 100"
        strokeDashoffset="-55"
      />
      <circle
        cx="21"
        cy="21"
        r="15.91549430918954"
        fill="transparent"
        stroke="#EF4444"
        strokeWidth="6"
        strokeDasharray="25 100"
        strokeDashoffset="-75"
      />

      {/* Center circle */}
      <circle
        cx="21"
        cy="21"
        r="10"
        fill="white"
        className="dark:fill-gray-900"
      />
    </svg>
  </div>
);

const AreaChart = () => (
  <div className="h-16 w-full relative">
    <svg className="h-full w-full" viewBox="0 0 100 40">
      {/* Gradient fill */}
      <defs>
        <linearGradient id="area-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#8B5CF6" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Area fill */}
      <path
        d="M0,35 C10,30 15,20 20,15 S30,5 40,10 S50,20 60,15 S70,5 80,10 S90,20 100,15 V40 H0 Z"
        fill="url(#area-gradient)"
      />

      {/* Line */}
      <path
        d="M0,35 C10,30 15,20 20,15 S30,5 40,10 S50,20 60,15 S70,5 80,10 S90,20 100,15"
        fill="none"
        stroke="#8B5CF6"
        strokeWidth="1.5"
      />
    </svg>
  </div>
);

// Collection 1: Modern Business Dashboard
export function ModernBusinessCollection() {
  const cards = [
    {
      title: "Total Revenue",
      mainValue: "$86,429",
      subValue: "Monthly revenue",
      percentChange: 12.5,
      trendDirection: "up" as const,
      icon: <RevenueIcon />,
      cardStyle: "default" as const,
      className: "border-l-4 border-blue-500",
    },
    {
      title: "Active Users",
      mainValue: "9,271",
      subValue: "Unique visitors",
      percentChange: 8.3,
      trendDirection: "up" as const,
      icon: <UsersIcon />,
      cardStyle: "default" as const,
      className: "border-l-4 border-green-500",
    },
    {
      title: "Conversion Rate",
      mainValue: "3.6%",
      subValue: "From website visits",
      percentChange: -1.2,
      trendDirection: "down" as const,
      icon: <ConversionIcon />,
      cardStyle: "default" as const,
      className: "border-l-4 border-amber-500",
    },
    {
      title: "Sales",
      mainValue: "1,849",
      subValue: "Total orders",
      percentChange: 4.7,
      trendDirection: "up" as const,
      icon: <ShoppingIcon />,
      cardStyle: "default" as const,
      className: "border-l-4 border-purple-500",
    },
  ];

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Modern Business Dashboard</h2>
      <DynamicTotalCard cards={cards} />
    </div>
  );
}

// Collection 2: Gradient Executive Dashboard
export function GradientExecutiveCollection() {
  const cards = [
    {
      title: "Revenue",
      mainValue: "$1.28M",
      subValue: "Quarterly",
      percentChange: 15.8,
      trendDirection: "up" as const,
      cardStyle: "gradient" as const,
      className:
        "bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg shadow-blue-200 dark:shadow-blue-900/20",
    },
    {
      title: "Market Share",
      mainValue: "24.8%",
      subValue: "Industry position",
      percentChange: 2.1,
      trendDirection: "up" as const,
      cardStyle: "gradient" as const,
      className:
        "bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/20",
    },
    {
      title: "Customer Growth",
      mainValue: "18.4%",
      subValue: "Year over year",
      percentChange: 7.9,
      trendDirection: "up" as const,
      cardStyle: "gradient" as const,
      className:
        "bg-gradient-to-r from-violet-600 to-purple-600 shadow-lg shadow-purple-200 dark:shadow-purple-900/20",
    },
    {
      title: "ROI",
      mainValue: "214%",
      subValue: "On marketing spend",
      percentChange: -3.2,
      trendDirection: "down" as const,
      cardStyle: "gradient" as const,
      className:
        "bg-gradient-to-r from-orange-600 to-amber-600 shadow-lg shadow-orange-200 dark:shadow-orange-900/20",
    },
  ];

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Executive Dashboard</h2>
      <DynamicTotalCard cards={cards} />
    </div>
  );
}

// Collection 3: E-commerce Dashboard with enhanced charts
export function EcommerceCollection() {
  const cards = [
    {
      title: "Total Sales",
      mainValue: "$43,629",
      subValue: "Monthly revenue",
      percentChange: 8.7,
      trendDirection: "up" as const,
      sparkline: <MiniSparkline trend="up" />,
      cardStyle: "default" as const,
      animation: true,
      chart: <LineChart />,
      chartPosition: "bottom" as const,
    },
    {
      title: "Orders",
      mainValue: "1,482",
      subValue: "This month",
      percentChange: 12.3,
      trendDirection: "up" as const,
      sparkline: <MiniSparkline trend="up" />,
      cardStyle: "default" as const,
      animation: true,
      chart: <BarChart />,
      chartPosition: "bottom" as const,
    },
    {
      title: "Conversion Rate",
      mainValue: "3.2%",
      subValue: "From product page",
      percentChange: -0.8,
      trendDirection: "down" as const,
      sparkline: <MiniSparkline trend="down" />,
      cardStyle: "default" as const,
      animation: true,
      chart: <PieChart />,
      chartPosition: "bottom" as const,
    },
    {
      title: "Avg Order Value",
      mainValue: "$78.60",
      subValue: "Per transaction",
      percentChange: 4.3,
      trendDirection: "up" as const,
      sparkline: <MiniSparkline trend="volatile" />,
      cardStyle: "default" as const,
      animation: true,
      chart: <AreaChart />,
      chartPosition: "bottom" as const,
    },
  ];

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">E-commerce Dashboard</h2>
      <DynamicTotalCard cards={cards} />
    </div>
  );
}

// Collection 4: Analytics Dashboard with Progress
export function AnalyticsCollection() {
  const cards = [
    {
      title: "Customer Satisfaction",
      mainValue: "94%",
      subValue: "Based on surveys",
      cardStyle: "bordered" as const,
      className: "border-green-500",
      progress: 94,
      progressColor: "bg-green-500",
      badge: "Excellent",
      badgeColor: "bg-green-100 text-green-800",
    },
    {
      title: "Task Completion",
      mainValue: "72%",
      subValue: "Current sprint",
      cardStyle: "bordered" as const,
      className: "border-blue-500",
      progress: 72,
      progressColor: "bg-blue-500",
      badge: "On Track",
      badgeColor: "bg-blue-100 text-blue-800",
    },
    {
      title: "System Resources",
      mainValue: "38%",
      subValue: "CPU utilization",
      cardStyle: "bordered" as const,
      className: "border-green-500",
      progress: 38,
      progressColor: "bg-green-500",
      badge: "Normal",
      badgeColor: "bg-green-100 text-green-800",
    },
    {
      title: "Storage Usage",
      mainValue: "86%",
      subValue: "Cloud storage",
      cardStyle: "bordered" as const,
      className: "border-yellow-500",
      progress: 86,
      progressColor: "bg-yellow-500",
      badge: "Warning",
      badgeColor: "bg-yellow-100 text-yellow-800",
    },
  ];

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Analytics Dashboard</h2>
      <DynamicTotalCard cards={cards} />
    </div>
  );
}

// Collection 5: Media-Rich Dashboard
export function MediaRichCollection() {
  const cards = [
    {
      title: "New York Office",
      mainValue: "186",
      subValue: "Team members",
      percentChange: 12.5,
      trendDirection: "up" as const,
      cardStyle: "solid" as const,
      className: "bg-blue-600",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-6 h-6"
        >
          <path d="M2 22h20M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
          <path d="M7 3h10M5 3h14v4H5z" />
          <path d="M10 7v4M14 7v4" />
        </svg>
      ),
    },
    {
      title: "London Office",
      mainValue: "142",
      subValue: "Team members",
      percentChange: 8.3,
      trendDirection: "up" as const,
      cardStyle: "solid" as const,
      className: "bg-indigo-600",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-6 h-6"
        >
          <path d="M2 22h20M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
          <path d="M7 3h10M5 3h14v4H5z" />
          <path d="M10 7v4M14 7v4" />
        </svg>
      ),
    },
    {
      title: "Singapore Office",
      mainValue: "97",
      subValue: "Team members",
      percentChange: 18.7,
      trendDirection: "up" as const,
      cardStyle: "solid" as const,
      className: "bg-emerald-600",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-6 h-6"
        >
          <path d="M2 22h20M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
          <path d="M7 3h10M5 3h14v4H5z" />
          <path d="M10 7v4M14 7v4" />
        </svg>
      ),
    },
    {
      title: "Sydney Office",
      mainValue: "65",
      subValue: "Team members",
      percentChange: 5.2,
      trendDirection: "up" as const,
      cardStyle: "solid" as const,
      className: "bg-amber-600",
      icon: (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="w-6 h-6"
        >
          <path d="M2 22h20M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22" />
          <path d="M7 3h10M5 3h14v4H5z" />
          <path d="M10 7v4M14 7v4" />
        </svg>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Global Presence Dashboard</h2>
      <DynamicTotalCard cards={cards} />
    </div>
  );
}

// Collection 6: Performance Monitoring Dashboard
export function PerformanceCollection() {
  const cards = [
    {
      title: "System Status",
      mainValue: "99.99%",
      subValue: "Monthly uptime",
      cardStyle: "circle-indicator" as const,
      trendDirection: "up" as const,
      secondaryMetric: {
        label: "Average Response Time",
        value: "124ms",
      },
    },
    {
      title: "API Requests",
      mainValue: "682K",
      subValue: "Weekly calls",
      cardStyle: "circle-indicator" as const,
      trendDirection: "up" as const,
      secondaryMetric: {
        label: "Error Rate",
        value: "0.02%",
      },
    },
    {
      title: "Load Balancer",
      mainValue: "42%",
      subValue: "Average utilization",
      cardStyle: "circle-indicator" as const,
      trendDirection: "neutral" as const,
      secondaryMetric: {
        label: "Traffic Distribution",
        value: "Even",
      },
    },
    {
      title: "Database",
      mainValue: "16ms",
      subValue: "Query response",
      cardStyle: "circle-indicator" as const,
      trendDirection: "down" as const,
      secondaryMetric: {
        label: "Connection Pool",
        value: "68% used",
      },
    },
  ];

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold">Performance Monitoring</h2>
      <DynamicTotalCard cards={cards} />
    </div>
  );
}

// Complete dashboard showcase with all collections
export default function StatisticsCardCollections() {
  return (
    <div className="space-y-16 py-8">
      <h1 className="text-3xl font-bold mb-8">
        Pre-configured Statistics Card Collections
      </h1>

      <ModernBusinessCollection />
      <GradientExecutiveCollection />
      <EcommerceCollection />
      <AnalyticsCollection />
      <MediaRichCollection />
      <PerformanceCollection />

      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6 mt-12">
        <h2 className="text-xl font-semibold mb-2">
          How to Use These Collections
        </h2>
        <p className="text-gray-700 dark:text-gray-300 mb-4">
          To use any of these collections in your project, simply import the
          specific collection component:
        </p>
        <pre className="bg-gray-800 text-green-400 p-4 rounded overflow-x-auto">
          {`import { EcommerceCollection } from "@/components/StatisticsCardCollections";

            export default function Dashboard() {
              return (
                <div>
                  <EcommerceCollection />
                  {/* Your other dashboard components */}
                </div>
              );
            }`}
        </pre>
      </div>
    </div>
  );
}
