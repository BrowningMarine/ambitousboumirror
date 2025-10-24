"use client";

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export default function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const handleChange = (newLocale: string) => {
    startTransition(() => {
      // Parse the current pathname to find the route after the locale
      const pathnameWithoutLocale = pathname.replace(/^\/[^\/]+/, '');
      
      // Navigate to the new locale with the same pathname
      router.push(`/${newLocale}${pathnameWithoutLocale}`);
    });
  };

  return (
    <div className="language-switcher">
      <Select 
        defaultValue={locale} 
        onValueChange={handleChange}
        disabled={isPending}
      >
        <SelectTrigger className="w-[80px] bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100">
          <SelectValue placeholder={locale === 'en' ? '🇬🇧 EN' : '🇨🇳 中文'} />
        </SelectTrigger>
        <SelectContent className="bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100">
          <SelectItem value="en">🇬🇧 EN</SelectItem>
          <SelectItem value="zh">🇨🇳 中文</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}