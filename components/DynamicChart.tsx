"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  RadialLinearScale,
  Title,
  Tooltip,
  Legend,
  Filler,
  ChartOptions,
  ChartData,
  ChartType,
} from "chart.js";
import { Line, Bar, Doughnut, Pie, PolarArea, Radar } from "react-chartjs-2";
import { client } from "@/lib/appwrite/appwrite-client";
import { RealtimeResponseEvent } from "appwrite";

// Register all the chart components we'll use
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  RadialLinearScale,
  Title,
  Tooltip,
  Legend,
  Filler
);

// Default color palettes
const DEFAULT_COLOR_PALETTES = {
  blue: ["#0747b6", "#2265d8", "#2f91fa", "#4dabff", "#7fc3ff"],
  green: ["#047857", "#059669", "#10b981", "#34d399", "#6ee7b7"],
  red: ["#991b1b", "#b91c1c", "#dc2626", "#ef4444", "#f87171"],
  purple: ["#6d28d9", "#7c3aed", "#8b5cf6", "#a78bfa", "#c4b5fd"],
  orange: ["#9a3412", "#c2410c", "#ea580c", "#f97316", "#fdba74"],
  mixed: ["#0747b6", "#059669", "#b91c1c", "#6d28d9", "#c2410c"],
};

// Type for chart data item
export interface ChartDataItem {
  [key: string]: unknown;
  $id?: string;
}

// Type for subscription configuration
export interface SubscriptionConfig {
  enabled: boolean;
  databaseId: string;
  collectionId: string;
  documentIds?: string[];
}

// Type for dataset options
export type DatasetOption = Record<string, unknown>;

// Helper function to safely access dynamic properties
const getPropertyValue = <T extends ChartDataItem>(
  obj: T,
  key: keyof T | string
): unknown => {
  return obj[key as keyof T];
};

// Props for the DynamicChart component
export interface DynamicChartProps<T extends ChartDataItem> {
  // Basic chart configuration
  chartType: ChartType;
  data: T[];

  // Data mapping
  labelKey?: keyof T | string;
  valueKey?: keyof T | string | (keyof T | string)[];
  categoryKey?: keyof T | string;

  // Styling
  colorPalette?: string[] | keyof typeof DEFAULT_COLOR_PALETTES;
  title?: string;
  height?: number;
  width?: number | string;

  // Formatters
  valueFormatter?: (value: number) => string;
  labelFormatter?: (item: T, index: number) => string;

  // Options overrides
  chartOptions?: ChartOptions<ChartType>;

  // Appwrite realtime subscription
  subscription?: SubscriptionConfig;

  // Custom dataset configuration
  datasetLabels?: string[];
  datasetOptions?: DatasetOption[];

  // Additional props
  className?: string;
  showLegend?: boolean;
}

