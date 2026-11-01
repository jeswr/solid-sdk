// AUTHORED-BY Codex
import { notFound } from "next/navigation";
import { decodeRef } from "@/lib/refs";
export default async function DocumentPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  try {
    decodeRef(ref);
  } catch {
    notFound();
  }
  return null;
}
