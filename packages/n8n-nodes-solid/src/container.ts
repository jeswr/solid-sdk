// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Container listing for the n8n Solid node's Container -> List operation.
//
// The ONLY RDF this node touches is the LDP container listing (the `ldp:contains`
// membership). Resource VALUES read/written by the node are opaque bytes/text and
// are NEVER RDF-parsed.
//
// House rule: parse the container document through `@jeswr/fetch-rdf` (`parseRdf`)
// and read `ldp:contains` through `@solid/object`'s typed `ContainerDataset`.
// NEVER hand-parse Turtle, never hand-walk quads for membership. This module does
// the PARSE only — the HTTP GET is performed by the node via n8n's
// `this.helpers.httpRequest` (n8n owns the transport, not a bespoke fetch).

import { parseRdf } from "@jeswr/fetch-rdf";
import { podScopedUrl } from "@jeswr/guarded-fetch";
import { ContainerDataset } from "@solid/object";
import { DataFactory } from "n3";
import { isContainerUrl } from "./scope.js";

/** A single member of a container. */
export interface ContainerMember {
  /** Absolute URL of the member. */
  readonly url: string;
  /** True iff the member is itself a container (trailing slash). */
  readonly container: boolean;
}

/**
 * Parse the direct `ldp:contains` members of a container document.
 *
 * @param body - the raw container document text (as fetched by the node).
 * @param contentType - the response `Content-Type` header (may be `null`;
 *   `parseRdf` defaults a null content-type to `text/turtle`).
 * @param containerUrl - the absolute container URL; used as the parse `baseIRI`
 *   so relative `ldp:contains` IRIs resolve to absolute member URLs, and as the
 *   scope-guard base so a hostile/buggy server cannot inject a foreign member.
 * @param base - the configured pod base; members are validated to lie under it.
 * @returns the direct members (the container itself and out-of-pod members are
 *   excluded). A valid but empty document yields `[]`.
 */
export async function parseContainerListing(
  body: string,
  contentType: string | null,
  containerUrl: string,
  base: string,
): Promise<ContainerMember[]> {
  // parseRdf resolves relative IRIs against the container URL (baseIRI), so
  // ldp:contains object IRIs come back absolute.
  const dataset = await parseRdf(body, contentType, { baseIRI: containerUrl });

  const container = new ContainerDataset(dataset, DataFactory).container;
  if (!container) {
    // A valid but empty / non-container document — no members.
    return [];
  }

  const members: ContainerMember[] = [];
  for (const resource of container.contains) {
    // resource.id may be relative if the server emitted a relative IRI the parser
    // did not resolve; resolve against the container URL to be safe.
    const absolute = new URL(resource.id, containerUrl).toString();
    // Defence in depth: never surface a member that escapes the pod base — a
    // hostile/buggy server cannot inject foreign URLs into the listing. The FILTER
    // form returns the CANONICAL in-scope URL (or `undefined` to drop it); we push
    // that canonical value — not the raw `absolute` — so the URL we validated is
    // the URL we surface (avoids the canonical-URL bug class where a guard is used
    // only for its throw side-effect while a non-canonical string is passed on).
    const scoped = podScopedUrl(base, absolute, { allowRoot: true });
    if (scoped === undefined) {
      continue;
    }
    // Some serialisations list the container itself; skip the self-member
    // (compare against the canonical scoped value now in use).
    if (scoped === containerUrl) {
      continue;
    }
    members.push({ url: scoped, container: isContainerUrl(scoped) });
  }
  return members;
}
