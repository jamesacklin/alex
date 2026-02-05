import Link from "next/link";
import { Badge } from "@/components/ui/badge";

export interface Book {
  id: string;
  title: string;
  author: string | null;
  coverPath: string | null;
  fileType: string;
  pageCount: number | null;
  updatedAt: number;
  readingProgress: {
    status: string;
    percentComplete: number;
    lastReadAt: number | null;
  } | null;
}

export function BookCard({ book }: { book: Book }) {
  return (
    <Link
      href={`/read/${book.id}`}
      className="group block rounded-lg border bg-card overflow-hidden"
    >
      {/* Cover */}
      <div className="relative aspect-[2/3] overflow-hidden bg-muted">
        <img
          src={`/api/books/${book.id}/cover?t=${book.updatedAt}`}
          alt={book.title}
          className="w-full h-full object-cover"
        />
        {/* File-type badge */}
        <div className="absolute top-2 right-2">
          <Badge
            variant="secondary"
            className="text-xs font-semibold bg-white/90 text-gray-800"
          >
            {book.fileType === "pdf" ? "PDF" : "EPUB"}
          </Badge>
        </div>
        {/* Completed overlay */}
        {book.readingProgress?.status === "completed" && (
          <div className="absolute bottom-2 left-2">
            <Badge className="text-xs bg-green-600 text-white">Completed</Badge>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="p-3 space-y-1">
        <h3 className="font-medium text-sm leading-snug line-clamp-2">
          {book.title}
        </h3>
        {book.author && (
          <p className="text-xs text-muted-foreground truncate">
            {book.author}
          </p>
        )}

        {/* Progress bar — reading only */}
        {book.readingProgress?.status === "reading" && (
          <div className="pt-2">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Reading</span>
              <span>{book.readingProgress.percentComplete.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full"
                style={{ width: `${book.readingProgress.percentComplete}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
