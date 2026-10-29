// AUTHORED-BY Codex
import type { ResourceIdentity } from "./commit";

/** Only a mutation response can advance an approved parent validator. Standard
 * LDP supplies no atomic parent receipt: keep the approved tag in that case and
 * let the next conditional check refuse, retaining recovery for a new decision.
 */
export function containerVersions(http: typeof fetch) {
  const transitions = new Map<string, Map<string, string>>();
  const track = (url: string) => {
    if (!url.endsWith("/")) return;
    if (!transitions.has(url)) transitions.set(url, new Map());
  };
  const current = (url: string, etag: string | undefined): string | undefined =>
    etag ? (transitions.get(url)?.get(etag) ?? etag) : undefined;
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
  const committed = (parents: readonly ResourceIdentity[], response: Response): void => {
    // An optional server extension: receipts must be captured atomically by
    // the mutating request. A HEAD/GET is never substituted for this evidence.
    let receipts: unknown;
    try {
      receipts = JSON.parse(response.headers.get("x-solid-drive-parent-validators") ?? "null");
    } catch {
      return;
    }
    if (!receipts || typeof receipts !== "object") return;
    for (const parent of parents) {
      const etag: unknown = Object.hasOwn(receipts, parent.url)
        ? Reflect.get(receipts, parent.url)
        : undefined;
      if (typeof etag !== "string" || !/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag)) continue;
      const versions = transitions.get(parent.url) as Map<string, string>;
      for (const [original, latest] of versions)
        if (latest === parent.etag) versions.set(original, etag);
      versions.set(parent.etag, etag);
    }
  };
  return { track, current, identity, prepare, committed };
}
