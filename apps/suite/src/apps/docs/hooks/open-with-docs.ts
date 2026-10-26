// AUTHORED-BY Codex
import type { PodSession } from "@/lib/session/pod-session";
import { importDocument, validateImportFile } from "../editor/import-document";
import type { ImportProgress } from "../lib/convert/docx-import";

/** Drive can pass its selected pod file and navigate to the returned Docs resource. */
export async function openWithDocs(
  source: { url: string; name: string },
  session: PodSession,
  progress: (value: ImportProgress) => void,
) {
  validateImportFile({ name: source.name, size: 0 });
  const url = new URL(source.url);
  if (
    url.origin !== new URL(session.storageUrl).origin ||
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Choose a file on your pod");
  const response = await session.fetch(url.href, { redirect: "error" });
  if (!response.ok) throw new Error("We couldn't open this file");
  const data = await response.blob();
  return importDocument(new File([data], source.name, { type: data.type }), session, progress);
}
