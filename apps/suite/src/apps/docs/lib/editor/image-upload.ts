// AUTHORED-BY Codex GPT-6.1-Sol
import { displayImageBlob } from "../../editor/image-blob";
import { validateImage } from "./logic";

/** Shared Docs/Notes upload: never trust the original file name or follow redirects. */
export async function uploadPodImage(file: Blob, container: string, fetchImpl: typeof fetch) {
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
  const src = `${container}${crypto.randomUUID()}.${extension}`;
  const response = await fetchImpl(src, {
    method: "PUT",
    redirect: "error",
    headers: { "content-type": file.type, "if-none-match": "*" },
    body: file,
  });
  if (!response.ok) throw new Error("Upload failed");
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
