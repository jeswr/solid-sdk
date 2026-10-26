// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { safeIri } from "@jeswr/rdf-serialize";
import type { DatasetCore, Literal, NamedNode, Quad, Term } from "@rdfjs/types";
import { LiteralAs, NamedNodeAs, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory as df, Literal as N3Literal, Parser, Store } from "n3";
import { UnsupportedLiteralCharacterError, UnsupportedLiteralDatatypeError } from "./errors.js";

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

/** Retain RDFlib's language spelling in both the RDF/JS term and N3's store key. */
function languageLiteral(value: string, language: string): Literal {
  const literal = new N3Literal(`"${value}"@${language}`);
  Object.defineProperty(literal, "language", { value: language });
  return literal;
}

const referenceFactory = {
  ...df,
  literal(value: string | number, languageOrDatatype?: string | NamedNode) {
    return typeof languageOrDatatype === "string"
      ? languageLiteral(String(value), languageOrDatatype)
      : df.literal(value, languageOrDatatype);
  },
};

/** N3 also recreates terms on reads; retain tag spelling through every store. */
export class ReferenceStore extends Store {
  constructor(quads: Quad[] = []) {
    super(quads, { factory: referenceFactory });
  }
}

/** Parse through the suite boundary while preserving reference LANGTAG spelling. */
export async function parseReferenceRdf(
  body: string,
  format: "text/turtle" | "application/trig",
  baseIRI?: string,
): Promise<DatasetCore> {
  const dataset = await parseRdf(body, format, { baseIRI });
  if (![...dataset].some((q) => q.object.termType === "Literal" && q.object.language))
    return dataset;
  // fetch-rdf exposes no factory option. Replay its validated N3 input with a
  // spelling-preserving factory; the default N3 factory lowercases LANGTAGs.
  return new ReferenceStore(
    new Parser({
      format,
      baseIRI,
      factory: referenceFactory,
    }).parse(body),
  );
}

const supportedLiteralDatatypes = new Set([
  `${NS.xsd}string`,
  `${NS.rdf}langString`,
  `${NS.xsd}integer`,
  `${NS.xsd}decimal`,
  `${NS.xsd}boolean`,
  `${NS.xsd}dateTime`,
  `${NS.xsd}date`,
  `${NS.xsd}gYear`,
  `${NS.xsd}gYearMonth`,
]);

function validateLiteral(term: Literal): void {
  if (!supportedLiteralDatatypes.has(term.datatype.value))
    throw new UnsupportedLiteralDatatypeError(term.datatype.value);
  // These characters split Python's N-Triples hash input into additional lines.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: explicitly reject the control characters in the parity policy.
  const separator = /[\u2028\u2029\u0085\u000b\u000c\u001c-\u001e]/u.exec(term.value);
  if (separator) throw new UnsupportedLiteralCharacterError(separator[0].codePointAt(0) as number);
}

/** Validate the literal parity boundary without changing serialized graph values. */
export function validateLiterals(dataset: DatasetCore): void {
  for (const q of dataset) if (q.object.termType === "Literal") validateLiteral(q.object);
}

/** Reject unsafe caller-owned terms without changing their RDF identity. */
export function validateTermSafety(term: Term): void {
  if (term.termType === "NamedNode" && iri(term.value) !== term.value)
    throw new Error("Unsafe assertion IRI");
  if (term.termType === "Literal") {
    validateTermSafety(term.datatype);
    // Turtle LANGTAG syntax; the end assertion excludes a trailing newline.
    if (
      (term.language || term.datatype.value === `${NS.rdf}langString`) &&
      !/^[a-z]+(?:-[a-z0-9]+)*(?![\s\S])/i.test(term.language)
    )
      throw new Error("Invalid language tag");
  }
}

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
    if (value.termType === "Literal") validateLiteral(value);
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
  const out = new ReferenceStore();
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
  // RDFlib keeps the lexical form when Python cannot represent the XSD value.
  if (Number(year) === 0 || value.slice(11, 13) === "24") return value;
  // Normalize Python microseconds even for local assertion values; do not add a zone.
  return value
    .replace(/(?:Z|-00:00)$/, "+00:00")
    .replace(/\.(\d+)(?=[+-]|$)/, (_, digits: string) => {
      const micros = digits.padEnd(6, "0").slice(0, 6);
      return Number(micros) === 0 ? "" : `.${micros}`;
    });
}

/** RDFlib's date-backed XSD types drop zones without shifting the calendar value. */
function calendarLiteral(value: string, datatype: "date" | "gYear" | "gYearMonth"): string {
  const patterns = {
    date: /^(\d{4})-(\d\d)-(\d\d)(?:[Zz]|[+-]\d\d:\d\d)?$/,
    gYear: /^(\+?\d{4,})(?:[Zz]|[+-]\d\d:\d\d)?$/,
    gYearMonth: /^(\+?\d{4,})-(\d{2,})(?:[Zz]|[+-]\d\d:\d\d)?$/,
  };
  const match = patterns[datatype].exec(value);
  if (!match || match[0] !== value) return value;
  const year = Number(match[1]);
  const month = match[2] === undefined ? 1 : Number(match[2]);
  const day = match[3] === undefined ? 1 : Number(match[3]);
  // Python dates only represent years 1–9999; failed conversions stay lexical.
  if (year < 1 || year > 9999 || !validCalendarDate(year, month, day)) return value;
  const normalizedYear = String(year).padStart(4, "0");
  if (datatype === "gYear") return normalizedYear;
  const normalizedMonth = `${normalizedYear}-${String(month).padStart(2, "0")}`;
  return datatype === "gYearMonth"
    ? normalizedMonth
    : `${normalizedMonth}-${String(day).padStart(2, "0")}`;
}

export function normalizeLiteral(term: Literal): Literal {
  // Validate before trimming numeric whitespace or normalizing dateTime values.
  validateLiteral(term);
  if (term.datatype.value === `${NS.xsd}dateTime`)
    return df.literal(dateTime(term.value, false), term.datatype);
  const datatype = term.datatype.value.replace(NS.xsd, "");
  if (
    term.datatype.value.startsWith(NS.xsd) &&
    (datatype === "date" || datatype === "gYear" || datatype === "gYearMonth")
  )
    return df.literal(calendarLiteral(term.value, datatype), term.datatype);
  const value = term.value.trim();
  if (term.datatype.value === `${NS.xsd}integer` && /^[+-]?\d+$/.test(value)) {
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
    term.datatype.value === `${NS.xsd}boolean` &&
    ["true", "false", "1", "0"].includes(term.value)
  ) {
    return df.literal(["true", "1"].includes(term.value) ? "true" : "false", term.datatype);
  }
  return term;
}
