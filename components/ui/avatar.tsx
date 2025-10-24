"use client"

import React from "react";  
import { cn } from "@/lib/utils";  
import Image from "next/image";

interface AvatarProps {  
  src?: string | null;  
  alt?: string;  
  children?: React.ReactNode;  
  className?: string;  
}  

export const Avatar = ({ src, alt = "", children, className }: AvatarProps) => {  
  return (  
    <div className={cn("w-10 h-10 rounded-full overflow-hidden flex items-center justify-center", className)}>  
      {src ? (  
        <Image src={src} alt={alt} className="w-full h-full object-cover" />  
      ) : (  
        children  
      )}  
    </div>  
  );  
};  

export const AvatarFallback = ({ children, className }: { children?: React.ReactNode; className?: string }) => {  
  return (  
    <div className={cn("w-full h-full flex items-center justify-center bg-gray-200 text-gray-700 font-medium", className)}>  
      {children}  
    </div>  
  );  
};  

export const AvatarImage = ({ src, alt = "" }: { src?: string | null; alt?: string }) => {  
  return src ? <Image src={src} alt={alt} className="w-full h-full object-cover" /> : null;  
};