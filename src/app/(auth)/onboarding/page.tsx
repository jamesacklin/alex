"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppLogo } from "@/components/branding/AppLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
} from "@/components/ui/card";

interface S3FormState {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  prefix: string;
  pollInterval: string;
}

const EMPTY_S3_FORM: S3FormState = {
  endpoint: "",
  region: "",
  bucket: "",
  accessKey: "",
  secretKey: "",
  prefix: "",
  pollInterval: "60",
};

export default function OnboardingPage() {
  const router = useRouter();
  const [storageMode, setStorageMode] = useState<"local" | "s3">("local");
  const [libraryPath, setLibraryPath] = useState("");
  const [s3Form, setS3Form] = useState<S3FormState>(EMPTY_S3_FORM);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const [s3Error, setS3Error] = useState("");

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

  const canProceed =
    storageMode === "local"
      ? !!libraryPath
      : !!(s3Form.bucket && s3Form.accessKey && s3Form.secretKey);

  const handleGetStarted = async () => {
    if (!window.electronAPI || !canProceed) return;
    setIsSettingUp(true);
    setS3Error("");

    try {
      if (storageMode === "s3") {
        const result = await window.electronAPI.saveS3Config({
          bucket: s3Form.bucket,
          accessKey: s3Form.accessKey,
          secretKey: s3Form.secretKey,
          endpoint: s3Form.endpoint || undefined,
          region: s3Form.region || undefined,
          prefix: s3Form.prefix || undefined,
          pollInterval: s3Form.pollInterval
            ? Number(s3Form.pollInterval)
            : undefined,
        });
        if (!result.success) {
          setS3Error(result.error || "Failed to save S3 configuration");
          setIsSettingUp(false);
          return;
        }
      }

      const result = await window.electronAPI.completeOnboarding();
      if (result.success) {
        router.push("/library");
      } else {
        setIsSettingUp(false);
      }
    } catch {
      setIsSettingUp(false);
    }
  };

  const updateS3Field = (field: keyof S3FormState, value: string) => {
    setS3Form((prev) => ({ ...prev, [field]: value }));
    setS3Error("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2.5">
            <AppLogo className="h-9 w-9" />
            <h1 className="text-2xl font-medium tracking-tight">Alex</h1>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mx-auto">
            A personal library for your ebooks. Choose where your book files are
            stored to get started.
          </p>
        </div>

        {/* Storage mode selector */}
        <div className="flex gap-2 justify-center">
          <Button
            variant={storageMode === "local" ? "default" : "outline"}
            onClick={() => setStorageMode("local")}
            size="sm"
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
            Local Folder
          </Button>
          <Button
            variant={storageMode === "s3" ? "default" : "outline"}
            onClick={() => setStorageMode("s3")}
            size="sm"
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
              <path d="M2 16s0-4 4-4 4 4 8 4 4-4 4-4" />
              <path d="M2 12s0-4 4-4 4 4 8 4 4-4 4-4" />
              <path d="M2 8s0-4 4-4 4 4 8 4 4-4 4-4" />
            </svg>
            S3 / R2 Bucket
          </Button>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            {storageMode === "local" ? (
              <>
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
              </>
            ) : (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Connect to an S3-compatible bucket (Cloudflare R2, AWS S3,
                  MinIO).
                </p>

                <div className="grid gap-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="s3-endpoint" className="text-xs">
                      Endpoint URL
                    </Label>
                    <Input
                      id="s3-endpoint"
                      placeholder="https://abc123.r2.cloudflarestorage.com"
                      value={s3Form.endpoint}
                      onChange={(e) =>
                        updateS3Field("endpoint", e.target.value)
                      }
                      className="h-8 text-sm"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Required for R2 / MinIO. Leave empty for AWS S3.
                    </p>
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="s3-region" className="text-xs">
                      Region
                    </Label>
                    <Input
                      id="s3-region"
                      placeholder="auto"
                      value={s3Form.region}
                      onChange={(e) => updateS3Field("region", e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>

                  <div className="grid gap-1.5">
                    <Label htmlFor="s3-bucket" className="text-xs">
                      Bucket Name{" "}
                      <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id="s3-bucket"
                      placeholder="my-library"
                      value={s3Form.bucket}
                      onChange={(e) => updateS3Field("bucket", e.target.value)}
                      required
                      className="h-8 text-sm"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="s3-access-key" className="text-xs">
                        Access Key <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="s3-access-key"
                        placeholder="AKIA..."
                        value={s3Form.accessKey}
                        onChange={(e) =>
                          updateS3Field("accessKey", e.target.value)
                        }
                        required
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="s3-secret-key" className="text-xs">
                        Secret Key <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="s3-secret-key"
                        type="password"
                        placeholder="••••••••"
                        value={s3Form.secretKey}
                        onChange={(e) =>
                          updateS3Field("secretKey", e.target.value)
                        }
                        required
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor="s3-prefix" className="text-xs">
                        Key Prefix
                      </Label>
                      <Input
                        id="s3-prefix"
                        placeholder="books/"
                        value={s3Form.prefix}
                        onChange={(e) =>
                          updateS3Field("prefix", e.target.value)
                        }
                        className="h-8 text-sm"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="s3-poll-interval" className="text-xs">
                        Poll Interval (s)
                      </Label>
                      <Input
                        id="s3-poll-interval"
                        type="number"
                        min="10"
                        placeholder="60"
                        value={s3Form.pollInterval}
                        onChange={(e) =>
                          updateS3Field("pollInterval", e.target.value)
                        }
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                </div>

                {s3Error && (
                  <p className="text-xs text-destructive">{s3Error}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Button
          className="w-full"
          disabled={!canProceed || isSettingUp}
          onClick={handleGetStarted}
        >
          {isSettingUp ? "Setting up..." : "Get started"}
        </Button>
      </div>
    </div>
  );
}
