"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { BookCard, type Book } from "@/components/library/BookCard";

interface CollectionResponse {
  id: string;
  name: string;
  description: string | null;
  createdAt: number;
  books: Array<{
    id: string;
    title: string;
    author: string | null;
    coverPath: string | null;
    fileType: string;
    pageCount: number | null;
    addedAt: number;
    updatedAt: number;
  }>;
}

const editSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or fewer"),
  description: z.string().trim().optional(),
});

type EditValues = z.infer<typeof editSchema>;

export default function CollectionDetailClient() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const collectionId = params?.id;

  const [collection, setCollection] = useState<CollectionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: "", description: "" },
  });

  const loadCollection = useCallback(() => {
    if (!collectionId) return;
    setLoading(true);
    setError(null);

    fetch(`/api/collections/${collectionId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load collection");
        return r.json();
      })
      .then((data) => {
        setCollection(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load collection");
        setLoading(false);
      });
  }, [collectionId]);

  useEffect(() => {
    loadCollection();
  }, [loadCollection]);

  useEffect(() => {
    if (!collection) return;
    form.reset({
      name: collection.name,
      description: collection.description ?? "",
    });
  }, [collection, form]);

  const books: Book[] = useMemo(() => {
    if (!collection) return [];
    return collection.books.map((book) => ({
      id: book.id,
      title: book.title,
      author: book.author,
      coverPath: book.coverPath,
      fileType: book.fileType,
      pageCount: book.pageCount,
      updatedAt: book.updatedAt,
      readingProgress: null,
    }));
  }, [collection]);

  async function onEditSubmit(values: EditValues) {
    if (!collectionId) return;
    setSubmitError(null);
    const payload = {
      name: values.name.trim(),
      description: values.description?.trim() || undefined,
    };

    try {
      const res = await fetch(`/api/collections/${collectionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      const data = text
        ? (() => {
            try {
              return JSON.parse(text) as { error?: string };
            } catch {
              return null;
            }
          })()
        : null;

      if (!res.ok) {
        const message =
          typeof data?.error === "string"
            ? data.error
            : res.statusText || "Failed to update collection";
        setSubmitError(message);
        return;
      }

      toast.success("Collection updated");
      setEditOpen(false);
      loadCollection();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to update collection");
    }
  }

  async function onDeleteCollection() {
    if (!collectionId) return;
    try {
      const res = await fetch(`/api/collections/${collectionId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete collection");
      toast.success("Collection deleted");
      router.push("/collections");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete collection");
    } finally {
      setDeleteOpen(false);
    }
  }

  async function onRemoveBook(bookId: string) {
    if (!collectionId) return;
    try {
      const res = await fetch(`/api/collections/${collectionId}/books/${bookId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove book");
      toast.success("Removed from collection");
      loadCollection();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to remove book");
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Skeleton className="h-8 w-48" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
          </div>
        </div>
        <Skeleton className="h-4 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="rounded-lg border overflow-hidden">
              <Skeleton className="aspect-[2/3]" />
              <div className="p-3 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error || !collection) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
        {error || "Collection not found"}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{collection.name}</h1>
          {collection.description && (
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              {collection.description}
            </p>
          )}
          <p className="text-sm text-muted-foreground mt-2">
            {collection.books.length} {collection.books.length === 1 ? "book" : "books"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            Edit
          </Button>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            Delete
          </Button>
        </div>
      </div>

      {collection.books.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <svg
            className="h-12 w-12 text-muted-foreground mb-4"
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
          <p className="text-muted-foreground font-medium">
            This collection is empty. Add books from your library.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4 lg:gap-6">
          {books.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              actionLabel="Remove from collection"
              onAction={() => onRemoveBook(book.id)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) {
            form.reset({
              name: collection.name,
              description: collection.description ?? "",
            });
            setSubmitError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Collection</DialogTitle>
            <DialogDescription>Update your collection details.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              {submitError && (
                <div className="text-sm text-destructive">{submitError}</div>
              )}
              <DialogFooter>
                <DialogClose asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {form.formState.isSubmitting ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete collection?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the collection but won&apos;t delete any books.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDeleteCollection}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
