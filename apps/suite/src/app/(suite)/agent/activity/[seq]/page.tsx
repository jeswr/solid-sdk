// AUTHORED-BY Codex GPT-6.1-Sol

import { notFound } from "next/navigation";
import { ActivityScreen } from "@/apps/agent/components/activity";
import { guardSlug } from "@/apps/agent/lib/paths";
export default async function Page({ params }: { params: Promise<{ seq: string }> }) {
  const { seq } = await params;
  try {
    guardSlug(seq);
  } catch {
    notFound();
  }
  return <ActivityScreen seq={seq} />;
}
