// AUTHORED-BY Codex GPT-6.1-Sol

import { notFound } from "next/navigation";
import { InboxScreen } from "@/apps/agent/components/inbox";
import { guardSlug } from "@/apps/agent/lib/paths";
export default async function Page({ params }: { params: Promise<{ binding: string }> }) {
  const { binding } = await params;
  try {
    guardSlug(binding);
  } catch {
    notFound();
  }
  return <InboxScreen binding={binding} />;
}
