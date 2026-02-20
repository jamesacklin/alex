"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

interface GeneralSettingsClientProps {
  displayName: string;
  email: string;
}

export function GeneralSettingsClient({
  displayName,
  email,
}: GeneralSettingsClientProps) {
  const [isElectron, setIsElectron] = useState(
    process.env.NEXT_PUBLIC_ALEX_DESKTOP === "true",
  );

  useEffect(() => {
    const electron = typeof window !== "undefined" && !!window.electronAPI;
    if (electron) {
      setIsElectron(true);
    }
  }, []);

  return (
    <div className="space-y-8">
      {/* Account info */}
      <div className="space-y-1">
        <h2 className="text-base font-medium">Account</h2>
        <p className="text-sm text-muted-foreground">
          Signed in as {displayName} ({email})
        </p>
      </div>

      {/* Logout */}
      {!isElectron && (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => signOut({ redirectTo: "/login" })}
          >
            Log out
          </Button>
        </div>
      )}
    </div>
  );
}
