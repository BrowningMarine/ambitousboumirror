"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  RefreshCw,
  Eye,
  EyeOff,
  Copy,
  Check,
  Image as ImageIcon,
} from "lucide-react";
import { generateUniqueString, formatAmount } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import Link from "next/link";
import { updateAccount } from "@/lib/actions/account.actions";
import { Account } from "@/types";
import Image from "next/image";
import { subscribeToCollectionDocuments } from "@/lib/client/appwriteSubcriptions";
import { appwriteConfig } from "@/lib/appwrite/appwrite-config";
import { useTranslations } from "next-intl";

interface AccountUpdateData {
  accountName: string;
  status: boolean;
  apiKey?: string;
  avaiableBalance?: number;
  currentBalance?: number;
  logoUrl?: string;
  minDepositAmount?: number;
  maxDepositAmount?: number;
  minWithdrawAmount?: number;
  maxWithdrawAmount?: number;
  depositWhitelistIps?: string[];
  withdrawWhitelistIps?: string[];
}

interface EditAccountFormProps {
  account: Account;
  userRole: string;
}

// Currency Input Component
function CurrencyInput({
  value,
  onChange,
  name,
  id,
  placeholder = "0",
  required = false,
  min = "0",
}: {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  name: string;
  id: string;
  placeholder?: string;
  required?: boolean;
  min?: string;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Format value for display when not focused
  const formattedValue =
    !isFocused && value ? formatAmount(parseFloat(value)) : value;

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleBlur = () => {
    setIsFocused(false);
  };

  // Simulate custom onChange for proper type handling
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Just pass the event up to parent handler
    onChange(e);
  };

  return (
    <Input
      ref={inputRef}
      id={id}
      name={name}
      type={isFocused ? "number" : "text"}
      value={formattedValue}
      onChange={handleInputChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder}
      step="10000"
      min={min}
      required={required}
      className={!isFocused ? "cursor-pointer" : ""}
    />
  );
}

