"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Link2 } from "lucide-react";

interface CollectionSummary {
  id: string;
  name: string;
  description: string | null;
  createdAt: number;
  shareToken: string | null;
  bookCount: number;
}

const createCollectionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must be 100 characters or fewer"),
  description: z.string().trim().optional(),
});

type CreateCollectionValues = z.infer<typeof createCollectionSchema>;

export default function CollectionsClient() {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<CreateCollectionValues>({
    resolver: zodResolver(createCollectionSchema),
    defaultValues: { name: "", description: "" },
  });

  const loadCollections = useCallback(() => {
    setLoading(true);
    setError(null);

    fetch("/api/collections")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load collections");
        return r.json();
      })
      .then((data) => {
        setCollections(Array.isArray(data.collections) ? data.collections : []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load collections");
        setCollections([]);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  async function onCreateSubmit(values: CreateCollectionValues) {
    setSubmitError(null);
    const payload = {
      name: values.name.trim(),
      description: values.description?.trim() || undefined,
    };

    try {
      const res = await fetch("/api/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      const data = text ? (() => {
        try {
          return JSON.parse(text) as { error?: string };
        } catch {
          return null;
        }
      })() : null;

      if (!res.ok) {
        const message =
          typeof data?.error === "string"
            ? data.error
            : res.statusText || "Failed to create collection";
        setSubmitError(message);
        return;
      }
      toast.success("Collection created");
      form.reset();
      setCreateOpen(false);
      loadCollections();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to create collection");
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Collections</h1>
        <Button type="button" onClick={() => setCreateOpen(true)}>
          New Collection
        </Button>
      </div>

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) {
            form.reset();
            setSubmitError(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Collection</DialogTitle>
            <DialogDescription>
              Create a collection to organize your books.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onCreateSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Sci-Fi Favorites" {...field} />
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
                      <Textarea placeholder="Optional description" {...field} />
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
                  {form.formState.isSubmitting ? "Creating…" : "Create"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="gap-4">
              <CardHeader className="pb-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-1/3" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          {error}
        </div>
      ) : collections.length === 0 ? (
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
            <polygon points="12 2 2 7 12 12 22 7 12 2" />
            <polyline points="2 17 12 22 22 17" />
            <polyline points="2 12 12 17 22 12" />
          </svg>
          <p className="text-muted-foreground font-medium">You haven&apos;t created any collections yet</p>
          <p className="text-sm text-muted-foreground mt-1">
            Create a collection to start organizing your library.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-6">
          {collections.map((collection) => (
            <Link key={collection.id} href={`/collections/${collection.id}`} className="group">
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg flex-1">{collection.name}</CardTitle>
                    {collection.shareToken && (
                      <div className="shrink-0" title="This collection is publicly shared">
                        <Link2 className="h-4 w-4 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <CardAction className="text-sm text-muted-foreground">
                    {collection.bookCount} {collection.bookCount === 1 ? "book" : "books"}
                  </CardAction>
                  <CardDescription className="line-clamp-2">
                    {collection.description || "No description"}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-muted-foreground">
                    View collection
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
