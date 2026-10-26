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

/** Gregorian calendar check, independent of Date.parse's day rollover. */
export function validCalendarDate(year: number, month = 1, day = 1): boolean {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] as number);
}

export function dateTime(value: string, requireTimezone = true): string {
  // XSD permits 24:00:00 only with a zero fraction, and offsets up to ±14:00.
  const match =
    /^(\d{4})-(\d\d)-(\d\d)T(?:(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?|24:00:00(?:\.0+)?)(Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))?$/.exec(
      value,
    );
  if (!match || match[0] !== value) throw new Error("Invalid dateTime");
  const [, year, month, day, timezone] = match;
  if (
    (requireTimezone && !timezone) ||
    !validCalendarDate(Number(year), Number(month), Number(day))
  ) {
    throw new Error("Invalid dateTime");
  }
  // Assertion literals describe local calendar values, not necessarily instants.
  if (!timezone) return value;
  // RDFlib normalizes UTC offsets and microsecond precision on parsing.
  return value
    .replace(/(?:Z|-00:00)$/, "+00:00")
    .replace(/\.(\d+)(?=[+-])/, (_, digits: string) => {
      const micros = digits.padEnd(6, "0").slice(0, 6);
      return Number(micros) === 0 ? "" : `.${micros}`;
    });
}

export function normalizeLiteral(term: Literal): Literal {
  if (term.datatype.value === `${NS.xsd}dateTime`)
    return df.literal(dateTime(term.value, false), term.datatype);
  const datatype = term.datatype.value.replace(NS.xsd, "");
  const value = term.value.trim();
  if (
    term.datatype.value.startsWith(NS.xsd) &&
    /^(integer|nonPositiveInteger|negativeInteger|long|int|short|byte|nonNegativeInteger|unsignedLong|unsignedInt|unsignedShort|unsignedByte|positiveInteger)$/.test(
      datatype,
    ) &&
    /^[+-]?\d+$/.test(value)
  ) {
    return df.literal(BigInt(value).toString(), term.datatype);
  }
  if (term.datatype.value === `${NS.xsd}decimal` && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) {
    // Decimal's fixed-point spelling retains scale and signed zero, without
    // passing through a JS number (which would round arbitrary-precision values).
    const [integer, fraction] = value.replace(/^\+/, "").split(".");
    const whole = (integer as string).replace(/^(-?)0+(?=\d)/, "$1").replace(/^-?$/, "$&0");
    return df.literal(whole + (fraction ? `.${fraction}` : ""), term.datatype);
  }
  if (
    [`${NS.xsd}float`, `${NS.xsd}double`].includes(term.datatype.value) &&
    /^(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[+-]?INF|NaN)$/.test(value)
  ) {
    const number = Number(value.replace("INF", "Infinity"));
    let normalized: string;
    if (Number.isNaN(number)) normalized = "nan";
    else if (!Number.isFinite(number)) normalized = number < 0 ? "-inf" : "inf";
    else if (Object.is(number, -0)) normalized = "-0.0";
    else if (number !== 0 && (Math.abs(number) < 1e-4 || Math.abs(number) >= 1e16))
      normalized = number.toExponential().replace(/e([+-])(\d)$/, "e$10$2");
    else normalized = Number.isInteger(number) ? `${number}.0` : String(number);
    return df.literal(normalized, term.datatype);
  }
  if (
    term.datatype.value === `${NS.xsd}boolean` &&
    ["true", "false", "1", "0"].includes(term.value)
  ) {
    return df.literal(["true", "1"].includes(term.value) ? "true" : "false", term.datatype);
  }
  return term;
}
