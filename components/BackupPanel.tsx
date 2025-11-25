"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Archive,
  Calendar,
  Eye,
  Download,
  Trash2,
} from "lucide-react";
import {
  appwriteRestoreData,
  backupDatabaseAndAuth,
  archiveDatabaseData,
  getDatabaseCollections,
  type appwriteDatabaseBackup,
  type ArchiveResult,
} from "@/lib/appwrite/appwrite.actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";

type MessageType = "success" | "error" | "info";

interface StatusMessage {
  text: string;
  type: MessageType;
}

interface BackupStats {
  collections?: number;
  documents?: number;
  users?: number;
}

export default function BackupPanel() {
  const router = useRouter();
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [message, setMessage] = useState<StatusMessage | null>(null);
  const [stats, setStats] = useState<BackupStats>({});
  
  // Archive states
  const [archiveDate, setArchiveDate] = useState<string>('');
  const [archiveDryRun, setArchiveDryRun] = useState(true);
  const [archiveIncludeRelations, setArchiveIncludeRelations] = useState(true);
  const [archiveCountOnly, setArchiveCountOnly] = useState(true); // Default to count-only for faster preview
  const [archiveResult, setArchiveResult] = useState<ArchiveResult | null>(null);
  const [availableCollections, setAvailableCollections] = useState<{ id: string; name: string }[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<string[]>([]);
  const [isLoadingCollections, setIsLoadingCollections] = useState(false);
  
  // Remove min date restriction - allow any date up to today
  const maxArchiveDate = new Date().toISOString().split('T')[0];

  const showMessage = (text: string, type: MessageType) => {
    setMessage({ text, type });
    if (type === "success" || type === "info") {
      setTimeout(() => setMessage(null), 5000);
    }
  };

  const loadCollections = async () => {
    setIsLoadingCollections(true);
    try {
      const collections = await getDatabaseCollections();
      setAvailableCollections(collections);
      // Select all by default
      setSelectedCollections(collections.map(c => c.id));
    } catch (error) {
      console.error('Failed to load collections:', error);
      showMessage('Failed to load collections', 'error');
    } finally {
      setIsLoadingCollections(false);
    }
  };

  const toggleCollection = (collectionId: string) => {
    setSelectedCollections(prev => 
      prev.includes(collectionId)
        ? prev.filter(id => id !== collectionId)
        : [...prev, collectionId]
    );
  };

  const toggleAllCollections = () => {
    if (selectedCollections.length === availableCollections.length) {
      setSelectedCollections([]);
    } else {
      setSelectedCollections(availableCollections.map(c => c.id));
    }
  };

  const handleArchive = async () => {
    if (!archiveDate) {
      showMessage("Please select an archive date", "error");
      return;
    }
    
    if (selectedCollections.length === 0) {
      showMessage("Please select at least one collection to archive", "error");
      return;
    }
    
    setIsArchiving(true);
    setMessage(null);
    setArchiveResult(null);
    
    try {
      const cutoffDate = new Date(archiveDate);
      
      if (archiveDryRun) {
        const mode = archiveCountOnly ? ' (quick count mode - counts only, no data fetched)' : ' (full preview with sample data)';
        if (!window.confirm(
          `DRY RUN${mode}: Preview archiving data before ${archiveDate}?\n\nSelected collections: ${selectedCollections.length}\n\nNo data will be deleted in dry run mode.`
        )) {
          return;
        }
      } else {
        // Extra warning for large deletions
        if (!archiveCountOnly) {
          const firstWarning = window.confirm(
            `⚠️ WARNING: This will permanently DELETE all data created before ${archiveDate}!\n\n` +
            `Selected collections: ${selectedCollections.length}\n\n` +
            `The deleted data will be saved to a JSON file, but this action cannot be undone.\n\n` +
            `Are you absolutely sure you want to proceed?`
          );
          
          if (!firstWarning) {
            return;
          }
          
          // Second confirmation for extra safety
          const finalConfirm = window.prompt(
            `FINAL CONFIRMATION:\n\n` +
            `This will fetch and delete ALL matching documents.\n` +
            `For large datasets (100k+ documents), this may take several minutes.\n\n` +
            `Type "DELETE" (in capital letters) to confirm:`
          );
          
          if (finalConfirm !== 'DELETE') {
            showMessage('Deletion cancelled - confirmation not received', 'info');
            return;
          }
        }
      }
      
      const result = await archiveDatabaseData({
        cutoffDate,
        dryRun: archiveDryRun,
        includeRelationships: archiveIncludeRelations,
        countOnly: archiveCountOnly,
        selectedCollections
      });
      
      setArchiveResult(result);
      
      if (result.dryRun) {
        showMessage(result.message, "info");
      } else {
        // Download archive file
        const blob = new Blob([JSON.stringify(result.archiveData, null, 2)], {
          type: "application/json",
        });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `archive-${result.cutoffDate.split('T')[0]}.json`;
        a.click();
        window.URL.revokeObjectURL(url);
        
        showMessage(result.message, result.success ? "success" : "error");
      }
      
      if (result.errors && result.errors.length > 0) {
        console.error("Archive errors:", result.errors);
      }
    } catch (error) {
      console.error("Archive error:", error);
      showMessage(
        `Archive failed: ${error instanceof Error ? error.message : String(error)}`,
        "error"
      );
    } finally {
      setIsArchiving(false);
    }
  };

  const handleBackup = async () => {
    setIsBackingUp(true);
    setMessage(null);

    try {
      // Show warning message before proceeding
      if (
        !window.confirm(
          "Warning: Are you sure you want to proceed with the backup?"
        )
      ) {
        return;
      }
      const backupData = await backupDatabaseAndAuth();

      // Create downloadable file
      const blob = new Blob([JSON.stringify(backupData, null, 2)], {
        type: "application/json",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `appwrite-backup-${
        new Date().toISOString().split("T")[0]
      }.json`;
      a.click();
      window.URL.revokeObjectURL(url);

      // Update stats
      setStats({
        collections: Object.keys(backupData.collections).length,
        documents: Object.values(backupData.collections).reduce(
          (acc, curr) => acc + curr.documents.length,
          0
        ),
        users: backupData.users.length,
      });

      showMessage("Backup completed successfully!", "success");
    } catch (error) {
      console.error("Backup error:", error);
      if (error instanceof Error && error.message.includes("No session")) {
        router.push("/auth/login");
        return;
      }
      showMessage("Failed to create backup. Please try again.", "error");
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestore = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file size (max 400MB for safety margin)
    if (file.size > 400 * 1024 * 1024) {
      showMessage("File size exceeds 400MB limit", "error");
      event.target.value = "";
      return;
    }

    setIsRestoring(true);
    setMessage(null);

    try {
      const fileContent = await file.text();
      const backupData = JSON.parse(fileContent) as appwriteDatabaseBackup;

      // Show warning message before proceeding
      if (
        !window.confirm(
          "Warning: Restoring a backup will overwrite existing data. Are you sure you want to proceed?"
        )
      ) {
        event.target.value = "";
        return;
      }

      const result = await appwriteRestoreData(backupData);

      setStats({
        documents: result.stats.documents,
        users: result.stats.users,
      });

      showMessage(
        result.errors?.length
          ? `Restore completed with ${result.errors.length} errors. Check console for details.`
          : "Restore completed successfully!",
        result.errors?.length ? "info" : "success"
      );

      if (result.errors?.length) {
        console.error("Restore errors:", result.errors);
      }
    } catch (error) {
      console.error("Restore error:", error);
      if (error instanceof Error && error.message.includes("No session")) {
        router.push("/auth/login");
        return;
      }
      showMessage(
        "Failed to restore backup. Please check the file format.",
        "error"
      );
    } finally {
      setIsRestoring(false);
      event.target.value = "";
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          Database & Auth Backup
        </CardTitle>
        <CardDescription>
          Create and restore backups of your database and user data
        </CardDescription>
      </CardHeader>

      <CardContent>
        <div className="space-y-6">        
          {/* Backup Section */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Create Backup
              </h2>
              <button
                onClick={handleBackup}
                disabled={isBackingUp || isRestoring}
                className="inline-flex items-center px-4 py-2 border border-transparent   
                                    text-sm font-medium rounded-md shadow-sm text-white   
                                    bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2   
                                    focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50   
                                    disabled:cursor-not-allowed"
              >
                {isBackingUp ? (
                  <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                ) : (
                  <ArrowDownToLine className="-ml-1 mr-2 h-4 w-4" />
                )}
                {isBackingUp ? "Creating Backup..." : "Create Backup"}
              </button>
          </div>

          {/* Restore Section */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              Restore Backup
            </h2>
            <label className="block">
              <span className="sr-only">Choose backup file</span>
              {isRestoring ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                  <span>Restoring Backup...</span>
                </div>
              ) : (
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={handleRestore}
                    disabled={isRestoring||isBackingUp}
                    className="block w-full text-sm text-slate-500  
                                      file:mr-4 file:py-2 file:px-4  
                                      file:rounded-md file:border-0  
                                      file:text-sm file:font-semibold  
                                      file:bg-blue-50 file:text-blue-700  
                                      hover:file:bg-blue-100  
                                      disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                )}
                
            </label>
            <p className="mt-2 text-sm text-gray-500">
              Maximum file size: 400MB. Only JSON files are supported.
            </p>
          </div>

          {/* Archive Section */}
          <div className="bg-white p-6 rounded-lg shadow-sm border border-orange-200">
            <div className="flex items-center gap-2 mb-4">
              <Archive className="h-5 w-5 text-orange-600" />
              <h2 className="text-xl font-semibold text-gray-900">
                Archive Old Data
              </h2>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Archive and optionally delete old data before a specific date. 
              Archived data will be saved to a JSON file for restoration if needed.
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 mb-4">
              <p className="text-xs text-blue-800">
                <strong>💡 Tip:</strong> Use <strong>Quick Count</strong> mode for large databases to avoid timeouts. 
                It only counts documents without fetching full data, making preview much faster.
              </p>
            </div>
            
            <div className="space-y-4">
              {/* Collection Selection */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Select Collections to Archive
                  </label>
                  <button
                    type="button"
                    onClick={loadCollections}
                    disabled={isArchiving || isBackingUp || isRestoring || isLoadingCollections}
                    className="text-xs text-blue-600 hover:text-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isLoadingCollections ? 'Loading...' : availableCollections.length > 0 ? 'Refresh' : 'Load Collections'}
                  </button>
                </div>
                
                {availableCollections.length > 0 && (
                  <div className="border border-gray-300 rounded-md p-3 max-h-48 overflow-y-auto">
                    <label className="flex items-center gap-2 mb-2 pb-2 border-b border-gray-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedCollections.length === availableCollections.length}
                        onChange={toggleAllCollections}
                        disabled={isArchiving || isBackingUp || isRestoring}
                        className="h-4 w-4 text-orange-600 border-gray-300 rounded
                                 focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                      <span className="text-sm font-medium text-gray-900">
                        Select All ({selectedCollections.length}/{availableCollections.length})
                      </span>
                    </label>
                    
                    <div className="space-y-1.5">
                      {availableCollections.map(collection => (
                        <label key={collection.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                          <input
                            type="checkbox"
                            checked={selectedCollections.includes(collection.id)}
                            onChange={() => toggleCollection(collection.id)}
                            disabled={isArchiving || isBackingUp || isRestoring}
                            className="h-4 w-4 text-orange-600 border-gray-300 rounded
                                     focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                          <span className="text-sm text-gray-700">{collection.name}</span>
                          <span className="text-xs text-gray-500">({collection.id})</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Date Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  <Calendar className="inline h-4 w-4 mr-1" />
                  Archive data before this date
                </label>
                <input
                  type="date"
                  value={archiveDate}
                  onChange={(e) => setArchiveDate(e.target.value)}
                  max={maxArchiveDate}
                  disabled={isArchiving || isBackingUp || isRestoring}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm
                           focus:ring-orange-500 focus:border-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Maximum date: {maxArchiveDate}
                </p>
              </div>

              {/* Options */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={archiveDryRun}
                    onChange={(e) => {
                      setArchiveDryRun(e.target.checked);
                      // Auto-disable count-only when turning off dry run (can't delete without full data)
                      if (!e.target.checked) {
                        setArchiveCountOnly(false);
                      }
                    }}
                    disabled={isArchiving || isBackingUp || isRestoring}
                    className="h-4 w-4 text-orange-600 border-gray-300 rounded
                             focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <span className="text-sm text-gray-700 flex items-center gap-1">
                    <Eye className="h-4 w-4" />
                    Dry Run (Preview only, don&apos;t delete)
                  </span>
                </label>
                
                {archiveDryRun && (
                  <label className="flex items-center gap-2 cursor-pointer ml-6">
                    <input
                      type="checkbox"
                      checked={archiveCountOnly}
                      onChange={(e) => setArchiveCountOnly(e.target.checked)}
                      disabled={isArchiving || isBackingUp || isRestoring}
                      className="h-4 w-4 text-blue-600 border-gray-300 rounded
                               focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                    <span className="text-sm text-gray-600">
                      Quick Count (faster preview, counts only)
                    </span>
                  </label>
                )}
                
                {!archiveDryRun && (
                  <p className="text-xs text-red-600 ml-6">
                    ⚠️ Quick Count is disabled. Full document data will be fetched for deletion.
                  </p>
                )}
                
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={archiveIncludeRelations}
                    onChange={(e) => setArchiveIncludeRelations(e.target.checked)}
                    disabled={isArchiving || isBackingUp || isRestoring || archiveCountOnly}
                    className="h-4 w-4 text-orange-600 border-gray-300 rounded
                             focus:ring-orange-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <span className="text-sm text-gray-700">
                    Include related documents (only if they&apos;re also old)
                  </span>
                </label>
                {archiveIncludeRelations && (
                  <p className="text-xs text-gray-500 ml-6">
                    ℹ️ Only includes related documents that are also before the cutoff date.
                    This prevents breaking references from newer documents.
                  </p>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleArchive}
                  disabled={isArchiving || isBackingUp || isRestoring || !archiveDate || selectedCollections.length === 0}
                  className={`inline-flex items-center px-4 py-2 border border-transparent
                           text-sm font-medium rounded-md shadow-sm text-white
                           ${archiveDryRun 
                             ? 'bg-blue-600 hover:bg-blue-700' 
                             : 'bg-orange-600 hover:bg-orange-700'}
                           focus:outline-none focus:ring-2 focus:ring-offset-2
                           ${archiveDryRun ? 'focus:ring-blue-500' : 'focus:ring-orange-500'}
                           disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  {isArchiving ? (
                    <>
                      <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                      {archiveDryRun ? 'Previewing...' : 'Archiving...'}
                    </>
                  ) : (
                    <>
                      {archiveDryRun ? (
                        <Eye className="-ml-1 mr-2 h-4 w-4" />
                      ) : (
                        <Trash2 className="-ml-1 mr-2 h-4 w-4" />
                      )}
                      {archiveDryRun ? 'Preview Archive' : 'Archive & Delete'}
                    </>
                  )}
                </button>
              </div>

              {/* Archive Result Preview */}
              {archiveResult && (
                <div className={`mt-4 p-4 rounded-lg border ${
                  archiveResult.dryRun 
                    ? 'bg-blue-50 border-blue-200' 
                    : 'bg-orange-50 border-orange-200'
                }`}>
                  <div className="flex items-start gap-2 mb-3">
                    {archiveResult.dryRun ? (
                      <Eye className="h-5 w-5 text-blue-600 flex-shrink-0" />
                    ) : (
                      <Download className="h-5 w-5 text-orange-600 flex-shrink-0" />
                    )}
                    <div className="flex-1">
                      <h3 className="font-semibold text-gray-900 mb-1">
                        {archiveResult.dryRun ? 'Preview Results' : 'Archive Complete'}
                      </h3>
                      <p className="text-sm text-gray-700">{archiveResult.message}</p>
                    </div>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
                    <div className="bg-white p-3 rounded-md">
                      <div className="text-xs font-medium text-gray-500">Collections</div>
                      <div className="text-lg font-semibold text-gray-900">
                        {archiveResult.stats.collections}
                      </div>
                    </div>
                    <div className="bg-white p-3 rounded-md">
                      <div className="text-xs font-medium text-gray-500">Documents</div>
                      <div className="text-lg font-semibold text-gray-900">
                        {archiveResult.stats.documentsToArchive}
                      </div>
                    </div>
                    <div className="bg-white p-3 rounded-md">
                      <div className="text-xs font-medium text-gray-500">Relationships</div>
                      <div className="text-lg font-semibold text-gray-900">
                        {archiveResult.stats.relationshipsTracked}
                      </div>
                    </div>
                    {!archiveResult.dryRun && (
                      <div className="bg-white p-3 rounded-md">
                        <div className="text-xs font-medium text-gray-500">Deleted</div>
                        <div className="text-lg font-semibold text-red-600">
                          {archiveResult.stats.documentsDeleted}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Preview Collections */}
                  {archiveResult.preview && archiveResult.preview.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-gray-700">Collections to Archive:</h4>
                      <div className="max-h-48 overflow-y-auto space-y-1">
                        {archiveResult.preview.map((coll, idx) => (
                          <div key={idx} className="text-xs bg-white p-2 rounded border border-gray-200">
                            <span className="font-medium">{coll.collectionName}</span>
                            <span className="text-gray-500"> ({coll.collectionId})</span>
                            <span className="ml-2 text-gray-600">- {coll.documentCount} documents</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Errors */}
                  {archiveResult.errors && archiveResult.errors.length > 0 && (
                    <div className="mt-3">
                      <div className="text-sm font-medium text-red-600 mb-1">
                        Errors ({archiveResult.errors.length}):
                      </div>
                      <div className="max-h-32 overflow-y-auto text-xs text-red-700 bg-red-50 p-2 rounded">
                        {archiveResult.errors.map((err, idx) => (
                          <div key={idx} className="mb-1">• {err}</div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Status Messages */}
          {message && (
            <div
              className={`p-4 rounded-lg flex items-start space-x-2 ${
                message.type === "error"
                  ? "bg-red-50 text-red-700"
                  : message.type === "success"
                  ? "bg-green-50 text-green-700"
                  : "bg-blue-50 text-blue-700"
              }`}
            >
              {message.type === "error" ? (
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
              ) : (
                <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
              )}
              <p className="text-sm">{message.text}</p>
            </div>
          )}

          {/* Statistics */}
          {(stats.collections !== undefined ||
            stats.documents !== undefined ||
            stats.users !== undefined) && (
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900 mb-4">
                Statistics
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {stats.collections !== undefined && (
                  <div className="bg-gray-50 p-4 rounded-md">
                    <div className="text-sm font-medium text-gray-500">
                      Collections
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-gray-900">
                      {stats.collections}
                    </div>
                  </div>
                )}
                {stats.documents !== undefined && (
                  <div className="bg-gray-50 p-4 rounded-md">
                    <div className="text-sm font-medium text-gray-500">
                      Documents
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-gray-900">
                      {stats.documents}
                    </div>
                  </div>
                )}
                {stats.users !== undefined && (
                  <div className="bg-gray-50 p-4 rounded-md">
                    <div className="text-sm font-medium text-gray-500">Users</div>
                    <div className="mt-1 text-2xl font-semibold text-gray-900">
                      {stats.users}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}