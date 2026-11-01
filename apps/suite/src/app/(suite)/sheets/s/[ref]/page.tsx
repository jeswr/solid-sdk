// AUTHORED-BY Codex GPT-6.1-Sol
import { SheetEditor, SheetNotFound } from "@/apps/sheets/components/sheet-editor";
import { decodeRef } from "@/lib/refs";

export default async function EditorPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  let container: string;
  try {
    container = decodeRef(ref);
    const url = new URL(container);
    if (!url.pathname.endsWith("/") || url.search || url.hash || url.username || url.password)
      return <SheetNotFound />;
  } catch {
    return <SheetNotFound />;
  }
  return <SheetEditor key={container} container={container} />;
}
