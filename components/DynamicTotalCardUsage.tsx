"use client";

import DynamicTotalCard from "./DynamicStatisticsCard";

export default function DynamicTotalCardUsage() {
  // Example data for different card styles
  const basicCards = [
    {
      title: "Total Users",
      mainValue: "42,835",
      subValue: "Registered accounts",
      percentChange: 12.5,
      trendDirection: "up" as const,
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
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      ),
    },
    {
      title: "Revenue",
      mainValue: "$156,432",
      subValue: "Monthly income",
      percentChange: 8.2,
      trendDirection: "up" as const,
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
          <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      ),
    },
    {
      title: "Conversion Rate",
      mainValue: "3.42%",
      subValue: "From visits to signup",
      percentChange: -1.4,
      trendDirection: "down" as const,
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
          <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
        </svg>
      ),
    },
    {
      title: "Active Sessions",
      mainValue: "2,845",
      subValue: "Currently online",
      percentChange: 5.3,
      trendDirection: "up" as const,
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
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <path d="M7 7h10M7 12h10M7 17h10" />
        </svg>
      ),
    },
  ];

  const gradientCards = [
    {
      title: "New Subscribers",
      mainValue: "2,431",
      subValue: "This month",
      percentChange: 18.2,
      trendDirection: "up" as const,
      cardStyle: "gradient" as const,
      className:
        "bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg shadow-blue-200 dark:shadow-blue-900/20",
    },
    {
      title: "Engagement Rate",
      mainValue: "64.8%",
      subValue: "Average per session",
      percentChange: 4.7,
      trendDirection: "up" as const,
      cardStyle: "gradient" as const,
      className:
        "bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/20",
    },
  ];

  // Cards with progress indicators
  const progressCards = [
    {
      title: "Project Completion",
      mainValue: "68%",
      subValue: "Current sprint progress",
      cardStyle: "default" as const,
      progress: 68,
      progressColor: "bg-blue-600",
    },
    {
      title: "Resource Usage",
      mainValue: "42%",
      subValue: "CPU utilization",
      cardStyle: "default" as const,
      progress: 42,
      progressColor: "bg-green-600",
    },
  ];

  return (
    <div className="space-y-10 p-6">
      <div>
        <h2 className="text-2xl font-bold mb-4">Basic Statistics Cards</h2>
        <DynamicTotalCard cards={basicCards} />
      </div>

      <div>
        <h2 className="text-2xl font-bold mb-4">Gradient Cards</h2>
        <DynamicTotalCard cards={gradientCards} columns={2} />
      </div>

      <div>
        <h2 className="text-2xl font-bold mb-4">Progress Indicator Cards</h2>
        <DynamicTotalCard cards={progressCards} columns={2} />
      </div>

      <div className="bg-gray-50 dark:bg-gray-800 p-6 rounded-lg">
        <h2 className="text-xl font-bold mb-4">How to Use DynamicTotalCard</h2>
        <p className="mb-4">
          Simply import the component and pass your card data:
        </p>

        <pre className="bg-gray-800 text-green-400 p-4 rounded overflow-x-auto">
          {`import DynamicTotalCard from "@/components/DynamicStatisticsCard";

export default function Dashboard() {
  const cards = [
    {
      title: "Revenue",
      mainValue: "$156,432",
      subValue: "Monthly income",
      percentChange: 8.2,
      trendDirection: "up",
      // Add more properties as needed
    },
    // More cards...
  ];

  return <DynamicTotalCard cards={cards} />;
}`}
        </pre>

        <p className="mt-4">
          For more advanced examples, check the{" "}
          <code className="bg-gray-200 dark:bg-gray-700 px-1 py-0.5 rounded text-sm">
            DynamicTotalCardShowcase
          </code>{" "}
          component.
        </p>
      </div>
    </div>
  );
}
