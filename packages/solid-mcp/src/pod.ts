// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-5
/**
 * Pod operations over the caller's PodPort and shared output projection.
 *
 * RDF discipline (house rule): we NEVER hand-build or hand-parse RDF. Container
 * listings are parsed via `@jeswr/fetch-rdf` (`fetchRdf`) + `@solid/object`
 * (`ContainerDataset`), and any RDF representation we hand back to a client is
 * re-serialised with `@jeswr/rdf-serialize` over the parsed quads.
 */
import { parseRdf } from "@jeswr/fetch-rdf";
import { isContainerUrl } from "@jeswr/guarded-fetch";
import { serialize } from "@jeswr/rdf-serialize";
import { DataFactory } from "n3";
import {
  podScopedUrlOrUndefined,
  requirePodScopedUrl,
  requirePodScopedWriteUrl,
  type SolidMcpConfig,
} from "./auth.js";
import { parseBoundedRdf, RdfLimitError } from "./bounded-rdf.js";
import { MAX_CONTENT_BYTES, mediaType, RDF_MEDIA_TYPES, resourceTitle } from "./content.js";
import { PodOutput } from "./output.js";
import { withPodFetchLimits, withPodReadLimits } from "./pod-operation.js";
import { asPodPort, type PodReadResult, type PodSource, podSearchLimits } from "./pod-port.js";

import { SearchBudget, searchLimit } from "./search-budget.js";

const RDF_ACCEPT = "text/turtle, application/ld+json;q=0.9";

/** A typed child of an LDP container, mapped to absolute URLs. */
export interface PodChild {
  /** Absolute URL of the child resource. */
  url: string;
  /** Human-friendly name (the last path segment, per @solid/object). */
  name: string;
  /** Whether the child is itself a container. */
  isContainer: boolean;
  /** The child's RDF types (rdf:type IRIs), if any. */
  type: string[];
  /** The child's MIME type, if advertised. */
  mimeType?: string;
  /** The child's byte size, if advertised. */
  size?: number;
  /** The child's last-modified time (ISO 8601), if advertised. */
  modified?: string;
}

/** The result of reading a (possibly binary) resource's bytes. */
export interface ReadResult {
  /** The response Content-Type (lowercased media type, no params), if any. */
  contentType?: string;
  /** UTF-8 text body — present iff the content-type is textual. */
  text?: string;
  /** Base64-encoded body — present iff the content-type is treated as binary. */
  base64?: string;
  /** The resource ETag, if the server returned one. */
  etag?: string;
}

/** The result of reading an RDF resource as Turtle. */
export interface ReadRdfResult {
  /** A canonical Turtle serialisation of the resource graph. */
  turtle: string;
  /** The parsed dataset, for callers that want to query it (e.g. search). */
  dataset: import("n3").Store;
}

/** A single search hit. */
export interface SearchMatch {
  /** Absolute URL of the matching resource. */
  url: string;
  /** Human-friendly name. */
  name: string;
  /** A short snippet explaining why it matched (url/name/literal), if relevant. */
  snippet?: string;
}

/** Options controlling {@link search}. */
export interface SearchOptions {
  /** Restrict the crawl to this sub-container (must be within the pod). */
  scope?: string;
  /** Max recursion depth for the container scan (default 4). */
  maxDepth?: number;
  /** Max distinct resources across discovery and scanning (default 500). */
  maxResources?: number;
  /** Wall-clock budget including discovery and stalled reads (default 5000 ms). */
  maxTimeMs?: number;
}

/**
 * Content-types we treat as textual (everything else is returned base64). Covers
 * the RDF serialisations plus the common text / json / xml families.
 */
function isTextualContentType(ct: string | undefined): boolean {
  if (!ct) {
    // No content-type advertised: default to text (the common case for pods).
    return true;
  }
  const m = ct.toLowerCase();
  if (m.startsWith("text/")) return true;
  if (m === "application/json" || m.endsWith("+json")) return true;
  if (m === "application/xml" || m.endsWith("+xml")) return true;
  const textApps = [
    "application/ld+json",
    "application/json",
    "application/x-turtle",
    "text/turtle",
    "application/trig",
    "application/n-triples",
    "application/n-quads",
    "application/sparql-query",
    "application/sparql-update",
    "application/javascript",
    "application/yaml",
  ];
  return textApps.includes(m);
}

