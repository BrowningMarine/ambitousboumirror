// components/RawCopy.tsx
import { useState } from "react";
import { cn } from "@/lib/utils";

interface RawCopyProps {
  value: string;
  title: string;
  className?: string;
}

export const RawCopy: React.FC<RawCopyProps> = ({
  value,
  title,
  className = "",
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={cn(
        "group relative flex items-center gap-1 text-blue-600 hover:text-blue-800",
        className
      )}
    >
      <span>{title}</span>
      {copied ? (
        <svg
          className="w-4 h-4 text-green-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      ) : (
        <svg
          className="w-4 h-4 opacity-0 group-hover:opacity-100"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
          />
        </svg>
      )}
      <span className="invisible group-hover:visible absolute -top-8 left-0 text-xs bg-gray-800 text-white px-2 py-1 rounded">
        {copied ? "Copied!" : "Click to copy"}
      </span>
    </button>
  );
};
