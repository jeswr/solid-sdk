// AUTHORED-BY Codex GPT-6.1-Sol
import type { ImageResolver } from "@jeswr/suite-ui";

/** TypedView aborts on replacement/unmount, releasing the URL owned by that read. */
export function createPreviewImageResolver(fetch: typeof globalThis.fetch): ImageResolver {
  return async (url, signal) => {
    if (signal.aborted) return undefined;
    const response = await fetch(url, { signal });
    if (!response.ok || signal.aborted) return undefined;
    const blob = await response.blob();
    // An injected transport may finish even after cancellation.
    if (signal.aborted) return undefined;
    const objectUrl = URL.createObjectURL(blob);
    signal.addEventListener("abort", () => URL.revokeObjectURL(objectUrl), { once: true });
    return objectUrl;
  };
}
