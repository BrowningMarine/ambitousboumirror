import { getRequestConfig } from 'next-intl/server';
import { appConfig } from './lib/appconfig';

// Define the available locales explicitly
//const availableLocales = ['en', 'zh', 'vn'];
const availableLocales = appConfig.locales;
export default getRequestConfig(async ({ locale }) => {
  // Check if the requested locale is available, otherwise use default
  let resolvedLocale = locale || 'en';

  // Make sure we only use available locales
  if (!availableLocales.includes(resolvedLocale)) {
    console.warn(`Locale "${resolvedLocale}" is not available, falling back to "en"`);
    resolvedLocale = 'en';
  }

  //console.log('i18n config using locale:', resolvedLocale);

  try {
    return {
      // Include the locale property since it's required
      locale: resolvedLocale,

      messages: (await import(`./messages/${resolvedLocale}.json`)).default,
      timeZone: 'Asia/Bangkok'
    };
  } catch (error) {
    console.error(`Failed to load messages for locale: ${resolvedLocale}`, error);

    // Always fallback to English if there's any issue
    return {
      locale: 'en',
      messages: (await import('./messages/en.json')).default,
      timeZone: 'Asia/Bangkok'
    };
  }
});