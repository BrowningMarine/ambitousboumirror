import MobileNav from "@/components/MobileNav";
import { TransitionProvider } from "@/components/PageTransition";
import Sidebar from "@/components/Sidebar";
import { getLoggedInUser } from "@/lib/actions/user.actions";
import { appConfig } from "@/lib/appconfig";
import Image from "next/image";
import { redirect } from "next/navigation";
import { cache, Suspense } from "react";

// Cache the user lookup to avoid repeated database calls during navigation
const getCachedLoggedInUser = cache(async () => {
  return await getLoggedInUser();
});

// Loading component for navigation elements
const NavigationSkeleton = () => (
  <div className="flex h-screen w-full">
    <div className="sidebar">
      <div className="flex flex-col gap-4 p-4">
        <div className="mb-12 flex items-center gap-2">
          <div className="h-8 w-8 bg-gray-200 rounded animate-pulse" />
          <div className="h-6 w-32 bg-gray-200 rounded animate-pulse" />
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex gap-3 items-center p-3">
            <div className="h-6 w-6 bg-gray-200 rounded animate-pulse" />
            <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
    <div className="flex size-full flex-col">
      <div className="root-layout">
        <div className="h-8 w-8 bg-gray-200 rounded animate-pulse" />
        <div className="h-8 w-8 bg-gray-200 rounded animate-pulse" />
      </div>
      <div className="flex-1 overflow-y-auto p-8">
        <div className="h-32 bg-gray-200 rounded animate-pulse" />
      </div>
    </div>
  </div>
);

async function NavigationLayout({
  children,
  locale,
}: {
  children: React.ReactNode;
  locale: string;
}) {
  // Use cached user lookup
  const loggedIn = await getCachedLoggedInUser();
  if (!loggedIn) {
    redirect(`/${locale}/sign-in`);
  }

  const applogo = appConfig.icon;

  return (
    <main className="flex h-screen w-full font-inter">
      <Sidebar user={loggedIn} />
      <div className="flex size-full flex-col">
        <div className="root-layout">
          <Image src={applogo} width={46} height={46} alt="logo" priority />
          <div>
            <MobileNav user={loggedIn} />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <TransitionProvider>{children}</TransitionProvider>
        </div>
      </div>
    </main>
  );
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: { locale: string };
}>) {
  const awaitedParams = await params;
  const locale = awaitedParams.locale as string;

  return (
    <Suspense fallback={<NavigationSkeleton />}>
      <NavigationLayout locale={locale}>{children}</NavigationLayout>
    </Suspense>
  );
}
