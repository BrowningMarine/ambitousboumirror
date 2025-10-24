import React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Check, RefreshCw, X } from "lucide-react";
import HeaderBox from "@/components/HeaderBox";

interface WithdrawHeaderProps {
  totalPendingCount: number;
  suspiciousTransactionCount: number;
  completedTodayCount: number;
  userRole: string;
  assigningTransactions: Set<string>;
  loading: boolean;
  onBulkAssignment: () => void;
}

const WithdrawHeader: React.FC<WithdrawHeaderProps> = ({
  totalPendingCount,
  suspiciousTransactionCount,
  completedTodayCount,
  userRole,
  assigningTransactions,
  loading,
  onBulkAssignment,
}) => {
  const t = useTranslations("withdraw");

  return (
    <header className="home-header">
      <HeaderBox
        type="greeting"
        title="Pending Withdrawals"
        subtext="Solving pending withdrawals first in first out"
      />
      {/* Total pending count and bulk assignment button */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mt-4">
        <div className="text-lg font-medium text-gray-700 flex items-center gap-4">
          <div className="flex items-center gap-2">
            {t("totalPendingCount") || "Pending"}:{" "}
            <span className="text-blue-600 font-bold">{totalPendingCount}</span>
          </div>
          
          <div className="flex items-center gap-2">
            Completed Today:{" "}
            <span className="text-green-600 font-bold">{completedTodayCount}</span>
          </div>
          
          {suspiciousTransactionCount > 0 && (
            <div className="flex items-center gap-1">
              <X className="h-4 w-4 text-red-600" />
              <span className="text-red-600 font-bold">
                Suspicious: {suspiciousTransactionCount}
              </span>
            </div>
          )}
        </div>

        {/* Bulk assignment button for admin and transactor */}
        {(userRole === "admin" || userRole === "transactor") && (
          <Button
            onClick={onBulkAssignment}
            disabled={assigningTransactions.size > 0 || loading}
            className="form-btn-shadow"
            size="sm"
          >
            {assigningTransactions.has("bulk-assignment") ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                {t("starting") || "Starting..."}
              </>
            ) : assigningTransactions.has("background") ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin opacity-60" />
                {t("backgroundAssigning") || "Background Processing"}
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                {t("reassignAllOrders") || "Reassign All Orders"}
              </>
            )}
          </Button>
        )}
      </div>
    </header>
  );
};

export default WithdrawHeader;
