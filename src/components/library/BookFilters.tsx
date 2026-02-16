import { cn } from "@/lib/utils";

interface BookFiltersProps {
  type: string;
  status: string;
  sort: string;
  hasFilters: boolean;
  onTypeChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onClearFilters: () => void;
}

interface PillOption {
  value: string;
  label: string;
}

const TYPE_OPTIONS: PillOption[] = [
  { value: "all", label: "All Types" },
  { value: "pdf", label: "PDF" },
  { value: "epub", label: "ePub" },
];

const STATUS_OPTIONS: PillOption[] = [
  { value: "all", label: "All" },
  { value: "not_started", label: "Not Started" },
  { value: "reading", label: "Reading" },
  { value: "completed", label: "Completed" },
];

const SORT_OPTIONS: PillOption[] = [
  { value: "added", label: "Recent" },
  { value: "read", label: "Last Read" },
  { value: "title", label: "Title" },
  { value: "author", label: "Author" },
];

export function BookFilters({
  type,
  status,
  sort,
  hasFilters,
  onTypeChange,
  onStatusChange,
  onSortChange,
  onClearFilters,
}: BookFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {/* Type pills */}
      {TYPE_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onTypeChange(option.value)}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 cursor-pointer",
            type === option.value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-border"
          )}
        >
          {option.label}
        </button>
      ))}

      <div className="w-px h-6 bg-border mx-1" />

      {/* Status pills */}
      {STATUS_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onStatusChange(option.value)}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 cursor-pointer",
            status === option.value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-border"
          )}
        >
          {option.label}
        </button>
      ))}

      <div className="w-px h-6 bg-border mx-1" />

      {/* Sort pills */}
      {SORT_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onSortChange(option.value)}
          className={cn(
            "rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-200 cursor-pointer",
            sort === option.value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border border-border"
          )}
        >
          {option.label}
        </button>
      ))}

      {/* Clear filters */}
      {hasFilters && (
        <>
          <div className="w-px h-6 bg-border mx-1" />
          <button
            type="button"
            onClick={onClearFilters}
            className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-200 cursor-pointer border border-border"
          >
            Clear
          </button>
        </>
      )}
    </div>
  );
}
