// AUTHORED-BY Codex GPT-6.1-Sol
import { assertWithinPodScope, normalizePodBase, refuseRedirects } from "@jeswr/guarded-fetch";
import { parseLinkHeaders } from "@jeswr/storage-capabilities";
import type { ExportError, ExportKind, ExportOptions } from "./types.js";

export function cancel(response: Response): void {
  void response.body?.cancel().catch(() => {});
}

/** Also races injected transports/readers that do not implement cancellation themselves. */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener("abort", aborted, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", aborted));
    if (signal.aborted) aborted();
  });
}

export class HttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`);
  }
}
export function exportError(error: unknown): ExportError {
  // Do not echo transport errors, which can contain credentials or untrusted response data.
  return error instanceof HttpError
    ? { message: error.message, status: error.status }
    : { message: "Resource could not be read" };
}

export function context(options: ExportOptions) {
  const root = normalizePodBase(options.root);
  const maxDepth = options.maxDepth ?? 32;
  const maxEntries = options.maxEntries ?? 10_000;
  if (!Number.isSafeInteger(maxDepth) || maxDepth < 0) throw new RangeError("Invalid maxDepth");
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1)
    throw new RangeError("Invalid maxEntries");
  const canonical = (value: string) => {
    const url = new URL(assertWithinPodScope(root, value));
    // One resource has one identity, independent of query/fragment listing aliases.
    if (url.search) throw new TypeError("Export URLs cannot have queries");
    url.hash = "";
    if (url.href === root.slice(0, -1)) return root;
    return url.href;
  };
  const include = options.include?.map(canonical);
  const exclude = options.exclude?.map(canonical) ?? [];
  const under = (url: string, prefix: string) =>
    url === prefix || (prefix.endsWith("/") && url.startsWith(prefix));
  const selected = (url: string, auxiliary = false) =>
    !exclude.some((prefix) => under(url, prefix)) &&
    (auxiliary || include === undefined || include.some((prefix) => under(url, prefix)));
  const visit = (url: string) =>
    selected(url) ||
    (!exclude.some((prefix) => under(url, prefix)) &&
      url.endsWith("/") &&
      include?.some((prefix) => under(prefix, url)));
  const checkDepth = (url: string) => {
    const relative = new URL(url).pathname.slice(new URL(root).pathname.length);
    if (relative.split("/").filter(Boolean).length > maxDepth)
      throw new RangeError("Export exceeds maxDepth");
  };
  const transport = refuseRedirects(options.fetch);
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = canonical(String(input));
    options.signal?.throwIfAborted();
    const pending = transport(url, { ...init, signal: options.signal }).then((response) => {
      if (options.signal?.aborted) {
        cancel(response);
        options.signal.throwIfAborted();
      }
      try {
        if (response.redirected || (response.url && canonical(response.url) !== url))
          throw new TypeError("Unexpected response URL");
      } catch (error) {
        cancel(response);
        throw error;
      }
      return response;
    });
    return abortable(pending, options.signal);
  };
  return { root, canonical, selected, visit, checkDepth, maxEntries, fetch };
}

export function auxiliaries(response: Response, url: string) {
  return parseLinkHeaders(response.headers.get("link"), url, {
    maxBytes: 65_536,
    maxMembers: 1024,
    maxResolvedBytes: 1_048_576,
    onOverflow: "throw",
  }).flatMap((link): { url: string; kind: "acl" | "meta" }[] => {
    if (link.context !== url) return [];
    if (link.rel.includes("acl")) return [{ url: link.target, kind: "acl" }];
    if (link.rel.includes("describedby")) return [{ url: link.target, kind: "meta" }];
    return [];
  });
}
export function rdf(contentType: string): boolean {
  return /^(?:text\/(?:turtle|n3)|application\/(?:ld\+json|n-triples|n-quads|trig|rdf\+xml))(?:;|$)/i.test(
    contentType,
  );
}
export function kindFor(url: string, contentType: string, hint?: ExportKind): ExportKind {
  if (hint === "acl" || hint === "meta") return hint;
  return url.endsWith("/") ? "container" : rdf(contentType) ? "rdf" : "binary";
}
export function sizeOf(response: Response): number | undefined {
  const value = response.headers.get("content-length");
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const size = Number(value);
  return Number.isSafeInteger(size) ? size : undefined;
}

/** fflate emits classic ZIP offsets; refuse overflow before delivering corrupt output. */
export function addZipBytes(current: number, next: number): number {
  const total = current + next;
  if (total >= 0xffffffff) throw new RangeError("Export exceeds the ZIP 4 GiB limit");
  return total;
}
