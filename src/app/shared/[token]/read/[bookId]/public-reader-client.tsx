"use client";

interface PublicReaderClientProps {
  token: string;
  bookId: string;
  title: string;
  fileType: "pdf" | "epub";
  fileUrl: string;
  backUrl: string;
}

export default function PublicReaderClient({
  token,
  bookId,
  title,
  fileType,
  fileUrl,
  backUrl,
}: PublicReaderClientProps) {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      Reader loading…
    </div>
  );
}
