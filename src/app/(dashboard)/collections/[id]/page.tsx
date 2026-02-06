import { Suspense } from "react";
import CollectionDetailClient from "./collection-detail-client";

export default function CollectionDetailPage() {
  return (
    <Suspense>
      <CollectionDetailClient />
    </Suspense>
  );
}
