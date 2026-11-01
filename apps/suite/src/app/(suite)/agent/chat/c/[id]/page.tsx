// AUTHORED-BY Codex GPT-6.1-Sol

import { notFound } from "next/navigation";
import { ChatScreen } from "@/apps/agent/components/chat";
import { guardSlug } from "@/apps/agent/lib/paths";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    guardSlug(id);
  } catch {
    notFound();
  }
  return <ChatScreen id={id} />;
}
