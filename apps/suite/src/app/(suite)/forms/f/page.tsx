// AUTHORED-BY Codex (GPT-6.1 Sol)
import { Suspense } from "react";
import { FillView } from "@/apps/forms/components/fill-view";
export default function FillPage() {
  return (
    <Suspense fallback={<p role="status">Opening form…</p>}>
      <FillView />
    </Suspense>
  );
}
