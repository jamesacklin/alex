"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ReadingProgressMeter } from "@/components/library/ReadingProgressMeter";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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

interface CollectionOption {
  id: string;
  name: string;
  description: string | null;
  containsBook?: boolean;
}

export function BookCard({
  book,
  actionLabel,
  onAction,
}: {
  book: Book;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [collections, setCollections] = useState<CollectionOption[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collectionsError, setCollectionsError] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [collectionsLoaded, setCollectionsLoaded] = useState(false);

  const savingSet = useMemo(() => new Set(savingIds), [savingIds]);
  const hasCollection = collections.some((option) => option.containsBook);
  const metadataParts = [
    book.fileType === "pdf" ? "PDF" : "EPUB",
    book.pageCount
      ? `${book.pageCount} ${book.pageCount === 1 ? "page" : "pages"}`
      : null,
  ].filter((value): value is string => Boolean(value));
  const metadata = metadataParts.join(" · ");

  useEffect(() => {
    if (collectionsLoaded && !collectionsOpen) return;
    setCollectionsLoading(true);
    setCollectionsError(null);
    fetch(`/api/collections?bookId=${encodeURIComponent(book.id)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load collections");
        return r.json();
      })
      .then((data) => {
        setCollections(Array.isArray(data.collections) ? data.collections : []);
        setCollectionsLoading(false);
        setCollectionsLoaded(true);
      })
      .catch((err) => {
        setCollectionsError(
          err instanceof Error ? err.message : "Failed to load collections",
        );
        setCollectionsLoading(false);
      });
  }, [book.id, collectionsLoaded, collectionsOpen]);

  async function toggleCollection(option: CollectionOption) {
    if (savingSet.has(option.id)) return;
    setSavingIds((prev) => [...prev, option.id]);

    const isInCollection = Boolean(option.containsBook);
    try {
      if (isInCollection) {
        const res = await fetch(
          `/api/collections/${option.id}/books/${book.id}`,
          {
            method: "DELETE",
          },
        );
        if (!res.ok) throw new Error("Failed to remove book");
        toast.success(`Removed from ${option.name}`);
        setCollections((prev) =>
          prev.map((item) =>
            item.id === option.id ? { ...item, containsBook: false } : item,
          ),
        );
      } else {
        const res = await fetch(`/api/collections/${option.id}/books`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookId: book.id }),
        });
        if (!res.ok) throw new Error("Failed to add book");
        toast.success(`Added to ${option.name}`);
        setCollections((prev) =>
          prev.map((item) =>
            item.id === option.id ? { ...item, containsBook: true } : item,
          ),
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update collection",
      );
    } finally {
      setSavingIds((prev) => prev.filter((id) => id !== option.id));
    }
  }

  return (
    <Link
      href={`/read/${book.id}`}
      className="group block overflow-hidden"
      onClick={(event) => {
        if (collectionsOpen) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {/* Cover */}
      <div className="relative aspect-[2/3] overflow-hidden bg-muted rounded-sm">
        <img
          src={`/api/books/${book.id}/cover?t=${book.updatedAt}`}
          alt={book.title}
          className="w-full h-full object-cover"
        />
      </div>

      {/* Info */}
      <div className="pt-2.5 space-y-1">
        <div className="flex items-start gap-2">
          <h3 className="flex-1 font-normal text-sm leading-tight line-clamp-2">
            {book.title}
          </h3>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            className={[
              "text-muted-foreground hover:text-foreground",
              hasCollection ? "text-foreground" : "",
            ].join(" ")}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setCollectionsOpen(true);
            }}
          >
            <span className="sr-only">Add to Collection</span>
            <svg
              className="h-3.5 w-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </Button>
        </div>
        {book.author && (
          <p className="text-sm text-muted-foreground truncate">
            {book.author}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {metadata}
        </p>
        {book.readingProgress?.status === "completed" && (
          <p className="text-xs text-muted-foreground font-medium">
            Completed
          </p>
        )}

        {(actionLabel && onAction) && (
          <Button
            type="button"
            size="xs"
            variant="outline"
            className="h-6 px-2 text-sm"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onAction();
            }}
          >
            {actionLabel}
          </Button>
        )}

        {/* Progress bar — reading only */}
        {book.readingProgress?.status === "reading" && (
          <ReadingProgressMeter
            percentComplete={book.readingProgress.percentComplete}
          />
        )}
      </div>

      <Dialog open={collectionsOpen} onOpenChange={setCollectionsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to Collection</DialogTitle>
            <DialogDescription>
              Select collections for this book.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {collectionsLoading ? (
              <div className="text-sm text-muted-foreground">
                Loading collections…
              </div>
            ) : collectionsError ? (
              <div className="text-sm text-destructive">{collectionsError}</div>
            ) : collections.length === 0 ? (
              <div className="text-sm text-muted-foreground">
                You haven&apos;t created any collections yet.
              </div>
            ) : (
              <div className="space-y-2">
                {collections.map((option) => {
                  const isSelected = Boolean(option.containsBook);
                  const isSaving = savingSet.has(option.id);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => toggleCollection(option)}
                      disabled={isSaving}
                      role="checkbox"
                      aria-checked={isSelected}
                      className={[
                        "w-full flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                        isSelected
                          ? "border-primary/50 bg-primary/5"
                          : "hover:bg-muted/60",
                        isSaving ? "opacity-60 cursor-not-allowed" : "",
                      ].join(" ")}
                    >
                      <span className="text-primary text-sm font-medium" aria-hidden="true">
                        {isSelected ? "☑" : "☐"}
                      </span>
                      <span className="flex-1">
                        <span className="block text-sm font-medium">
                          {option.name}
                        </span>
                        {option.description && (
                          <span className="block text-sm text-muted-foreground line-clamp-1">
                            {option.description}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Done
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Link>
  );
}
