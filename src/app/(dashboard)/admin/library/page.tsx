"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function AdminLibraryPage() {
  const router = useRouter();
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isElectron, setIsElectron] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [libraryPath, setLibraryPath] = useState<string>("");

  useEffect(() => {
    const electron = typeof window !== "undefined" && !!window.electronAPI;
    setIsElectron(electron);

    if (electron && window.electronAPI) {
      window.electronAPI.getLibraryPath().then(setLibraryPath);
    }
  }, []);

  const handleClearLibrary = async () => {
    setIsClearing(true);
    try {
      // Use Electron API if available, otherwise use web API
      if (isElectron && window.electronAPI) {
        const success = await window.electronAPI.nukeAndRescanLibrary();
        setShowClearDialog(false);
        if (success) {
          toast.success("Library cleared", {
            description: "All books removed. Re-scanning directory...",
          });
          router.refresh();
        } else {
          toast.error("Failed to clear library");
        }
      } else {
        const response = await fetch("/api/admin/library/clear", {
          method: "POST",
        });

        const result = await response.json();

        if (result.success) {
          toast.success("Library cleared", {
            description: `Deleted ${result.deleted} books and ${result.deletedCovers} covers. The watcher will re-index files.`,
          });
          setShowClearDialog(false);
          router.refresh();
        } else {
          toast.error("Failed to clear library", {
            description: result.error || "Unknown error",
          });
        }
      }
    } catch (error) {
      console.error("Failed to clear library:", error);
      toast.error("Failed to clear library", {
        description: "Network or server error",
      });
    } finally {
      setIsClearing(false);
    }
  };

  const handleChangeLibraryPath = async () => {
    if (!window.electronAPI || isProcessing) return;
    setIsProcessing(true);
    try {
      const newPath = await window.electronAPI.selectLibraryPath();
      if (newPath) {
        toast.success("Library directory changed", {
          description: "Books cleared and library will be re-indexed",
        });
        router.refresh();
      }
    } catch (error) {
      console.error("Failed to change library path:", error);
      toast.error("Failed to change library directory");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRescan = async () => {
    if (!window.electronAPI || isProcessing) return;
    setIsProcessing(true);
    try {
      const success = await window.electronAPI.rescanLibrary();
      if (success) {
        toast.info("Library rescan started", {
          description: "Scanning for new books...",
        });
      }
    } catch (error) {
      console.error("Failed to rescan library:", error);
      toast.error("Failed to rescan library");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleResetApp = async () => {
    if (!window.electronAPI || isResetting) return;
    setIsResetting(true);
    try {
      const result = await window.electronAPI.resetApp();
      if (result.success) {
        setShowResetDialog(false);
        toast.success("App reset", {
          description: "Reloading onboarding...",
        });
        // Wait a moment then reload to /onboarding
        setTimeout(() => {
          window.location.href = "/onboarding";
        }, 500);
      } else {
        toast.error("Failed to reset app");
        setIsResetting(false);
      }
    } catch (error) {
      console.error("Failed to reset app:", error);
      toast.error("Failed to reset app");
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">
          Manage your book library and file watcher
        </p>
      </div>

      <div className="grid gap-6">
        {/* Electron-only: Change Library Directory */}
        {isElectron && (
          <Card>
            <CardHeader>
              <CardTitle>Library Directory</CardTitle>
              <CardDescription>
                Change the folder where your book files are stored. This will
                clear the current library and re-index the new directory.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {libraryPath && (
                  <div className="rounded-lg border border-muted-foreground/20 bg-muted/50 p-3">
                    <p className="text-xs text-muted-foreground mb-1">Current directory:</p>
                    <p className="text-sm font-mono break-all">{libraryPath}</p>
                  </div>
                )}
                <Button
                  onClick={handleChangeLibraryPath}
                  disabled={isProcessing}
                >
                  <svg
                    className="h-4 w-4 mr-2"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
                  </svg>
                  Change Directory
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Clear Library */}
        <Card>
          <CardHeader>
            <CardTitle>Clear Library</CardTitle>
            <CardDescription>
              Remove all books from the database and clear cover images. The
              file watcher will automatically re-index files from your library
              directory.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="rounded-lg border border-muted-foreground/20 bg-muted/50 p-4">
                <h4 className="text-sm font-medium mb-2">What happens:</h4>
                <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                  <li>All books deleted from database</li>
                  <li>All cover images removed from storage</li>
                  <li>Collections and users preserved</li>
                  <li>Reading progress reset</li>
                  <li>File watcher re-indexes library directory</li>
                </ul>
              </div>

              <Button
                variant="destructive"
                onClick={() => setShowClearDialog(true)}
                disabled={isClearing}
              >
                <svg
                  className="h-4 w-4 mr-2"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 6h18" />
                  <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                  <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
                Clear Library
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* File Watcher */}
        <Card>
          <CardHeader>
            <CardTitle>File Watcher</CardTitle>
            <CardDescription>
              The file watcher automatically monitors your library directory for
              changes and updates the database.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {isElectron ? (
                <>
                  <div className="rounded-lg border border-muted-foreground/20 bg-muted/50 p-4">
                    <p className="text-sm text-muted-foreground">
                      In Electron, the watcher runs as a child process and can be
                      restarted from this interface.
                    </p>
                  </div>

                  <Button
                    onClick={handleRescan}
                    disabled={isProcessing}
                    variant="outline"
                  >
                    <svg
                      className={`h-4 w-4 mr-2 ${isProcessing ? "animate-spin" : ""}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                      <path d="M16 16h5v5" />
                    </svg>
                    Restart Watcher
                  </Button>
                </>
              ) : (
                <div className="rounded-lg border border-muted-foreground/20 bg-muted/50 p-4">
                  <p className="text-sm text-muted-foreground">
                    In Docker deployments, the watcher runs as a separate process
                    and cannot be restarted from the web interface. To restart
                    the watcher, restart the Docker container.
                  </p>
                </div>
              )}

              <div className="text-sm">
                <p className="font-medium mb-2">Watcher capabilities:</p>
                <ul className="text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Automatically indexes new .epub and .pdf files</li>
                  <li>Detects file changes and updates metadata</li>
                  <li>Removes books when files are deleted</li>
                  <li>Sends real-time updates via Server-Sent Events</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Electron-only: Reset App */}
        {isElectron && (
          <Card>
            <CardHeader>
              <CardTitle>Reset App</CardTitle>
              <CardDescription>
                Clear all data and return to the onboarding screen. This will
                remove your library path, clear all books, and restart the
                setup process.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="rounded-lg border border-muted-foreground/20 bg-muted/50 p-4">
                  <h4 className="text-sm font-medium mb-2">What happens:</h4>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc list-inside">
                    <li>All books deleted from database</li>
                    <li>All cover images removed from storage</li>
                    <li>Library path cleared</li>
                    <li>App returns to onboarding screen</li>
                  </ul>
                </div>

                <Button
                  variant="destructive"
                  onClick={() => setShowResetDialog(true)}
                  disabled={isResetting}
                >
                  <svg
                    className="h-4 w-4 mr-2"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                    <path d="M16 16h5v5" />
                  </svg>
                  Reset App
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear library and re-index?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all books from the library database and delete
              cover images. Your collections and users will be preserved, but
              all reading progress will be reset. The file watcher will
              automatically re-index books from your library directory.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearLibrary}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isClearing}
            >
              {isClearing ? "Clearing..." : "Clear Library"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset app and restart onboarding?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear all books, remove your library path, and return
              you to the onboarding screen. You will need to select your
              library folder again. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleResetApp}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isResetting}
            >
              {isResetting ? "Resetting..." : "Reset App"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
