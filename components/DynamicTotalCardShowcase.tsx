"use client";

import DynamicTotalCard from "./DynamicStatisticsCard";
import { useState } from "react";

// Sample icons (using the same ones from previous examples)
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

// Sample mini sparkline component
const MiniSparkline = ({ trend }: { trend: "up" | "down" | "volatile" }) => {
  const paths = {
    up: "M1 6L3 4L5 3L7 2L9 1L11 0",
    down: "M1 0L3 1L5 2L7 3L9 4L11 6",
    volatile: "M1 3L3 1L5 4L7 2L9 5L11 3",
  };

  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded px-2 py-1">
      <svg
        width="44"
        height="16"
        viewBox="0 0 12 6"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="opacity-80"
      >
        <path
          d={paths[trend]}
          stroke={
            trend === "up" ? "#10B981" : trend === "down" ? "#EF4444" : "#6366F1"
          }
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
};

// Sample chart component
const SimpleBarChart = () => (
  <div className="flex h-12 items-end space-x-0.5 bg-gray-50 dark:bg-gray-800/50 rounded p-2">
    {[40, 25, 60, 35, 50, 70, 45, 60, 35, 45, 55, 65].map((height, i) => (
      <div
        key={i}
        className="bg-gradient-to-t from-blue-600 to-blue-400 dark:from-blue-500 dark:to-blue-300 rounded-sm flex-1 min-w-[2px]"
        style={{ height: `${Math.max(height * 0.6, 8)}%` }}
      ></div>
    ))}
  </div>
);

// Button component for actions
const Button = ({
  children,
  variant = "primary",
}: {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
}) => (
  <button
    className={`px-3 py-1 text-xs rounded font-medium ${
      variant === "primary"
        ? "bg-blue-600 text-white hover:bg-blue-700"
        : "bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
    }`}
  >
    {children}
  </button>
);

