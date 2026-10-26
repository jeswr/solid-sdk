// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { createMemoryCache } from "./cache.js";
import { CapabilitiesError } from "./errors.js";
import { discardBody, httpUrl, readBody, request } from "./http.js";
import { parseLinkHeaders } from "./link.js";
import { parseLwsDescription } from "./lws-description.js";
import { notificationDocumentLoader } from "./notification-context.js";
import { isWithinRoot } from "./prefix.js";
import { parseSolidDescription } from "./solid-description.js";
import type { ResolveOptions, StorageDescription } from "./types.js";
import { PIM, SOLID, SSD } from "./vocab.js";

const DEFAULT_TTL_MS = 3_600_000;
const LWS_STORAGE = "https://www.w3.org/ns/lws#storage";
/** Shared module default so `capabilities()` and the resolver see the same records. */
export const defaultCache = createMemoryCache();

function linksFor(url: string, headers: Headers) {
  return parseLinkHeaders(headers.get("link"), url).filter((link) => link.context === url);
}

function maxAge(headers: Headers, fallback = DEFAULT_TTL_MS): number {
  const match = /(?:^|,)\s*max-age\s*=\s*(?:"(\d+)"|(\d+))\s*(?=,|$)/i.exec(
    headers.get("cache-control") ?? "",
  );
  const milliseconds = match ? Number(match[1] ?? match[2]) * 1000 : Number.NaN;
  return Number.isSafeInteger(milliseconds) ? milliseconds : fallback;
}

async function head(url: string, options: ResolveOptions): Promise<Headers> {
  const response = await request(url, options, { method: "HEAD" });
  await discardBody(response);
  return response.headers;
}

async function solidRoot(url: string, headers: Headers, options: ResolveOptions) {
  let candidate = httpUrl(url);
  candidate.search = "";
  if (
    linksFor(url, headers).some((link) => link.rel.includes("type") && link.target === PIM.Storage)
  ) {
    return { root: candidate.href, evidence: [] };
  }
  const limit = options.maxAncestorProbes ?? 8;
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new CapabilitiesError(
      "description-invalid",
      url,
      "maxAncestorProbes must be a nonnegative integer",
    );
  }
  for (let count = 0; count < limit && candidate.pathname !== "/"; count++) {
    // Path arithmetic is only for Solid; LWS containment comes from its CID instead.
    candidate = new URL(candidate.pathname.endsWith("/") ? "../" : "./", candidate);
    const parent = candidate.href;
    const headers = await head(parent, options);
    if (
      linksFor(parent, headers).some(
        (link) => link.rel.includes("type") && link.target === PIM.Storage,
      )
    ) {
      return { root: parent, evidence: [] };
    }
  }
  return { root: `${candidate.origin}/`, evidence: ["assumed-origin-root"] };
}

async function fetchDescription(
  base: StorageDescription,
  descriptionUrl: string,
  resourceUrl: string,
  options: ResolveOptions,
  refreshing: boolean,
): Promise<StorageDescription> {
  const destination = httpUrl(descriptionUrl);
  const foreign = destination.origin !== httpUrl(resourceUrl).origin;
  // SSD-CLI-18 applies to both protocols, including direct cached refreshes.
  if (foreign) {
    throw new CapabilitiesError(
      "root-mismatch",
      descriptionUrl,
      "Storage description has a foreign origin",
    );
  }
  const headers = new Headers({
    accept:
      base.protocol === "lws"
        ? "application/lws+cid, application/cid;q=0.9, application/ld+json;q=0.8"
        : "application/ld+json, text/turtle;q=0.9",
  });
  if (refreshing && base.etag !== null) headers.set("if-none-match", base.etag);
  const response = await request(destination.href, options, {
    method: "GET",
    headers,
  });
  if (response.status === 304 && refreshing) {
    await discardBody(response);
    return {
      ...base,
      fetchedAt: (options.now ?? Date.now)(),
      etag: response.headers.get("etag") ?? base.etag,
      maxAgeMs: maxAge(response.headers, base.maxAgeMs),
    };
  }
  if (!response.ok) {
    await discardBody(response);
    throw new CapabilitiesError(
      "description-unreachable",
      descriptionUrl,
      "Storage description is unreachable",
      response.status,
    );
  }
  const body = await readBody(response, descriptionUrl);
  let parsed: StorageDescription;
  try {
    if (base.protocol === "lws") {
      parsed = parseLwsDescription(JSON.parse(body), destination.href, resourceUrl);
    } else {
      const dataset = await parseRdf(body, response.headers.get("content-type"), {
        baseIRI: destination.href,
        documentLoader: notificationDocumentLoader,
      });
      parsed = {
        ...base,
        // SSD-CLI-16: an assumed origin root cannot authorize root-scoped entries.
        ...parseSolidDescription(
          dataset,
          base.root,
          base.evidence?.includes("assumed-origin-root") ?? false,
        ),
      };
    }
  } catch (error) {
    if (error instanceof CapabilitiesError) throw error;
    throw new CapabilitiesError(
      "description-invalid",
      descriptionUrl,
      "Storage description could not be parsed",
    );
  }
  return {
    ...parsed,
    fetchedAt: (options.now ?? Date.now)(),
    etag: response.headers.get("etag"),
    maxAgeMs: maxAge(response.headers),
  };
}

