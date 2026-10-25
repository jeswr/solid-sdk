// AUTHORED-BY Codex GPT-6.1-Sol
import { safeIri } from "@jeswr/rdf-serialize";
import type { DatasetCore, Literal, Term } from "@rdfjs/types";
import { LiteralAs, NamedNodeAs, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory as df, Store } from "n3";

export const NS = {
  pkg: "https://jeswr.org/ns/pkg#",
  genid: "https://jeswr.org/.well-known/genid/",
  np: "http://www.nanopub.org/nschema#",
  prov: "http://www.w3.org/ns/prov#",
  oa: "http://www.w3.org/ns/oa#",
  dpv: "https://w3id.org/dpv#",
  pd: "https://w3id.org/dpv/pd#",
  schema: "https://schema.org/",
  vcard: "http://www.w3.org/2006/vcard/ns#",
  foaf: "http://xmlns.com/foaf/0.1/",
  health: "https://w3id.org/jeswr/sectors/health#",
  core: "https://w3id.org/jeswr/core#",
  fhir: "http://hl7.org/fhir/",
  sct: "http://snomed.info/id/",
  loinc: "https://loinc.org/",
  time: "http://www.w3.org/2006/time#",
  skos: "http://www.w3.org/2004/02/skos/core#",
  dcterms: "http://purl.org/dc/terms/",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
} as const;

export function iri(value: string): string {
  const safe = safeIri(value);
  if (safe === undefined || !/^(https?:|urn:|mailto:|tel:|file:)/i.test(safe)) {
    throw new Error("Invalid or unsupported IRI");
  }
  return safe;
}

export function expand(value: string, owner: string): string {
  if (value === "me") return owner;
  const colon = value.indexOf(":");
  const prefix = value.slice(0, colon);
  if (prefix === "pkg-rule") return iri(`https://jeswr.org/ns/pkg/rule/${value.slice(colon + 1)}`);
  if (Object.hasOwn(NS, prefix)) return iri(NS[prefix as keyof typeof NS] + value.slice(colon + 1));
  return iri(value);
}

/** Internal typed read/write accessors, always over a single graph. */
export class RdfNode extends TermWrapper {
  constructor(subject: string | Term, dataset: DatasetCore) {
    super(typeof subject === "string" ? df.namedNode(iri(subject)) : subject, dataset, df);
  }
  terms(predicate: string): Set<Term> {
    return SetFrom.subjectPredicate(this, predicate, TermAs.term, TermFrom.itself);
  }
  add(predicate: string, value: Term): this {
    this.terms(predicate).add(value);
    return this;
  }
  link(predicate: string, value: string): this {
    return this.add(predicate, df.namedNode(iri(value)));
  }
  text(predicate: string, value: string, datatype?: string): this {
    return this.add(
      predicate,
      df.literal(value, datatype === undefined ? undefined : df.namedNode(datatype)),
    );
  }
  one(predicate: string): Term {
    const terms = [...this.terms(predicate)];
    if (terms.length !== 1) throw new Error(`Expected exactly one ${predicate}`);
    return terms[0] as Term;
  }
  oneIri(predicate: string): string {
    return iri(NamedNodeAs.string(new TermWrapper(this.one(predicate), this.dataset, df)));
  }
  oneText(predicate: string): string {
    const term = this.one(predicate);
    if (term.termType !== "Literal" || term.datatype.value !== `${NS.xsd}string`)
      throw new Error("Expected string literal");
    return LiteralAs.string(new TermWrapper(term, this.dataset, df));
  }
  oneDateTime(predicate: string): string {
    const term = this.one(predicate);
    if (term.termType !== "Literal" || term.datatype.value !== `${NS.xsd}dateTime`)
      throw new Error("Expected dateTime literal");
    return dateTime(term.value);
  }
}

export function graph(dataset: DatasetCore, name: string): Store {
  const out = new Store();
  for (const q of dataset.match(null, null, null, df.namedNode(name))) {
    out.addQuad(df.quad(q.subject, q.predicate, q.object));
  }
  return out;
}

export function putGraph(dataset: Store, name: string, contents: DatasetCore): void {
  for (const q of contents)
    dataset.addQuad(df.quad(q.subject, q.predicate, q.object, df.namedNode(name)));
}

export function dateTime(value: string): string {
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error("Invalid dateTime");
  }
  // RDFlib normalizes UTC offsets and microsecond precision on parsing.
  return value.replace(/Z$/, "+00:00").replace(/\.(\d+)(?=[+-])/, (_, digits: string) => {
    const micros = digits.padEnd(6, "0").slice(0, 6);
    return Number(micros) === 0 ? "" : `.${micros}`;
  });
}

export function normalizeLiteral(term: Literal): Literal {
  if (term.datatype.value === `${NS.xsd}dateTime`)
    return df.literal(dateTime(term.value), term.datatype);
  if (term.datatype.value === `${NS.xsd}integer` && /^[+-]?\d+$/.test(term.value)) {
    return df.literal(BigInt(term.value).toString(), term.datatype);
  }
  if (
    term.datatype.value === `${NS.xsd}boolean` &&
    ["true", "false", "1", "0"].includes(term.value)
  ) {
    return df.literal(["true", "1"].includes(term.value) ? "true" : "false", term.datatype);
  }
  return term;
}