/**
 * List the children of an LDP container at `url` (pod-scoped). Parses the
 * container listing via fetch-rdf + @solid/object's ContainerDataset; maps each
 * child's (possibly relative) id to an absolute URL.
 *
 * SECURITY: a container listing is UNTRUSTED data — a malicious or compromised
 * pod could put an `ldp:contains` entry pointing at an external origin. Every
 * resolved child URL is therefore re-validated against the pod scope, and any
 * child that resolves OUTSIDE the pod is DROPPED (fail-closed). This is what
 * stops a poisoned listing from making a downstream `solid_read` / `solid_search`
 * fetch an arbitrary URL (SSRF). Callers can rely on every returned `child.url`
 * being in-pod.
 */
export async function listContainer(source: PodSource, url: string): Promise<PodChild[]> {
  return new PodOutput(asPodPort(source)).children(url);
}

/** Scope-filtered discovery candidates; callers must authorize before reporting them. */
export async function containerCandidates(source: PodSource, url: string): Promise<PodChild[]> {
  const pod = asPodPort(source);
  const config = { podRoot: pod.root };
  const target = requirePodScopedUrl(config, url);
  return (await pod.list(target)).flatMap((child) => {
    const scoped = podScopedUrlOrUndefined(config, child.url);
    if (scoped === undefined) return [];
    return [
      { ...child, url: scoped, name: child.name ?? resourceName(scoped), type: child.type ?? [] },
    ];
  });
}

/**
 * Read a resource's raw bytes (pod-scoped) via a plain GET on the injected fetch
 * (NOT fetchRdf — we want the bytes for ANY content type). Decides text vs binary
 * by content-type. Fails CLOSED on 401/403 with a clear "supply an authenticated
 * fetch" error, and on any other non-2xx with the status.
 */
export async function readResource(source: PodSource, url: string): Promise<ReadResult> {
  return withPodReadLimits(async () => {
    const pod = asPodPort(source);
    const target = requirePodScopedUrl({ podRoot: pod.root }, url);
    const output = new PodOutput(pod);
    const {
      body,
      contentType: rawContentType,
      etag,
    } = await output.representation(target, await output.read(target));
    const contentType = (rawContentType.split(";").shift() ?? "").trim().toLowerCase();
    const result: ReadResult = {
      ...(contentType ? { contentType } : {}),
      ...(etag ? { etag } : {}),
    };
    if (isTextualContentType(contentType)) {
      result.text = new TextDecoder().decode(body);
    } else {
      result.base64 = Buffer.from(body).toString("base64");
    }
    return result;
  });
}

/**
 * Fetch an RDF resource (pod-scoped) and return a canonical Turtle view (never
 * hand-concatenated) plus the parsed dataset.
 */
export async function readRdf(source: PodSource, url: string): Promise<ReadRdfResult> {
  return withPodReadLimits(async () => {
    const pod = asPodPort(source);
    const target = requirePodScopedUrl({ podRoot: pod.root }, url);
    const output = new PodOutput(pod);
    const read = await output.read(target, {
      accept: RDF_ACCEPT,
    });
    const dataset =
      (await output.containerRdf(target, read)) ??
      (await output.rdf(
        target,
        read,
        await parseRdf(new TextDecoder().decode(read.body), read.contentType || null, {
          baseIRI: read.url ?? target,
        }),
      ));
    const turtle = await serializeTurtle(dataset);
    return { turtle, dataset };
  });
}

/** Serialise an n3.Store to Turtle via the shared serializer (no hand-built triples). */
function serializeTurtle(dataset: import("n3").Store): Promise<string> {
  return serialize(dataset.getQuads(null, null, null, null), {
    format: "text/turtle",
    emptyAsEmptyString: false,
  });
}

/** Compatibility import location for the shared parsing/output media-type vocabulary. */
export { RDF_MEDIA_TYPES } from "./content.js";

/**
 * De-duplicated match accumulator keyed by URL, keeping the STRONGEST (lowest)
 * rank per URL. `ranked()` returns matches sorted strongest-first. Encapsulating
 * the byUrl+rank bookkeeping keeps `search` readable (it just calls `add`).
 */
class RankedMatches {
  private readonly byUrl = new Map<string, SearchMatch>();
  private readonly rankOf = new Map<string, number>();

  /** Record `m` at `rank`; a lower rank overrides a previously-stored weaker one. */
  add(m: SearchMatch, rank: number): void {
    if (rank < (this.rankOf.get(m.url) ?? Number.POSITIVE_INFINITY)) {
      this.byUrl.set(m.url, m);
      this.rankOf.set(m.url, rank);
    }
  }

  /** A later denied read must also discard an earlier discovery of this URL. */
  remove(url: string): void {
    this.byUrl.delete(url);
    this.rankOf.delete(url);
  }

