// AUTHORED-BY Codex GPT-6
import { parseRdf } from "@jeswr/fetch-rdf";
import { assertWithinPodScope } from "@jeswr/guarded-fetch";
import { parseLinkHeaders } from "@jeswr/storage-capabilities";
import type { DatasetCore, Term } from "@rdfjs/types";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Writer } from "n3";
import type { Mode } from "./types.js";
export const ACL = "http://www.w3.org/ns/auth/acl#";
export const ACP = "http://www.w3.org/ns/solid/acp#";
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
export const FOAF = "http://xmlns.com/foaf/0.1/";
export const modes: Mode[] = ["read", "append", "write", "control"];
export function modeIri(mode: Mode): string {
  return ACL + mode.charAt(0).toUpperCase() + mode.slice(1);
}
export function readModes(iris: Iterable<string>): Set<Mode> {
  const result = new Set<Mode>();
  for (const mode of modes) if ([...iris].includes(modeIri(mode))) result.add(mode);
  if (result.has("write")) result.add("append");
  return result;
}
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
export class RdfNode extends TermWrapper {
  iris(predicate: string): string[] {
    return [...SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string)];
  }
  add(predicate: string, value: string): void {
    SetFrom.subjectPredicate(this, predicate, NamedNodeAs.string, NamedNodeFrom.string).add(
      safeIri(value),
    );
  }
  nodes(predicate: string): RdfNode[] {
    return [...this.dataset.match(this as unknown as Term, DataFactory.namedNode(predicate))].map(
      (q) => {
        if (q.object.termType !== "NamedNode" && q.object.termType !== "BlankNode")
          throw new TypeError("RDF node required");
        return new RdfNode(q.object, this.dataset, DataFactory);
      },
    );
  }
}
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
export function parent(url: string, root: string): string | undefined {
  if (url === root) return undefined;
  return new URL(".", url.endsWith("/") ? url.slice(0, -1) : url).href;
}
