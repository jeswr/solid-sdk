// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Container listing for getKeys/clear.
//
// The ONLY RDF this driver touches is the LDP container listing (the `ldp:contains`
// membership). Stored VALUES are opaque KV blobs and are NEVER RDF-parsed.
//
// House rule: parse the container document through `@jeswr/fetch-rdf` (`parseRdf`)
// and read `ldp:contains` through `@solid/object`'s typed `ContainerDataset`.
// NEVER hand-parse Turtle, never hand-walk quads for membership.

import { parseRdf } from "@jeswr/fetch-rdf";
import { ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";
import { assertWithinBase, isContainerUrl } from "./keys.js";

/** A single member of a container. */
export interface ContainerMember {
  /** Absolute URL of the member. */
  readonly url: string;
  /** True iff the member is itself a container (trailing slash). */
  readonly container: boolean;
}

/**
 * List the direct `ldp:contains` members of the container at `containerUrl`.
 *
 * @param containerUrl - absolute container URL (trailing slash).
 * @param base - the driver base (members are validated to lie under it).
 * @param fetchImpl - the (possibly authenticated) fetch to use.
 * @returns the direct members; `null` if the container does not exist (404),
 *   which the caller treats as an empty listing.
 */
export async function listContainer(
  containerUrl: string,
  base: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<ContainerMember[] | null> {
  const res = await fetchImpl(containerUrl, {
    method: "GET",
    headers: { accept: "text/turtle, application/ld+json;q=0.9" },
  });
  if (res.status === 404 || res.status === 410) {
    return null;
  }
  if (!res.ok) {
    throw new Error(
      `[unstorage-solid] listing container ${containerUrl} failed: ${res.status} ${res.statusText}`,
    );
  }
  const body = await res.text();
  // parseRdf resolves relative IRIs against the container URL (baseIRI), so
  // ldp:contains object IRIs come back absolute.
  const dataset = await parseRdf(body, res.headers.get("content-type"), {
    baseIRI: containerUrl,
  });

  const container = new ContainerDataset(dataset, DataFactory).container;
  if (!container) {
    // A valid but empty / non-container document — no members.
    return [];
  }

  const members: ContainerMember[] = [];
  for (const resource of container.contains) {
    // resource.id may be relative if the server emitted a relative IRI and the
    // parser did not resolve it; resolve against the container URL to be safe.
    const absolute = new URL(resource.id, containerUrl).toString();
    // Defence in depth: never surface a member that escapes the driver base —
    // a hostile/buggy server cannot inject foreign URLs into our key space.
    try {
      assertWithinBase(base, absolute);
    } catch {
      continue;
    }
    // The base container lists itself in some serialisations; skip a member that
    // is the container itself.
    if (absolute === containerUrl) {
      continue;
    }
    members.push({ url: absolute, container: isContainerUrl(absolute) });
  }
  return members;
}
