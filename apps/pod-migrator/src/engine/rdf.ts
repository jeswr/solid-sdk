// AUTHORED-BY Codex GPT-6

import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { parseLinkHeaders } from "@jeswr/storage-capabilities";
import type { DatasetCore } from "@rdfjs/types";
import { Writer } from "n3";
export async function parse(
  response: Response,
  url: string,
): Promise<Awaited<ReturnType<typeof parseRdf>>> {
  requireRepresentation(response);
  return parseRdf(await response.text(), response.headers.get("content-type"), { baseIRI: url });
}
export function requireRepresentation(response: Response): Response {
  if (response.status !== 200)
    throw new Error(`Expected a complete representation (${response.status})`);
  return response;
}
export function links(response: Response, url: string, rel: string): string[] {
  return parseLinkHeaders(response.headers.get("link"), url)
    .filter((link) => link.context === url && link.rel.includes(rel))
    .map((link) => link.target);
}
export function aclLink(response: Response, url: string, root: string): string | undefined {
  const found = links(response, url, "acl");
  if (found.length > 1) throw new TypeError("Ambiguous ACL links");
  return found[0] === undefined ? undefined : assertWithinPodScope(root, found[0]);
}
export function requireOk(response: Response): Response {
  if (!response.ok) throw new Error(`Pod request failed (${response.status})`);
  return response;
}

/** Web Access Control vocabulary namespace. */
export const ACL = "http://www.w3.org/ns/auth/acl#";
/** Access Control Policy vocabulary namespace. */
export const ACP = "http://www.w3.org/ns/solid/acp#";
/** RDF syntax vocabulary namespace. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

/** Reject malformed IRIREFs instead of letting N3 Writer emit injected Turtle. */
export function safeIri(value: string): string {
  if (
    !/^[a-z][a-z0-9+.-]*:/i.test(value) ||
    // biome-ignore lint/suspicious/noControlCharactersInRegex: RDF IRIREF must exclude control characters.
    /[\s<>"{}|^`\\\u0000-\u001f\u007f-\u009f]/u.test(value)
  )
    throw new TypeError("Unsafe RDF IRI");
  return value;
}
/** Validate named-node IRIs and serialize the dataset using n3.Writer. */
export function serialize(dataset: DatasetCore): Promise<string> {
  for (const quad of dataset)
    for (const term of [quad.subject, quad.predicate, quad.object, quad.graph])
      if (term.termType === "NamedNode") safeIri(term.value);
  const writer = new Writer();
  writer.addQuads([...dataset]);
  return new Promise((resolve, reject) =>
    writer.end((error, value) => (error ? reject(error) : resolve(value))),
  );
}
/** Find the Solid path parent, stopping at the caller-supplied storage root. */
export function parent(url: string, root: string): string | undefined {
  if (url === root) return undefined;
  return new URL(".", url.endsWith("/") ? url.slice(0, -1) : url).href;
}
