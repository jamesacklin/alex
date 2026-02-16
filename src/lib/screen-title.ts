/**
 * Get the screen title based on the current pathname
 */
export function getScreenTitle(pathname: string): string {
  // Settings routes
  if (pathname.startsWith("/admin")) {
    return "Settings";
  }

  // Collections routes
  if (pathname.startsWith("/collections")) {
    return "Collections";
  }

  // Library routes (default)
  if (pathname.startsWith("/library") || pathname === "/") {
    return "Library";
  }

  // Default fallback
  return "Library";
}
