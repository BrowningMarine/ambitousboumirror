"use client";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { sidebarLinks } from "@/constants";
import { cn } from "@/lib/utils";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useMemo } from "react";
import Footer from "./Footer";
import { appConfig } from "@/lib/appconfig";
import { MobileNavProps } from "@/types";
import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";

const MobileNav = React.memo(({ user }: MobileNavProps) => {
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
    <section className="w-fulll max-w-[264px]">
      <Sheet>
        <SheetTrigger>
          <Image
            src="/icons/hamburger.svg"
            width={30}
            height={30}
            alt="menu"
            priority
            className="cursor-pointer"
          />
        </SheetTrigger>
        <SheetContent side="left" className="border-none bg-white">
          <VisuallyHidden>
            <SheetTitle>Menu</SheetTitle>
            <SheetDescription>
              Navigation menu for the mobile app.
            </SheetDescription>
          </VisuallyHidden>

          <div className="flex h-full flex-col">
            <Link
              href="/"
              className="cursor-pointer flex items-center gap-1 px-4 mb-8"
            >
              <Image
                src={applogo}
                width={46}
                height={46}
                alt="app logo"
                priority
              />
              <h1 className="text-xl font-ibm-plex-serif font-bold text-black-1">
                {apptitle}
              </h1>
            </Link>

            <nav className="flex flex-1 flex-col gap-6 text-white">
              {filteredLinks.map((item) => {
                const fullRoute = `/${locale}${
                  item.route === "/" ? "" : item.route
                }`;
                const isActive =
                  pathname === fullRoute ||
                  (item.route !== "/" && pathname.startsWith(`${fullRoute}/`));

                return (
                  <SheetClose asChild key={item.route}>
                    <Link
                      href={fullRoute}
                      key={item.label.toLowerCase().replace(" ", "")}
                      className={cn("mobilenav-sheet_close w-full", {
                        "bg-bank-gradient": isActive,
                      })}
                    >
                      <Image
                        src={item.imgURL}
                        alt={item.label.toLowerCase().replace(" ", "")}
                        width={20}
                        height={20}
                        className={cn({
                          "brightness-[3] invert-0": isActive,
                        })}
                      />
                      <p
                        className={cn("text-16 font-semibold text-black-2", {
                          "text-white": isActive,
                        })}
                      >
                        {t(item.translationKey)}
                      </p>
                    </Link>
                  </SheetClose>
                );
              })}
            </nav>

            <div className="mt-auto pb-4">
              <Footer user={user} type="mobile" />
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
});

MobileNav.displayName = "MobileNav";

export default MobileNav;
