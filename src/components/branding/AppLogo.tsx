import Image from "next/image";
import { cn } from "@/lib/utils";

interface AppLogoProps {
  className?: string;
}

export function AppLogo({ className }: AppLogoProps) {
  return (
    <Image
      src="/icon.png"
      alt=""
      className={cn("h-6 w-6", className)}
      aria-hidden="true"
      width={24}
      height={24}
      unoptimized
    />
  );
}
