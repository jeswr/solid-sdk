// AUTHORED-BY Codex
import Image from "@tiptap/extension-image";
import type { DOMOutputSpec } from "@tiptap/pm/model";
import { normaliseImageDestination } from "../lib/editor/destination";
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
          getAttrs: (element) => {
            const src = normaliseImageDestination(element.getAttribute("src") ?? "");
            return src ? { src } : false;
          },
        },
      ];
    },
    addNodeView() {
      return ({ node }) => {
        const dom = document.createElement("img");
        // Keep a stable node-view root while link wrappers and presentation
        // attributes change; the loaded image belongs to this source URL.
        const wrapper = document.createElement("span");
        wrapper.append(dom);
        let anchor: HTMLAnchorElement | undefined;
        let current = node;
        const present = () => {
          const alt = String(current.attrs.alt ?? "");
          dom.alt =
            dom.dataset.docsImageState === "error"
              ? alt
                ? `Image unavailable: ${alt}`
                : "Image unavailable"
              : alt;
          dom.style.width = current.attrs.width ? `${current.attrs.width}px` : "100%";
          for (const key of ["title", "height"]) {
            const value: unknown = current.attrs[key];
            if (value == null) dom.removeAttribute(key);
            else dom.setAttribute(key, String(value));
          }
          const link = normaliseImageLink(current.attrs.link);
          if (link) {
            if (!anchor) {
              anchor = document.createElement("a");
              // Match text links: clicks select; the link popover opens.
              anchor.addEventListener("click", (event) => event.preventDefault());
              wrapper.replaceChildren(anchor);
              anchor.append(dom);
            }
            for (const key of ["href", "title", "target", "rel", "class"]) {
              const value = link[key];
              if (value == null) anchor.removeAttribute(key);
              else anchor.setAttribute(key, value);
            }
          } else if (anchor) {
            wrapper.replaceChildren(dom);
            anchor = undefined;
          }
        };
        let objectUrl: string | undefined;
        let alive = true;
        const abort = new AbortController();
        dom.dataset.docsImageState = "loading";
        dom.className = "docs-private-image";
        present();
        const src = normaliseImageDestination(String(node.attrs.src));
        const load = () => {
          if (!alive || !src) return;
          dom.dataset.docsImageState = "loading";
          present();
          void fetchImpl(src, { signal: abort.signal, redirect: "error" })
            .then(async (response) => {
              if (!response.ok) throw new Error("Image unavailable");
              const blob = await displayImageBlob(await response.blob());
              if (alive) {
                objectUrl = URL.createObjectURL(blob);
                dom.src = objectUrl;
                dom.dataset.docsImageState = "loaded";
                present();
              }
            })
            .catch(() => {
              if (!alive) return;
              dom.dataset.docsImageState = "error";
              present();
            });
        };
        // Every failed request shares this recovery path. Pending and loaded
        // views retain their bytes/request; destroyed views cannot retry.
        const reconnect = () => {
          if (dom.dataset.docsImageState === "error") load();
        };
        window.addEventListener("online", reconnect);
        if (src) load();
        else {
          dom.dataset.docsImageState = "error";
          present();
        }
        return {
          dom: wrapper,
          update(next) {
            if (next.type !== current.type || next.attrs.src !== current.attrs.src) return false;
            current = next;
            present();
            return true;
          },
          destroy() {
            alive = false;
            window.removeEventListener("online", reconnect);
            abort.abort();
            if (objectUrl) URL.revokeObjectURL(objectUrl);
          },
        };
      };
    },
  });
}
