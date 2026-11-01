// AUTHORED-BY Codex GPT-6.1-Sol

import { notFound } from "next/navigation";
import { AccountsScreen } from "@/apps/agent/components/accounts";
import { guardSlug } from "@/apps/agent/lib/paths";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    guardSlug(id);
  } catch {
    notFound();
  }
  return <AccountsScreen id={id} />;
}
