"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";

export interface SharedBook {
  id: string;
  title: string;
  author: string | null;
  fileType: string;
  pageCount: number | null;
  coverUrl: string;
}

interface SharedBookCardProps {
  book: SharedBook;
  shareToken: string;
}

export function SharedBookCard({ book, shareToken }: SharedBookCardProps) {
  const [imageError, setImageError] = useState(false);

  return (
    <Link
      href={`/shared/${shareToken}/read/${book.id}`}
      className="group block rounded-lg border bg-card overflow-hidden hover:shadow-lg transition-shadow"
    >
      {/* Cover */}
      <div className="relative aspect-[2/3] overflow-hidden bg-muted">
        {!imageError ? (
          <img
            src={book.coverUrl}
            alt={book.title}
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
          />
        ) : (
          // Cover placeholder SVG
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-muted to-muted/50">
            <svg
              className="h-16 w-16 text-muted-foreground/30"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </div>
        )}
        {/* File-type badge */}
        <div className="absolute top-2 right-2">
          <Badge
            variant="secondary"
            className="text-sm font-semibold bg-white/90 text-gray-800"
          >
            {book.fileType === "pdf" ? "PDF" : "EPUB"}
          </Badge>
        </div>
      </div>

      {/* Info */}
      <div className="p-3 space-y-1">
        <h3 className="font-medium text-sm leading-snug line-clamp-2 group-hover:text-primary transition-colors">
          {book.title}
        </h3>
        {book.author && (
          <p className="text-sm text-muted-foreground truncate">
            {book.author}
          </p>
        )}
        {book.pageCount !== null && (
          <p className="text-sm text-muted-foreground">
            {book.pageCount} {book.pageCount === 1 ? "page" : "pages"}
          </p>
        )}
      </div>
    </Link>
  );
}
