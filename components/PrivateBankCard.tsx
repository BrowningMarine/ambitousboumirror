import { formatAmount } from "@/lib/utils";  
import Image from "next/image";  
import Link from "next/link";  
import React from "react";  
import Copy from "./Copy";  

interface PrivateBankCardProps {  
  account: {  
    $id: string;  
    privateBankId: string;  
    bankName: string;  
    privateAccountNumber: string;  
    bankCardNumber: string;  
    availableBalance: string;  
    currentBalance: string;  
    type: string;  
    shareableId: string;  
  };  
  userName: string;  
  showBalance?: boolean;  
}  

const PrivateBankCard = ({  
  account,  
  userName,  
  showBalance = true,  
}: PrivateBankCardProps) => {  
  // Convert string balance to number  
  const currentBalance = parseFloat(account.currentBalance) || 0;  

  return (  
    <div className="flex flex-col">  
      <Link  
        href={`/transaction-history/?id=${account.$id}`}  
        className="bank-card min-w-[290px] private-card bg-bank-gradient"  
      >  
        <div className="bank-card_content">  
          <div>  
            <h1 className="text-16 font-semibold text-white">{account.bankName}</h1>  
            <p className="font-ibm-plex-serif font-black text-white">  
              {formatAmount(currentBalance)}  
            </p>  
          </div>  

          <article className="flex flex-col gap-2">  
            <div className="flex justify-between">  
              <h1 className="text-12 font-semibold text-white">{userName}</h1>  
              <h2 className="text-12 font-semibold text-white">  
                {account.type.toUpperCase()}  
              </h2>  
            </div>  
            <p className="text-14 font-semibold tracking-[1.1px] text-white">  
              ●●●● ●●●● ●●●● {" "}  
              <span className="text-16">  
                {account.bankCardNumber.slice(-4)}  
              </span>  
            </p>  
          </article>  
        </div>  

        <div className="bank-card_icon">  
          <Image src="/icons/Paypass.svg" width={20} height={24} alt="pay" />  
          <Image  
            src="/icons/mastercard.svg"  
            width={45}  
            height={32}  
            alt="mastercard"  
            className="ml-5"  
          />  
        </div>  

        <Image  
          src="/icons/lines.png"  
          width={316}  
          height={190}  
          alt="lines"  
          className="absolute top-0 left-0"  
        />  
      </Link>  

      {showBalance && <Copy title={account.shareableId} />}  
    </div>  
  );  
};  

export default PrivateBankCard;