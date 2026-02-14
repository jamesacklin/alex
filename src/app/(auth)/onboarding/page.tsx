"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppLogo } from "@/components/branding/AppLogo";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";

export default function OnboardingPage() {
  const router = useRouter();
  const [libraryPath, setLibraryPath] = useState("");
  const [isSettingUp, setIsSettingUp] = useState(false);

  useEffect(() => {
    if (!window.electronAPI) {
      router.replace("/login");
      return;
    }

    window.electronAPI.getLibraryPath().then((path) => {
      if (path) {
        router.replace("/library");
      }
    });
  }, [router]);

  const handleSelectFolder = async () => {
    if (!window.electronAPI) return;
    const selected = await window.electronAPI.selectLibraryPathInitial();
    if (selected) {
      setLibraryPath(selected);
    }
  };

  const handleGetStarted = async () => {
    if (!window.electronAPI || !libraryPath) return;
    setIsSettingUp(true);
    const result = await window.electronAPI.completeOnboarding();
    if (result.success) {
      router.push("/library");
    } else {
      setIsSettingUp(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2.5">
            <AppLogo className="h-9 w-9" />
            <h1 className="text-2xl font-medium tracking-tight">Alex</h1>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
            A personal library for your ebooks. Point Alex at a folder of EPUB
            and PDF files to get started.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <Button
              variant="outline"
              className="w-full"
              onClick={handleSelectFolder}
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
              {libraryPath ? "Change folder" : "Select folder"}
            </Button>

            {libraryPath && (
              <div className="rounded-lg border border-muted-foreground/20 bg-muted/50 p-3">
                <p className="text-xs text-muted-foreground mb-1">
                  Library folder
                </p>
                <p className="text-sm font-mono break-all">{libraryPath}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Button
          className="w-full"
          disabled={!libraryPath || isSettingUp}
          onClick={handleGetStarted}
        >
          {isSettingUp ? "Setting up..." : "Get started"}
        </Button>
      </div>
    </div>
  );
}
