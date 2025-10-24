"use client";

import Image from "next/image";
import { Card, CardContent } from "./ui/card";
import { cn } from "@/lib/utils";

// Define types for the component
type TrendDirection = "up" | "down" | "neutral";
type CardVariant =
  | "default"
  | "gradient"
  | "bordered"
  | "solid"
  | "glass"
  | "image-bg"
  | "pattern"
  | "minimal"
  | "neumorphic"
  | "3d"
  | "pill"
  | "split"
  | "circle-indicator"
  | "accent-top"
  | "accent-left"
  | "accent-bottom"
  | "accent-right"
  | "floating"
  | "shadow-hover"
  | "glow";

interface StatCardProps {
  title: string;
  mainValue: string | number;
  subValue?: string | number;
  percentChange?: number;
  trendDirection?: TrendDirection;
  icon?: React.ReactNode;
  className?: string;
  mainValueColor?: string;
  subValueColor?: string;
  trendColor?: string;
  cardStyle?: CardVariant;
  imageSrc?: string;
  imagePosition?: "top" | "bottom" | "left" | "right" | "background";
  chart?: React.ReactNode;
  chartPosition?: "top" | "bottom" | "right";
  badge?: string;
  badgeColor?: string;
  progress?: number;
  progressColor?: string;
  sparkline?: React.ReactNode;
  secondaryMetric?: {
    label: string;
    value: string | number;
  };
  actions?: React.ReactNode;
  tooltip?: string;
  animation?: boolean;
  compareValue?: string | number;
  compareLabel?: string;
  footer?: React.ReactNode;
  accentColor?: string;
  comparisonText?: string;
}

interface DynamicTotalCardProps {
  cards: StatCardProps[];
  className?: string;
  columns?: 1 | 2 | 3 | 4;
  gap?: "sm" | "md" | "lg";
  containerClassName?: string;
}

// Helper function to determine trend icon and color
const getTrendDetails = (direction: TrendDirection, customColor?: string) => {
  const colors = {
    up: customColor || "text-success-600",
    down: customColor || "text-red-600",
    neutral: "text-gray-500",
  };

  const icons = {
    up: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-4 h-4"
      >
        <path
          fillRule="evenodd"
          d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z"
          clipRule="evenodd"
        />
      </svg>
    ),
    down: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-4 h-4"
      >
        <path
          fillRule="evenodd"
          d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z"
          clipRule="evenodd"
        />
      </svg>
    ),
    neutral: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="w-4 h-4"
      >
        <path
          fillRule="evenodd"
          d="M4 10a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H4.75A.75.75 0 014 10z"
          clipRule="evenodd"
        />
      </svg>
    ),
  };

  return {
    icon: icons[direction],
    color: colors[direction],
  };
};

// Get appropriate card styling based on cardStyle prop
const getCardStyle = (
  style: CardVariant = "default",
  className?: string,
  accentColor?: string
) => {
  const accent = accentColor || "indigo";

  const styles: Record<CardVariant, string> = {
    default: "bg-white dark:bg-gray-950 shadow-md",
    gradient: "", // Gradient styles will be provided in className
    bordered: "bg-white dark:bg-gray-950 border-2",
    solid: "text-white shadow-lg", // Solid background will be provided in className
    glass:
      "bg-white/70 dark:bg-gray-900/70 backdrop-blur-md border border-white/20 dark:border-gray-800/20 shadow-xl",
    "image-bg": "relative text-white shadow-xl overflow-hidden",
    pattern:
      "bg-white dark:bg-gray-950 shadow-md bg-[url('/patterns/subtle-dots.png')]",
    minimal: "bg-transparent border border-gray-100 dark:border-gray-800",
    neumorphic:
      "bg-gray-100 dark:bg-gray-900 shadow-[6px_6px_12px_#b8b9be,-6px_-6px_12px_#ffffff] dark:shadow-[6px_6px_12px_#151515,-6px_-6px_12px_#272727]",
    "3d": `bg-white dark:bg-gray-900 shadow-[0_8px_0_0_${accent}-600,0_15px_20px_-5px_rgba(0,0,0,0.3)]`,
    pill: "rounded-full bg-white dark:bg-gray-950 shadow-md",
    split: "bg-white dark:bg-gray-950 shadow-md relative overflow-hidden",
    "circle-indicator": "bg-white dark:bg-gray-950 shadow-md relative",
    "accent-top": "bg-white dark:bg-gray-950 shadow-md border-t-4",
    "accent-left": "bg-white dark:bg-gray-950 shadow-md border-l-4",
    "accent-bottom": "bg-white dark:bg-gray-950 shadow-md border-b-4",
    "accent-right": "bg-white dark:bg-gray-950 shadow-md border-r-4",
    floating:
      "bg-white dark:bg-gray-950 shadow-2xl translate-y-0 hover:-translate-y-1 transition-transform duration-300",
    "shadow-hover":
      "bg-white dark:bg-gray-950 shadow-md hover:shadow-xl transition-shadow duration-300",
    glow: `bg-white dark:bg-gray-950 shadow-md relative before:absolute before:inset-0 before:-z-10 before:rounded-lg before:bg-gradient-to-r before:from-${accent}-500 before:via-purple-500 before:to-pink-500 before:p-0.5 before:opacity-0 hover:before:opacity-100 before:transition-opacity`,
  };

  return cn(styles[style], className);
};

