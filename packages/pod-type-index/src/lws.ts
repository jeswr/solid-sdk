// AUTHORED-BY Codex GPT-6.1-Sol
import { parseLinkHeaders } from "@jeswr/storage-capabilities";
import { StorageError, toStorageError } from "@jeswr/storage-client";
import { canonicalize } from "@jeswr/suite-vocab";
import { aliases, error, requireScoped, scoped } from "./common.js";
import type { TypeIndexOptions } from "./types.js";

const MEDIA = "application/lws+json";
const LWS = "https://www.w3.org/ns/lws#";
const MAX_BYTES = 1_048_576;
const MAX_ITEMS = 10_000;
const MAX_PAGES = 64;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  return typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
}

async function json(
  body: ReadableStream<Uint8Array> | null,
  url: string,
): Promise<Record<string, unknown>> {
  if (!body) throw error("invalid-response", url);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw error("invalid-response", url);
      chunks.push(value);
    }
  } catch (cause) {
    void reader.cancel().catch(() => undefined);
    if (cause instanceof StorageError) throw cause;
    throw error("network", url);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw error("invalid-response", url);
  }
  if (!object(data)) throw error("invalid-response", url);
  return data;
}

export function lwsIndex({ storage, features, fetch: transport }: TypeIndexOptions) {
  function endpoint(kind: "indexEndpoint" | "searchEndpoint") {
    const url = features.typeIndex.detail[kind];
    if (
      features.typeIndex.state !== "available" ||
      features.typeIndex.detail.mode !== "server" ||
      !url
    ) {
      throw error("unsupported", storage.root);
    }
    return requireScoped(storage, url);
  }

  async function* pages(start: string, query?: string) {
    const signal = AbortSignal.timeout(30_000);
    const seen = new Set<string>();
    let url: string | undefined = start;
    let totalItems = 0;
    while (url) {
      if (url.length > 8192 || seen.has(url) || seen.size >= MAX_PAGES)
        throw error("invalid-response", start);
      seen.add(url);
      let body: ReadableStream<Uint8Array> | null;
      let media: string | null;
      let next: string | undefined;
      if (query !== undefined && seen.size === 1) {
        if (!transport) throw error("unsupported", storage.root, "QUERY");
        let response: Response;
        try {
          response = await transport(url, {
            method: "QUERY",
            redirect: "manual",
            signal,
            headers: { Accept: MEDIA, "Content-Type": "application/lws-query+json" },
            body: query,
          });
        } catch {
          throw error("network", url, "QUERY");
        }
        if (
          response.status !== 200 ||
          response.redirected ||
          (response.url && response.url !== url)
        ) {
          void response.body?.cancel().catch(() => undefined);
          throw toStorageError("QUERY", url, response);
        }
        body = response.body;
        media = response.headers.get("content-type");
        try {
          const links = parseLinkHeaders([response.headers.get("link") ?? ""], url, {
            maxBytes: 65_536,
            maxMembers: 1024,
            maxResolvedBytes: MAX_BYTES,
            onOverflow: "throw",
          });
          next = links.find((link) => link.context === url && link.rel.includes("next"))?.target;
        } catch {
          void body?.cancel().catch(() => undefined);
          throw error("invalid-response", url);
        }
      } else {
        const response = await storage.read(url, { accept: MEDIA, signal });
        body = response.body;
        media = response.contentType;
        next = response.links.get("next")?.[0]?.target;
      }
      if (media?.split(";")[0]?.trim().toLowerCase() !== MEDIA) {
        void body?.cancel().catch(() => undefined);
        throw error("invalid-response", url);
      }
      const data = await json(body, url);
      const expected = query === undefined ? "TypeIndex" : "ContainerPage";
      if (
        !strings(data.type).some((type) => type === expected || type === LWS + expected) ||
        !Array.isArray(data.items)
      ) {
        throw error("invalid-response", url);
      }
      totalItems += data.items.length;
      if (totalItems > MAX_ITEMS) throw error("invalid-response", url);
      for (const item of data.items) {
        if (!object(item) || typeof item.id !== "string") throw error("invalid-response", url);
        yield { item, url };
      }
      if (next !== undefined) {
        const safe = scoped(storage, next);
        if (!safe) throw error("scope", storage.root);
        url = safe;
      } else url = undefined;
    }
  }

  async function findAll(classes: string[]): Promise<Map<string, string[]>> {
    const output = new Map(classes.map((iri) => [iri, [] as string[]]));
    if (output.size === 0) return output;
    const wanted = new Map([...output.keys()].map((iri) => [canonicalize(iri), new Set<string>()]));
    const types = [...new Set(classes.flatMap(aliases))];
    for await (const { item, url } of pages(
      endpoint("searchEndpoint"),
      JSON.stringify({ type: [types] }),
    )) {
      let target: string | undefined;
      try {
        target = scoped(storage, new URL(item.id as string, url).href);
      } catch {
        continue;
      }
      if (!target) continue;
      const itemTypes = strings(item.type);
      if (itemTypes.length === 0) throw error("invalid-response", url);
      for (const type of itemTypes) {
        const iri =
          type === "Container" || type === "DataResource" ? LWS + type : canonicalize(type);
        wanted.get(iri)?.add(target);
      }
    }
    for (const iri of output.keys())
      output.set(iri, [...(wanted.get(canonicalize(iri)) as Set<string>)]);
    return output;
  }

  async function listClasses(): Promise<string[]> {
    const result = new Set<string>();
    for await (const { item } of pages(endpoint("indexEndpoint"))) {
      // Type identifiers are vocabulary IRIs, not resource URLs to fetch.
      if (/^[a-z][a-z0-9+.-]*:[^\s\p{Cc}<>"{}|^`\\]+$/iu.test(item.id as string))
        result.add(canonicalize(item.id as string));
    }
    return [...result];
  }

  return { findAll, listClasses };
}
