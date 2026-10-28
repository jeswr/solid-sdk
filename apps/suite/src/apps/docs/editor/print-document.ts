// AUTHORED-BY Codex
const IMAGE_TIMEOUT = 10_000;

/** Include authenticated fetch time (when the node view has no src yet) and decoding. */
function imageReady(image: HTMLImageElement, signal: AbortSignal | undefined, timeout: number) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    let decoding: string | undefined;
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      observer.disconnect();
      image.removeEventListener("load", loaded);
      image.removeEventListener("error", failed);
      signal?.removeEventListener("abort", failed);
      resolve(ready);
    };
    const loaded = () => finish(true);
    const failed = () => finish(false);
    const check = () => {
      if (image.dataset.docsImageState === "error") return failed();
      const src = image.getAttribute("src");
      if (!src) return;
      if (typeof image.decode === "function") {
        if (decoding === src) return;
        decoding = src;
        void image.decode().then(loaded, failed);
      } else if (image.complete) finish(image.naturalWidth > 0);
    };
    const observer = new MutationObserver(check);
    const timer = setTimeout(failed, timeout);
    observer.observe(image, {
      attributes: true,
      attributeFilter: ["src", "data-docs-image-state"],
    });
    image.addEventListener("load", loaded);
    image.addEventListener("error", failed);
    signal?.addEventListener("abort", failed, { once: true });
    if (signal?.aborted) failed();
    else check();
  });
}

/** Both print entry points share the same bounded image readiness barrier. */
export async function printDocument(
  root: HTMLElement,
  signal?: AbortSignal,
  timeout = IMAGE_TIMEOUT,
) {
  const images = [...root.querySelectorAll("img")];
  const ready = await Promise.all(images.map((image) => imageReady(image, signal, timeout)));
  if (signal?.aborted) return;
  const restore: (() => void)[] = [];
  images.forEach((image, index) => {
    if (ready[index]) return;
    // Use real text: browsers do not consistently print broken images' alt attributes.
    const placeholder = document.createElement("span");
    placeholder.textContent = image.alt || "Image unavailable";
    const hidden = image.hidden;
    image.hidden = true;
    image.after(placeholder);
    restore.push(() => {
      image.hidden = hidden;
      placeholder.remove();
    });
  });
  try {
    window.print();
  } finally {
    for (const undo of restore) undo();
  }
}
