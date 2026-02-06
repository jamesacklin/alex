import { Suspense } from "react";
import CollectionsClient from "./collections-client";

export default function CollectionsPage() {
  return (
    <Suspense>
      <CollectionsClient />
    </Suspense>
  );
}