  /** All matches, strongest (lowest rank) first. */
  ranked(): SearchMatch[] {
    return [...this.byUrl.values()].sort(
      (a, b) => (this.rankOf.get(a.url) ?? 9) - (this.rankOf.get(b.url) ?? 9),
    );
  }
}

/**
 * (1) Seed containers for the scan. Always seeds the `scope`; when a `webId` is
 * configured, adds best-effort Type-Index hints (a failure never aborts). Each
 * discovered hint is re-scope-checked (SSRF guard): in-pod containers become scan
 * seeds; a direct in-pod instance file is read before matching (rank 0). A hint
 * outside the pod is ignored.
 */
async function seedContainers(
  config: PodSource,
  q: string,
  scope: string,
  matches: RankedMatches,
  budget: SearchBudget,
): Promise<Set<string>> {
  const seeds = new Set<string>([scope]);
  if (!asPodPort(config).webId) return seeds;
  let hints: string[];
  try {
    hints = await typeIndexContainers(config);
  } catch {
    return seeds; // No type index / unreadable profile — plain scan from scope.
  }
  for (const hint of hints) {
    if (!budget.claim(hint)) continue;
    // Best-effort per hint: untrusted profile data never aborts the whole search.
    try {
      const scoped = requirePodScopedUrl({ podRoot: asPodPort(config).root }, hint); // only honour in-pod hints
      if (isContainerUrl(scoped)) {
        seeds.add(scoped);
      } else {
        const name = resourceTitle(scoped);
        await matchChild(
          config,
          { url: scoped, name, isContainer: false, type: [] },
          q,
          matches,
          budget,
          true,
        );
      }
    } catch {
      // Unreadable or out-of-pod hint — ignore (best-effort seeding).
    }
  }
  return seeds;
}

/** Authorize a candidate before recording any name, URL or literal match. */
async function matchChild(
  config: PodSource,
  child: PodChild,
  q: string,
  matches: RankedMatches,
  budget: SearchBudget,
  directInstance = false,
): Promise<void> {
  const nameHit = child.name.toLowerCase().includes(q) || child.url.toLowerCase().includes(q);
  // Type Index instances negotiate RDF even without a filename extension.
  const tryLiteral =
    !child.isContainer &&
    (directInstance || isRdfLike(child.mimeType) || hasRdfExtension(child.url));
  if (!nameHit && !tryLiteral) return;
  let read: PodReadResult;
  const output = new PodOutput(asPodPort(config));
  try {
    read = await output.read(child.url, tryLiteral ? { accept: RDF_ACCEPT } : undefined);
  } catch {
    matches.remove(child.url);
    return;
  }
  if (!budget.active) return;
  if (nameHit) {
    const match = await output.match({
      url: child.url,
      name: child.name,
      snippet: directInstance ? "type-index instance" : "name/url match",
    });
    if (budget.active) matches.add(match, directInstance ? 0 : 1);
  }
  if (!tryLiteral) return;
  const literalHit = await literalMatch(read, child.url, q, output);
  if (literalHit && budget.active) {
    const match = await output.match({
      url: child.url,
      name: child.name,
      snippet: `literal: ${literalHit}`,
    });
    if (budget.active) matches.add(match, 2);
  }
}

/**
 * (2) Bounded breadth-first container scan from `seeds`, capped by `maxDepth` and
 * `maxResources`. Each visited resource is matched against `q` by url/name
 * (rank 1); RDF resources additionally by literal value (rank 2); sub-containers
 * are enqueued until the depth cap. All matches are added to `matches`.
 */
async function scanContainers(
  config: PodSource,
  q: string,
  seeds: Set<string>,
  maxDepth: number,
  matches: RankedMatches,
  budget: SearchBudget,
): Promise<void> {
  const seen = new Set<string>();
  const queue: Array<{ url: string; depth: number }> = [...seeds].map((url) => ({ url, depth: 0 }));
  while (queue.length > 0 && budget.active) {
    const next = queue.shift();
    if (!next) break;
    const { url, depth } = next;
    if (seen.has(url) || !budget.claim(url)) continue;
    seen.add(url);

    let children: PodChild[];
    try {
      children = await containerCandidates(config, url);
    } catch {
      continue; // unreadable container — skip.
    }

    for (const child of children) {
      if (!budget.active) break;
      if (!budget.claim(child.url)) continue;
      await matchChild(config, child, q, matches, budget);
      if (child.isContainer) {
        if (depth + 1 <= maxDepth) queue.push({ url: child.url, depth: depth + 1 });
      }
    }
  }
}

