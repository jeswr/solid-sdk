// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5

import { notFound } from "next/navigation";
import { AccountsScreen } from "@/apps/agent/components/accounts";
import { guardSlug } from "@/apps/agent/lib/paths";

// Staging sets this literal to false; the web target retains on-demand routes. The native export
// has one placeholder page, which shows only the signed-out gate until native sign-in lands.
export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ id: "__" }] : [];
}
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    guardSlug(id);
  } catch {
    notFound();
  }
  return <AccountsScreen id={id} />;
}
