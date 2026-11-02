// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
// AUTHORED-BY Claude Opus 5.5
//
// Container listing for the n8n Solid node's Container -> List operation.
//
// The ONLY RDF this node touches is the LDP container listing (the `ldp:contains`
// membership). Resource VALUES read/written by the node are opaque bytes/text and
// are NEVER RDF-parsed.
//
// House rule: parse the container document through `@jeswr/fetch-rdf` (`parseRdf`)
// and read `ldp:contains` through `@jeswr/ldp-container` (which uses
// `@solid/object`'s typed `ContainerDataset`).
// NEVER hand-parse Turtle, never hand-walk quads for membership. This module does
// the PARSE only — the HTTP GET is performed by the node via n8n's
// `this.helpers.httpRequest` (n8n owns the transport, not a bespoke fetch).

import { parseRdf } from "@jeswr/fetch-rdf";
import { parseContainerMembers } from "@jeswr/ldp-container";

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
 * Membership is read by the suite's shared `@jeswr/ldp-container` helper, which
 * keeps only named-node members that lie strictly inside the listed container
 * and inside the pod base: a hostile or buggy server cannot inject a blank-node
 * member, a sibling (`<../private/x>`), a foreign URL or the container itself.
 *
 * @param body - the raw container document text (as fetched by the node).
 * @param contentType - the response `Content-Type` header (may be `null`;
 *   `parseRdf` defaults a null content-type to `text/turtle`).
 * @param containerUrl - the absolute container URL; used as the parse `baseIRI`
 *   so relative `ldp:contains` IRIs resolve to absolute member URLs.
 * @param base - the configured pod base; members are validated to lie under it.
 * @returns the direct members. A valid but empty document yields `[]`.
 */
export async function parseContainerListing(
  body: string,
  contentType: string | null,
  containerUrl: string,
  base: string,
): Promise<ContainerMember[]> {
  const dataset = await parseRdf(body, contentType, { baseIRI: containerUrl });
  return parseContainerMembers(dataset, containerUrl, { scope: base, allowRoot: true });
}
