"use client";

import React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface TabItem {
  id: string;
  label: React.ReactNode;
  content: React.ReactNode;
  triggerClassName?: string;
  contentClassName?: string;
}

interface DynamicTabsProps {
  items: TabItem[];
  activeTab: string;
  onTabChange: (value: string) => void;
  className?: string;
  tabsListClassName?: string;
  triggerClassName?: string;
  contentClassName?: string;
}

const DynamicTabs = ({
  items,
  activeTab,
  onTabChange,
  className = "w-full",
  tabsListClassName = "mb-4",
  triggerClassName = "",
  contentClassName = "",
}: DynamicTabsProps) => {
  return (
    <Tabs value={activeTab} onValueChange={onTabChange} className={className}>
      <TabsList className={tabsListClassName}>
        {items.map((item) => (
          <TabsTrigger
            key={item.id}
            value={item.id}
            className={cn(triggerClassName, item.triggerClassName)}
          >
            {item.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {items.map((item) => (
        <TabsContent
          key={item.id}
          value={item.id}
          className={cn(contentClassName, item.contentClassName)}
        >
          {item.content}
        </TabsContent>
      ))}
    </Tabs>
  );
};

export default DynamicTabs;
