// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { Suspense } from "react";
import { NewSheetRoute } from "@/apps/sheets/components/native-routes";

/** The query comes from the URL on the client, so the page can be exported statically. */
export default function NewPage() {
  return (
    <Suspense>
      <NewSheetRoute />
    </Suspense>
  );
}
