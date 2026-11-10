// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import { notFound } from "next/navigation";
import { ActivityScreen } from "@/apps/agent/components/activity";
import { guardSlug } from "@/apps/agent/lib/paths";

// Staging sets this literal to false; the web target retains on-demand routes. The native export
// has one placeholder page, which shows only the signed-out gate until native sign-in lands.
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ seq: "__" }] : [];
}
export default async function Page({ params }: { params: Promise<{ seq: string }> }) {
  const { seq } = await params;
  try {
    guardSlug(seq);
  } catch {
    notFound();
  }
  return <ActivityScreen seq={seq} />;
}
