import { NextIntlClientProvider } from 'next-intl';

export default async function AuthLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: { locale: string };
}>) {
  // Get the current locale from params
  const awaitedParams = await params;
  const locale = awaitedParams.locale as string;
  // Load messages for the current locale
  let messages;
  try {
    messages = (await import(`../../../messages/${locale}.json`)).default;
  } catch (error) {
    console.error(`Locale messages for ${locale} not found.`, error);
    // Fallback to English if the locale doesn't exist
    messages = (await import(`../../../messages/en.json`)).default;
  }

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <main className="flex min-h-screen w-full justify-between font-inter">
        {children}
        {/* <div className="auth-asset">
          <div>
            <Image src="/icons/auth-image.svg" alt="Auth Image" width={500} height={50} />
          </div>
        </div> */}
      </main>
    </NextIntlClientProvider>
  );
}