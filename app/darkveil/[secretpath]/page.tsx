"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Lock,
  Unlock,
  Save,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Server,
  Database,
  Eye,
  EyeOff,
  Shuffle,
} from "lucide-react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ConfigValue = string | number | boolean | string[] | any;

interface AppConfig {
  _metadata: {
    version: string;
    lastModified: string;
    description: string;
    requiresRestart: Record<string, boolean>;
  };
  baseSettings: Record<string, ConfigValue>;
  security: Record<string, ConfigValue>;
  qrService: Record<string, ConfigValue>;
  fallbackBank: Record<string, ConfigValue>;
  merchants: Record<string, ConfigValue>;
  banks: Record<string, ConfigValue>;
  databaseSettings?: Record<string, ConfigValue>;
  webhookSettings?: Record<string, ConfigValue>;
}

export default function ConfigAdminPage() {
  const params = useParams();
  const secretpath = params.secretpath as string;

  // Get secret path dynamically - don't use static appConfig
  // The API will validate if this secret path is correct
  const API_ENDPOINT = `/api/${secretpath}`;

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [authenticatedPassword, setAuthenticatedPassword] = useState(""); // Store password after auth

  // Session persistence: Load authentication state from sessionStorage on mount
  useEffect(() => {
    const savedAuth = sessionStorage.getItem(`config_auth_${secretpath}`);
    const savedPassword = sessionStorage.getItem(
      `config_password_${secretpath}`
    );

    if (savedAuth === "true" && savedPassword) {
      setIsAuthenticated(true);
      setAuthenticatedPassword(savedPassword);
      // Load config asynchronously
      void loadConfig();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secretpath]);
  const [showPassword, setShowPassword] = useState(false);
  const [showEncryptionKey, setShowEncryptionKey] = useState(false);
  const [showAdminPassword, setShowAdminPassword] = useState(false);
  const [showQrClientSecret, setShowQrClientSecret] = useState(false);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [originalConfig, setOriginalConfig] = useState<AppConfig | null>(null);
  const [jsonView, setJsonView] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // API Key Hash Generator states
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyHash, setApiKeyHash] = useState("");
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [hashCopied, setHashCopied] = useState(false);

  // Payment URL Decryption states
  const [encryptedUrl, setEncryptedUrl] = useState("");
  const [decryptedUrl, setDecryptedUrl] = useState("");
  const [decryptionError, setDecryptionError] = useState("");

  // Note: Secret path validation is handled by the API
  // If the path is wrong, authentication will fail with 404

  // Generate random secure string
  const generateRandomKey = (length: number = 32): string => {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  // Generate SHA-256 hash for API key
  const generateApiKeyHash = async (apiKey: string): Promise<string> => {
    const msgBuffer = new TextEncoder().encode(apiKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hashHex;
  };

  // Handle API key hash generation
  const handleGenerateHash = async () => {
    if (!apiKeyInput.trim()) {
      setError("Please enter an API key");
      return;
    }

    try {
      const hash = await generateApiKeyHash(apiKeyInput);
      setApiKeyHash(hash);
      setError("");
      setHashCopied(false);
    } catch {
      setError("Failed to generate hash");
    }
  };

  // Copy hash to clipboard
  const copyHashToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(apiKeyHash);
      setHashCopied(true);
      setTimeout(() => setHashCopied(false), 2000);
    } catch {
      setError("Failed to copy to clipboard");
    }
  };

  // Decrypt payment URL using AES-256-CBC
  const decryptPaymentUrl = async () => {
    if (!encryptedUrl.trim()) {
      setDecryptionError("Please enter an encrypted URL");
      return;
    }

    if (!config?.security?.paymentEncryptKey) {
      setDecryptionError("Payment encryption key not configured");
      return;
    }

    try {
      setDecryptionError("");
      
      // The encrypted URL format: iv:encryptedData
      const parts = encryptedUrl.split(":");
      if (parts.length !== 2) {
        throw new Error("Invalid encrypted URL format. Expected format: iv:encryptedData");
      }

      const [ivHex, encryptedHex] = parts;
      
      // Convert hex strings to Uint8Array
      const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
      const encryptedData = new Uint8Array(encryptedHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
      
      // Derive key from encryption key using SHA-256
      const keyMaterial = new TextEncoder().encode(config.security.paymentEncryptKey);
      const hashBuffer = await crypto.subtle.digest("SHA-256", keyMaterial);
      
      // Import the key
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        hashBuffer,
        { name: "AES-CBC" },
        false,
        ["decrypt"]
      );
      
      // Decrypt
      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: "AES-CBC", iv },
        cryptoKey,
        encryptedData
      );
      
      // Convert to string
      const decrypted = new TextDecoder().decode(decryptedBuffer);
      setDecryptedUrl(decrypted);
      setDecryptionError("");
    } catch (err) {
      setDecryptionError(
        err instanceof Error 
          ? `Decryption failed: ${err.message}` 
          : "Failed to decrypt URL. Check encryption key and format."
      );
      setDecryptedUrl("");
    }
  };

  // Copy decrypted URL to clipboard
  const copyDecryptedUrl = async () => {
    try {
      await navigator.clipboard.writeText(decryptedUrl);
      setSuccess("Decrypted URL copied to clipboard!");
      setTimeout(() => setSuccess(""), 2000);
    } catch {
      setDecryptionError("Failed to copy to clipboard");
    }
  };

  // Decode Base64 config data
  const decodeConfig = (encodedData: string): AppConfig => {
    const decoded = atob(encodedData);
    return JSON.parse(decoded);
  };

  // Load configuration
  const loadConfig = async () => {
    try {
      setLoading(true);
      setError("");
      const response = await fetch(API_ENDPOINT);

      if (!response.ok) {
        // Handle 404 specifically - invalid secret path
        if (response.status === 404) {
          throw new Error(
            "Invalid configuration path. This URL is not recognized."
          );
        }
        throw new Error("Failed to load configuration");
      }

      const responseData = await response.json();

      // Check if data is encoded
      const data = responseData.encoded
        ? decodeConfig(responseData.data)
        : responseData;

      setConfig(data);
      setOriginalConfig(JSON.parse(JSON.stringify(data))); // Deep clone
      setJsonView(JSON.stringify(data, null, 2));
      setHasChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  // Authenticate
  const handleAuth = async () => {
    try {
      setLoading(true);
      setError("");
      const response = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "auth", password }),
      });

      if (!response.ok) {
        // Handle 404 specifically - invalid secret path
        if (response.status === 404) {
          throw new Error(
            "Invalid configuration path. This URL is not recognized."
          );
        }

        const errorData = await response.json();
        throw new Error(errorData.error || "Invalid password");
      }

      setIsAuthenticated(true);
      setAuthenticatedPassword(password); // Store password for future API calls

      // Persist authentication in sessionStorage
      sessionStorage.setItem(`config_auth_${secretpath}`, "true");
      sessionStorage.setItem(`config_password_${secretpath}`, password);

      await loadConfig();
      setPassword(""); // Clear password input
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  // Save configuration
  const handleSave = async () => {
    if (!config) return;

    try {
      setLoading(true);
      setError("");
      setSuccess("");

      const response = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          config,
          password: authenticatedPassword,
        }),
      });

      if (!response.ok) {
        const data = await response.json();

        // If authentication failed, clear the session and require re-auth
        if (response.status === 401) {
          setIsAuthenticated(false);
          setAuthenticatedPassword("");
          // Clear sessionStorage
          sessionStorage.removeItem(`config_auth_${secretpath}`);
          sessionStorage.removeItem(`config_password_${secretpath}`);
          throw new Error("Session expired. Please authenticate again.");
        }

        throw new Error(data.error || "Failed to save configuration");
      }

      const data = await response.json();

      // If password was changed, update authenticatedPassword
      if (
        config?.security?.adminPasswordPlaintext &&
        config.security.adminPasswordPlaintext !== authenticatedPassword
      ) {
        setAuthenticatedPassword(config.security.adminPasswordPlaintext);
        // Update sessionStorage with new password
        sessionStorage.setItem(
          `config_password_${secretpath}`,
          config.security.adminPasswordPlaintext
        );
        console.log("Your password updated in session and sessionStorage");
      }

      // Check if configSecretPath changed - needs redirect to new URL
      const newSecretPath = config?.security?.configSecretPath;
      if (newSecretPath && newSecretPath !== secretpath) {
        // Clear old session storage
        sessionStorage.removeItem(`config_auth_${secretpath}`);
        sessionStorage.removeItem(`config_password_${secretpath}`);

        // Set new session storage with new path
        sessionStorage.setItem(`config_auth_${newSecretPath}`, "true");
        sessionStorage.setItem(
          `config_password_${newSecretPath}`,
          authenticatedPassword
        );

        const newUrl = `${window.location.origin}/darkveil/${newSecretPath}`;
        setSuccess(
          `✅ Configuration saved! New URL: ${newUrl} - Redirecting in 3 seconds...`
        );

        setHasChanges(false);
        setOriginalConfig(JSON.parse(JSON.stringify(config)));

        // Redirect to new URL after 3 seconds
        setTimeout(() => {
          window.location.href = `/darkveil/${newSecretPath}`;
        }, 3000);

        return; // Don't continue with normal success flow
      }

      // Show success message with better feedback
      if (data.requiresRestart) {
        setSuccess(
          `✅ Configuration saved successfully! ⚠️ SERVER RESTART REQUIRED for: ${data.changedFields.join(
            ", "
          )}`
        );
      } else {
        setSuccess("✅ Configuration saved successfully! Changes are live.");
      }

      setHasChanges(false);
      setOriginalConfig(JSON.parse(JSON.stringify(config)));

      // Auto-hide success message after 5 seconds
      setTimeout(() => {
        setSuccess("");
      }, 5000);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Save failed";
      setError(errorMessage);

      // Auto-hide error after 5 seconds
      setTimeout(() => {
        setError("");
      }, 5000);
    } finally {
      setLoading(false);
    }
  };

  // Reset changes
  const handleReset = () => {
    if (originalConfig) {
      setConfig(JSON.parse(JSON.stringify(originalConfig)));
      setJsonView(JSON.stringify(originalConfig, null, 2));
      setHasChanges(false);
      setSuccess("");
      setError("");
    }
  };

  // Update JSON view
  const handleJsonUpdate = (value: string) => {
    setJsonView(value);
    try {
      const parsed = JSON.parse(value);
      setConfig(parsed);
      setHasChanges(true);
      setError("");
    } catch {
      setError("Invalid JSON format");
    }
  };

  // Update specific field
  const updateField = (
    section: keyof AppConfig,
    key: string,
    value: string | number
  ) => {
    if (!config || section === "_metadata") return;

    const newConfig = { ...config };
    const sectionData = newConfig[section];

    if (typeof sectionData === "object" && sectionData !== null) {
      newConfig[section] = {
        ...sectionData,
        [key]: value,
      } as typeof sectionData;
    }

    setConfig(newConfig);
    setJsonView(JSON.stringify(newConfig, null, 2));
    setHasChanges(true);
  };

  // Check if field requires restart
  const requiresRestart = (section: string): boolean => {
    if (!config) return false;
    return config._metadata.requiresRestart[section] || false;
  };

  // API will validate if this secret path is correct and return 404 if invalid

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-blue-600" />
            </div>
            <CardTitle>Configuration</CardTitle>
            <CardDescription>
              Password-protected configuration editor
              <br />
              <span className="text-xs text-gray-500">
                No database required - always available
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="relative">
              <Input
                type={showPassword ? "text" : "password"}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleAuth()}
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
            <Button
              onClick={handleAuth}
              disabled={loading || !password}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-md"
            >
              {loading ? "Authenticating..." : "Unlock Configuration"}
            </Button>
            {error && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-4 sm:py-8 px-2 sm:px-4">
      <div className="max-w-6xl mx-auto space-y-4 sm:space-y-6">
        {/* Header */}
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex-1">
                <CardTitle className="flex items-center gap-2 text-lg sm:text-xl">
                  <Unlock className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
                  Configuration Editor
                </CardTitle>
                <CardDescription className="text-xs sm:text-sm">
                  Manage application configuration without database access
                  {config && (
                    <span className="block mt-1 text-xs">
                      Last modified:{" "}
                      {new Date(config._metadata.lastModified).toLocaleString()}
                    </span>
                  )}
                </CardDescription>
              </div>
              <div className="flex gap-2 sm:shrink-0">
                {hasChanges && (
                  <>
                    <Button
                      variant="outline"
                      onClick={handleReset}
                      disabled={loading}
                      className="border-2 hover:bg-gray-100 font-medium text-xs sm:text-sm"
                    >
                      <RotateCcw className="w-4 h-4 sm:mr-2" />
                      <span className="hidden sm:inline">Reset</span>
                    </Button>
                    <Button
                      onClick={handleSave}
                      disabled={loading}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-medium shadow-md text-xs sm:text-sm"
                    >
                      <Save className="w-4 h-4 sm:mr-2" />
                      <span className="hidden sm:inline">Save Changes</span>
                      <span className="sm:hidden ml-1">Save</span>
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Status Messages */}
        {success && (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Configuration Tabs */}
        {config && (
          <Tabs defaultValue="base" className="w-full">
            <TabsList className="grid w-full grid-cols-3 sm:grid-cols-3 md:grid-cols-6 h-auto p-1 bg-gray-100 gap-1">
              <TabsTrigger
                value="base"
                className="data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-blue-500 data-[state=active]:text-blue-600 font-medium text-xs sm:text-sm px-2 py-2"
              >
                <span className="hidden sm:inline">Base Settings</span>
                <span className="sm:hidden">Base</span>
              </TabsTrigger>
              <TabsTrigger
                value="database"
                className="data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-yellow-500 data-[state=active]:text-yellow-600 font-medium text-xs sm:text-sm px-2 py-2"
              >
                <span className="hidden sm:inline">Database</span>
                <span className="sm:hidden">DB</span>
              </TabsTrigger>
              <TabsTrigger
                value="advanced"
                className="data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-cyan-500 data-[state=active]:text-cyan-600 font-medium text-xs sm:text-sm px-2 py-2"
              >
                <span className="hidden md:inline">Advanced & QR</span>
                <span className="md:hidden">Adv/QR</span>
              </TabsTrigger>
              <TabsTrigger
                value="security"
                className="data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-red-500 data-[state=active]:text-red-600 font-medium text-xs sm:text-sm px-2 py-2"
              >
                Security
              </TabsTrigger>
              <TabsTrigger
                value="fallback"
                className="data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-green-500 data-[state=active]:text-green-600 font-medium text-xs sm:text-sm px-2 py-2"
              >
                <span className="hidden md:inline">Merchants & Banks</span>
                <span className="md:hidden">M&B</span>
              </TabsTrigger>
              <TabsTrigger
                value="json"
                className="data-[state=active]:bg-white data-[state=active]:border-b-2 data-[state=active]:border-indigo-500 data-[state=active]:text-indigo-600 font-medium text-xs sm:text-sm px-2 py-2"
              >
                JSON
              </TabsTrigger>
            </TabsList>{" "}
            {/* Base Settings */}
            <TabsContent value="base">
              <Card>
                <CardHeader>
                  <CardTitle>Base Settings</CardTitle>
                  <CardDescription>
                    Core application configuration
                    {requiresRestart("baseSettings") && (
                      <Badge variant="default" className="ml-2">
                        <Server className="w-3 h-3 mr-1" />
                        Restart not required
                      </Badge>
                    )}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Title</label>
                    <Input
                      value={String(config.baseSettings.title || "")}
                      onChange={(e) =>
                        updateField("baseSettings", "title", e.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">
                      Payment Base URL
                    </label>
                    <Input
                      value={String(config.baseSettings.paymentBaseUrl || "")}
                      onChange={(e) =>
                        updateField(
                          "baseSettings",
                          "paymentBaseUrl",
                          e.target.value
                        )
                      }
                      placeholder="https://page.example.com"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      All payment URLs will use this domain
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">
                      Payment Window (seconds)
                    </label>
                    <Input
                      type="number"
                      value={String(
                        config.baseSettings.paymentWindowSeconds || 0
                      )}
                      onChange={(e) =>
                        updateField(
                          "baseSettings",
                          "paymentWindowSeconds",
                          parseInt(e.target.value)
                        )
                      }
                    />
                  </div>

                  {/* Webhook Settings Section */}
                  <div className="border-t pt-4 sm:pt-6 mt-4 sm:mt-6">
                    <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4 flex flex-wrap items-center gap-2">
                      Webhook Configuration
                      <Badge variant="default" className="bg-green-600 text-xs">
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Live Reload
                      </Badge>
                    </h3>
                    
                    <Alert className="bg-green-50 border-green-200 mb-4">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                      <AlertDescription className="text-green-800 text-xs sm:text-sm">
                        ✅ Webhook settings load dynamically - changes take effect immediately!
                      </AlertDescription>
                    </Alert>

                    {/* Enable Callback Batching */}
                    <div className="space-y-4">
                      <div className="flex items-start space-x-3">
                        <input
                          type="checkbox"
                          id="enableCallbackBatching"
                          checked={Boolean(
                            config.webhookSettings?.enableCallbackBatching ?? true
                          )}
                          onChange={(e) => {
                            const newConfig = { ...config };
                            if (!newConfig.webhookSettings) {
                              newConfig.webhookSettings = {};
                            }
                            newConfig.webhookSettings.enableCallbackBatching = e
                              .target.checked as never;
                            setConfig(newConfig);
                            setJsonView(JSON.stringify(newConfig, null, 2));
                            setHasChanges(true);
                          }}
                          className="w-5 h-5 mt-0.5"
                        />
                        <div className="flex-1">
                          <label
                            htmlFor="enableCallbackBatching"
                            className="text-sm font-medium cursor-pointer"
                          >
                            Enable Webhook Callback Batching
                          </label>
                          <p className="text-xs text-gray-600 mt-1">
                            When enabled, multiple orders with the same callback
                            URL are batched into a single array request.
                          </p>
                        </div>
                      </div>

                      {/* Explanation Cards */}
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                        {/* Batching Enabled */}
                        <div
                          className={`p-3 sm:p-4 rounded-lg border-2 ${
                            config.webhookSettings?.enableCallbackBatching ?? true
                              ? "bg-teal-50 border-teal-300"
                              : "bg-gray-50 border-gray-200"
                          }`}
                        >
                          <h4 className="font-semibold text-xs sm:text-sm mb-2 flex items-center gap-2">
                            <CheckCircle2
                              className={`w-3 h-3 sm:w-4 sm:h-4 ${
                                config.webhookSettings?.enableCallbackBatching ??
                                true
                                  ? "text-teal-600"
                                  : "text-gray-400"
                              }`}
                            />
                            Batching Mode (Recommended)
                          </h4>
                          <div className="text-xs space-y-1 sm:space-y-2 text-gray-700">
                            <p>
                              <strong>How it works:</strong> Groups orders by callback URL
                            </p>
                            <p>
                              <strong>Format:</strong> ALWAYS array (even single items)
                            </p>
                            <p>
                              <strong>Example:</strong> 1 order → array[1], 10 orders → array[10]
                            </p>
                            <p className="text-teal-700">
                              ✅ <strong>Benefits:</strong> 90%+ reduction in HTTP requests
                            </p>
                          </div>
                        </div>

                        {/* Batching Disabled */}
                        <div
                          className={`p-3 sm:p-4 rounded-lg border-2 ${
                            !(
                              config.webhookSettings?.enableCallbackBatching ??
                              true
                            )
                              ? "bg-orange-50 border-orange-300"
                              : "bg-gray-50 border-gray-200"
                          }`}
                        >
                          <h4 className="font-semibold text-xs sm:text-sm mb-2 flex items-center gap-2">
                            <AlertTriangle
                              className={`w-3 h-3 sm:w-4 sm:h-4 ${
                                !(
                                  config.webhookSettings
                                    ?.enableCallbackBatching ?? true
                                )
                                  ? "text-orange-600"
                                  : "text-gray-400"
                              }`}
                            />
                            Parallel Mode (Legacy)
                          </h4>
                          <div className="text-xs space-y-1 sm:space-y-2 text-gray-700">
                            <p>
                              <strong>How it works:</strong> Sends each order separately
                            </p>
                            <p>
                              <strong>Example:</strong> 10 orders → 10 separate requests
                            </p>
                            <p className="text-orange-700">
                              ⚠️ <strong>Note:</strong> More network overhead
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            {/* Database Settings */}
            <TabsContent value="database">
              <Card>
                <CardHeader>
                  <CardTitle>Database Configuration</CardTitle>
                  <CardDescription>
                    Core database running mode and order prefix settings
                    <Badge variant="default" className="ml-2 bg-green-600">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Live Reload
                    </Badge>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <Alert className="bg-green-50 border-green-200">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <AlertDescription className="text-green-800">
                      ✅ These settings are loaded dynamically - changes take
                      effect immediately without server restart!
                    </AlertDescription>
                  </Alert>

                  {/* Core Running Mode */}
                  <div className="space-y-3">
                    <label className="text-sm font-medium">
                      Core Running Mode
                    </label>
                    <select
                      value={String(
                        config.databaseSettings?.coreRunningMode || "auto"
                      )}
                      onChange={(e) => {
                        const newConfig = { ...config };
                        if (!newConfig.databaseSettings) {
                          newConfig.databaseSettings = {};
                        }
                        newConfig.databaseSettings.coreRunningMode = e.target
                          .value as never;
                        setConfig(newConfig);
                        setJsonView(JSON.stringify(newConfig, null, 2));
                        setHasChanges(true);
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      <option value="auto">Auto (Health Check)</option>
                      <option value="appwrite">Appwrite Only</option>
                      <option value="supabase">Supabase Only</option>
                      <option value="fallback">
                        Fallback Only (No Database)
                      </option>
                    </select>
                    <div className="text-xs text-gray-600 space-y-1 ml-1">
                      <p>
                        <strong>🔄 Auto (Health Check):</strong> System
                        automatically selects healthy database based on priority
                        order below
                      </p>
                      <p>
                        <strong>🟦 Appwrite Only:</strong> System only uses
                        Appwrite database (no fallback)
                      </p>
                      <p>
                        <strong>🟩 Supabase Only:</strong> System only uses
                        Supabase database (no fallback)
                      </p>
                      <p>
                        <strong>🟡 Fallback Only:</strong> No database writes -
                        uses config fallback bank/merchant, validates payments
                        via encrypted URL timestamp (payment-direct only)
                      </p>
                    </div>
                  </div>

                  {/* Database Priority Order (only shown in auto mode) */}
                  {config.databaseSettings?.coreRunningMode === "auto" && (
                    <div className="space-y-3 border-t pt-4">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                          Auto Mode
                        </span>
                        Database Priority Order
                      </label>
                      <div className="space-y-2">
                        {["appwrite", "supabase", "fallback"].map(
                          (db, index) => {
                            const currentPriority = config.databaseSettings
                              ?.databasePriority || [
                              "appwrite",
                              "supabase",
                              "fallback",
                            ];
                            const currentIndex = currentPriority.indexOf(
                              db as never
                            );
                            const displayIndex =
                              currentIndex === -1 ? index : currentIndex;

                            return (
                              <div key={db} className="flex items-center gap-3">
                                <select
                                  value={displayIndex}
                                  onChange={(e) => {
                                    const newConfig = { ...config };
                                    if (!newConfig.databaseSettings) {
                                      newConfig.databaseSettings = {};
                                    }

                                    const newPriority = [
                                      ...(newConfig.databaseSettings
                                        .databasePriority || [
                                        "appwrite",
                                        "supabase",
                                        "fallback",
                                      ]),
                                    ] as never[];
                                    const newIndex = parseInt(e.target.value);
                                    const oldIndex = newPriority.indexOf(
                                      db as never
                                    );

                                    if (oldIndex !== -1) {
                                      newPriority.splice(oldIndex, 1);
                                    }
                                    newPriority.splice(
                                      newIndex,
                                      0,
                                      db as never
                                    );

                                    newConfig.databaseSettings.databasePriority =
                                      newPriority;
                                    setConfig(newConfig);
                                    setJsonView(
                                      JSON.stringify(newConfig, null, 2)
                                    );
                                    setHasChanges(true);
                                  }}
                                  className="w-20 px-2 py-1 border border-gray-300 rounded text-sm"
                                >
                                  <option value="0">1st</option>
                                  <option value="1">2nd</option>
                                  <option value="2">3rd</option>
                                </select>
                                <span
                                  className={`px-3 py-1 rounded text-sm font-medium ${
                                    db === "appwrite"
                                      ? "bg-blue-100 text-blue-700"
                                      : db === "supabase"
                                      ? "bg-green-100 text-green-700"
                                      : "bg-yellow-100 text-yellow-700"
                                  }`}
                                >
                                  {db.charAt(0).toUpperCase() + db.slice(1)}
                                </span>
                              </div>
                            );
                          }
                        )}
                      </div>
                      <p className="text-xs text-gray-600 ml-1 mt-2">
                        Set the order in which databases are checked when in
                        Auto mode. The system will use the first healthy
                        database in this order.
                        <br />
                        Example: If Appwrite is 1st but unhealthy, system tries
                        2nd (Supabase), then 3rd (Fallback).
                      </p>
                    </div>
                  )}

                  <div className="border-t pt-6">
                    <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                      <Database className="w-4 h-4" />
                      Dynamic Order Prefix Configuration
                    </h3>
                    <p className="text-xs text-gray-600 mb-4">
                      Configure different order prefixes for each database mode.
                      The system will use the appropriate prefix based on which
                      database is active:
                      <br />• <strong>Appwrite</strong>: Used when Appwrite is
                      the active database
                      <br />• <strong>Supabase</strong>: Used when Supabase is
                      the active database
                      <br />• <strong>Fallback</strong>: Used when no database
                      is available (Fallback mode)
                    </p>

                    {/* Appwrite Order Prefix */}
                    <div className="space-y-3 mb-4">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                          Appwrite
                        </span>
                        Order Prefix
                      </label>
                      <Input
                        value={String(
                          config.databaseSettings?.appwriteOrderPrefix ||
                            config.baseSettings?.odrPrefix ||
                            "ABO"
                        )}
                        onChange={(e) => {
                          const newConfig = { ...config };
                          if (!newConfig.databaseSettings) {
                            newConfig.databaseSettings = {};
                          }
                          newConfig.databaseSettings.appwriteOrderPrefix = e
                            .target.value as never;
                          setConfig(newConfig);
                          setJsonView(JSON.stringify(newConfig, null, 2));
                          setHasChanges(true);
                        }}
                        placeholder="ABO"
                        maxLength={10}
                      />
                      <p className="text-xs text-gray-600 ml-1">
                        Used when Core Running Mode is{" "}
                        <strong>Appwrite Only</strong> or <strong>Auto</strong>{" "}
                        and Appwrite is selected.
                        <br />
                        Example:{" "}
                        <code className="bg-gray-100 px-1 rounded">
                          ABO20251104ABC1234
                        </code>
                      </p>
                    </div>

                    {/* Supabase Order Prefix */}
                    <div className="space-y-3 mb-4">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                          Supabase
                        </span>
                        Order Prefix
                      </label>
                      <Input
                        value={String(
                          config.databaseSettings?.supabaseOrderPrefix ||
                            config.baseSettings?.odrPrefix ||
                            "SBO"
                        )}
                        onChange={(e) => {
                          const newConfig = { ...config };
                          if (!newConfig.databaseSettings) {
                            newConfig.databaseSettings = {};
                          }
                          newConfig.databaseSettings.supabaseOrderPrefix = e
                            .target.value as never;
                          setConfig(newConfig);
                          setJsonView(JSON.stringify(newConfig, null, 2));
                          setHasChanges(true);
                        }}
                        placeholder="SBO"
                        maxLength={10}
                      />
                      <p className="text-xs text-gray-600 ml-1">
                        Used when Core Running Mode is{" "}
                        <strong>Supabase Only</strong> or <strong>Auto</strong>{" "}
                        and Supabase is selected.
                        <br />
                        Example:{" "}
                        <code className="bg-gray-100 px-1 rounded">
                          SBO20251104XYZ5678
                        </code>
                      </p>
                    </div>

                    {/* Fallback Order Prefix */}
                    <div className="space-y-3">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded text-xs">
                          Fallback
                        </span>
                        Order Prefix
                      </label>
                      <Input
                        value={String(
                          config.databaseSettings?.fallbackOrderPrefix ||
                            config.baseSettings?.odrPrefix ||
                            "FBO"
                        )}
                        onChange={(e) => {
                          const newConfig = { ...config };
                          if (!newConfig.databaseSettings) {
                            newConfig.databaseSettings = {};
                          }
                          newConfig.databaseSettings.fallbackOrderPrefix = e
                            .target.value as never;
                          setConfig(newConfig);
                          setJsonView(JSON.stringify(newConfig, null, 2));
                          setHasChanges(true);
                        }}
                        placeholder="FBO"
                        maxLength={10}
                      />
                      <p className="text-xs text-gray-600 ml-1">
                        Used when Core Running Mode is{" "}
                        <strong>Fallback Only</strong> or when no database is
                        available.
                        <br />
                        Example:{" "}
                        <code className="bg-gray-100 px-1 rounded">
                          FBO20251104DEF9012
                        </code>
                      </p>
                    </div>

                    <Alert className="mt-4">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>Important:</strong> The legacy{" "}
                        <code>odrPrefix</code> in Base Settings is now
                        deprecated. Use the database-specific prefixes above
                        instead.
                      </AlertDescription>
                    </Alert>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            {/* Advanced & QR Settings */}
            <TabsContent value="advanced">
              <Card>
                <CardHeader>
                  <CardTitle>Advanced & QR Service Settings</CardTitle>
                  <CardDescription>
                    URLs, domains, configuration paths, and VietQR API
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">Site URL</label>
                    <Input
                      value={String(config.baseSettings.siteUrl || "")}
                      onChange={(e) =>
                        updateField("baseSettings", "siteUrl", e.target.value)
                      }
                      placeholder="http://localhost:3000"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Your site&apos;s base URL (fallback if not detected)
                    </p>
                  </div>

                  <div>
                    <label className="text-sm font-medium">
                      Trusted Domains (for iframe embedding)
                    </label>
                    <Textarea
                      value={
                        Array.isArray(config.baseSettings.trustedDomains)
                          ? config.baseSettings.trustedDomains.join("\n")
                          : ""
                      }
                      onChange={(e) => {
                        const domains = e.target.value
                          .split("\n")
                          .map((d) => d.trim())
                          .filter((d) => d);
                        setConfig({
                          ...config,
                          baseSettings: {
                            ...config.baseSettings,
                            trustedDomains: domains as never,
                          },
                        });
                        setHasChanges(true);
                      }}
                      className="font-mono text-sm"
                      rows={5}
                      placeholder="https://domain1.com&#10;https://domain2.com"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      One domain per line. These domains can embed your payment
                      pages in iframes.
                    </p>
                  </div>

                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="allowAllFrameEmbedding"
                      checked={Boolean(
                        config.baseSettings.allowAllFrameEmbedding
                      )}
                      onChange={(e) => {
                        setConfig({
                          ...config,
                          baseSettings: {
                            ...config.baseSettings,
                            allowAllFrameEmbedding: e.target.checked as never,
                          },
                        });
                        setHasChanges(true);
                      }}
                      className="w-4 h-4"
                    />
                    <label
                      htmlFor="allowAllFrameEmbedding"
                      className="text-sm font-medium"
                    >
                      Allow All Frame Embedding
                    </label>
                  </div>
                  <p className="text-xs text-gray-500 -mt-2">
                    ⚠️ Security warning: When enabled, any website can embed
                    your pages. Use with caution!
                  </p>

                  <div>
                    <label className="text-sm font-medium">
                      Config Secret Path
                    </label>
                    <Input
                      value={String(config.security.configSecretPath || "")}
                      onChange={(e) =>
                        updateField(
                          "security",
                          "configSecretPath",
                          e.target.value
                        )
                      }
                      placeholder="maisuposirit"
                    />
                    <Alert className="mt-2 bg-orange-50 border-orange-200">
                      <AlertTriangle className="h-4 w-4 text-orange-600" />
                      <AlertDescription className="text-orange-800">
                        <strong>⚠️ Important:</strong> Changing this will update
                        your config URL to:
                        <code className="ml-1 px-1 bg-orange-100 rounded">
                          /darkveil/{"{"}newpath{"}"}
                        </code>
                        <br />
                        After saving, you&apos;ll be automatically redirected to
                        the new URL.
                        <br />
                        <strong className="text-red-600">
                          ⚠️ Save the new URL before closing this page!
                        </strong>
                      </AlertDescription>
                    </Alert>
                  </div>

                  {/* QR Service Section */}
                  <div className="border-t pt-4 sm:pt-6 mt-4 sm:mt-6">
                    <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4">QR Service Configuration</h3>
                    
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium">Create QR By</label>
                        <select
                          value={String(config.baseSettings.createQrBy || "vietqr")}
                          onChange={(e) => {
                            setConfig({
                              ...config,
                              baseSettings: {
                                ...config.baseSettings,
                                createQrBy: e.target.value as never,
                              },
                            });
                            setHasChanges(true);
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md"
                        >
                          <option value="vietqr">VietQR API</option>
                          <option value="local">Local Generation</option>
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                          Method for generating QR codes for payments
                        </p>
                      </div>

                      <div>
                        <label className="text-sm font-medium">VietQR Client URL</label>
                        <Input
                          value={String(config.qrService.clientUrl || "")}
                          onChange={(e) =>
                            updateField("qrService", "clientUrl", e.target.value)
                          }
                          placeholder="https://api.vietqr.io"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium">VietQR Client ID</label>
                        <Input
                          value={String(config.qrService.clientId || "")}
                          onChange={(e) =>
                            updateField("qrService", "clientId", e.target.value)
                          }
                          placeholder="Your VietQR client ID"
                        />
                      </div>

                      <div>
                        <label className="text-sm font-medium">VietQR Client Secret</label>
                        <div className="relative">
                          <Input
                            type={showQrClientSecret ? "text" : "password"}
                            value={String(config.qrService.clientSecret || "")}
                            onChange={(e) =>
                              updateField(
                                "qrService",
                                "clientSecret",
                                e.target.value
                              )
                            }
                            className="pr-10"
                            placeholder="Your VietQR client secret"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setShowQrClientSecret(!showQrClientSecret)
                            }
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                          >
                            {showQrClientSecret ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            {/* Security */}
            <TabsContent value="security">
              <Card>
                <CardHeader>
                  <CardTitle>Security Settings</CardTitle>
                  <CardDescription>
                    Encryption keys and passwords
                    <Badge variant="danger" className="ml-2">
                      <Server className="w-3 h-3 mr-1" />
                      Requires restart
                    </Badge>
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <Alert>
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      Changing these values requires server restart!
                    </AlertDescription>
                  </Alert>
                  <div>
                    <label className="text-sm font-medium">
                      Payment Encryption Key
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showEncryptionKey ? "text" : "password"}
                          value={String(
                            config.security.paymentEncryptionKey || ""
                          )}
                          onChange={(e) =>
                            updateField(
                              "security",
                              "paymentEncryptionKey",
                              e.target.value
                            )
                          }
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowEncryptionKey(!showEncryptionKey)
                          }
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                        >
                          {showEncryptionKey ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const newKey = generateRandomKey(32);
                          updateField(
                            "security",
                            "paymentEncryptionKey",
                            newKey
                          );
                        }}
                        className="shrink-0 w-full sm:w-auto"
                      >
                        <Shuffle className="w-4 h-4 mr-2" />
                        Generate
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Must be 32 characters for AES-256
                    </p>
                  </div>
                  <div>
                    <label className="text-sm font-medium">
                      Password (Plaintext)
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <div className="relative flex-1">
                        <Input
                          type={showAdminPassword ? "text" : "password"}
                          value={String(
                            config.security.adminPasswordPlaintext || ""
                          )}
                          onChange={(e) =>
                            updateField(
                              "security",
                              "adminPasswordPlaintext",
                              e.target.value
                            )
                          }
                          className="pr-10"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setShowAdminPassword(!showAdminPassword)
                          }
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                        >
                          {showAdminPassword ? (
                            <EyeOff className="w-4 h-4" />
                          ) : (
                            <Eye className="w-4 h-4" />
                          )}
                        </button>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          const newPassword = generateRandomKey(24);
                          updateField(
                            "security",
                            "adminPasswordPlaintext",
                            newPassword
                          );
                        }}
                        className="shrink-0 w-full sm:w-auto"
                      >
                        <Shuffle className="w-4 h-4 mr-2" />
                        Generate
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Password for this config page
                    </p>
                  </div>

                  {/* Payment URL Decryption Tool */}
                  <div className="border-t pt-4 sm:pt-6 mt-4 sm:mt-6">
                    <h3 className="text-base sm:text-lg font-semibold mb-3 sm:mb-4 flex items-center gap-2">
                      <Lock className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                      <span className="hidden sm:inline">Payment URL Decryption Tool</span>
                      <span className="sm:hidden">URL Decryption</span>
                    </h3>
                    
                    <Alert className="mb-4 bg-blue-50 border-blue-200">
                      <AlertTriangle className="h-4 w-4 text-blue-600" />
                      <AlertDescription className="text-blue-800">
                        <strong>Decrypt Payment URLs:</strong> Use this tool to decrypt encrypted payment URLs using the Payment Encryption Key above. The encrypted URL format is: <code className="bg-blue-100 px-1 rounded">iv:encryptedData</code>
                      </AlertDescription>
                    </Alert>

                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium">
                          Encrypted Payment URL
                        </label>
                        <Textarea
                          value={encryptedUrl}
                          onChange={(e) => setEncryptedUrl(e.target.value)}
                          placeholder="Example: a1b2c3d4e5f6....:f8e9d0c1b2a3...."
                          className="font-mono text-xs"
                          rows={3}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Enter the encrypted URL string (format: iv:encryptedData in hex)
                        </p>
                      </div>

                      <Button
                        type="button"
                        onClick={decryptPaymentUrl}
                        disabled={!encryptedUrl.trim() || !config?.security?.paymentEncryptionKey}
                        className="bg-blue-600 hover:bg-blue-700 text-white w-full sm:w-auto"
                      >
                        <Lock className="w-4 h-4 mr-2" />
                        Decrypt URL
                      </Button>

                      {decryptionError && (
                        <Alert variant="destructive">
                          <AlertTriangle className="h-4 w-4" />
                          <AlertDescription className="text-xs sm:text-sm">{decryptionError}</AlertDescription>
                        </Alert>
                      )}

                      {decryptedUrl && (
                        <div>
                          <label className="text-sm font-medium flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4 text-green-600" />
                            Decrypted URL
                          </label>
                          <div className="flex flex-col sm:flex-row gap-2 mt-1">
                            <Input
                              value={decryptedUrl}
                              readOnly
                              className="font-mono text-xs bg-green-50 flex-1"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={copyDecryptedUrl}
                              className="shrink-0 w-full sm:w-auto"
                            >
                              <Save className="w-4 h-4 mr-2" />
                              Copy
                            </Button>
                          </div>
                          <p className="text-xs text-green-700 mt-1">
                            ✅ Decryption successful! You can now use this URL.
                          </p>
                        </div>
                      )}

                      <Alert className="bg-gray-50">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertDescription>
                          <strong>Decryption Algorithm:</strong> AES-256-CBC
                          <br />
                          <strong>Key Derivation:</strong> SHA-256 hash of Payment Encryption Key
                          <br />
                          <strong>Format:</strong> The encrypted string contains IV (Initialization Vector) and encrypted data separated by colon
                        </AlertDescription>
                      </Alert>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            {/* Merchants & Banks Fallback */}
            <TabsContent value="fallback">
              <Card>
                <CardHeader>
                  <CardTitle>Merchants & Banks Fallback Configuration</CardTitle>
                  <CardDescription>
                    Fallback data when databases are unavailable
                    <Badge variant="default" className="ml-2">
                      <Database className="w-3 h-3 mr-1" />
                      No restart required
                    </Badge>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Alert className="mb-4">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertDescription>
                      <strong>Advanced Users Only:</strong> This is raw JSON
                      configuration. Merchants are usually managed in your
                      database. This fallback is used when the database is
                      unavailable.
                      <br />
                      <br />
                      <strong>How to edit:</strong> Edit the JSON directly in
                      the textarea below. Each merchant needs: apiKeyHash,
                      accountId, min/max amounts, IP whitelists, and enabled
                      status.
                    </AlertDescription>
                  </Alert>

                  {/* API Key Hash Generator Tool */}
                  <Card className="mb-6 bg-blue-50 border-blue-200">
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Shuffle className="w-5 h-5 text-blue-600" />
                        API Key Hash Generator
                      </CardTitle>
                      <CardDescription>
                        Generate SHA-256 hash for merchant API keys
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div>
                        <label className="text-sm font-medium">
                          Enter API Key
                        </label>
                        <div className="flex flex-col sm:flex-row gap-2 mt-1">
                          <div className="relative flex-1">
                            <Input
                              type={showApiKeyInput ? "text" : "password"}
                              value={apiKeyInput}
                              onChange={(e) => setApiKeyInput(e.target.value)}
                              placeholder="sk_live_abc123xyz789..."
                              className="pr-10"
                              onKeyPress={(e) =>
                                e.key === "Enter" && handleGenerateHash()
                              }
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setShowApiKeyInput(!showApiKeyInput)
                              }
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                            >
                              {showApiKeyInput ? (
                                <EyeOff className="w-4 h-4" />
                              ) : (
                                <Eye className="w-4 h-4" />
                              )}
                            </button>
                          </div>
                          <Button
                            type="button"
                            onClick={handleGenerateHash}
                            className="bg-blue-600 hover:bg-blue-700 text-white shrink-0 w-full sm:w-auto"
                          >
                            <span className="hidden sm:inline">Generate Hash</span>
                            <span className="sm:hidden">Generate</span>
                          </Button>
                        </div>
                      </div>

                      {apiKeyHash && (
                        <div>
                          <label className="text-sm font-medium">
                            Generated Hash (SHA-256)
                          </label>
                          <div className="flex flex-col sm:flex-row gap-2 mt-1">
                            <Input
                              value={apiKeyHash}
                              readOnly
                              className="font-mono text-xs bg-white flex-1"
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={copyHashToClipboard}
                              className="shrink-0 w-full sm:w-auto"
                            >
                              {hashCopied ? (
                                <>
                                  <CheckCircle2 className="w-4 h-4 mr-2" />
                                  Copied!
                                </>
                              ) : (
                                <>
                                  <Save className="w-4 h-4 mr-2" />
                                  Copy Hash
                                </>
                              )}
                            </Button>
                          </div>
                          <p className="text-xs text-gray-600 mt-1">
                            ✅ Use this hash value for the
                            &quot;apiKeyHash&quot; field in your merchant
                            configuration
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  <div className="space-y-4">
                    <div className="text-sm text-gray-600">
                      {Object.keys(config.merchants).length} merchants
                      configured
                    </div>
                    <Textarea
                      value={JSON.stringify(config.merchants, null, 2)}
                      onChange={(e) => {
                        try {
                          const parsed = JSON.parse(e.target.value);
                          setConfig({ ...config, merchants: parsed });
                          setHasChanges(true);
                        } catch {
                          // Ignore parse errors while typing
                        }
                      }}
                      className="font-mono text-xs"
                      rows={15}
                    />
                    <p className="text-xs text-gray-500">
                      💡 <strong>Tip:</strong> Copy this JSON, edit in a JSON
                      editor (like jsonformatter.org), validate it, then paste
                      back here. Or use the JSON Editor tab for better
                      formatting.
                    </p>
                  </div>

                  {/* Banks Section */}
                  <div className="border-t pt-6 mt-6">
                    <h3 className="text-lg font-semibold mb-4">Bank Fallback Configuration</h3>
                    
                    <Alert className="mb-4">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <strong>Advanced Users Only:</strong> This is raw JSON
                        configuration. Banks are usually managed in your database.
                        This fallback is used when the database is unavailable.
                        <br />
                        <br />
                        <strong>How to edit:</strong> Edit the JSON directly in
                        the textarea below. Each bank needs: bankId, name, BIN
                        code, account number, owner name, amounts, and status.
                      </AlertDescription>
                    </Alert>
                    
                    <div className="space-y-4">
                      <div className="text-sm text-gray-600">
                        {Object.keys(config.banks).length} banks configured
                      </div>
                      <Textarea
                        value={JSON.stringify(config.banks, null, 2)}
                        onChange={(e) => {
                          try {
                            const parsed = JSON.parse(e.target.value);
                            setConfig({ ...config, banks: parsed });
                            setHasChanges(true);
                          } catch {
                            // Ignore parse errors while typing
                          }
                        }}
                        className="font-mono text-xs"
                        rows={15}
                      />
                      <p className="text-xs text-gray-500">
                        💡 <strong>Tip:</strong> Copy this JSON, edit in a JSON
                        editor (like jsonformatter.org), validate it, then paste
                        back here. Or use the JSON Editor tab for better
                        formatting.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            {/* JSON Editor */}
            <TabsContent value="json">
              <Card>
                <CardHeader>
                  <CardTitle>Raw JSON Editor</CardTitle>
                  <CardDescription>
                    Direct JSON editing - advanced users only
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Textarea
                    value={jsonView}
                    onChange={(e) => handleJsonUpdate(e.target.value)}
                    className="font-mono text-xs"
                    rows={25}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
