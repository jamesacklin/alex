import { cn } from "@/lib/utils";

/**
 * Skeleton Component
 *
 * Provides visual loading placeholder with proper accessibility attributes
 * for screen readers to announce loading state.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading"
      className={cn("bg-accent animate-pulse", className)}
      {...props}
    />
  );
}

export { Skeleton }
