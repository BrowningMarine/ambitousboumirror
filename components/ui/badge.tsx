"use client"

import React from "react";  
import { cn } from "@/lib/utils";  

interface BadgeProps {  
  children: React.ReactNode;  
  variant?: "default" | "success" | "warning" | "danger" | "urgent" | "info";  
  className?: string;  
}  

export const Badge = ({ children, variant = "default", className }: BadgeProps) => {  
  const baseStyles = "inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-xs font-medium shadow-sm text-center max-w-full truncate";  
  
  const variantStyles = {  
    default: "bg-gray-100 text-gray-800",  
    success: "bg-green-100 text-green-800",  
    warning: "bg-yellow-100 text-yellow-800",
    urgent: "bg-orange-100 text-orange-800",  
    danger: "bg-red-100 text-red-800",
    info: "bg-blue-100 text-blue-800",  
  };  
  
  return (  
    <span className={cn(baseStyles, variantStyles[variant], className)}>  
      {children}  
    </span>  
  );  
};  