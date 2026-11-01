// AUTHORED-BY Codex GPT-6
import { Suspense } from "react";
import { CollectionScreen } from "@/apps/photos/components/collections";
export default function Page() {
  return (
    <Suspense>
      <CollectionScreen kind="favourites" />
    </Suspense>
  );
}
