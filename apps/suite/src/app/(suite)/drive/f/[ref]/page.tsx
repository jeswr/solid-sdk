// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
import { Suspense } from "react";
import { FolderRefView } from "@/apps/drive/components/views";

// Staging sets this literal to false; the web target retains on-demand routes.
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ ref: "__" }] : [];
}

export default function Page() {
  return (
    <Suspense>
      <FolderRefView />
    </Suspense>
  );
}
