"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Eye,
  EyeOff,
  TestTube,
  TrendingUp,
  PercentIcon,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { appConfig } from "@/lib/appconfig";
import { useTranslations } from "next-intl";

const qrTemplateCode = appConfig.qrTemplateCode || "VE7bsvs";

// Define possible ribbon types
export type RibbonType = "test" | "discount" | "trending" | "special" | null;

interface QRCodeDisplayProps {
  // Source type - either direct QR code URL or VietQR parameters
  sourceType: "direct" | "vietqr";

  // For direct QR code
  qrCodeUrl?: string;

  // For VietQR
  bankCode?: string;
  accountNumber?: string;
  amount?: number;
  additionalInfo?: string;

  // Common props
  width?: number;
  height?: number;
  status?: string;
  bankName?: string;
  showHideToggle?: boolean;
  blurByDefault?: boolean;
  hideMessage?: string;
  showMessage?: string;
  unavailableMessage?: string;
  scanInstructions?: string;
  completedMessage?: string;
  onToggleVisibility?: () => void;

  // Ribbon display settings
  ribbon?: RibbonType;
  ribbonText?: string;

  // Suspicious IP props
  blur?: boolean;
  warningText?: string;
}

export default function QRCodeCard({
  sourceType,
  qrCodeUrl,
  bankCode,
  accountNumber,
  amount,
  additionalInfo,
  width = 180,
  height = 180,
  status,
  bankName,
  showHideToggle = false,
  blurByDefault = false,
  hideMessage,
  showMessage,
  unavailableMessage,
  scanInstructions,
  completedMessage,
  onToggleVisibility,
  ribbon,
  ribbonText,
  blur = false,
  warningText,
}: QRCodeDisplayProps) {
  const t = useTranslations("transactions");
  
  // Use translations with fallbacks
  const messages = {
    hideQrCode: hideMessage || t("hideQrCode"),
    showQrCode: showMessage || t("showQrCode"),
    qrNotAvailable: unavailableMessage || t("qrNotAvailable"),
    scanWithBankingApp: scanInstructions || t("scanWithBankingApp"),
    paymentCompletedSuccessfully: completedMessage || t("paymentCompletedSuccessfully"),
  };
  
  // Initialize with visible state unless explicitly set to blur/hide
  const [isVisible, setIsVisible] = useState(!(blurByDefault || blur));

  // Determine the source URL
  const qrSource =
    sourceType === "direct"
      ? qrCodeUrl
      : `https://img.vietqr.io/image/${bankCode}-${accountNumber}-${qrTemplateCode}.png${
          amount ? `?amount=${amount}` : ""
        }${additionalInfo ? `&addInfo=${additionalInfo}` : ""}`;

  // Check if QR is available (either has valid URL or valid VietQR params)
  const isQrAvailable =
    (sourceType === "direct" && qrCodeUrl) ||
    (sourceType === "vietqr" && bankCode && accountNumber);

  // Status checks
  const isCompleted = status === "completed";

  // Simplified blur logic - only blur when user hasn't chosen to show it
  const shouldBlur = !isVisible;

  // Get ribbon style and icon based on type
  const getRibbonStyle = () => {
    switch (ribbon) {
      case "test":
        return {
          bgColor: "bg-amber-500",
          icon: <TestTube className="h-3 w-3" />,
          text: ribbonText || "TEST",
        };
      case "discount":
        return {
          bgColor: "bg-green-500",
          icon: <PercentIcon className="h-3 w-3" />,
          text: ribbonText || "DISCOUNT",
        };
      case "trending":
        return {
          bgColor: "bg-blue-500",
          icon: <TrendingUp className="h-3 w-3" />,
          text: ribbonText || "TRENDING",
        };
      case "special":
        return {
          bgColor: "bg-orange-500",
          icon: <Tag className="h-3 w-3" />,
          text: ribbonText || "SPECIAL DEAL",
        };
      default:
        return null;
    }
  };

  // Toggle visibility function
  const toggleVisibility = () => {
    // If this is a suspicious transaction (blur is true), show a confirmation dialog
    if (blur && !isVisible) {
      const confirmed = window.confirm(t("suspiciousQrWarning"));
      if (!confirmed) {
        return; // Don't toggle if user cancels
      }
    }

    // Toggle visibility state
    setIsVisible((prevVisible) => !prevVisible);

    if (onToggleVisibility) {
      onToggleVisibility();
    }
  };

  if (!isQrAvailable) {
    return null;
  }

  // Get ribbon style if a ribbon is specified
  const ribbonStyle = ribbon ? getRibbonStyle() : null;

  return (
    <div className="flex flex-col items-center">
      <div className="bg-white p-3 rounded-lg border-2 border-gray-200 shadow-sm relative">
        {isCompleted ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm font-semibold text-green-600">
              {messages.paymentCompletedSuccessfully}
            </p>
          </div>
        ) : (
          <>
            <Image
              src={qrSource as string}
              alt="QR Code"
              width={width}
              height={height}
              className={`object-contain transition-all duration-500 ${
                shouldBlur ? "blur-md opacity-60" : ""
              }`}
              priority={true}
            />

            {/* Display warning for suspicious IP when hidden */}
            {blur && !isVisible && warningText && (
              <div className="absolute inset-0 flex items-center justify-center bg-red-500 bg-opacity-30 rounded-lg transition-opacity duration-500">
                <span className="text-white font-medium px-3 py-2 bg-red-600 bg-opacity-80 rounded text-center">
                  {warningText}
                </span>
              </div>
            )}

            {/* General overlay when QR is hidden */}
            {!isVisible && !blur && (
              <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 rounded-lg transition-opacity duration-500">
                <span className="text-white font-medium px-3 py-2 bg-black bg-opacity-70 rounded">
                  {t("qrCodeHidden")}
                </span>
              </div>
            )}

            {/* Ribbon Badge */}
            {ribbonStyle && (
              <>
                <div
                  className="absolute top-0 right-0"
                  style={{
                    width: 0,
                    height: 0,
                    borderStyle: "solid",
                    borderWidth: "0 50px 50px 0",
                    borderColor:
                      "transparent " +
                      (ribbonStyle.bgColor === "bg-orange-500"
                        ? "#F97316"
                        : ribbonStyle.bgColor === "bg-green-500"
                        ? "#22C55E"
                        : ribbonStyle.bgColor === "bg-blue-500"
                        ? "#3B82F6"
                        : ribbonStyle.bgColor === "bg-amber-500"
                        ? "#F59E0B"
                        : "#F97316") +
                      " transparent transparent",
                  }}
                />
                <div className="absolute top-0 right-0 text-[10px] font-bold text-white transform rotate-45 pt-3 pl-15">
                  {ribbonStyle.text}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {bankName && !isCompleted && (
        <div className="mt-2 w-full flex justify-center">
          <p className="text-sm font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
            {bankName}
          </p>
        </div>
      )}

      {/* Show toggle button if showHideToggle is true or if this is a suspicious transaction */}
      {(showHideToggle || blur) && !isCompleted && (
        <div className="mt-2 flex flex-col items-center">
          <Button variant="outline" size="sm" onClick={toggleVisibility}>
            {isVisible ? (
              <>
                <EyeOff className="h-4 w-4 mr-2" />
                {messages.hideQrCode}
              </>
            ) : (
              <>
                <Eye className="h-4 w-4 mr-2" />
                {blur
                  ? t("revealSuspiciousQr")
                  : blurByDefault
                  ? t("showSecureQr")
                  : messages.showQrCode}
              </>
            )}
          </Button>
          <p className="text-sm text-gray-500 text-center mt-2">
            {isVisible ? (
              messages.scanWithBankingApp
            ) : (
              <span className={`font-semibold ${blur ? "text-red-500" : ""}`}>
                {blur
                  ? t("clickToRevealSuspiciousQr")
                  : blurByDefault
                  ? t("qrCodeHiddenForSecurity")
                  : t("qrCodeHiddenClickEye")}
              </span>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
