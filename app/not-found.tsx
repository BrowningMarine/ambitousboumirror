import Link from "next/link";
import React from "react";
import { useTranslations } from "next-intl";

export default function LocaleNotFound() {
  const t = useTranslations("error");

  return (
    <div className="flex flex-col items-center justify-center min-h-screen text-center p-4">
      <h1 className="text-4xl font-bold mb-4">{t("notFoundTitle")}</h1>
      <p className="mb-6 text-gray-600">{t("notFoundMessage")}</p>
      <Link
        href="/"
        className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
      >
        {t("returnHome")}
      </Link>
    </div>
  );
}
