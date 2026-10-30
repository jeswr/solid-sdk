// AUTHORED-BY Codex GPT-6.1-Sol
import type { DatasetCore, Term } from "@rdfjs/types";
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Writer } from "n3";
import type { Mode } from "./types.js";
/** WAC vocabulary namespace used by the extracted migrator core. */
export const ACL = "http://www.w3.org/ns/auth/acl#";
/** ACP vocabulary namespace used by the extracted migrator core. */
export const ACP = "http://www.w3.org/ns/solid/acp#";
/** RDF vocabulary namespace. */
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
/** FOAF vocabulary namespace for public WAC agents. */
export const FOAF = "http://xmlns.com/foaf/0.1/";
/** Canonical mode order, retained from the migrator. */
export const modes: Mode[] = ["read", "append", "write", "control"];
/** Map a neutral mode to its WAC mode IRI. */
export function modeIri(mode: Mode): string {
  return ACL + mode.charAt(0).toUpperCase() + mode.slice(1);
}
/** Read recognized WAC modes, including the Write to Append implication. */
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
/** Typed graph accessors shared by the WAC and ACP implementations. */
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
/** Serialize RDF as Turtle after validating every named-node IRI. */
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
/** Return the path parent, stopping at the supplied pod root. */
export function parent(url: string, root: string): string | undefined {
  if (url === root) return undefined;
  return new URL(".", url.endsWith("/") ? url.slice(0, -1) : url).href;
}
