// AUTHORED-BY Claude Opus 5.5
import { createPodScopedFetch } from "@jeswr/guarded-fetch";
import type { Photo } from "../model";

/** One photo's footprint in the pod: its original plus its stored thumbnail. */
export interface PhotoUsage {
  /** Key the UI uses to find the photo again (the photo ref or the trash record URL). */
  key: string;
  name: string;
  originalBytes?: number;
  thumbnailBytes?: number;
  /** Sum of the measured binaries; 0 when nothing could be measured. */
  bytes: number;
  /** "stored" binaries live in this pod; "external" ones (imports) are never fetched. */
  location: "stored" | "external";
  /** True when at least one stored binary could not be measured. */
  incomplete: boolean;
}
export interface UsageReport {
  /** Largest first; external photos last. */
  items: PhotoUsage[];
  totalBytes: number;
  storedCount: number;
  externalCount: number;
  incompleteCount: number;
}
export interface UsageSource {
  key: string;
  photo: Pick<Photo, "name" | "contentUrl" | "thumbnailUrl">;
  /** Imported photos whose binaries live with another service. */
  external?: boolean;
}

/** Parse `Content-Range: bytes 0-0/12345` (the total after the slash). */
export function totalFromContentRange(value: string | null): number | undefined {
  const match = value?.match(/^bytes\s+(?:\d+-\d+|\*)\/(\d+)$/i);
  return match ? safeSize(match[1]) : undefined;
}
function safeSize(value: string | null | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value.trim())) return undefined;
  const size = Number(value);
  return Number.isSafeInteger(size) ? size : undefined;
}

/**
 * Measures binaries by HEAD (Content-Length), falling back to a one-byte range
 * GET (Content-Range total) for servers that omit lengths on HEAD. Requests go
 * through a pod-scoped fetch, so a contentUrl outside `root` is never sent the
 * session's credentials; such photos are reported as external.
 */
export function createBinarySizer(fetch: typeof globalThis.fetch, root: string) {
  const scoped = createPodScopedFetch(root, { fetch });
  const scope = new URL(root);
  const inScope = (value: string) => {
    try {
      const url = new URL(value);
      return (
        url.origin === scope.origin &&
        !url.username &&
        !url.password &&
        url.pathname.startsWith(scope.pathname)
      );
    } catch {
      return false;
    }
  };
  async function size(url: string, signal?: AbortSignal): Promise<number | undefined> {
    const init = { ...(signal ? { signal } : {}), headers: { "cache-control": "no-cache" } };
    const head = await scoped(url, { ...init, method: "HEAD" });
    if (!head.ok) return undefined;
    const length = safeSize(head.headers.get("content-length"));
    if (length !== undefined) return length;
    const ranged = await scoped(url, { ...init, headers: { ...init.headers, range: "bytes=0-0" } });
    const total =
      ranged.status === 206
        ? totalFromContentRange(ranged.headers.get("content-range"))
        : ranged.ok
          ? safeSize(ranged.headers.get("content-length"))
          : undefined;
    // A server that ignores Range sends the whole binary; stop reading it.
    try {
      await ranged.body?.cancel();
    } catch {
      /* Already consumed or errored; the size is known either way. */
    }
    return total;
  }
  return {
    inScope,
    async measure(url: string, signal?: AbortSignal): Promise<number | undefined> {
      if (!inScope(url)) return undefined;
      try {
        return await size(url, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        return undefined;
      }
    },
  };
}

/** Measures each source with bounded concurrency and returns them largest first. */
export async function measureUsage(
  sizer: ReturnType<typeof createBinarySizer>,
  sources: readonly UsageSource[],
  options: { concurrency?: number; signal?: AbortSignal } = {},
): Promise<UsageReport> {
  const items: PhotoUsage[] = new Array(sources.length);
  let next = 0;
  const worker = async () => {
    while (next < sources.length) {
      const index = next++;
      const { key, photo, external } = sources[index] as UsageSource;
      if (external || !sizer.inScope(photo.contentUrl)) {
        items[index] = {
          key,
          name: photo.name,
          bytes: 0,
          location: "external",
          incomplete: false,
        };
        continue;
      }
      const originalBytes = await sizer.measure(photo.contentUrl, options.signal);
      const thumbnailBytes =
        photo.thumbnailUrl && sizer.inScope(photo.thumbnailUrl)
          ? await sizer.measure(photo.thumbnailUrl, options.signal)
          : undefined;
      items[index] = {
        key,
        name: photo.name,
        ...(originalBytes !== undefined ? { originalBytes } : {}),
        ...(thumbnailBytes !== undefined ? { thumbnailBytes } : {}),
        bytes: (originalBytes ?? 0) + (thumbnailBytes ?? 0),
        location: "stored",
        incomplete:
          originalBytes === undefined ||
          (photo.thumbnailUrl !== undefined &&
            sizer.inScope(photo.thumbnailUrl) &&
            thumbnailBytes === undefined),
      };
    }
  };
  const lanes = Math.max(1, Math.min(options.concurrency ?? 4, sources.length));
  await Promise.all(Array.from({ length: lanes }, worker));
  items.sort(
    (a, b) =>
      Number(a.location === "external") - Number(b.location === "external") ||
      b.bytes - a.bytes ||
      a.name.localeCompare(b.name),
  );
  return {
    items,
    totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
    storedCount: items.filter((item) => item.location === "stored").length,
    externalCount: items.filter((item) => item.location === "external").length,
    incompleteCount: items.filter((item) => item.incomplete).length,
  };
}
