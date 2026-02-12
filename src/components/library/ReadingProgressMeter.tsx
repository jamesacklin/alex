"use client";

import { cn } from "@/lib/utils";

interface ReadingProgressMeterProps {
  percentComplete: number;
  label?: string;
  precision?: number;
  compact?: boolean;
  className?: string;
  rowClassName?: string;
  trackClassName?: string;
  fillClassName?: string;
}

export function ReadingProgressMeter({
  percentComplete,
  label = "Reading",
  precision = 0,
  compact = false,
  className,
  rowClassName,
  trackClassName,
  fillClassName,
}: ReadingProgressMeterProps) {
  const normalizedPercent = Number.isFinite(percentComplete)
    ? Math.min(100, Math.max(0, percentComplete))
    : 0;
  const safePrecision = Number.isInteger(precision)
    ? Math.min(4, Math.max(0, precision))
    : 0;
  const formattedPercent = normalizedPercent.toFixed(safePrecision);

  return (
    <div className={cn(compact ? "space-y-1" : "pt-2", className)}>
      <div
        className={cn(
          "flex justify-between text-muted-foreground",
          compact ? "text-xs" : "text-sm mb-1",
          rowClassName,
        )}
      >
        <span>{label}</span>
        <span>{formattedPercent}%</span>
      </div>
      <div
        className={cn(
          "w-full bg-muted overflow-hidden",
          compact ? "h-1" : "h-1.5",
          trackClassName,
        )}
      >
        <div
          className={cn(
            "h-full bg-primary transition-[width] duration-200 ease-out",
            fillClassName,
          )}
          style={{ width: `${normalizedPercent}%` }}
        />
      </div>
    </div>
  );
}
