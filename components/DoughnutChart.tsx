"use client";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { Doughnut } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend);

// Default blue color palette
const DEFAULT_COLOR_PALETTE = ["#0747b6", "#2265d8", "#2f91fa"];

interface DynamicDoughnutProps<T extends Record<string, unknown>> {
  data: T[];
  valueKey?: keyof T | string;
  labelKey?: keyof T | string;
  labelFormatter?: (item: T, index: number) => string;
  colorPalette?: string[];
  labelSeparator?: string;
}

const DoughnutChart = <T extends Record<string, unknown>>({ 
  data,
  valueKey = "currentBalance",
  labelKey = "accountName",
  labelFormatter,
  colorPalette = DEFAULT_COLOR_PALETTE,
  labelSeparator = "-"
}: DynamicDoughnutProps<T>) => {
  if (!data || data.length === 0) {
    return <div>No data to display</div>;
  }

  // Generate labels based on provided data
  const labels = data.map((item, index) => {
    if (labelFormatter) {
      return labelFormatter(item, index);
    }
    
    // Default label formatting logic for backward compatibility
    const rawLabel = String(item[labelKey]).split(labelSeparator)[0].trim();
    const previousOccurrences = data
      .slice(0, index)
      .filter((a) => String(a[labelKey]).split(labelSeparator)[0].trim() === rawLabel).length;
    
    return previousOccurrences > 0
      ? `${rawLabel} (${previousOccurrences + 1})`
      : rawLabel;
  });

  // Extract values based on provided valueKey
  const values = data.map((item) => Number(item[valueKey]) || 0);

  // Direct string formatting without using toLocaleString
  const formatCurrency = (value: number): string => {
    if (value >= 1000000000) {
      // Format as billions with B suffix
      const billions = value / 1000000000;
      const formatted =
        billions < 10 ? billions.toFixed(2) : billions.toFixed(1);
      return formatted + "B";
    } else if (value >= 1000000) {
      // Explicitly format as millions with M suffix
      const millions = value / 1000000;
      const formatted =
        millions < 10 ? millions.toFixed(2) : millions.toFixed(1);
      return formatted + "M";
    } else if (value >= 1000) {
      // Explicitly format as thousands with K suffix
      const thousands = value / 1000;
      const formatted =
        thousands < 10 ? thousands.toFixed(2) : thousands.toFixed(1);
      return formatted + "K";
    } else {
      // Small numbers just use direct value
      return value.toString();
    }
  };

  const total = values.reduce((sum, value) => sum + value, 0);

  // Apply the color palette, repeating if necessary
  const backgroundColors = data.map(
    (_, index) => colorPalette[index % colorPalette.length]
  );

  const adjustedValues = values.map((value) => {
    const percentage = (value / total) * 100;
    if (percentage < 1 && total > 0) {
      return total * 0.01;
    }
    return value;
  });

  const chartData = {
    labels: labels,
    datasets: [
      {
        data: adjustedValues,
        backgroundColor: backgroundColors,
        borderWidth: 1,
        borderColor: "#ffffff",
        hoverOffset: 8,
      },
    ],
  };

  return (
    <Doughnut
      data={chartData}
      options={{
        cutout: "60%",
        radius: "90%",
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            enabled: true,
            displayColors: true,
            callbacks: {
              label: (context) => {
                const index = context.dataIndex;
                const actualValue = values[index];
                const formattedValue = formatCurrency(actualValue);
                const percentage = ((actualValue / total) * 100).toFixed(1);
                return `${formattedValue} (${percentage}%)`;
              },
            },
          },
        },
        animation: {
          animateRotate: true,
          animateScale: true,
          duration: 800,
        },
        responsive: true,
        maintainAspectRatio: true,
      }}
    />
  );
};

export default DoughnutChart;