const DynamicChart = <T extends ChartDataItem>({
  chartType = "line",
  data: initialData,
  labelKey = "label",
  valueKey = "value",
  categoryKey,
  colorPalette = "blue",
  title,
  height = 300,
  width = "100%",
  valueFormatter,
  labelFormatter,
  chartOptions = {},
  subscription,
  datasetLabels,
  datasetOptions,
  className = "",
  showLegend = true,
}: DynamicChartProps<T>) => {
  // State to hold chart data that can be updated by subscriptions
  const [data, setData] = useState<T[]>(initialData);

  // Get colors from palette
  const colors = useMemo(() => {
    if (Array.isArray(colorPalette)) {
      return colorPalette;
    }
    return (
      DEFAULT_COLOR_PALETTES[
        colorPalette as keyof typeof DEFAULT_COLOR_PALETTES
      ] || DEFAULT_COLOR_PALETTES.blue
    );
  }, [colorPalette]);

  // Format data for chart based on chart type
  const chartData: ChartData<ChartType> = useMemo(() => {
    if (!data || data.length === 0) {
      return {
        labels: [],
        datasets: [],
      };
    }

    // For categorical charts (line, bar) that need categories and series
    if (chartType === "line" || chartType === "bar") {
      // If categoryKey is provided, organize data by categories
      if (categoryKey) {
        // Get unique categories
        const categories = Array.from(
          new Set(
            data.map((item) => String(getPropertyValue(item, categoryKey)))
          )
        ).sort();

        // Get unique labels/series
        const labels = Array.from(
          new Set(data.map((item) => String(getPropertyValue(item, labelKey))))
        );

        // Create datasets for each label/series
        const datasets = labels.map((label, index) => {
          const seriesData = categories.map((category) => {
            const matchingItem = data.find(
              (item) =>
                String(getPropertyValue(item, labelKey)) === label &&
                String(getPropertyValue(item, categoryKey)) === category
            );
            if (!matchingItem) return 0;

            // Handle valueKey differently based on type
            if (
              typeof valueKey === "string" ||
              valueKey instanceof String ||
              typeof valueKey === "symbol"
            ) {
              return (
                Number(getPropertyValue(matchingItem, valueKey as string)) || 0
              );
            }
            return 0;
          });

          return {
            label,
            data: seriesData,
            backgroundColor: colors[index % colors.length],
            borderColor:
              chartType === "line" ? colors[index % colors.length] : undefined,
            borderWidth: chartType === "line" ? 2 : 1,
            tension: chartType === "line" ? 0.4 : undefined,
            fill: chartType === "line" ? false : undefined,
            ...(datasetOptions && datasetOptions[index]
              ? datasetOptions[index]
              : {}),
          };
        });

        return {
          labels: categories,
          datasets,
        };
      }
      // Simple case: each data point is a separate category
      else {
        // Handle single valueKey (string) or multiple valueKeys (array)
        if (Array.isArray(valueKey)) {
          const datasets = valueKey.map((key, index) => {
            return {
              label: datasetLabels?.[index] || String(key),
              data: data.map(
                (item) => Number(getPropertyValue(item, key as string)) || 0
              ),
              backgroundColor: colors[index % colors.length],
              borderColor:
                chartType === "line"
                  ? colors[index % colors.length]
                  : undefined,
              borderWidth: chartType === "line" ? 2 : 1,
              tension: chartType === "line" ? 0.4 : undefined,
              fill: chartType === "line" ? false : undefined,
              ...(datasetOptions && datasetOptions[index]
                ? datasetOptions[index]
                : {}),
            };
          });

          return {
            labels: data.map((item, index) =>
              labelFormatter
                ? labelFormatter(item, index)
                : String(getPropertyValue(item, labelKey))
            ),
            datasets,
          };
        } else {
          return {
            labels: data.map((item, index) =>
              labelFormatter
                ? labelFormatter(item, index)
                : String(getPropertyValue(item, labelKey))
            ),
            datasets: [
              {
                label: datasetLabels?.[0] || title || "Data",
                data: data.map(
                  (item) =>
                    Number(getPropertyValue(item, valueKey as string)) || 0
                ),
                backgroundColor: colors,
                borderColor: chartType === "line" ? colors[0] : undefined,
                borderWidth: chartType === "line" ? 2 : 1,
                tension: chartType === "line" ? 0.4 : undefined,
                fill: chartType === "line" ? false : undefined,
                ...(datasetOptions && datasetOptions[0]
                  ? datasetOptions[0]
                  : {}),
              },
            ],
          };
        }
      }
    }
    // For pie, doughnut, polarArea charts
    else if (["pie", "doughnut", "polarArea"].includes(chartType)) {
      return {
        labels: data.map((item, index) =>
          labelFormatter
            ? labelFormatter(item, index)
            : String(getPropertyValue(item, labelKey))
        ),
        datasets: [
          {
            data: data.map(
              (item) => Number(getPropertyValue(item, valueKey as string)) || 0
            ),
            backgroundColor: colors,
            borderWidth: 1,
            borderColor: "#ffffff",
            ...(datasetOptions && datasetOptions[0] ? datasetOptions[0] : {}),
          },
        ],
      };
    }
    // For radar charts
    else if (chartType === "radar") {
      if (Array.isArray(valueKey)) {
        const datasets = valueKey.map((key, index) => {
          return {
            label: datasetLabels?.[index] || String(key),
            data: data.map(
              (item) => Number(getPropertyValue(item, key as string)) || 0
            ),
            backgroundColor: `${colors[index % colors.length]}50`, // 50% opacity
            borderColor: colors[index % colors.length],
            borderWidth: 2,
            ...(datasetOptions && datasetOptions[index]
              ? datasetOptions[index]
              : {}),
          };
        });

        return {
          labels: data.map((item, index) =>
            labelFormatter
              ? labelFormatter(item, index)
              : String(getPropertyValue(item, labelKey))
          ),
          datasets,
        };
      } else {
        return {
          labels: data.map((item, index) =>
            labelFormatter
              ? labelFormatter(item, index)
              : String(getPropertyValue(item, labelKey))
          ),
          datasets: [
            {
              label: datasetLabels?.[0] || title || "Data",
              data: data.map(
                (item) =>
                  Number(getPropertyValue(item, valueKey as string)) || 0
              ),
              backgroundColor: `${colors[0]}50`, // 50% opacity
              borderColor: colors[0],
              borderWidth: 2,
              ...(datasetOptions && datasetOptions[0] ? datasetOptions[0] : {}),
            },
          ],
        };
      }
    }

    // Default fallback
    return {
      labels: data.map((item, index) =>
        labelFormatter
          ? labelFormatter(item, index)
          : String(getPropertyValue(item, labelKey))
      ),
      datasets: [
        {
          label: title || "Data",
          data: data.map(
            (item) => Number(getPropertyValue(item, valueKey as string)) || 0
          ),
          backgroundColor: colors,
          borderColor: colors[0],
          borderWidth: 2,
          ...(datasetOptions && datasetOptions[0] ? datasetOptions[0] : {}),
        },
      ],
    };
  }, [
    data,
    chartType,
    labelKey,
    valueKey,
    categoryKey,
    colors,
    title,
    labelFormatter,
    datasetLabels,
    datasetOptions,
  ]);

  // Default options merged with provided options
  const options: ChartOptions<ChartType> = useMemo(() => {
    const defaultOptions: ChartOptions<ChartType> = {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: showLegend,
          position: "top" as const,
        },
        title: {
          display: !!title,
          text: title || "",
        },
        tooltip: {
          enabled: true,
          callbacks: {
            label: function (context) {
              let label = context.dataset.label || "";
              if (label) {
                label += ": ";
              }
              const value =
                context.parsed.y !== undefined
                  ? context.parsed.y
                  : context.parsed !== undefined
                  ? context.parsed
                  : context.raw;

              if (valueFormatter) {
                return label + valueFormatter(Number(value));
              }
              return label + value;
            },
          },
        },
      },
      scales:
        chartType === "line" || chartType === "bar"
          ? {
              y: {
                beginAtZero: true,
                ticks: {
                  callback: function (value) {
                    if (valueFormatter) {
                      return valueFormatter(Number(value));
                    }
                    return value;
                  },
                },
              },
            }
          : undefined,
    };

    // Merge with user provided options
    return {
      ...defaultOptions,
      ...chartOptions,
      plugins: {
        ...defaultOptions.plugins,
        ...(chartOptions.plugins || {}),
      },
    };
  }, [chartType, title, valueFormatter, chartOptions, showLegend]);

  // Set up Appwrite subscription if enabled
  useEffect(() => {
    if (!subscription || !subscription.enabled) return;

    const { databaseId, collectionId, documentIds } = subscription;

    let unsubscribe: () => void;

    if (documentIds && documentIds.length > 0) {
      // Subscribe to specific documents
      const channels = documentIds.map(
        (id) =>
          `databases.${databaseId}.collections.${collectionId}.documents.${id}`
      );

      unsubscribe = client.subscribe(
        channels,
        (response: RealtimeResponseEvent<T>) => {
          const eventType = response.events[0];
          const document = response.payload;

          if (eventType.endsWith(".create") || eventType.endsWith(".update")) {
            setData((prevData) => {
              const existingIndex = prevData.findIndex(
                (item) => item.$id === document.$id
              );
              if (existingIndex >= 0) {
                // Update existing item
                const newData = [...prevData];
                newData[existingIndex] = document;
                return newData;
              } else {
                // Add new item
                return [...prevData, document];
              }
            });
          } else if (eventType.endsWith(".delete") && document.$id) {
            setData((prevData) =>
              prevData.filter((item) => item.$id !== document.$id)
            );
          }
        }
      );
    } else {
      // Subscribe to entire collection
      unsubscribe = client.subscribe(
        `databases.${databaseId}.collections.${collectionId}.documents`,
        (response: RealtimeResponseEvent<T>) => {
          const eventType = response.events[0];
          const document = response.payload;

          if (eventType.endsWith(".create")) {
            setData((prevData) => [...prevData, document]);
          } else if (eventType.endsWith(".update")) {
            setData((prevData) => {
              const existingIndex = prevData.findIndex(
                (item) => item.$id === document.$id
              );
              if (existingIndex >= 0) {
                const newData = [...prevData];
                newData[existingIndex] = document;
                return newData;
              }
              return prevData;
            });
          } else if (eventType.endsWith(".delete") && document.$id) {
            setData((prevData) =>
              prevData.filter((item) => item.$id !== document.$id)
            );
          }
        }
      );
    }

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [subscription]);

  // Render appropriate chart based on chartType
  const renderChart = () => {
    switch (chartType) {
      case "line":
        return (
          <Line
            data={chartData as ChartData<"line">}
            options={options as ChartOptions<"line">}
          />
        );
      case "bar":
        return (
          <Bar
            data={chartData as ChartData<"bar">}
            options={options as ChartOptions<"bar">}
          />
        );
      case "doughnut":
        return (
          <Doughnut
            data={chartData as ChartData<"doughnut">}
            options={options as ChartOptions<"doughnut">}
          />
        );
      case "pie":
        return (
          <Pie
            data={chartData as ChartData<"pie">}
            options={options as ChartOptions<"pie">}
          />
        );
      case "polarArea":
        return (
          <PolarArea
            data={chartData as ChartData<"polarArea">}
            options={options as ChartOptions<"polarArea">}
          />
        );
      case "radar":
        return (
          <Radar
            data={chartData as ChartData<"radar">}
            options={options as ChartOptions<"radar">}
          />
        );
      default:
        return (
          <Line
            data={chartData as ChartData<"line">}
            options={options as ChartOptions<"line">}
          />
        );
    }
  };

  // Handle no data scenario
  if (!data || data.length === 0) {
    return (
      <div
        className={`flex items-center justify-center ${className}`}
        style={{ height: `${height}px`, width }}
      >
        <p className="text-gray-500">No data available</p>
      </div>
    );
  }

  return (
    <div className={className} style={{ height: `${height}px`, width }}>
      {renderChart()}
    </div>
  );
};

export default DynamicChart;
