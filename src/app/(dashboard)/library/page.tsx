import { Suspense } from "react";
import LibraryClient from "./library-client";

export default function LibraryPage() {
  return (
    <Suspense>
      <LibraryClient />
    </Suspense>
  );
}
