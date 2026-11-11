// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChatRoute } from "@/apps/agent/components/detail-route";
import { guardSlug } from "@/apps/agent/lib/paths";

// Staging sets this literal to false; the web target retains on-demand routes.
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ id: "__" }] : [];
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  if (process.env.NEXT_PUBLIC_SUITE_TARGET !== "native") {
    const { id } = await params;
    try {
      guardSlug(id);
    } catch {
      notFound();
    }
  }
  return (
    <Suspense>
      <ChatRoute />
    </Suspense>
  );
}