export function EditAccountForm({ account, userRole }: EditAccountFormProps) {
  const t = useTranslations("accounts");
  const router = useRouter();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [previewLogoUrl, setPreviewLogoUrl] = useState<string | null>(null);

  // State for IP whitelist text fields
  const [depositIps, setDepositIps] = useState<string>(
    account.depositWhitelistIps ? account.depositWhitelistIps.join(", ") : ""
  );
  const [withdrawIps, setWithdrawIps] = useState<string>(
    account.withdrawWhitelistIps ? account.withdrawWhitelistIps.join(", ") : ""
  );

  const [formData, setFormData] = useState({
    accountName: account.accountName,
    avaiableBalance: account.avaiableBalance.toString(),
    currentBalance: account.currentBalance.toString(),
    status: account.status,
    apiKey: account.apiKey || "",
    logoUrl: account.logoUrl || "",
    minDepositAmount: account.minDepositAmount?.toString() || "",
    maxDepositAmount: account.maxDepositAmount?.toString() || "",
    minWithdrawAmount: account.minWithdrawAmount?.toString() || "",
    maxWithdrawAmount: account.maxWithdrawAmount?.toString() || "",
  });

  // Determine if this is initial setup (both balances are zero)
  const isInitialSetup =
    account.avaiableBalance === 0 && account.currentBalance === 0;

  // Determine if user can edit balance fields
  const canEditBalances =
    isInitialSetup && (userRole === "admin" || userRole === "transactor");

  const hasRoleButInitialized =
    (userRole === "admin" || userRole === "transactor") && !isInitialSetup;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    // If logoUrl changes, update the preview
    if (name === "logoUrl" && value) {
      setPreviewLogoUrl(value);
    } else if (name === "logoUrl" && !value) {
      setPreviewLogoUrl(null);
    }
  };

  const handleSwitchChange = (checked: boolean) => {
    setFormData((prev) => ({ ...prev, status: checked }));
  };

  const generateApiKey = () => {
    setIsGeneratingKey(true);

    try {
      // Generate a secure API key (24 characters, include uppercase, lowercase, numbers)
      const newApiKey = generateUniqueString({
        length: 24,
        includeLowercase: true,
        includeUppercase: true,
        includeNumbers: true,
        includeSpecial: false,
      });

      setFormData((prev) => ({ ...prev, apiKey: newApiKey }));
      setShowApiKey(true); // Show the newly generated key

      toast({
        description:
          t("apiKeyGenerated") ||
          "New API key generated. Remember to save the form to apply changes.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        description:
          t("apiKeyGeneratedFailed") ||
          "Failed to generate API key. Please try again.",
      });
      console.error(error);
    }

    setIsGeneratingKey(false);
  };

  // Function to mask API key
  const maskApiKey = (key: string) => {
    if (!key) return "";
    // Show first 4 and last 4 characters, mask the rest
    return key.length > 8
      ? `${key.substring(0, 4)}${"•".repeat(key.length - 8)}${key.substring(
          key.length - 4
        )}`
      : "•".repeat(key.length);
  };

  // Function to copy API key to clipboard
  const copyApiKey = () => {
    if (formData.apiKey) {
      navigator.clipboard.writeText(formData.apiKey);
      setIsCopied(true);

      toast({
        description: t("apiKeyCopied") || "API key copied to clipboard",
      });

      // Reset copy icon after 2 seconds
      setTimeout(() => {
        setIsCopied(false);
      }, 2000);
    }
  };

  // Setup realtime subscription for this account
  useEffect(() => {
    // Get the database ID from environment variable or configuration
    const DATABASE_ID = appwriteConfig.databaseId;
    const ACCOUNT_COLLECTION_ID = appwriteConfig.accountsCollectionId;

    // Subscribe to updates for this specific document instead of the whole collection
    const unsubscribe = subscribeToCollectionDocuments<Account>(
      DATABASE_ID,
      ACCOUNT_COLLECTION_ID,
      [account.$id], // subscribe to just this specific document by ID
      (updatedAccount) => {
        // Show notification about update
        toast({
          description:
            t("realtimeAccountUpdated") ||
            "Account data was updated in real-time.",
        });

        // Update form data with the latest values
        setFormData({
          accountName: updatedAccount.accountName,
          avaiableBalance: updatedAccount.avaiableBalance.toString(),
          currentBalance: updatedAccount.currentBalance.toString(),
          status: updatedAccount.status,
          apiKey: updatedAccount.apiKey || "",
          logoUrl: updatedAccount.logoUrl || "",
          minDepositAmount: updatedAccount.minDepositAmount?.toString() || "",
          maxDepositAmount: updatedAccount.maxDepositAmount?.toString() || "",
          minWithdrawAmount: updatedAccount.minWithdrawAmount?.toString() || "",
          maxWithdrawAmount: updatedAccount.maxWithdrawAmount?.toString() || "",
        });

        // Update the logo preview if changed
        if (updatedAccount.logoUrl) {
          setPreviewLogoUrl(updatedAccount.logoUrl);
        }

        // Update IP whitelist fields
        setDepositIps(
          updatedAccount.depositWhitelistIps
            ? updatedAccount.depositWhitelistIps.join(", ")
            : ""
        );
        setWithdrawIps(
          updatedAccount.withdrawWhitelistIps
            ? updatedAccount.withdrawWhitelistIps.join(", ")
            : ""
        );
      }
    );

    // Cleanup subscription when component unmounts
    return () => {
      unsubscribe();
    };
  }, [account.$id, toast, t]);

  // Add a helper function to parse IP lists
  const parseIpList = (ips: string): string[] => {
    if (!ips.trim()) return [];
    return ips
      .split(",")
      .map((ip) => ip.trim())
      .filter((ip) => ip !== "");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      // Parse the IP whitelist strings into arrays
      const depositWhitelistIps = parseIpList(depositIps);
      const withdrawWhitelistIps = parseIpList(withdrawIps);

      // Use AccountUpdateData since that's what you've defined
      const updateData: Omit<AccountUpdateData, "$id"> = {
        accountName: formData.accountName,
        status: formData.status,
        apiKey: formData.apiKey || undefined,
        logoUrl: formData.logoUrl || undefined,
        minDepositAmount: formData.minDepositAmount
          ? parseFloat(formData.minDepositAmount)
          : undefined,
        maxDepositAmount: formData.maxDepositAmount
          ? parseFloat(formData.maxDepositAmount)
          : undefined,
        minWithdrawAmount: formData.minWithdrawAmount
          ? parseFloat(formData.minWithdrawAmount)
          : undefined,
        maxWithdrawAmount: formData.maxWithdrawAmount
          ? parseFloat(formData.maxWithdrawAmount)
          : undefined,
        depositWhitelistIps,
        withdrawWhitelistIps,
      };

      // Only include balance fields if user can edit them
      if (canEditBalances) {
        updateData.avaiableBalance = parseFloat(formData.avaiableBalance);
        updateData.currentBalance = parseFloat(formData.currentBalance);
      }

      // Pass the account.$id as the first parameter, and updateData as the second
      const updatedAccount = await updateAccount(account.$id, updateData);

      if (updatedAccount) {
        toast({
          description:
            t("accountUpdateSuccess") || "Account updated successfully!",
        });
        router.refresh();
      } else {
        throw new Error(t("accountUpdateFailed") || "Failed to update account");
      }
    } catch (error) {
      console.error(t("accountUpdateFailed"), error);
      toast({
        variant: "destructive",
        description: `${t("accountUpdateFailed")} ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    }
    setIsLoading(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Logo Preview and URL Section */}
      <div className="space-y-2">
        <Label htmlFor="logoUrl">{t("logoUrl")}</Label>
        <div className="flex flex-col md:flex-row gap-4 items-start">
          {/* Logo Preview */}
          <div className="w-24 h-24 border rounded-md overflow-hidden flex items-center justify-center bg-gray-50">
            {previewLogoUrl || formData.logoUrl ? (
              <Image
                src={previewLogoUrl || formData.logoUrl}
                alt="Account Logo"
                width={96}
                height={96}
                className="object-contain"
                onError={() => {
                  setPreviewLogoUrl(null);
                  toast({
                    variant: "destructive",
                    description:
                      t("invalidImageUrl") ||
                      "Invalid image URL. Please check the URL and try again.",
                  });
                }}
              />
            ) : (
              <ImageIcon className="w-12 h-12 text-gray-300" />
            )}
          </div>

          {/* URL Input */}
          <div className="flex-1 space-y-2">
            <Input
              id="logoUrl"
              name="logoUrl"
              value={formData.logoUrl}
              onChange={handleChange}
              placeholder="https://example.com/logo.png"
              className="w-full"
            />
            <p className="text-sm text-gray-500">{t("imageUrlDescription")}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="accountName">{t("accountName")}</Label>
          <Input
            id="accountName"
            name="accountName"
            value={formData.accountName}
            onChange={handleChange}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="publicTransactionId">
            {t("publicTransactionsID")}
          </Label>
          <Input
            id="publicTransactionId"
            value={account.publicTransactionId}
            readOnly
            className="bg-gray-50"
          />
          <p className="text-sm text-gray-500">{t("idCantChange")}</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="avaiableBalance">{t("availableBalance")}</Label>
          {canEditBalances ? (
            <>
              <CurrencyInput
                id="avaiableBalance"
                name="avaiableBalance"
                value={formData.avaiableBalance}
                onChange={handleChange}
                required
              />
              <p className="text-xs text-amber-600 font-medium">
                {t("initialSetupOnce") ||
                  "Initial setup - you can only set this value once"}
              </p>
            </>
          ) : (
            <div className="flex items-center h-10 px-3 rounded-md border bg-gray-50 text-gray-500">
              {formatAmount(account.avaiableBalance)}
              {hasRoleButInitialized && (
                <span className="ml-2 text-xs text-gray-400">
                  {t("alreadyInit") || "(Already initialized)"}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="currentBalance">{t("currentBalance")}</Label>
          {canEditBalances ? (
            <>
              <CurrencyInput
                id="currentBalance"
                name="currentBalance"
                value={formData.currentBalance}
                onChange={handleChange}
                required
              />
              <p className="text-xs text-amber-600 font-medium">
                {t("initialSetupOnce") ||
                  "Initial setup - you can only set this value once"}
              </p>
            </>
          ) : (
            <div className="flex items-center h-10 px-3 rounded-md border bg-gray-50 text-gray-500">
              {formatAmount(account.currentBalance)}
              {hasRoleButInitialized && (
                <span className="ml-2 text-xs text-gray-400">
                  {t("alreadyInit") || "(Already initialized)"}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Transaction Amount Limits Section */}
      <div className="pt-4 border-t">
        <h3 className="text-base font-medium mb-4">
          {t("transAmtLimit") || "Transaction Amount Limits"}
        </h3>

        <div className="grid gap-6 md:grid-cols-2">
          {/* Deposit Limits */}
          <div className="space-y-4 p-4 border rounded-md bg-gray-50">
            <h4 className="font-medium">
              {t("depositLimit") || "Deposit Limits"}
            </h4>

            <div className="space-y-2">
              <Label htmlFor="minDepositAmount">
                {t("minimumDeposit") || "Minimum deposit"}
              </Label>
              <CurrencyInput
                id="minDepositAmount"
                name="minDepositAmount"
                value={formData.minDepositAmount}
                onChange={handleChange}
              />
              <p className="text-xs text-gray-500">
                {t("minimumDescription") ||
                  "Minimum amount allowed (0 for no limit)"}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxDepositAmount">
                {t("maximumDeposit") || "Maximum deposit"}
              </Label>
              <CurrencyInput
                id="maxDepositAmount"
                name="maxDepositAmount"
                value={formData.maxDepositAmount}
                onChange={handleChange}
              />
              <p className="text-xs text-gray-500">
                {t("maximumDescription") ||
                  "Maximum amount allowed (0 for no limit)"}
              </p>
            </div>
          </div>

          {/* Withdrawal Limits */}
          <div className="space-y-4 p-4 border rounded-md bg-gray-50">
            <h4 className="font-medium">
              {t("withdrawLimit") || "Withdrawal Limits"}
            </h4>

            <div className="space-y-2">
              <Label htmlFor="minWithdrawAmount">
                {t("minimumWithdraw") || "Minimum Withdrawal Amount"}
              </Label>
              <CurrencyInput
                id="minWithdrawAmount"
                name="minWithdrawAmount"
                value={formData.minWithdrawAmount}
                onChange={handleChange}
              />
              <p className="text-xs text-gray-500">
                {t("minimumDescription") ||
                  "Minimum amount allowed (0 for no limit)"}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxWithdrawAmount">
                {t("maximumWithdraw") || "Maximum withdraw"}
              </Label>
              <CurrencyInput
                id="maxWithdrawAmount"
                name="maxWithdrawAmount"
                value={formData.maxWithdrawAmount}
                onChange={handleChange}
              />
              <p className="text-xs text-gray-500">
                {t("maximumDescription") ||
                  "Maximum amount allowed (0 for no limit)"}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKey">{t("apikey") || "API Key"}</Label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              id="apiKey"
              name="apiKey"
              value={showApiKey ? formData.apiKey : maskApiKey(formData.apiKey)}
              onChange={handleChange}
              placeholder={t("apiKeyNotSet") || "No API key set"}
              readOnly
              className="font-mono text-sm pr-20"
            />
            <div className="absolute inset-y-0 right-0 pr-3 flex items-center gap-2">
              {formData.apiKey && (
                <>
                  <button
                    type="button"
                    className="text-gray-400 hover:text-gray-600 focus:outline-none"
                    onClick={copyApiKey}
                    title={t("copyApiKey") || "Copy API key"}
                  >
                    {isCopied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    type="button"
                    className="text-gray-400 hover:text-gray-600 focus:outline-none"
                    onClick={() => setShowApiKey(!showApiKey)}
                    title={
                      showApiKey
                        ? t("hideApiKey") || "Hide API key"
                        : t("showApiKey") || "Show API key"
                    }
                  >
                    {showApiKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </>
              )}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={generateApiKey}
            disabled={isGeneratingKey}
            className="shrink-0"
          >
            {isGeneratingKey ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            {t("generateKey") || "Generate Key"}
          </Button>
        </div>
        <p className="text-sm text-gray-500">
          {t("apikeyDescription") ||
            "The API key will be used for secure access to this account. Generate a new one to revoke existing access."}
        </p>
      </div>

      <div className="flex items-center justify-between border-t border-b py-4">
        <div className="space-y-0.5">
          <h3 className="text-base font-medium">
            {t("accountStatus") || "Account Status"}
          </h3>
          <p className="text-sm text-gray-500">
            {formData.status
              ? t("accountActivateDescription", { status: "active" })
              : t("accountActivateDescription", { status: "inactive" })}
          </p>
        </div>
        <Switch
          checked={formData.status}
          onCheckedChange={handleSwitchChange}
          aria-label="Toggle account status"
        />
      </div>

      {/* After the account limits section, add IP whitelist section */}
      {userRole === 'admin' && (
        <div className="border p-4 rounded-lg mt-4">
          <h3 className="text-lg font-semibold mb-2">{t("ipWhitelisting")}</h3>
          <p className="text-sm text-gray-500 mb-4">
            {t("ipWhitelistDescription")}
          </p>

          <div className="grid gap-4 mb-4">
            {/* Deposit IP Whitelist */}
            <div>
              <Label htmlFor="depositWhitelistIps">
                {t("depositWhitelistIps")}
              </Label>
              <Input
                id="depositWhitelistIps"
                value={depositIps}
                onChange={(e) => setDepositIps(e.target.value)}
                placeholder="192.168.1.1, 10.0.0.1"
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">{t("ipWhitelistHelp")}</p>
            </div>

            {/* Withdraw IP Whitelist */}
            <div>
              <Label htmlFor="withdrawWhitelistIps">
                {t("withdrawWhitelistIps")}
              </Label>
              <Input
                id="withdrawWhitelistIps"
                value={withdrawIps}
                onChange={(e) => setWithdrawIps(e.target.value)}
                placeholder="192.168.1.1, 10.0.0.1"
                className="mt-1"
              />
              <p className="text-xs text-gray-500 mt-1">{t("ipWhitelistHelp")}</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4">
        <Link href="/accounts">
          <Button className="light-btn" type="button">
            {t("cancelButton") || "Cancel"}
          </Button>
        </Link>
        <Button className="form-btn-shadow" type="submit" disabled={isLoading}>
          {isLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t("saving") || "Saving..."} </span>
            </div>
          ) : (
            t("saveChangesButton") || "Save Changes"
          )}
        </Button>
      </div>
    </form>
  );
}
