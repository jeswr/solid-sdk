// AUTHORED-BY Codex
import Image from "@tiptap/extension-image";
import { validLink } from "../lib/editor/logic";
/**
 * Pod credentials go only to the pod's own origin: an image URL pasted from elsewhere is fetched
 * anonymously, so a document can't make the editor send authenticated requests to other hosts.
 */
export function podScopedFetch(fetchImpl: typeof fetch, storageUrl: string): typeof fetch {
  const podOrigin = new URL(storageUrl).origin;
  return (input, init) =>
    new URL(input instanceof Request ? input.url : String(input)).origin === podOrigin
      ? fetchImpl(input, init)
      : fetch(input, { ...init, credentials: "omit", referrerPolicy: "no-referrer" });
}
/** The stored src stays a pod URL; authenticated bytes are displayed only in the node view. */
export function privateImage(fetchImpl: typeof fetch) {
  return Image.extend({
    parseHTML() {
      return [
        {
          tag: "img[src]",
          getAttrs: (element) =>
            /^https?:/.test(element.getAttribute("src") ?? "") &&
            validLink(element.getAttribute("src") ?? "")
              ? null
              : false,
        },
      ];
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement("img");
        let objectUrl: string | undefined;
        let alive = true;
        const abort = new AbortController();
        dom.dataset.docsImageState = "loading";
        dom.alt = String(node.attrs.alt ?? "");
        dom.className = "docs-private-image";
        dom.style.width = node.attrs.width ? `${node.attrs.width}px` : "100%";
        const src = String(node.attrs.src);
        if (validLink(src) && /^https?:/.test(src)) {
          void fetchImpl(src, { signal: abort.signal, redirect: "error" })
            .then(async (response) => {
              if (!response.ok) throw new Error("Image unavailable");
              const blob = await response.blob();
              if (!blob.type.startsWith("image/")) throw new Error("Image unavailable");
              if (alive) {
                objectUrl = URL.createObjectURL(blob);
                dom.src = objectUrl;
              }
            })
            .catch(() => {
              if (!alive) return;
              dom.dataset.docsImageState = "error";
              dom.alt = node.attrs.alt
                ? `Image unavailable: ${node.attrs.alt}`
                : "Image unavailable";
            });
        } else dom.dataset.docsImageState = "error";
        return {
          dom,
          destroy() {
            alive = false;
            abort.abort();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
          },
        };
      };
    },
  });
}
