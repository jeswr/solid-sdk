// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { displayImageBlob } from "../../editor/image-blob";
import { validateImage } from "./logic";

/** Shared Docs/Notes upload: never trust the original file name or follow redirects. */
export async function uploadPodImage(
  file: Blob,
  container: string,
  fetchImpl: typeof fetch,
  uploadId?: string,
) {
  const error = validateImage(file);
  if (error) throw new Error(error);
  const extension = (
    {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/svg+xml": "svg",
    } as Record<string, string>
  )[file.type];
  const src = `${container}${encodeURIComponent(uploadId ?? crypto.randomUUID())}.${extension}`;
  const response = await fetchImpl(src, {
    method: "PUT",
    redirect: "error",
    headers: { "content-type": file.type, "if-none-match": "*" },
    body: file,
  });
  if (!response.ok) {
    if (!uploadId || response.status !== 412) throw new Error("Upload failed");
    // An interrupted conversion may have written these bytes before losing its acknowledgement.
    const existing = await fetchImpl(src, { redirect: "error" });
    if (!existing.ok) throw new Error("Upload failed");
    const prior = new Uint8Array(await existing.arrayBuffer());
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (prior.length !== bytes.length || prior.some((byte, index) => byte !== bytes[index]))
      throw new Error("Upload failed");
  }
  return src;
}

/** Active formats are decoded to PNG before any navigable blob URL is published. */
export async function readPodImage(
  src: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal | null = null,
) {
  const response = await fetchImpl(src, { signal, redirect: "error" });
  if (!response.ok) throw new Error("Image unavailable");
  return displayImageBlob(await response.blob());
}
