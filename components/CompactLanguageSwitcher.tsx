"use client";

import { useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { useState } from "react";
import Image from "next/image";

// Language options with flag icons
const languageOptions = [
  {
    locale: "en",
    flag: "https://hatscripts.github.io/circle-flags/flags/us.svg",
    label: "English",
  },
  {
    locale: "zh",
    flag: "https://hatscripts.github.io/circle-flags/flags/cn.svg",
    label: "中文",
  },
  {
    locale: "vn",
    flag: "https://hatscripts.github.io/circle-flags/flags/vn.svg",
    label: "Tiếng Việt",
  },
  // Add more languages as needed
];

const CompactLanguageSwitcher = () => {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  // Find current language
  const currentLanguage =
    languageOptions.find((lang) => lang.locale === locale) ||
    languageOptions[0];

  // Handle language change
  const changeLanguage = (newLocale: string) => {
    // Create the new path by replacing the locale segment
    const pathWithoutLocale = pathname.replace(`/${locale}`, "");
    const newPath = `/${newLocale}${pathWithoutLocale}`;
    router.push(newPath);
    router.refresh();
    setIsOpen(false);
  };

  return (
    <div className="relative">
      {/* Current Language Button */}
      <button
        className="flex items-center justify-center w-8 h-8 rounded-full overflow-hidden border border-gray-200 hover:border-gray-300 transition-colors"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Current language: ${currentLanguage.label}`}
      >
        <Image
          src={currentLanguage.flag}
          alt={currentLanguage.label}
          width={24}
          height={24}
          className="object-cover"
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute bottom-full mb-1 right-0 bg-white shadow-lg rounded-md py-1 min-w-28 z-50">
          {languageOptions.map((lang) => (
            <button
              key={lang.locale}
              className={`flex items-center w-full px-3 py-2 text-gray-800 text-left text-sm hover:bg-gray-100 ${
                lang.locale === locale ? "font-semibold bg-gray-50" : ""
              }`}
              onClick={() => changeLanguage(lang.locale)}
            >
              <Image
                src={lang.flag}
                alt={lang.label}
                width={18}
                height={18}
                className="mr-2"
              />
              <span>{lang.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default CompactLanguageSwitcher;
