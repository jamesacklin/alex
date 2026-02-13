export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4">
      <svg
        className="h-16 w-16 text-muted-foreground mb-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        <line x1="8" y1="8" x2="16" y2="16" />
        <line x1="16" y1="8" x2="8" y2="16" />
      </svg>
      <h1 className="text-lg font-medium tracking-tight mb-2">Collection Not Found</h1>
      <p className="text-muted-foreground max-w-md">
        This collection doesn&apos;t exist or is no longer shared. Please check
        the link and try again.
      </p>
    </div>
  );
}