/**
 * Client-side search across the pod (NO server FTS).
 *
 * Strategy:
 *  1. Best-effort Type-Index discovery: if `config.webId` is set, read the
 *     profile, follow `solid:publicTypeIndex` / `solid:privateTypeIndex`, and add
 *     each registration's `solid:instance` / `solid:instanceContainer` as a hint.
 *  2. Bounded recursive container scan from the scope (default: the pod root),
 *     capped by depth + total resources, matching `query` (case-insensitive)
 *     against each resource's url / name AND — for RDF resources — against literal
 *     object values.
 *
 * Returns de-duplicated, ranked matches (name/url hits first, then literal hits).
 */
export async function search(
  source: PodSource,
  query: string,
  options: SearchOptions = {},
): Promise<SearchMatch[]> {
  const pod = asPodPort(source);
  const config: Pick<SolidMcpConfig, "podRoot" | "searchLimits"> = {
    podRoot: pod.root,
    searchLimits: podSearchLimits(source),
  };
  const q = (query ?? "").trim().toLowerCase();
  if (q.length === 0) {
    return [];
  }
  const maxDepth = searchLimit(options.maxDepth ?? config.searchLimits?.maxDepth ?? 4, "maxDepth");
  const maxResources = searchLimit(
    options.maxResources ?? config.searchLimits?.maxResources ?? 500,
    "maxResources",
  );
  const maxTimeMs = searchLimit(
    options.maxTimeMs ?? config.searchLimits?.maxTimeMs ?? 5000,
    "maxTimeMs",
  );
  const scope = requirePodScopedUrl(config, options.scope ?? config.podRoot);

  const matches = new RankedMatches();
  if (maxResources === 0 || maxTimeMs === 0) return [];
  const budget = new SearchBudget(maxResources, maxTimeMs);
  const bounded: PodSource = {
    root: pod.root,
    webId: pod.webId,
    write: (...args) => pod.write(...args),
    delete: (...args) => pod.delete(...args),
    async read(url, options) {
      if (!budget.claim(url)) throw new Error("Search resource/time budget exhausted.");
      return pod.read(url, options);
    },
    async list(url) {
      if (!budget.claim(url)) throw new Error("Search resource/time budget exhausted.");
      return pod.list(url);
    },
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      budget.stop();
      resolve();
    }, maxTimeMs);
  });
  const crawl = () =>
    withPodFetchLimits(
      (fetcher) => budget.wrap(fetcher),
      async () => {
        const seeds = await seedContainers(bounded, q, scope, matches, budget);
        await scanContainers(bounded, q, seeds, maxDepth, matches, budget);
      },
    );
  try {
    await Promise.race([crawl(), deadline]);
    return matches.ranked();
  } finally {
    clearTimeout(timer);
    budget.stop();
  }
}

/** Is the MIME type one we will attempt to RDF-parse for literal search? */
function isRdfLike(mimeType: string | undefined): boolean {
  if (!mimeType) return false;
  return RDF_MEDIA_TYPES.has(mimeType.toLowerCase());
}

/** Known RDF file extensions (used when a listing omits the child mimeType). */
const RDF_EXTENSIONS = [".ttl", ".jsonld", ".nt", ".nq", ".trig", ".n3"];

/** Does the URL path carry a known RDF file extension? */
function hasRdfExtension(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }
  return RDF_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/**
 * Read an RDF resource and return the first literal object value containing `q`
 * (case-insensitive), truncated to a short snippet, or `undefined`. Only parsing
 * and literal nonmatches are handled here; the caller has already authorized the read.
 */
async function literalMatch(
  read: PodReadResult,
  url: string,
  q: string,
  output: PodOutput,
): Promise<string | undefined> {
  let dataset: import("n3").Store;
  try {
    dataset = await output.rdf(url, read, await parseSearchRead(read, url));
  } catch {
    return undefined;
  }
  for (const quad of dataset.getQuads(null, null, null, null)) {
    if (quad.object.termType === "Literal") {
      const v = quad.object.value;
      if (v.toLowerCase().includes(q)) {
        return v.length > 120 ? `${v.slice(0, 117)}...` : v;
      }
    }
  }
  return undefined;
}

