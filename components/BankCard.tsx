"use client";

import { formatAmount } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";
import React, { useMemo } from "react";
import Copy from "./Copy";

interface BankCardProps {
  account: {
    $id: string; // Appwrite document ID
    bankName: string;
    accountNumber: string;
    cardNumber?: string;
    currentBalance: number;
    ownerName?: string;
  };
  userName: string;
  showBalance?: boolean;
}

// Colors for bank cards
const bankCardColors = [
  { primary: "#8B5CF6", secondary: "#D946EF" }, // violet to fuchsia
  { primary: "#06B6D4", secondary: "#3B82F6" }, // cyan to blue
  { primary: "#10B981", secondary: "#0D9488" }, // emerald to teal
  { primary: "#F97316", secondary: "#F59E0B" }, // orange to amber
  //{ primary: "#F43F5E", secondary: "#EF4444" }, // rose to red
  { primary: "#3B82F6", secondary: "#6366F1" }, // blue to indigo
  { primary: "#84CC16", secondary: "#22C55E" }, // lime to green
  { primary: "#EC4899", secondary: "#F43F5E" }, // pink to rose
  { primary: "#EAB308", secondary: "#F97316" }, // yellow to orange
  { primary: "#6366F1", secondary: "#A855F7" }, // indigo to purple
];

// Mapping of color index to Tailwind gradient class
const gradientClasses = [
  "bg-bankcard-violet-fuchsia",
  "bg-bankcard-cyan-blue",
  "bg-bankcard-emerald-teal",
  "bg-bankcard-orange-amber",
  "bg-bankcard-rose-red",
  "bg-bankcard-blue-indigo",
  "bg-bankcard-lime-green",
  "bg-bankcard-pink-rose",
  "bg-bankcard-yellow-orange",
  "bg-bankcard-indigo-purple",
];

const BankCard = ({ account, userName, showBalance = true }: BankCardProps) => {
  // Get the last 4 digits of the card number if available
  const lastFourDigits = account.cardNumber
    ? account.cardNumber.slice(-4)
    : account.accountNumber.slice(-4);

  // Generate a consistent color based on the account ID
  const colorIndex = useMemo(() => {
    // Sum up character codes
    let sum = 0;
    for (let i = 0; i < account.$id.length; i++) {
      sum += account.$id.charCodeAt(i);
    }
    const index = sum % bankCardColors.length;
    //console.log(`Account ID: ${account.$id}, Sum: ${sum}, Index: ${index}`);
    return index;
  }, [account.$id]);

  // Get the gradient class based on the color index
  const gradientClass = gradientClasses[colorIndex];
  //console.log(`Using gradient class: ${gradientClass}`);

  return (
    <div className="flex flex-col">
      <Link
        //href={`/my-banks/${account.$id}`}
        href="#"
        className={`bank-card min-w-[290px] relative transition-transform duration-300 hover:shadow-lg hover:-translate-y-1 ${gradientClass}`}
      >
        <div className="bank-card_content relative z-20">
          <div>
            <h1 className="text-16 font-semibold text-white">
              {account.bankName}
            </h1>
            <p className="font-ibm-plex-serif font-black text-white">
              {formatAmount(account.currentBalance)}
            </p>
          </div>

          <article className="flex flex-col gap-2">
            <div className="flex justify-between">
              <h1 className="text-12 font-semibold text-white">
                {userName || account.ownerName || "Card Owner"}
              </h1>
              <h2 className="text-12 font-semibold text-white">●● / ●●</h2>
            </div>
            <p className="text-14 font-semibold tracking-[1.1px] text-white">
              ●●●● ●●●● ●●●● <span className="text-16">{lastFourDigits}</span>
            </p>
          </article>
        </div>

        <div className="bank-card_icon relative z-20">
          <Image src="/icons/Paypass.svg" width={20} height={24} alt="pay" />
          <Image
            src="/icons/mastercard.svg"
            width={45}
            height={32}
            alt="mastercard"
            className="ml-5"
          />
        </div>

        {/* Make sure the lines image is visible with correct z-index */}
        <div className="absolute inset-0 z-10">
          <Image
            src="/icons/lines.png"
            alt="lines"
            fill
            sizes="(max-width: 768px) 100vw, 300px"
            className="object-cover"
            priority
          />
        </div>
      </Link>

      {showBalance && <Copy title={account.accountNumber} />}
    </div>
  );
};

export default BankCard;
