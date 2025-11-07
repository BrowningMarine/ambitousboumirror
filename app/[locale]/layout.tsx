import { NextIntlClientProvider } from "next-intl";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster as ShadcnToaster } from "@/components/ui/toaster";
import { Toaster } from "sonner";
import { notFound } from "next/navigation";
import { appConfig } from "@/lib/appconfig";
import OneSignalSetup from "@/components/OneSignalSetup";

//const locales = ["en", "zh", "vn"];
const locales = appConfig.locales;

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { locale: string };
}) {
  // Access the locale from params directly
  const awaitedParams = await params;
  const locale = awaitedParams.locale as string;
  // Validate that the incoming `locale` parameter is valid
  if (!locales.includes(locale)) notFound();

  // Load messages for the current locale
  let messages;
  try {
    messages = (await import(`../../messages/${locale}.json`)).default;
  } catch (error) {
    console.error(`Could not load messages for locale "${locale}":`, error);
    // Fallback to English if the locale doesn't exist
    messages = (await import(`../../messages/en.json`)).default;
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <ThemeProvider>{children}</ThemeProvider>
      <OneSignalSetup />
      <ShadcnToaster />
      <Toaster position="top-right" />
    </NextIntlClientProvider>
  );
}
