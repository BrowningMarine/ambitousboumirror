"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/theme-provider";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={toggleTheme}
            className="p-2 rounded-full bg-gray-300 hover:bg-gray-500 dark:hover:bg-gray-700 transition"
          >
            {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
          </button>
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          className="text-sm text-gray-700 dark:text-gray-200"
        >
          {theme === "light" ? "Switch to dark" : "Switch to light"}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
