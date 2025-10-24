"use client";

import { sidebarLinks } from "@/constants";
import { cn } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useMemo } from "react";
import Footer from "./Footer";
import { appConfig } from "@/lib/appconfig";
import { SiderbarProps } from "@/types";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";

const Sidebar = React.memo(({ user }: SiderbarProps) => {
  const pathname = usePathname();
  const apptitle = appConfig.title;
  const applogo = appConfig.icon;
  const t = useTranslations("navigation");
  const locale = useLocale();

  // Memoize filtered links to avoid recalculation on every render
  const filteredLinks = useMemo(() => {
    return sidebarLinks.filter((item) => {
      // For transassistant users, only show withdraw-list
      if (user?.role === "transassistant") {
        return item.route === "/withdraw-list";
      }

      // For merchant users, hide restricted routes
      if (user?.role === "merchant") {
        // Hide users-list, my-banks, withdraw-list, and settings for merchants
        if (
          item.route === "/users-list" ||
          item.route === "/my-banks" ||
          item.route === "/withdraw-list" ||
          item.route === "/settings"
        ) {
          return false;
        }
      } else if (user?.role !== "admin") {
        if (item.route === "/settings") {
          return false;
        }
      }
      return true;
    });
  }, [user?.role]);

  return (
    <section className="sidebar">
      <nav className="flex flex-col gap-4">
        <Link
          href={`/${locale}/`}
          className="mb-12 cursor-pointer flex items-center gap-2"
        >
          <Image
            src={applogo}
            width={46}
            height={46}
            alt="app logo"
            priority
            //className="size-[24px] max-xl:size-14"
          />
          <h1 className="sidebar-logo">{apptitle}</h1>
        </Link>

        {filteredLinks.map((item) => {
          // Construct the full route with locale
          const fullRoute = `/${locale}${item.route === "/" ? "" : item.route}`;
          const isActive =
            pathname === fullRoute ||
            (item.route !== "/" && pathname.startsWith(`${fullRoute}/`));
          return (
            <Link
              href={fullRoute}
              key={item.label}
              className={cn("sidebar-link", { "bg-bank-gradient": isActive })}
            >
              <div className="relative size-6">
                <Image
                  src={item.imgURL}
                  alt={item.label.toLowerCase().replace(" ", "")}
                  fill
                  className={cn({ "brightness-[3] invert-0": isActive })}
                />
              </div>
              <p
                className={cn("sidebar-label", {
                  "!text-white": isActive,
                })}
              >
                {/* Translate navigation labels */}
                {t(item.translationKey)}
              </p>
            </Link>
          );
        })}
      </nav>
      {user && <Footer user={user} />}
    </section>
  );
});

Sidebar.displayName = "Sidebar";

export default Sidebar;