export default function DynamicTotalCardShowcase() {
  // State for category selection
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  // Card categories for filtering
  const categories = [
    { id: "all", name: "All Styles" },
    { id: "basic", name: "Basic Cards" },
    { id: "special", name: "Special Effects" },
    { id: "media", name: "Media Cards" },
    { id: "advanced", name: "Advanced Features" },
    { id: "interactive", name: "Interactive" },
  ];

  // Professional card examples
  const showcaseCards = [
    // ===== BASIC STYLES =====
    {
      category: "basic",
      title: "Default Card",
      description: "Basic card with shadow",
      card: {
        title: "Total Revenue",
        mainValue: "$253,489",
        subValue: "Monthly income",
        percentChange: 12.7,
        trendDirection: "up" as const,
        icon: <RevenueIcon />,
        cardStyle: "default" as const,
      },
    },
    {
      category: "basic",
      title: "Bordered Card",
      description: "Card with prominent border",
      card: {
        title: "Customers",
        mainValue: "12,835",
        subValue: "Total registered users",
        percentChange: 8.3,
        trendDirection: "up" as const,
        icon: <UsersIcon />,
        cardStyle: "bordered" as const,
        className: "border-indigo-500",
        mainValueColor: "text-indigo-600",
      },
    },
    {
      category: "basic",
      title: "Solid Background",
      description: "Solid color background",
      card: {
        title: "Conversion Rate",
        mainValue: "3.75%",
        subValue: "From total visits",
        percentChange: -1.4,
        trendDirection: "down" as const,
        cardStyle: "solid" as const,
        className: "bg-purple-600",
      },
    },
    {
      category: "basic",
      title: "Gradient Card",
      description: "Smooth color gradient",
      card: {
        title: "Active Users",
        mainValue: "8,492",
        subValue: "Currently online",
        percentChange: 5.3,
        trendDirection: "up" as const,
        cardStyle: "gradient" as const,
        className: "bg-gradient-to-r from-sky-600 to-indigo-600",
      },
    },
    // ===== SPECIAL EFFECTS =====
    {
      category: "special",
      title: "Glass Effect",
      description: "Modern glassmorphism design",
      card: {
        title: "Page Views",
        mainValue: "1.4M",
        subValue: "Monthly impressions",
        percentChange: 22.8,
        trendDirection: "up" as const,
        cardStyle: "glass" as const,
      },
    },
    {
      category: "special",
      title: "Neumorphic Style",
      description: "Soft UI / neumorphism effect",
      card: {
        title: "Avg. Session",
        mainValue: "4m 38s",
        subValue: "Time on site",
        percentChange: -0.7,
        trendDirection: "down" as const,
        icon: <RevenueIcon />,
        cardStyle: "neumorphic" as const,
      },
    },
    {
      category: "special",
      title: "3D Effect",
      description: "Card with 3D depth effect",
      card: {
        title: "Support Tickets",
        mainValue: "87",
        subValue: "Open issues",
        percentChange: -12.6,
        trendDirection: "down" as const,
        icon: <UsersIcon />,
        cardStyle: "3d" as const,
        accentColor: "cyan",
      },
    },
    {
      category: "special",
      title: "Pill Shaped",
      description: "Fully rounded card shape",
      card: {
        title: "Engagement",
        mainValue: "64.2%",
        subValue: "User interaction rate",
        percentChange: 4.8,
        trendDirection: "up" as const,
        icon: <UsersIcon />,
        cardStyle: "pill" as const,
        className: "bg-gradient-to-r from-purple-500 to-pink-500 text-white",
      },
    },
    {
      category: "special",
      title: "Split Design",
      description: "Card with accent divider",
      card: {
        title: "Total Products",
        mainValue: "1,482",
        subValue: "In inventory",
        percentChange: 3.2,
        trendDirection: "up" as const,
        cardStyle: "split" as const,
      },
    },
    {
      category: "special",
      title: "Circle Indicator",
      description: "Status indicator dot",
      card: {
        title: "System Status",
        mainValue: "Operational",
        subValue: "All systems normal",
        percentChange: 0,
        trendDirection: "neutral" as const,
        cardStyle: "circle-indicator" as const,
      },
    },
    // ===== MEDIA CARDS =====
    {
      category: "media",
      title: "Background Image",
      description: "Image as card background",
      card: {
        title: "New York Office",
        mainValue: "127",
        subValue: "Team members",
        percentChange: 14.3,
        trendDirection: "up" as const,
        cardStyle: "image-bg" as const,
        imageSrc:
          "https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?q=80&w=2940&auto=format&fit=crop&ixlib=rb-4.0.3",
        imagePosition: "background" as const,
      },
    },
    {
      category: "media",
      title: "Top Image",
      description: "Image at the top of card",
      card: {
        title: "Marketing Campaign",
        mainValue: "$34,750",
        subValue: "Monthly budget",
        percentChange: 0,
        trendDirection: "neutral" as const,
        cardStyle: "default" as const,
        imageSrc:
          "https://images.unsplash.com/photo-1551434678-e076c223a692?q=80&w=2940&auto=format&fit=crop&ixlib=rb-4.0.3",
        imagePosition: "top" as const,
      },
    },
    {
      category: "media",
      title: "Left Image",
      description: "Image on the left side",
      card: {
        title: "Team Performance",
        mainValue: "94.7%",
        subValue: "Efficiency score",
        percentChange: 2.4,
        trendDirection: "up" as const,
        cardStyle: "default" as const,
        imageSrc:
          "https://images.unsplash.com/photo-1552664730-d307ca884978?q=80&w=2940&auto=format&fit=crop&ixlib=rb-4.0.3",
        imagePosition: "left" as const,
      },
    },
    {
      category: "media",
      title: "Right Image",
      description: "Image on the right side",
      card: {
        title: "Customer Feedback",
        mainValue: "4.8/5",
        subValue: "Satisfaction score",
        percentChange: 0.3,
        trendDirection: "up" as const,
        cardStyle: "default" as const,
        imageSrc:
          "https://images.unsplash.com/photo-1573497491765-dccce02b29df?q=80&w=2940&auto=format&fit=crop&ixlib=rb-4.0.3",
        imagePosition: "right" as const,
      },
    },
    // ===== ADVANCED FEATURES =====
    {
      category: "advanced",
      title: "Progress Bar",
      description: "Visual progress indicator",
      card: {
        title: "Project Completion",
        mainValue: "68%",
        subValue: "Sprint progress",
        cardStyle: "default" as const,
        progress: 68,
        progressColor: "bg-green-600",
      },
    },
    {
      category: "advanced",
      title: "With Badge",
      description: "Status badge indicator",
      card: {
        title: "Server Status",
        mainValue: "99.98%",
        subValue: "Uptime this month",
        percentChange: 0.2,
        trendDirection: "up" as const,
        icon: <RevenueIcon />,
        cardStyle: "default" as const,
        badge: "Healthy",
        badgeColor:
          "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
      },
    },
    {
      category: "advanced",
      title: "With Sparkline",
      description: "Mini trend visualization",
      card: {
        title: "Stock Performance",
        mainValue: "$842.32",
        subValue: "Current price",
        percentChange: 3.1,
        trendDirection: "up" as const,
        icon: <RevenueIcon />,
        cardStyle: "default" as const,
        sparkline: <MiniSparkline trend="up" />,
      },
    },
    {
      category: "advanced",
      title: "Secondary Metric",
      description: "Additional measurement data",
      card: {
        title: "Sales Performance",
        mainValue: "$128,429",
        subValue: "Monthly revenue",
        percentChange: 18.3,
        trendDirection: "up" as const,
        icon: <RevenueIcon />,
        cardStyle: "default" as const,
        secondaryMetric: {
          label: "Average Order Value",
          value: "$86.54",
        },
      },
    },
    {
      category: "advanced",
      title: "With Chart",
      description: "Data visualization chart",
      card: {
        title: "Monthly Trends",
        mainValue: "$92,438",
        subValue: "Total revenue",
        percentChange: 8.7,
        trendDirection: "up" as const,
        icon: <RevenueIcon />,
        cardStyle: "default" as const,
        chart: <SimpleBarChart />,
      },
    },
    {
      category: "advanced",
      title: "Comparison Data",
      description: "Period-over-period comparison",
      card: {
        title: "Website Traffic",
        mainValue: "824,521",
        subValue: "Total visitors",
        percentChange: 12.3,
        trendDirection: "up" as const,
        cardStyle: "default" as const,
        compareValue: "734,109",
        compareLabel: "Previous month",
      },
    },
    // ===== INTERACTIVE STYLES =====
    {
      category: "interactive",
      title: "Floating Effect",
      description: "Hover animation lift",
      card: {
        title: "Bounce Rate",
        mainValue: "42.7%",
        subValue: "From all sessions",
        percentChange: -2.8,
        trendDirection: "down" as const,
        cardStyle: "floating" as const,
      },
    },
    {
      category: "interactive",
      title: "Shadow Hover",
      description: "Shadow grows on hover",
      card: {
        title: "Return Rate",
        mainValue: "12.4%",
        subValue: "Returning visitors",
        percentChange: 5.1,
        trendDirection: "up" as const,
        cardStyle: "shadow-hover" as const,
      },
    },
    {
      category: "interactive",
      title: "With Actions",
      description: "Interactive buttons",
      card: {
        title: "Email Campaign",
        mainValue: "24.8%",
        subValue: "Open rate",
        percentChange: -1.3,
        trendDirection: "down" as const,
        cardStyle: "default" as const,
        actions: (
          <>
            <Button variant="secondary">Details</Button>
            <Button>Run Again</Button>
          </>
        ),
      },
    },
    {
      category: "interactive",
      title: "Glowing Border",
      description: "Highlight effect on hover",
      card: {
        title: "Partner Revenue",
        mainValue: "$36,428",
        subValue: "From affiliates",
        percentChange: 23.4,
        trendDirection: "up" as const,
        cardStyle: "glow" as const,
        accentColor: "purple",
      },
    },
  ];

  // Filter cards based on selected category
  const filteredCards =
    selectedCategory === "all"
      ? showcaseCards
      : showcaseCards.filter((card) => card.category === selectedCategory);

  return (
    <div className="py-8 px-4 md:px-8">
      <h1 className="text-3xl font-bold mb-2">Professional Statistics Cards</h1>
      <p className="text-gray-600 dark:text-gray-400 mb-8">
        Showcase of {showcaseCards.length} professional card styles for
        displaying statistics and data
      </p>

      {/* Category filters */}
      <div className="flex flex-wrap gap-2 mb-8">
        {categories.map((category) => (
          <button
            key={category.id}
            onClick={() => setSelectedCategory(category.id)}
            className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
              selectedCategory === category.id
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            {category.name}
          </button>
        ))}
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
        {filteredCards.map((item, index) => (
          <div key={index} className="space-y-6">
            <div className="h-52">
              {" "}
              {/* Fixed height container for consistent card sizes */}
              <DynamicTotalCard
                cards={[item.card]}
                columns={1}
                containerClassName="h-full"
              />
            </div>
            <div className="space-y-1">
              <h3 className="font-medium text-base">{item.title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {item.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Note about customization */}
      <div className="mt-12 bg-blue-50 dark:bg-blue-900/20 rounded-lg p-6">
        <h2 className="text-xl font-semibold mb-2">Endless Customization</h2>
        <p className="text-gray-700 dark:text-gray-300">
          These 24 examples demonstrate the core styles available. By combining
          different properties, colors, and content, you can create hundreds of
          unique card designs tailored to your specific needs.
        </p>
      </div>
    </div>
  );
}
