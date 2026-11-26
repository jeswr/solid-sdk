// AUTHORED-BY Codex GPT-6.1-Sol
import { normalizePodBase } from "@jeswr/guarded-fetch";
import { isDirectChild } from "@jeswr/solid-docs/layout";

export const notesMediaContainer = (podRoot: string) =>
  new URL("notes/media/", normalizePodBase(podRoot)).href;

/** Only this account's Notes media or a Docs document's asset container may render. */
export function noteImageSource(source: string, podRoot: string): string | null {
  try {
    const url = new URL(source);
    const root = normalizePodBase(podRoot);
    if (/[\\\s]|%2f|%5c|%25/i.test(source)) return null;
    if (isDirectChild(url.href, notesMediaContainer(root))) return url.href;
    for (const directory of ["docs/", "pod-docs/"]) {
      const docs = new URL(directory, root);
      const relative = url.pathname.slice(docs.pathname.length).split("/");
      if (
        relative.length === 3 &&
        relative[1] === "assets" &&
        isDirectChild(`${docs.href}${relative[0]}`, docs.href) &&
        isDirectChild(url.href, `${docs.href}${relative[0]}/assets/`)
      )
        return url.href;
    }
  } catch {
    /* Invalid URLs are inert. */
  }
  return null;
}

/** DOMParser keeps hostile HTML inert; never project an unvalidated src into the UI. */
export function noteImages(html: string, podRoot: string): { src: string; alt: string }[] {
  if (typeof window === "undefined") return [];
  const parsed = new window.DOMParser().parseFromString(html, "text/html");
  return Array.from(parsed.querySelectorAll("img")).flatMap((image) => {
    const src = noteImageSource(image.getAttribute("src") ?? "", podRoot);
    return src ? [{ src, alt: image.getAttribute("alt") ?? "" }] : [];
  });
}

export function firstNoteImage(html: string, podRoot: string) {
  return noteImages(html, podRoot)[0];
}

/** Raised by readCappedBlob as soon as a body passes its byte cap. */
export class ByteLimitError extends Error {
  constructor(readonly max: number) {
    super(`Response body exceeds ${max} bytes`);
    this.name = "ByteLimitError";
  }
}

/** Read a body through a byte cap: Content-Length first, then while streaming, never after. */
export async function readCappedBlob(response: Response, max: number): Promise<Blob> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > max) {
    void response.body?.cancel().catch(() => {});
    throw new ByteLimitError(max);
  }
  const type = response.headers.get("content-type") ?? "";
  const reader = response.body?.getReader();
  if (!reader) {
    // No stream means no body (Fetch spec). Never buffer an unstreamed body past the cap.
    if (declared !== null && Number(declared) > 0) throw new ByteLimitError(max);
    return new Blob([], { type });
  }
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) throw new ByteLimitError(max);
      chunks.push(value as Uint8Array<ArrayBuffer>);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type });
}
