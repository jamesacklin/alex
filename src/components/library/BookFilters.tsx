import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
    <>
      {/* Type */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">Type:</span>
        <Select value={type} onValueChange={onTypeChange}>
          <SelectTrigger size="sm" className="w-36 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="pdf">PDF</SelectItem>
            <SelectItem value="epub">ePub</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">Status:</span>
        <Select value={status} onValueChange={onStatusChange}>
          <SelectTrigger size="sm" className="w-40 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="not_started">Not Started</SelectItem>
            <SelectItem value="reading">Reading</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Sort */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">Sort by:</span>
        <Select value={sort} onValueChange={onSortChange}>
          <SelectTrigger size="sm" className="w-44 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="added">Recently Added</SelectItem>
            <SelectItem value="read">Recently Read</SelectItem>
            <SelectItem value="title">Title A–Z</SelectItem>
            <SelectItem value="author">Author A–Z</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Clear filters */}
      {hasFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Clear filters
        </button>
      )}
    </>
  );
}
