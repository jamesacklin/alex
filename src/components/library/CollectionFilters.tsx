import { cn } from "@/lib/utils";

interface CollectionFiltersProps {
  filter: string;
  onFilterChange: (value: string) => void;
}

interface PillOption {
  value: string;
  label: string;
}

const FILTER_OPTIONS: PillOption[] = [
  { value: "all", label: "All" },
  { value: "private", label: "Private" },
  { value: "shared", label: "Shared" },
];

export function CollectionFilters({
  filter,
  onFilterChange,
}: CollectionFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {FILTER_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onFilterChange(option.value)}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 cursor-pointer",
            filter === option.value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-border"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
