"use client";

import React, { useEffect, useState } from "react";

declare global {
  interface Window {
    TradingView: {
      widget: new (config: TradingViewConfig) => unknown;
    };
  }
}

interface TradingViewConfig {
  container_id: string;
  width?: string | number;
  height?: string | number;
  symbol: string;
  interval?: string;
  timezone?: string;
  theme?: "light" | "dark";
  style?: string;
  locale?: string;
  toolbar_bg?: string;
  enable_publishing?: boolean;
  allow_symbol_change?: boolean;
  hideideas?: boolean;
  studies?: string[];
  show_popup_button?: boolean;
  popup_width?: string;
  popup_height?: string;
}

type MarketType = "crypto" | "forex";

interface UniversalChartProps {
  symbol: string;
  marketType: MarketType;
  theme?: "light" | "dark";
  containerWidth?: string | number;
  containerHeight?: string | number;
  allowSymbolChange?: boolean;
  chartId?: string;
}

const formatSymbol = (symbol: string, marketType: MarketType): string => {
  const cleanSymbol = symbol.replace("/", "");
  switch (marketType) {
    case "crypto":
      return `BINANCE:${cleanSymbol}`;
    case "forex":
      return `FX:${cleanSymbol}`;
    default:
      return symbol;
  }
};

const UniversalChart: React.FC<UniversalChartProps> = ({
  symbol,
  marketType,
  theme = "light",
  containerWidth = "100%",
  containerHeight = 610,
  allowSymbolChange = false,
  chartId = Math.random().toString(36).substring(7),
}) => {
  const containerId = `tradingview_${chartId}`;
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;

    const initializeWidget = () => {
      if (window.TradingView) {
        new window.TradingView.widget({
          container_id: containerId,
          width: containerWidth,
          height: containerHeight,
          symbol: formatSymbol(symbol, marketType),
          interval: "D",
          timezone: "Etc/UTC",
          theme: theme,
          style: "1",
          locale: "en",
          toolbar_bg: "#f1f3f6",
          enable_publishing: false,
          allow_symbol_change: allowSymbolChange,
          hideideas: true,
          studies: [
            "MASimple@tv-basicstudies",
            "RSI@tv-basicstudies",
            "VolumeMa@tv-basicstudies",
          ],
          show_popup_button: true,
          popup_width: "1000",
          popup_height: "650",
        });
      }
    };

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/tv.js";
    script.async = true;
    script.onload = (event: Event) => {
      initializeWidget();
    };

    // Check if script already exists
    const existingScript = document.querySelector(
      `script[src="${script.src}"]`
    );
    if (!existingScript) {
      document.head.appendChild(script);
    } else {
      // If script already exists, initialize widget directly
      initializeWidget();
    }

    return () => {
      const container = document.getElementById(containerId);
      if (container) {
        container.innerHTML = "";
      }
    };
  }, [
    isClient,
    symbol,
    marketType,
    theme,
    containerWidth,
    containerHeight,
    allowSymbolChange,
    containerId,
  ]);

  if (!isClient) {
    return <div className="w-full h-[610px] bg-gray-100" />;
  }

  return (
    <div className="universal-chart-container">
      <div id={containerId} />
    </div>
  );
};

export default UniversalChart;
