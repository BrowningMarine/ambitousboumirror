// components/TelegramForm.tsx
"use client";
import { useEffect, useState } from "react";

interface FormData {
  brand: string;
  saleDate: string;
}

export default function TelegramForm() {
  const [formData, setFormData] = useState<FormData>({
    brand: "",
    saleDate: "",
  });

  const [themeParams, setThemeParams] = useState({
    bg_color: "#ffffff",
    text_color: "#000000",
  });

  useEffect(() => {
    const webapp = window.Telegram?.WebApp;
    if (webapp) {
      // Set theme params after component mounts
      setThemeParams({
        bg_color: webapp.themeParams.bg_color || "#ffffff",
        text_color: webapp.themeParams.text_color || "#000000",
      });

      const handleMainButtonClick = () => {
        const data = JSON.stringify(formData);
        webapp.sendData(data);
        webapp.close();
      };

      webapp.MainButton.onClick(handleMainButtonClick);

      // Cleanup
      return () => {
        webapp.MainButton.offClick(handleMainButtonClick);
      };
    }
  }, [formData]);

  const handleInputChange = (field: keyof FormData, value: string) => {
    const newFormData = { ...formData, [field]: value };
    setFormData(newFormData);

    const webapp = window.Telegram?.WebApp;
    if (webapp) {
      if (newFormData.brand && newFormData.saleDate) {
        webapp.MainButton.enable();
      } else {
        webapp.MainButton.disable();
      }
    }
  };

  return (
    <div
      className="w-full max-w-md mx-auto p-6 rounded-lg shadow-sm"
      style={
        {
          backgroundColor: themeParams.bg_color,
          color: themeParams.text_color,
          // Add Telegram viewport variables
          "--tg-viewport-height": "100vh",
          "--tg-viewport-stable-height": "100vh",
        } as React.CSSProperties
      }
    >
      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">Nhãn</label>
          <select
            className="w-full p-2 border rounded-md"
            value={formData.brand}
            onChange={(e) => handleInputChange("brand", e.target.value)}
          >
            <option value="0">Chọn nhãn hàng</option>
            <option value="1000">KAPPA</option>
            <option value="1001">ECKO</option>
            <option value="1002">SUPERGA</option>
            <option value="1003">REPLAY</option>
            <option value="1008">STAPLE</option>
            <option value="1010">NINU&NICK</option>
            <option value="1011">WISSBRAND</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Phạm vi ngày</label>
          <input
            type="number"
            min="1"
            max="365"
            placeholder="Nhập số ngày"
            className="w-full p-2 border rounded-md"
            value={formData.saleDate}
            onChange={(e) => {
              const value = e.target.value;
              if (
                value === "" ||
                (parseInt(value) >= 1 && parseInt(value) <= 365)
              ) {
                handleInputChange("saleDate", value);
              }
            }}
          />
          <p className="text-sm text-gray-500 mt-1">
            phạm vi ngày trong khoản (1-365)
          </p>
        </div>
      </div>
    </div>
  );
}
