"use client";

import React, { useEffect, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";

interface PriceData {
  symbol: string;
  price: number;
  change24h: number;
  volume24h: number;
}

interface MarketPriceListProps {
  theme?: "light" | "dark";
}

const CRYPTO_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "MATICUSDT",
  "SOLUSDT",
  "DOTUSDT",
  "LTCUSDT",
];

const FOREX_PAIRS = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "AUDUSD",
  "USDCAD",
  "NZDUSD",
  "USDCHF",
  "EURJPY",
  "GBPJPY",
  "EURGBP",
];

const MarketPriceList: React.FC<MarketPriceListProps> = ({
  theme = "dark",
}) => {
  const [activeTab, setActiveTab] = useState<"crypto" | "forex">("crypto");
  const [cryptoPrices, setCryptoPrices] = useState<PriceData[]>([]);
  const [forexPrices, setForexPrices] = useState<PriceData[]>([]);
  const [socket, setSocket] = useState<WebSocket | null>(null);

  useEffect(() => {
    // Initialize with some dummy data
    setCryptoPrices(
      CRYPTO_SYMBOLS.map((symbol) => ({
        symbol,
        price: Math.random() * 1000,
        change24h: Math.random() * 10 - 5,
        volume24h: Math.random() * 1000000,
      }))
    );

    setForexPrices(
      FOREX_PAIRS.map((symbol) => ({
        symbol,
        price: Math.random() * 2,
        change24h: Math.random() * 2 - 1,
        volume24h: Math.random() * 1000000,
      }))
    );

    // Connect to Binance WebSocket for crypto prices
    const cryptoWs = new WebSocket("wss://stream.binance.com:9443/ws");

    cryptoWs.onopen = () => {
      const subscribeMsg = {
        method: "SUBSCRIBE",
        params: CRYPTO_SYMBOLS.map(
          (symbol) => `${symbol.toLowerCase()}@ticker`
        ),
        id: 1,
      };
      cryptoWs.send(JSON.stringify(subscribeMsg));
    };

    cryptoWs.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.e === "24hrTicker") {
        setCryptoPrices((prev) => {
          const index = prev.findIndex((p) => p.symbol === data.s);
          if (index === -1) return prev;

          const newPrices = [...prev];
          newPrices[index] = {
            symbol: data.s,
            price: parseFloat(data.c),
            change24h: parseFloat(data.P),
            volume24h: parseFloat(data.v),
          };
          return newPrices;
        });
      }
    };

    setSocket(cryptoWs);

    return () => {
      if (cryptoWs) {
        cryptoWs.close();
      }
    };
  }, []);

  const formatNumber = (num: number, decimals: number = 2) => {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(num);
  };

  const formatVolume = (volume: number) => {
    if (volume >= 1e9) return `${(volume / 1e9).toFixed(2)}B`;
    if (volume >= 1e6) return `${(volume / 1e6).toFixed(2)}M`;
    if (volume >= 1e3) return `${(volume / 1e3).toFixed(2)}K`;
    return volume.toFixed(2);
  };

  const getChangeColor = (change: number) => {
    return change >= 0 ? "text-green-500" : "text-red-500";
  };

  return (
    <div
      className={`rounded-lg shadow-lg ${
        theme === "dark" ? "bg-gray-800 text-white" : "bg-white text-gray-800"
      }`}
    >
      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        <button
          className={`flex-1 py-3 text-center font-semibold ${
            activeTab === "crypto"
              ? "border-b-2 border-blue-500"
              : "text-gray-500 hover:text-gray-300"
          }`}
          onClick={() => setActiveTab("crypto")}
        >
          Cryptocurrency
        </button>
        <button
          className={`flex-1 py-3 text-center font-semibold ${
            activeTab === "forex"
              ? "border-b-2 border-blue-500"
              : "text-gray-500 hover:text-gray-300"
          }`}
          onClick={() => setActiveTab("forex")}
        >
          Forex
        </button>
      </div>

      {/* Table Header */}
      <div className="grid grid-cols-4 gap-4 p-4 font-semibold border-b border-gray-700">
        <div>Symbol</div>
        <div>Price</div>
        <div>24h Change</div>
        <div>24h Volume</div>
      </div>

      {/* Price List */}
      <div className="max-h-[600px] overflow-y-auto">
        {(activeTab === "crypto" ? cryptoPrices : forexPrices).map((item) => (
          <div
            key={item.symbol}
            className="grid grid-cols-4 gap-4 p-4 border-b border-gray-700 hover:bg-gray-700"
          >
            <div className="font-medium">{item.symbol}</div>
            <div>${formatNumber(item.price)}</div>
            <div
              className={`flex items-center ${getChangeColor(item.change24h)}`}
            >
              {item.change24h >= 0 ? (
                <ArrowUpIcon className="w-4 h-4 mr-1" />
              ) : (
                <ArrowDownIcon className="w-4 h-4 mr-1" />
              )}
              {formatNumber(Math.abs(item.change24h))}%
            </div>
            <div>{formatVolume(item.volume24h)}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default MarketPriceList;
