"use client";
import HeaderBox from "@/components/HeaderBox";
import { Button } from "@/components/ui/button";
import { Shield, Home } from "lucide-react";
import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <section className="home">
      <div className="home-content">
        <header className="home-header">
          <HeaderBox
            type="title"
            title="Access Denied"
            subtext="You don't have permission to access this page"
          />
        </header>
        <div className="mt-6 bg-white rounded-lg border p-12 text-center">
          <div className="flex justify-center mb-6">
            <Shield className="text-red-500 h-16 w-16" />
          </div>
          <h2 className="text-2xl font-bold mb-4">Unauthorized Access</h2>
          <p className="text-gray-600 mb-8">
            Sorry, your account does not have the required permissions to view
            this page. If you believe this is an error, please contact your
            administrator.
          </p>
          <div className="flex justify-center">
            <Link href="/">
              <Button className="flex items-center gap-2">
                <Home className="h-4 w-4" />
                Back to Home
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
