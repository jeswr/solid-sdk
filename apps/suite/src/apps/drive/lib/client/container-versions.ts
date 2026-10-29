// AUTHORED-BY Codex
import type { ResourceIdentity } from "./commit";

/** Only a confirmed local membership mutation can advance a captured container tag.
 * Capture its parents before the commit and their receipts immediately afterwards;
 * a later listing or a refused identity check can never supply an advancement.
 */
export function containerVersions(http: typeof fetch) {
  const transitions = new Map<string, Map<string, string>>();
  const track = (url: string) => {
    if (!url.endsWith("/")) return;
    if (!transitions.has(url)) transitions.set(url, new Map());
  };
  const current = (url: string, etag: string | undefined): string | undefined => {
    return etag ? (transitions.get(url)?.get(etag) ?? etag) : undefined;
  };
  const identity = (original: ResourceIdentity): ResourceIdentity => ({
    url: original.url,
    get etag() {
      return current(original.url, original.etag) as string;
    },
  });
  const prepare = async (target: string): Promise<ResourceIdentity[]> => {
    const parents: ResourceIdentity[] = [];
    for (const url of transitions.keys()) {
      if (url === target || !target.startsWith(url)) continue;
      const response = await http(url, { method: "HEAD", cache: "no-store" });
      const etag = response.headers.get("etag");
      if (response.ok && etag && !etag.startsWith("W/")) parents.push({ url, etag });
    }
    return parents;
  };
  const committed = async (parents: readonly ResourceIdentity[]): Promise<void> => {
    for (const parent of parents) {
      try {
        const response = await http(parent.url, { method: "HEAD", cache: "no-store" });
        const etag = response.headers.get("etag");
        if (response.ok && etag && !etag.startsWith("W/")) {
          const versions = transitions.get(parent.url) as Map<string, string>;
          for (const [original, latest] of versions)
            if (latest === parent.etag) versions.set(original, etag);
          versions.set(parent.etag, etag);
        }
      } catch {
        // No receipt means no advancement. Later validation retains the old tag.
      }
    }
  };
  return { track, current, identity, prepare, committed };
}
