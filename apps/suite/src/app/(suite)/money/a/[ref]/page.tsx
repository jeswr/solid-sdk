// AUTHORED-BY Codex GPT-6
import { notFound } from "next/navigation";
import { LedgerScreen } from "@/apps/money/components/ledger";
import { decodeRef } from "@/lib/refs";
export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  let id: string;
  try {
    id = decodeRef(ref);
  } catch {
    notFound();
  }
  return <LedgerScreen accountId={id} />;
}
