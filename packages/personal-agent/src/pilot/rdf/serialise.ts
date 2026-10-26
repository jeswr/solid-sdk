/**
 * Turtle and JSON-LD serialisation of evidence quads, plus a tiny basic-graph-pattern (BGP)
 * helper. The JSON-LD is a flattened node list with an inline prefix-only `@context` (no
 * remote contexts, nothing fetched). The competency report executes the printed SPARQL with a
 * real SPARQL engine; the helper evaluates the same patterns only as an independent
 * consistency comparison and in unit tests. It supports triple patterns (joins use full RDF
 * term identity, incl. literal datatype and language) and NOT EXISTS groups only — no FILTER
 * expressions, no ordering, no reasoning — and is deliberately not extended. With either
 * evaluator (no reasoning), an empty answer shows the pattern is not ASSERTED in the exported
 * graph, not that it is not entailed.
 */
import { DataFactory, Parser, type Quad, type Store, type Term, Writer } from "n3";
import { PREFIXES, RDF, XSD } from "./evidence.js";

export function toTurtle(quads: readonly Quad[], prefixes = PREFIXES): Promise<string> {
  const sorted = [...quads].sort(compareQuads);
  const writer = new Writer({ prefixes: { ...prefixes } });
  writer.addQuads(sorted);
  return new Promise((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}

export function parseTurtle(text: string, baseIRI?: string): Quad[] {
  return new Parser({ format: "text/turtle", ...(baseIRI ? { baseIRI } : {}) }).parse(text);
}

function compareQuads(a: Quad, b: Quad): number {
  const ka = `${a.subject.value} ${a.predicate.value} ${a.object.value}`;
  const kb = `${b.subject.value} ${b.predicate.value} ${b.object.value}`;
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

function compact(iri: string, prefixes: Readonly<Record<string, string>>): string {
  let best: [string, string] | undefined;
  for (const [p, ns] of Object.entries(prefixes))
    if (iri.startsWith(ns) && iri.length > ns.length && (!best || ns.length > best[1].length))
      best = [p, ns];
  return best ? `${best[0]}:${iri.slice(best[1].length)}` : iri;
}

type JsonLdValue = { "@id": string } | { "@value": string; "@type"?: string; "@language"?: string };

/** Deterministic flattened JSON-LD (1.1) for blank-node-free graphs. */
export function toJsonLd(quads: readonly Quad[], prefixes = PREFIXES): Record<string, unknown> {
  const nodes = new Map<string, Record<string, unknown>>();
  for (const q of [...quads].sort(compareQuads)) {
    if (q.subject.termType !== "NamedNode")
      throw new Error("blank-node subjects are not supported");
    const id = q.subject.value;
    const node = nodes.get(id) ?? { "@id": compact(id, prefixes) };
    nodes.set(id, node);
    if (q.predicate.value === `${RDF}type` && q.object.termType === "NamedNode") {
      node["@type"] = [
        ...((node["@type"] as string[] | undefined) ?? []),
        compact(q.object.value, prefixes),
      ];
      continue;
    }
    const key = compact(q.predicate.value, prefixes);
    let value: JsonLdValue;
    if (q.object.termType === "NamedNode") value = { "@id": compact(q.object.value, prefixes) };
    else if (q.object.termType === "Literal") {
      const lit = q.object;
      value = { "@value": lit.value };
      if (lit.language) value["@language"] = lit.language;
      else if (lit.datatype.value !== `${XSD}string`)
        value["@type"] = compact(lit.datatype.value, prefixes);
    } else throw new Error(`unsupported object term ${q.object.termType}`);
    node[key] = [...((node[key] as JsonLdValue[] | undefined) ?? []), value];
  }
  return { "@context": { ...prefixes }, "@graph": [...nodes.values()] };
}

// ---------------------------------------------------------------------------------------
// Basic graph patterns
// ---------------------------------------------------------------------------------------

/** A pattern term: `?var`, a prefixed name / full IRI, or a literal `{ literal: ... }`. */
export type PatternTerm = string | { readonly literal: string; readonly datatype?: string };
export type TriplePattern = readonly [PatternTerm, PatternTerm, PatternTerm];

export interface Query {
  readonly id: string;
  readonly question: string;
  readonly select: readonly string[];
  readonly where: readonly TriplePattern[];
  /** Each group is a NOT EXISTS { ... } over the current binding. */
  readonly notExists?: readonly (readonly TriplePattern[])[];
}

export type Binding = Record<string, string>;

function expand(t: string, prefixes: Readonly<Record<string, string>>): string {
  if (t === "a") return `${RDF}type`;
  const i = t.indexOf(":");
  const p = t.slice(0, i);
  return prefixes[p] !== undefined && !t.includes("://") ? prefixes[p] + t.slice(i + 1) : t;
}

function toTerm(t: PatternTerm, prefixes: Readonly<Record<string, string>>): Term | string {
  if (typeof t !== "string")
    return DataFactory.literal(
      t.literal,
      t.datatype ? DataFactory.namedNode(expand(t.datatype, prefixes)) : undefined,
    );
  return t.startsWith("?") ? t : DataFactory.namedNode(expand(t, prefixes));
}

/**
 * RDF term identity for repeated-variable joins: term type, lexical value, and for literals
 * the datatype and language tag (so "1"^^xsd:integer ≠ "1" and "a"@en ≠ "a"@fr ≠ "a").
 */
export function termKey(t: Term): string {
  if (t.termType === "Literal")
    return JSON.stringify(["L", t.value, t.datatype.value, t.language.toLowerCase()]);
  return JSON.stringify([t.termType, t.value]);
}

function solve(
  store: Store,
  patterns: readonly TriplePattern[],
  start: Map<string, Term>,
  prefixes: Readonly<Record<string, string>>,
): Map<string, Term>[] {
  let rows = [start];
  for (const p of patterns) {
    const next: Map<string, Term>[] = [];
    for (const row of rows) {
      const resolve = (x: PatternTerm): Term | string => {
        const t = toTerm(x, prefixes);
        return typeof t === "string" ? (row.get(t) ?? t) : t;
      };
      const [s, pr, o] = [resolve(p[0]), resolve(p[1]), resolve(p[2])];
      const bound = (t: Term | string) => (typeof t === "string" ? null : t);
      for (const q of store.match(bound(s) as never, bound(pr) as never, bound(o) as never)) {
        const r = new Map(row);
        let ok = true;
        const found: [Term | string | undefined, Term][] = [
          [s, q.subject as Term],
          [pr, q.predicate as Term],
          [o, q.object as Term],
        ];
        for (const [v, val] of found) {
          if (typeof v !== "string") continue;
          const prev = r.get(v);
          if (prev && termKey(prev) !== termKey(val)) ok = false;
          else r.set(v, val);
        }
        if (ok) next.push(r);
      }
    }
    rows = next;
  }
  return rows;
}

/** Evaluate a query; results are distinct, sorted rows of the selected variables. */
export function runQuery(store: Store, query: Query, prefixes = PREFIXES): Binding[] {
  let rows = solve(store, query.where, new Map(), prefixes);
  for (const group of query.notExists ?? [])
    rows = rows.filter((row) => solve(store, group, row, prefixes).length === 0);
  const out = new Map<string, Binding>();
  for (const row of rows) {
    const b: Binding = {};
    for (const v of query.select) {
      const t = row.get(v);
      if (t) b[v.slice(1)] = t.termType === "NamedNode" ? compact(t.value, prefixes) : t.value;
    }
    out.set(JSON.stringify(b), b);
  }
  return [...out.values()].sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : 1));
}

/** The same query as SPARQL 1.1 text — what the SPARQL engine executes in the RDF report. */
export function toSparql(query: Query, prefixes = PREFIXES): string {
  const used = new Set<string>();
  const fmt = (t: PatternTerm) => {
    if (typeof t !== "string")
      return `${JSON.stringify(t.literal)}${t.datatype ? `^^${t.datatype}` : ""}`;
    if (t.startsWith("?") || t === "a") return t;
    const i = t.indexOf(":");
    if (i > 0 && prefixes[t.slice(0, i)] !== undefined && !t.includes("://")) {
      used.add(t.slice(0, i));
      return t;
    }
    return `<${t}>`;
  };
  const line = (p: TriplePattern) => `  ${p.map(fmt).join(" ")} .`;
  const body = [
    ...query.where.map(line),
    ...(query.notExists ?? []).map(
      (g) => `  FILTER NOT EXISTS {\n${g.map((p) => `  ${line(p)}`).join("\n")}\n  }`,
    ),
  ].join("\n");
  for (const p of query.where.flat()) if (typeof p !== "string" && p.datatype) fmt(p.datatype);
  const head = [...used]
    .sort()
    .map((p) => `PREFIX ${p}: <${prefixes[p]}>`)
    .join("\n");
  return `${head}\nSELECT DISTINCT ${query.select.join(" ")} WHERE {\n${body}\n}`;
}
