"use client";

import { cn } from "@/lib/utils";

// Define interface for component props
interface BankTabItemProps {
  account: {
    $id: string;
    appwriteItemId: string;
    bankName: string;
    name?: string;
    [key: string]: string | number | boolean | object | undefined | null;
  };
  appwriteItemId: string;
}

export const BankTabItem = ({ account, appwriteItemId }: BankTabItemProps) => {
  const isActive = appwriteItemId === account?.appwriteItemId;
  const fullName = account.name || account.bankName;
  const displayName = fullName.split('-')[0].trim();
  return (
    <div
      className={cn(`banktab-item`, {
        " border-blue-600": isActive,
      })}
    >
      <p
        className={cn(`text-16 line-clamp-1 flex-1 font-medium text-gray-500`, {
          " text-blue-600": isActive,
        })}
      >
        {displayName}
      </p>
    </div>
  );
};