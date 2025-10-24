import { Metadata } from "next";

export const metadata: Metadata = {
  title: "TransBot - Transaction Viewer",
  description: "View and manage bot transactions",
};

export default function TransBotLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="min-h-screen bg-gray-50">{children}</div>;
}