/**
 * Resolve ADR-002's storage description from any resource, reusing cached root prefixes.
 * Uses only the injected fetch and clock; fresh cache hits make no requests. Expired
 * descriptions refresh directly with a conditional GET, without repeating discovery.
 * @throws {CapabilitiesError} For missing links, transport, parsing or origin failures.
 */
export async function resolveStorageDescription(
  url: string,
  options: ResolveOptions,
): Promise<StorageDescription> {
  const resource = httpUrl(url).href;
  const cache = options.cache ?? defaultCache;
  const storageId = await cache.lookupPrefix(resource);
  let cached = storageId === undefined ? undefined : await cache.get(storageId);
  let invalidationId = storageId;
  try {
    if (cached) {
      if (
        httpUrl(cached.description.root).origin !== httpUrl(resource).origin ||
        (cached.description.descriptionUrl !== null &&
          httpUrl(cached.description.descriptionUrl).origin !== httpUrl(resource).origin)
      ) {
        throw new CapabilitiesError(
          "root-mismatch",
          resource,
          "Cached storage has a foreign origin",
        );
      }
      if (!isWithinRoot(resource, cached.description.root)) {
        // A stale prefix (the storage root moved): rediscover instead of misattributing.
        cached = undefined;
        invalidationId = undefined;
      }
    }
    if (cached) {
      if (
        (options.now ?? Date.now)() <
        cached.description.fetchedAt + cached.description.maxAgeMs
      ) {
        return cached.description;
      }
      if (cached.description.descriptionUrl !== null) {
        const description = await fetchDescription(
          cached.description,
          cached.description.descriptionUrl,
          resource,
          options,
          true,
        );
        await cache.set(description.id, {
          description,
          // A 304 keeps the original entry arrays; a replacement body must be probed anew.
          ...(description.services === cached.description.services && cached.probe
            ? { probe: cached.probe }
            : {}),
        });
        await cache.rememberPrefix(description.root, description.id);
        if (isWithinRoot(resource, description.root)) return description;
        // The refreshed root no longer contains this resource: discover its storage afresh.
        invalidationId = undefined;
      }
    }
    const headers = options.seedHeaders ?? (await head(resource, options));
    const links = linksFor(resource, headers);
    const lws = links.find((link) => link.rel.includes(LWS_STORAGE));
    const solid = links.find((link) => link.rel.includes(SOLID.storageDescription.toLowerCase()));
    const legacy =
      headers.get("updates-via") ??
      links.find(
        (link) =>
          link.rel.includes("updates-via") ||
          link.rel.includes("http://www.w3.org/ns/solid/terms#updatesvia"),
      )?.target;
    if (!lws && !solid && !legacy) throw new CapabilitiesError("no-storage-link", resource);
    const discovery = lws
      ? { root: resource, evidence: [] }
      : await solidRoot(resource, headers, options);
    let description: StorageDescription = {
      protocol: lws ? "lws" : "solid",
      id: lws ? lws.target : discovery.root,
      root: discovery.root,
      descriptionUrl: lws?.target ?? solid?.target ?? null,
      services: [],
      capabilities: [],
      verificationMethods: [],
      sources: [lws ? "lws-cid" : solid ? "solid-description" : "probe"],
      fetchedAt: (options.now ?? Date.now)(),
      etag: null,
      maxAgeMs: maxAge(headers),
      ...(discovery.evidence.length ? { evidence: discovery.evidence } : {}),
    };
    invalidationId = description.id;
    if (description.descriptionUrl !== null) {
      description = await fetchDescription(
        description,
        description.descriptionUrl,
        resource,
        options,
        false,
      );
    } else {
      let endpoint: URL;
      try {
        endpoint = new URL(legacy as string, resource);
        if (!["ws:", "wss:"].includes(endpoint.protocol) || endpoint.username || endpoint.password)
          throw new Error();
      } catch {
        throw new CapabilitiesError(
          "description-invalid",
          resource,
          "Invalid Updates-Via endpoint",
        );
      }
      description.services = [
        {
          type: [SSD.SolidNotificationService, SSD.LegacyUpdatesVia],
          endpoint: endpoint.href,
          extra: {},
        },
      ];
    }
    await cache.set(description.id, { description });
    await cache.rememberPrefix(description.root, description.id);
    return description;
  } catch (error) {
    if (
      invalidationId !== undefined &&
      error instanceof CapabilitiesError &&
      (error.code === "root-mismatch" || error.status === 404 || error.status === 410)
    ) {
      await cache.delete(invalidationId);
    }
    throw error;
  }
}
