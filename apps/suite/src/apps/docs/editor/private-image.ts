// AUTHORED-BY Codex
import Image from "@tiptap/extension-image";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { validLink } from "../lib/editor/logic";
import { displayImageBlob } from "./image-blob";
import { imageLinkFromHtml, normaliseImageLink } from "./image-link";
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
    addAttributes() {
      return {
        ...this.parent?.(),
        link: { default: null, rendered: false, parseHTML: imageLinkFromHtml },
      };
    },
    renderHTML(props) {
      const image = this.parent?.(props) as DOMOutputSpec;
      const link = normaliseImageLink(props.node.attrs.link);
      return link ? ["a", link, image] : image;
    },
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
              const blob = await displayImageBlob(await response.blob());
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
        const link = normaliseImageLink(node.attrs.link);
        let wrapper: HTMLElement = dom;
        if (link) {
          const anchor = document.createElement("a");
          for (const [key, value] of Object.entries(link))
            if (value !== null) anchor.setAttribute(key, value);
          // Match text links: normal editor clicks select; the link popover opens.
          anchor.addEventListener("click", (event) => event.preventDefault());
          anchor.append(dom);
          wrapper = anchor;
        }
        return {
          dom: wrapper,
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
