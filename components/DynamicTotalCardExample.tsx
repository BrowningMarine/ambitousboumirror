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

const OrdersIcon = () => (
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

const ChartIcon = () => (
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
    <path d="M3 3v18h18" />
    <path d="M18 17V9" />
    <path d="M13 17V5" />
    <path d="M8 17v-3" />
  </svg>
);

const ClockIcon = () => (
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
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);

const GlobeIcon = () => (
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
    <circle cx="12" cy="12" r="10" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    <path d="M2 12h20" />
  </svg>
);

const HeartIcon = () => (
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
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
  </svg>
);

const ShoppingCartIcon = () => (
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

const StarIcon = () => (
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
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

export default function DynamicTotalCardExample() {
  // Sample data for the cards - 20 professional examples
  const professionalCards = [
    // Default style cards
    {
      title: "Total Users",
      mainValue: "8,249",
      subValue: "Active users",
      percentChange: 12.5,
      trendDirection: "up" as const,
      icon: <UsersIcon />,
      cardStyle: "default" as const,
    },
    {
      title: "Revenue",
      mainValue: "$45,231.89",
      subValue: "Monthly revenue",
      percentChange: -2.3,
      trendDirection: "down" as const,
      icon: <RevenueIcon />,
      cardStyle: "default" as const,
    },
    {
      title: "Orders",
      mainValue: "1,429",
      subValue: "Total orders this month",
      percentChange: 8.2,
      trendDirection: "up" as const,
      icon: <OrdersIcon />,
      cardStyle: "default" as const,
    },
    {
      title: "Conversion Rate",
      mainValue: "3.2%",
      subValue: "From website visits",
      percentChange: 0,
      trendDirection: "neutral" as const,
      icon: <ConversionIcon />,
      cardStyle: "default" as const,
    },

    // Bordered style cards
    {
      title: "Average Session",
      mainValue: "4m 32s",
      subValue: "Time on site",
      percentChange: 3.1,
      trendDirection: "up" as const,
      icon: <ClockIcon />,
      cardStyle: "bordered" as const,
      className: "border-blue-500",
      mainValueColor: "text-blue-600",
    },
    {
      title: "Customer Satisfaction",
      mainValue: "4.8/5",
      subValue: "Based on 2,345 reviews",
      percentChange: 0.3,
      trendDirection: "up" as const,
      icon: <StarIcon />,
      cardStyle: "bordered" as const,
      className: "border-yellow-500",
      mainValueColor: "text-yellow-600",
    },
    {
      title: "Cart Abandonment",
      mainValue: "21.3%",
      subValue: "Checkout process",
      percentChange: -3.6,
      trendDirection: "down" as const,
      icon: <ShoppingCartIcon />,
      cardStyle: "bordered" as const,
      className: "border-green-500",
      mainValueColor: "text-green-600",
    },
    {
      title: "Global Reach",
      mainValue: "42",
      subValue: "Countries",
      percentChange: 5,
      trendDirection: "up" as const,
      icon: <GlobeIcon />,
      cardStyle: "bordered" as const,
      className: "border-purple-500",
      mainValueColor: "text-purple-600",
    },

    // Solid background cards with proper contrast
    {
      title: "New Subscribers",
      mainValue: "928",
      subValue: "This month",
      percentChange: 8.1,
      trendDirection: "up" as const,
      icon: <HeartIcon />,
      cardStyle: "solid" as const,
      className:
        "bg-blue-600 shadow-lg shadow-blue-200 dark:shadow-blue-900/20",
    },
    {
      title: "Support Tickets",
      mainValue: "64",
      subValue: "Open tickets",
      percentChange: -12.5,
      trendDirection: "down" as const,
      icon: <OrdersIcon />,
      cardStyle: "solid" as const,
      className:
        "bg-amber-600 shadow-lg shadow-amber-200 dark:shadow-amber-900/20",
    },
    {
      title: "Engagement Rate",
      mainValue: "27.4%",
      subValue: "Social media",
      percentChange: 4.3,
      trendDirection: "up" as const,
      icon: <ChartIcon />,
      cardStyle: "solid" as const,
      className:
        "bg-emerald-600 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/20",
    },
    {
      title: "Bounce Rate",
      mainValue: "42.8%",
      subValue: "Homepage",
      percentChange: -1.2,
      trendDirection: "down" as const,
      icon: <ConversionIcon />,
      cardStyle: "solid" as const,
      className:
        "bg-rose-600 shadow-lg shadow-rose-200 dark:shadow-rose-900/20",
    },

    // Gradient cards with proper contrast
    {
      title: "Premium Users",
      mainValue: "1,248",
      subValue: "Subscribed users",
      percentChange: 18.2,
      trendDirection: "up" as const,
      cardStyle: "gradient" as const,
      className:
        "bg-gradient-to-r from-violet-600 to-purple-600 shadow-lg shadow-purple-200 dark:shadow-purple-900/20",
    },
    {
      title: "Page Views",
      mainValue: "2.4M",
      subValue: "Monthly traffic",
      percentChange: 12.7,
      trendDirection: "up" as const,
      cardStyle: "gradient" as const,
      className:
        "bg-gradient-to-r from-blue-600 to-cyan-600 shadow-lg shadow-blue-200 dark:shadow-blue-900/20",
    },
    {
      title: "Conversion Value",
      mainValue: "$89.54",
      subValue: "Average order value",
      percentChange: 3.6,
      trendDirection: "up" as const,
      cardStyle: "gradient" as const,
      className:
        "bg-gradient-to-r from-emerald-600 to-teal-600 shadow-lg shadow-emerald-200 dark:shadow-emerald-900/20",
    },
    {
      title: "Click Rate",
      mainValue: "24.3%",
      subValue: "Email campaigns",
      percentChange: -1.8,
      trendDirection: "down" as const,
      cardStyle: "gradient" as const,
      className:
        "bg-gradient-to-r from-orange-600 to-amber-600 shadow-lg shadow-orange-200 dark:shadow-orange-900/20",
    },

    // Additional professional cards
    {
      title: "Inventory Status",
      mainValue: "87.2%",
      subValue: "In stock items",
      percentChange: -0.8,
      trendDirection: "down" as const,
      icon: <ShoppingCartIcon />,
      cardStyle: "default" as const,
      className: "border-l-4 border-indigo-500",
      mainValueColor: "text-indigo-600",
    },
    {
      title: "Customer Retention",
      mainValue: "78.3%",
      subValue: "Repeat customers",
      percentChange: 2.4,
      trendDirection: "up" as const,
      icon: <UsersIcon />,
      cardStyle: "default" as const,
      className: "border-l-4 border-emerald-500",
      mainValueColor: "text-emerald-600",
    },
    {
      title: "Processing Time",
      mainValue: "1.4s",
      subValue: "Average response",
      percentChange: -22.5,
      trendDirection: "down" as const,
      icon: <ClockIcon />,
      cardStyle: "default" as const,
      className: "border-l-4 border-sky-500",
      mainValueColor: "text-sky-600",
    },
  ];

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Professional Statistics Cards</h2>
      <DynamicTotalCard cards={professionalCards.slice(0, 4)} />

      <h2 className="text-2xl font-bold mt-10 mb-6">Bordered Cards</h2>
      <DynamicTotalCard cards={professionalCards.slice(4, 8)} />

      <h2 className="text-2xl font-bold mt-10 mb-6">Solid Background Cards</h2>
      <DynamicTotalCard cards={professionalCards.slice(8, 12)} />

      <h2 className="text-2xl font-bold mt-10 mb-6">Gradient Cards</h2>
      <DynamicTotalCard cards={professionalCards.slice(12, 16)} />

      <h2 className="text-2xl font-bold mt-10 mb-6">
        Left Border Accent Cards
      </h2>
      <DynamicTotalCard cards={professionalCards.slice(16, 20)} />
    </div>
  );
}
