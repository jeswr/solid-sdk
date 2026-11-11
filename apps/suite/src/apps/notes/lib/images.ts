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
