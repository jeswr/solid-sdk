// AUTHORED-BY Codex GPT-6.1-Sol
import { fetchRdf } from "@jeswr/fetch-rdf";
import { createRdfEngine, type LocalIndex } from "@jeswr/rdf-engine";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import {
  createPodClient,
  type Entry,
  type PageCursor,
  type StorageClient,
} from "@jeswr/storage-client";
import { createLocalSearch, createSearch, createSearchFeeder } from "@jeswr/suite-sdk/search";
import { NS } from "@jeswr/suite-vocab";
import type { SearchSource } from "../lib/search-results";
import { podSearchResponse } from "./pod-results";

const MAX_REQUESTS = 200;
const MAX_DEPTH = 4;
const MAX_ENTRIES = 1000;
// Together with the request cap this bounds parsed response bodies to 50 MiB.
const MAX_BYTES = 256 * 1024;
const rdfType =
  /^(?:text\/turtle|application\/(?:ld\+json|n-triples|n-quads|trig|rdf\+xml))(?:;|$)/iu;

/** Yield before background reads, including between resources, without delaying foreground search. */
function idle(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const cancel =
      typeof requestIdleCallback === "function"
        ? (() => {
            const id = requestIdleCallback(finish, { timeout: 1000 });
            return () => cancelIdleCallback(id);
          })()
        : (() => {
            const id = setTimeout(finish, 0);
            return () => clearTimeout(id);
          })();
    function abort() {
      cancel();
      reject(signal.reason);
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** Complete listings supply binary names; only small RDF bodies are read. No guessed backend. */
export async function warmSearchIndex(
  storage: StorageClient,
  index: LocalIndex,
  fetch: typeof globalThis.fetch,
  signal: AbortSignal,
): Promise<void> {
  const feeder = createSearchFeeder(index);
  const queue = [
    { url: storage.root, kind: "container", depth: 0, contentType: null as string | null },
  ];
  const seen = new Set([storage.root]);
  let requests = 0;
  for (let position = 0; position < queue.length && requests < MAX_REQUESTS; position++) {
    await idle(signal);
    const item = queue[position];
    if (!item) break;
    try {
      if (item.kind !== "container") {
        if (!item.contentType) {
          requests++;
          const metadata = await storage.head(item.url, { signal });
          signal.throwIfAborted();
          if (!rdfType.test(metadata.contentType ?? "") || requests >= MAX_REQUESTS) continue;
        }
        requests++;
        const { dataset } = await fetchRdf(item.url, { fetch, signal, maxBytes: MAX_BYTES });
        signal.throwIfAborted();
        await feeder.resource(item.url, dataset);
        continue;
      }
      const entries: Entry[] = [];
      let cursor: PageCursor | undefined;
      const cursors = new Set<string>();
      do {
        if (requests >= MAX_REQUESTS) throw new Error("Search warm request budget reached");
        requests++;
        const page = await storage.list(item.url, {
          signal,
          maxBytes: MAX_BYTES,
          ...(cursor ? { cursor } : {}),
        });
        signal.throwIfAborted();
        entries.push(...page.items);
        if (entries.length > MAX_ENTRIES) throw new Error("Search warm listing budget reached");
        cursor = page.next ?? undefined;
        if (cursor && cursors.has(cursor.url)) throw new Error("Repeated search warm cursor");
        if (cursor) cursors.add(cursor.url);
      } while (cursor);
      // A failed or budget-truncated listing never replaces a complete graph.
      const scoped = entries.filter((entry) => storage.isWithinStorage(entry.url));
      await feeder.container(
        item.url,
        scoped.map((entry) =>
          entry.kind === "container"
            ? { ...entry, types: [...entry.types, `${NS.LDP}Container`] }
            : entry,
        ),
      );
      if (item.depth >= MAX_DEPTH) continue;
      for (const entry of scoped) {
        if (queue.length >= MAX_REQUESTS) break;
        if (seen.has(entry.url)) continue;
        if (
          entry.kind !== "container" &&
          ((entry.contentType !== null && !rdfType.test(entry.contentType)) ||
            (entry.size ?? 0) > MAX_BYTES)
        )
          continue;
        seen.add(entry.url);
        queue.push({
          url: entry.url,
          kind: entry.kind,
          depth: item.depth + 1,
          contentType: entry.contentType,
        });
      }
    } catch {
      signal.throwIfAborted();
      // An unreadable/oversized subtree does not hide other saved copies.
    }
  }
}

/** One ephemeral index and discovery cache per account. Dispose also fences late deliveries. */
export function createPodSearchSource(
  storageUrl: string,
  authenticatedFetch: typeof globalThis.fetch,
): SearchSource & { warmed: Promise<void>; dispose(): void } {
  const controller = new AbortController();
  const { signal } = controller;
  const cache = createMemoryCache();
  const fetch: typeof globalThis.fetch = async (input, init) => {
    signal.throwIfAborted();
    const response = await authenticatedFetch(input, {
      ...init,
      signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
    });
    signal.throwIfAborted();
    return response;
  };
  const discovered = createPodClient({
    storage: storageUrl,
    fetch,
    capabilities: cache,
    signal,
  }).catch(() => undefined);
  const engine = createRdfEngine();
  let index: Promise<LocalIndex> | undefined;
  const localIndex = () => {
    signal.throwIfAborted();
    index ??= engine.createIndex({ maxQuads: 200_000 }).then((value) => {
      if (signal.aborted) value.dispose();
      signal.throwIfAborted();
      return value;
    });
    return index;
  };
  const client = discovered.then((pod) =>
    createSearch({
      capabilities: pod?.storage ?? {
        root: storageUrl,
        features: { serverSearch: { state: "unknown", detail: {}, evidence: "none" } },
      },
      fetch,
      local: {
        search: async (query, options) =>
          createLocalSearch(await localIndex()).search(query, options),
      },
    }),
  );
  const warmed = idle(signal)
    .then(async () => {
      const pod = await discovered;
      if (pod) await warmSearchIndex(pod.storage, await localIndex(), fetch, signal);
    })
    .catch(() => {
      /* Background warming is best effort; foreground failures remain visible. */
    });
  return {
    warmed,
    async search(query, { scope, signal: requestSignal }) {
      const combined = AbortSignal.any([signal, requestSignal]);
      combined.throwIfAborted();
      const search = await client;
      combined.throwIfAborted();
      const page = await search.search(
        { text: query, within: [storageUrl], limit: 1000 },
        { signal: combined },
      );
      combined.throwIfAborted();
      return podSearchResponse(page, scope);
    },
    dispose() {
      controller.abort();
      // The root engine has no persistence: disposal purges all account data.
      engine.dispose();
    },
  };
}
