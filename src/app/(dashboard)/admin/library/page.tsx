"use client";

import { useState } from "react";
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
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [isClearing, setIsClearing] = useState(false);

  const handleClearLibrary = async () => {
    setIsClearing(true);
    try {
      const response = await fetch("/api/admin/library/clear", {
        method: "POST",
      });

      const result = await response.json();

      if (result.success) {
        toast.success("Library cleared", {
          description: `Deleted ${result.deleted} books and ${result.deletedCovers} covers. The watcher will re-index files.`,
        });
        setShowClearDialog(false);
      } else {
        toast.error("Failed to clear library", {
          description: result.error || "Unknown error",
        });
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

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-lg font-medium tracking-tight">Library Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your book library and file watcher
        </p>
      </div>

      <div className="grid gap-6">
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
              <div className="rounded-lg border border-muted-foreground/20 bg-muted/50 p-4">
                <p className="text-sm text-muted-foreground">
                  In Docker deployments, the watcher runs as a separate process
                  and cannot be restarted from the web interface. To restart
                  the watcher, restart the Docker container.
                </p>
              </div>

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
    </div>
  );
}
