// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { InboxRoute } from "@/apps/agent/components/detail-route";
import { guardSlug } from "@/apps/agent/lib/paths";

// Staging sets this literal to false; the web target retains on-demand routes.
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ binding: "__" }] : [];
}
export default async function Page({ params }: { params: Promise<{ binding: string }> }) {
  if (process.env.NEXT_PUBLIC_SUITE_TARGET !== "native") {
    const { binding } = await params;
    try {
      guardSlug(binding);
    } catch {
      notFound();
    }
  }
  return (
    <Suspense>
      <InboxRoute />
    </Suspense>
  );
}