// Individual Stat Card Component
const StatCard = ({
  title,
  mainValue,
  subValue,
  percentChange,
  trendDirection = "neutral",
  icon,
  className,
  mainValueColor = "text-gray-900 dark:text-white",
  subValueColor = "text-gray-500 dark:text-gray-400",
  trendColor,
  cardStyle = "default",
  imageSrc,
  imagePosition = "background",
  chart,
  chartPosition = "bottom",
  badge,
  badgeColor = "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  progress,
  progressColor = "bg-blue-600",
  sparkline,
  secondaryMetric,
  actions,
  tooltip,
  animation,
  compareValue,
  compareLabel,
  footer,
  accentColor,
  comparisonText,
}: StatCardProps) => {
  const { icon: trendIcon, color: trendColorClass } = getTrendDetails(
    trendDirection,
    trendColor
  );

  // Ensure text is readable on gradient/solid backgrounds
  const isColoredBackground =
    cardStyle === "gradient" ||
    cardStyle === "solid" ||
    cardStyle === "image-bg";
  const titleColor = isColoredBackground
    ? "text-white"
    : "text-gray-500 dark:text-gray-400";
  const mainTextColor = isColoredBackground ? "text-white" : mainValueColor;
  const subTextColor = isColoredBackground ? "text-white/80" : subValueColor;

  // Handle image background
  const imageStyles =
    imageSrc && imagePosition === "background"
      ? {
          backgroundImage: `linear-gradient(to bottom, rgba(0,0,0,0.7), rgba(0,0,0,0.7)), url(${imageSrc})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }
      : {};

  // Animation classes
  const animationClass = animation
    ? "animate-in fade-in slide-in-from-bottom-3 duration-500"
    : "";

  // Accent border color
  const accentBorderColor = accentColor
    ? `border-${accentColor}-500`
    : "border-blue-500";

  // Handle accent styles
  let accentedClassName = className || "";
  if (cardStyle?.includes("accent")) {
    accentedClassName = cn(accentedClassName, accentBorderColor);
  }

  return (
    <Card
      className={cn(
        "overflow-hidden",
        getCardStyle(cardStyle, accentedClassName, accentColor),
        animationClass
      )}
      style={imageStyles}
    >
      {/* Top image */}
      {imageSrc && imagePosition === "top" && (
        <div className="w-full h-32 overflow-hidden">
          <Image
            src={imageSrc}
            alt={title}
            width={400}
            height={128}
            className="w-full h-full object-cover"
          />
        </div>
      )}

      {/* Badge */}
      {badge && (
        <div className="absolute top-2 right-2">
          <span
            className={cn(
              "text-xs font-medium px-2.5 py-0.5 rounded-full",
              badgeColor
            )}
          >
            {badge}
          </span>
        </div>
      )}

      {/* Circle indicator for circle-indicator style */}
      {cardStyle === "circle-indicator" && (
        <div
          className={cn(
            "absolute top-4 right-4 w-3 h-3 rounded-full",
            trendDirection === "up"
              ? "bg-green-500"
              : trendDirection === "down"
              ? "bg-red-500"
              : "bg-gray-500"
          )}
        ></div>
      )}

      {/* Left image */}
      {imageSrc && imagePosition === "left" && (
        <div className="flex">
          <div className="w-24 h-full overflow-hidden">
            <Image
              src={imageSrc}
              alt={title}
              width={96}
              height={200}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex-1">
            <CardContent className="p-6">
              <CardInnerContent
                title={title}
                mainValue={mainValue}
                subValue={subValue}
                percentChange={percentChange}
                trendDirection={trendDirection}
                trendIcon={trendIcon}
                trendColorClass={trendColorClass}
                icon={icon}
                titleColor={titleColor}
                mainTextColor={mainTextColor}
                subTextColor={subTextColor}
                isColoredBackground={isColoredBackground}
                sparkline={sparkline}
                secondaryMetric={secondaryMetric}
                compareValue={compareValue}
                compareLabel={compareLabel}
                tooltip={tooltip}
                progress={progress}
                progressColor={progressColor}
                chartPosition={chartPosition}
                chart={chart}
                actions={actions}
                footer={footer}
                comparisonText={comparisonText}
              />
            </CardContent>
          </div>
        </div>
      )}

      {/* Right image */}
      {imageSrc && imagePosition === "right" && (
        <div className="flex">
          <div className="flex-1">
            <CardContent className="p-6">
              <CardInnerContent
                title={title}
                mainValue={mainValue}
                subValue={subValue}
                percentChange={percentChange}
                trendDirection={trendDirection}
                trendIcon={trendIcon}
                trendColorClass={trendColorClass}
                icon={icon}
                titleColor={titleColor}
                mainTextColor={mainTextColor}
                subTextColor={subTextColor}
                isColoredBackground={isColoredBackground}
                sparkline={sparkline}
                secondaryMetric={secondaryMetric}
                compareValue={compareValue}
                compareLabel={compareLabel}
                tooltip={tooltip}
                progress={progress}
                progressColor={progressColor}
                chartPosition={chartPosition}
                chart={chart}
                actions={actions}
                footer={footer}
                comparisonText={comparisonText}
              />
            </CardContent>
          </div>
          <div className="w-24 h-full overflow-hidden">
            <Image
              src={imageSrc}
              alt={title}
              width={96}
              height={200}
              className="w-full h-full object-cover"
            />
          </div>
        </div>
      )}

      {/* Standard layout (no side images) */}
      {(!imageSrc ||
        (imageSrc &&
          (imagePosition === "background" ||
            imagePosition === "top" ||
            imagePosition === "bottom"))) && (
        <CardContent
          className={cn(
            "p-6",
            cardStyle === "split" &&
              "after:content-[''] after:absolute after:left-0 after:top-0 after:h-full after:w-1 after:bg-blue-500"
          )}
        >
          <CardInnerContent
            title={title}
            mainValue={mainValue}
            subValue={subValue}
            percentChange={percentChange}
            trendDirection={trendDirection}
            trendIcon={trendIcon}
            trendColorClass={trendColorClass}
            icon={icon}
            titleColor={titleColor}
            mainTextColor={mainTextColor}
            subTextColor={subTextColor}
            isColoredBackground={isColoredBackground}
            sparkline={sparkline}
            secondaryMetric={secondaryMetric}
            compareValue={compareValue}
            compareLabel={compareLabel}
            tooltip={tooltip}
            progress={progress}
            progressColor={progressColor}
            chartPosition={chartPosition}
            chart={chart}
            actions={actions}
            footer={footer}
            comparisonText={comparisonText}
          />
        </CardContent>
      )}

      {/* Bottom image */}
      {imageSrc && imagePosition === "bottom" && (
        <div className="w-full h-32 overflow-hidden">
          <Image
            src={imageSrc}
            alt={title}
            width={400}
            height={128}
            className="w-full h-full object-cover"
          />
        </div>
      )}
    </Card>
  );
};

// Extracted inner content to avoid duplication
const CardInnerContent = ({
  title,
  mainValue,
  subValue,
  percentChange,
  trendDirection,
  trendIcon,
  trendColorClass,
  icon,
  titleColor,
  mainTextColor,
  subTextColor,
  isColoredBackground,
  sparkline,
  secondaryMetric,
  compareValue,
  compareLabel,
  tooltip,
  progress,
  progressColor,
  chartPosition,
  chart,
  actions,
  footer,
  comparisonText,
}: {
  title: string;
  mainValue: string | number;
  subValue?: string | number;
  percentChange?: number;
  trendDirection?: TrendDirection;
  trendIcon: React.ReactNode;
  trendColorClass: string;
  icon?: React.ReactNode;
  titleColor: string;
  mainTextColor: string;
  subTextColor: string;
  isColoredBackground: boolean;
  sparkline?: React.ReactNode;
  secondaryMetric?: { label: string; value: string | number };
  compareValue?: string | number;
  compareLabel?: string;
  tooltip?: string;
  progress?: number;
  progressColor?: string;
  chartPosition?: string;
  chart?: React.ReactNode;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  comparisonText?: string;
}) => (
  <>
    <div className="flex justify-between items-start">
      <div className="relative">
        {tooltip && (
          <div className="absolute -top-10 left-0 bg-gray-900 text-white text-xs rounded py-1 px-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none whitespace-nowrap">
            {tooltip}
          </div>
        )}
        <h3 className={cn("text-sm font-medium mb-1", titleColor)}>{title}</h3>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <p className={cn("text-2xl font-semibold", mainTextColor)}>
              {mainValue}
            </p>
            {sparkline && <div className="ml-2">{sparkline}</div>}
          </div>
          {subValue && (
            <p className={cn("text-sm", subTextColor)}>{subValue}</p>
          )}
        </div>
      </div>
      {icon && (
        <div
          className={isColoredBackground ? "text-white/80" : "text-gray-400"}
        >
          {icon}
        </div>
      )}
    </div>

    {secondaryMetric && (
      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
        <span className={cn("text-sm", subTextColor)}>
          {secondaryMetric.label}
        </span>
        <p className={cn("text-lg font-medium", mainTextColor)}>
          {secondaryMetric.value}
        </p>
      </div>
    )}

    {compareValue && compareLabel && (
      <div className="mt-2">
        <div className="flex items-center gap-2">
          <span className={cn("text-sm", subTextColor)}>{compareLabel}:</span>
          <span className={cn("text-sm font-medium", mainTextColor)}>
            {compareValue}
          </span>
        </div>
      </div>
    )}

    {percentChange !== undefined && (
      <div className="mt-4 flex items-center gap-1">
        <span
          className={cn(
            "flex items-center",
            isColoredBackground
              ? trendDirection === "up"
                ? "text-green-300"
                : trendDirection === "down"
                ? "text-red-300"
                : "text-gray-300"
              : trendColorClass
          )}
        >
          {trendIcon}
          <span className="ml-1 text-sm font-medium">
            {Math.abs(percentChange)}%
          </span>
        </span>
        <span
          className={
            isColoredBackground
              ? "text-white/70 text-sm"
              : "text-sm text-gray-500 dark:text-gray-400"
          }
        >
          {comparisonText || "vs previous period"}
        </span>
      </div>
    )}

    {progress !== undefined && (
      <div className="mt-4">
        <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
          <div
            className={cn("h-2.5 rounded-full", progressColor)}
            style={{ width: `${progress}%` }}
          ></div>
        </div>
        <div className="flex justify-between mt-1">
          <span className={cn("text-xs", subTextColor)}>0%</span>
          <span className={cn("text-xs", subTextColor)}>100%</span>
        </div>
      </div>
    )}

    {chart && chartPosition === "bottom" && <div className="mt-4">{chart}</div>}

    {actions && (
      <div className="mt-4 flex justify-end space-x-2">{actions}</div>
    )}

    {footer && (
      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
        {footer}
      </div>
    )}
  </>
);

// Main component that renders multiple stat cards
export default function DynamicTotalCard({
  cards,
  className,
  columns = 4,
  gap = "md",
  containerClassName,
}: DynamicTotalCardProps) {
  const gridCols = {
    1: "grid-cols-1",
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4",
  };

  const gapSizes = {
    sm: "gap-2",
    md: "gap-4",
    lg: "gap-6",
  };

  return (
    <div className={cn(containerClassName)}>
      <div className={cn("grid", gridCols[columns], gapSizes[gap], className)}>
        {cards.map((card, index) => (
          <StatCard key={index} {...card} />
        ))}
      </div>
    </div>
  );
}
