import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSharedBook } from "@/lib/shared";
import PublicReaderClient from "./public-reader-client";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string; bookId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token, bookId } = await params;
  const book = await getSharedBook(token, bookId);

  if (!book) {
    return { title: "Book Not Found" };
  }

  return {
    title: `${book.title} - Reader`,
  };
}

export default async function PublicReaderPage({ params }: PageProps) {
  const { token, bookId } = await params;
  const book = await getSharedBook(token, bookId);

  if (!book) {
    notFound();
  }

  if (book.fileType !== "pdf" && book.fileType !== "epub") {
    notFound();
  }

  const fileUrl =
    book.fileType === "pdf"
      ? `/api/shared/${token}/books/${bookId}/file`
      : `/api/shared/${token}/books/${bookId}/book.epub`;

  return (
    <PublicReaderClient
      token={token}
      bookId={bookId}
      title={book.title}
      fileType={book.fileType}
      fileUrl={fileUrl}
      backUrl={`/shared/${token}`}
    />
  );
}
