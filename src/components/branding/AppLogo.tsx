import { cn } from "@/lib/utils";

interface AppLogoProps {
  className?: string;
}

export function AppLogo({ className }: AppLogoProps) {
  return (
    <svg
      className={cn("h-6 w-6", className)}
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="128" cy="128" r="96" fill="none" stroke="currentColor" strokeWidth="12" />
      <rect x="88" y="88" width="80" height="80" fill="currentColor" />
    </svg>
  );
}