/**
 * Best-effort: discover the type-index registration target containers / instances
 * from the owner's WebID profile. Reads the profile, follows
 * `solid:publicTypeIndex` / `solid:privateTypeIndex`, then each type index's
 * `solid:instance` / `solid:instanceContainer`. Returns absolute URL strings.
 * Throws only if the profile itself cannot be fetched — caller catches.
 *
 * SECURITY: the WebID profile is the one URL we fetch off-pod — it is the owner's
 * configured identity (`config.webId`), often on a different origin, so it is
 * trusted by configuration. But every URL DISCOVERED from that profile (the
 * type-index documents) and from the type-index documents (the instance targets)
 * is UNTRUSTED RDF: a malicious profile could point `solid:publicTypeIndex` at an
 * arbitrary origin. So we (a) only FETCH a discovered type-index document if it is
 * within the pod, and (b) only EMIT instance/instanceContainer URLs that are
 * within the pod. This prevents the profile from steering `search` into an SSRF.
 */
async function typeIndexContainers(config: PodSource): Promise<string[]> {
  const webId = asPodPort(config).webId;
  if (!webId) return [];
  const solidNs = "http://www.w3.org/ns/solid/terms#";
  const out = new Set<string>();
  const profile = await searchRdf(config, webId, true);
  const indexes = new Set<string>();
  for (const p of [`${solidNs}publicTypeIndex`, `${solidNs}privateTypeIndex`]) {
    for (const quad of profile.getQuads(null, DataFactory.namedNode(p), null, null)) {
      if (quad.object.termType === "NamedNode") {
        // Only fetch type-index documents that are within the pod (untrusted ref).
        const scoped = podScopedUrlOrUndefined(
          { podRoot: asPodPort(config).root },
          quad.object.value,
        );
        if (scoped !== undefined) indexes.add(scoped);
      }
    }
  }
  for (const index of indexes) {
    try {
      // The index URL is in-pod (validated above); use scopedFetch so a redirect
      // out of the pod is still blocked (redirect-based SSRF guard).
      const ti = await searchRdf(config, index);
      for (const p of [`${solidNs}instance`, `${solidNs}instanceContainer`]) {
        for (const quad of ti.getQuads(null, DataFactory.namedNode(p), null, null)) {
          if (quad.object.termType === "NamedNode") {
            // Only emit in-pod instance targets (the caller scope-checks again).
            const scoped = podScopedUrlOrUndefined(
              { podRoot: asPodPort(config).root },
              quad.object.value,
            );
            if (scoped !== undefined) out.add(scoped);
          }
        }
      }
    } catch {
      // unreadable type index — skip.
    }
  }
  return [...out];
}

/**
 * Write `content` to `url` with `contentType` (pod-scoped) via PUT on the injected
 * fetch. GUARDED: throws if the server is read-only (the default). On a non-2xx
 * response it throws with the status.
 */
export async function writeResource(
  source: PodSource,
  url: string,
  content: string,
  contentType: string,
): Promise<{ url: string; etag?: string }> {
  const pod = asPodPort(source);
  const target = requirePodScopedWriteUrl({ podRoot: pod.root }, url);
  const result = await pod.write(target, new TextEncoder().encode(content), contentType, {});
  const output = new PodOutput(pod);
  // Mutation permission does not grant permission to describe the stored data.
  await output.read(target);
  return { url: target, ...(result.etag ? { etag: result.etag } : {}) };
}

/** Derive a name when a portable backend only supplies URL and container status. */
function resourceName(url: string): string {
  const name = new URL(url).pathname.replace(/\/$/, "").split("/").pop() ?? url;
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

/** Keep bounded parsing for portable reads as well as streaming fetch-backed reads. */
async function searchRdf(
  source: PodSource,
  url: string,
  profile = false,
): Promise<import("n3").Store> {
  const pod = asPodPort(source);
  const read = await pod.read(url, { accept: RDF_ACCEPT });
  const { url: finalUrl } = read;
  const base = finalUrl ?? url;
  // HTTP representation URLs omit WebID fragments; retain the configured-profile exception.
  const expectedProfile = profile ? new URL(pod.webId) : undefined;
  const finalDocument = new URL(base);
  if (expectedProfile) {
    expectedProfile.hash = "";
    finalDocument.hash = "";
  }
  if (expectedProfile?.href !== finalDocument.href) {
    requirePodScopedUrl({ podRoot: pod.root }, base);
  }
  return parseSearchRead(read, url);
}

/** Parse an already authorized read without turning a read denial into a nonmatch. */
async function parseSearchRead(
  { body, contentType, url: finalUrl }: PodReadResult,
  url: string,
): Promise<import("n3").Store> {
  if (body.byteLength > MAX_CONTENT_BYTES) throw new RdfLimitError();
  return parseBoundedRdf(
    new TextDecoder().decode(body),
    mediaType(contentType || "text/turtle"),
    finalUrl ?? url,
  );
}
