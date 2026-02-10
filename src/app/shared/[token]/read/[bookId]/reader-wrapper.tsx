"use client";

import dynamic from "next/dynamic";

const PublicReaderClient = dynamic(() => import("./public-reader-client"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex items-center gap-2 text-muted-foreground">
        <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        Loading reader...
      </div>
    </div>
  ),
});

interface ReaderWrapperProps {
  token: string;
  bookId: string;
  title: string;
  fileType: "pdf" | "epub";
  fileUrl: string;
  backUrl: string;
}

export default function ReaderWrapper(props: ReaderWrapperProps) {
  return <PublicReaderClient {...props} />;
}
