// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActivityRoute } from "@/apps/agent/components/detail-route";
import { guardSlug } from "@/apps/agent/lib/paths";

// Staging sets this literal to false; the web target retains on-demand routes.
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ seq: "__" }] : [];
}
export default async function Page({ params }: { params: Promise<{ seq: string }> }) {
  if (process.env.NEXT_PUBLIC_SUITE_TARGET !== "native") {
    const { seq } = await params;
    try {
      guardSlug(seq);
    } catch {
      notFound();
    }
  }
  return (
    <Suspense>
      <ActivityRoute />
    </Suspense>
  );
}
