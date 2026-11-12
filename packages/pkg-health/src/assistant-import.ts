// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { isSafeAbsoluteIri, readLiteral, sanitizeText } from "@jeswr/model-runtime";
import {
  buildNanopublications,
  type Claim,
  createFactAssertion,
  type Nanopublications,
  parseReferenceRdf,
  pkgId,
  type Source,
  serializeNanopublications,
  validateAssertionTerms,
} from "@jeswr/pkg-memory";
import type { DatasetCore, Literal, Quad, Term } from "@rdfjs/types";
import { NamedGraphDataset } from "@rdfjs/wrapper";
import { DataFactory as df, termToId as n3TermToId, type Store } from "n3";
import { entities } from "./generated/model.js";
import { H, RDF_TYPE, ReadNode, S, SUBJECT_LINK_PREDICATES, XSD } from "./read.js";
import { temporalTime } from "./temporal.js";
import { HealthGraphError } from "./types.js";

export interface AssistantTurtleOptions {
  owner: string;
  assistant: { iri: string; label: string };
  batchId: string;
  generatedAt: string;
}
const PROV = "http://www.w3.org/ns/prov#";
const OA = "http://www.w3.org/ns/oa#";
const PKG = ["https://jeswr.org/ns/pkg#", "https://w3id.org/jeswr/pkg#"];
const schema = (local: string) => [S + local, `http://schema.org/${local}`];
const factTypes = new Map([
  [`${H}Observation`, "observation"],
  [`${H}Condition`, "condition"],
  [`${H}MedicationStatement`, "medication"],
  [`${H}Encounter`, "encounter"],
  [`${H}Immunization`, "immunization"],
  ...schema("PropertyValue").map((iri) => [iri, "note"] as [string, string]),
]);
class Skip extends Error {
  constructor(readonly reason: string) {
    super("Assistant fact skipped");
  }
}
function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Skip("InvalidFact");
  return value;
}
/** Aliases are combined: neither namespace can conceal a conflicting scalar. */
function terms(node: ReadNode, predicates: readonly string[]): Term[] {
  const result = new Map<string, Term>();
  for (const predicate of predicates)
    for (const term of node.terms(predicate)) result.set(termToId(term), term);
  return [...result.values()].sort(termOrder);
}
/** A total, locale-free order includes literal datatype and language. */
export function termOrder(a: Term, b: Term): number {
  const key = (term: Term) =>
    `${term.termType}\u0000${term.value}\u0000${term.termType === "Literal" ? term.datatype.value : ""}\u0000${term.termType === "Literal" ? term.language : ""}`;
  const left = key(a),
    right = key(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
function one(node: ReadNode, predicates: string[]): Term | undefined {
  const values = terms(node, predicates);
  if (values.length > 1) throw new Skip("InvalidFact");
  return values[0];
}
function string(term: Term): string {
  if (term.termType !== "Literal" || term.datatype.value !== `${XSD}string`)
    throw new Skip("InvalidFact");
  if (sanitizeText(term.value) !== term.value) throw new Skip("InvalidFact");
  return term.value;
}
function text(node: ReadNode, predicates: string[]): string | undefined {
  const value = one(node, predicates);
  return value === undefined ? undefined : string(value);
}
/**
 * Read one display name. NFC-equivalent, case-only variants are the same name
 * (assistant exports repeat them); the first in code-point order is kept. Names
 * that genuinely differ are refused rather than guessed between.
 */
function name(node: ReadNode): string | undefined {
  const names = [...new Set(terms(node, schema("name")).map(string))].sort(codePointOrder);
  if (new Set(names.map((n) => n.normalize("NFC").toLowerCase())).size > 1)
    throw new Skip("InvalidFact");
  return names[0];
}
/** Unicode code-point order, including equal strings and prefix names. */
export function codePointOrder(a: string, b: string): number {
  const left = [...a],
    right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = (left[i] as string).codePointAt(0) as number;
    const other = (right[i] as string).codePointAt(0) as number;
    if (difference !== other) return difference - other;
  }
  return left.length - right.length;
}
function iri(term: Term): string {
  if (term.termType !== "NamedNode" || !isSafeAbsoluteIri(term.value))
    throw new Skip("InvalidFact");
  return term.value;
}
// N3 accepts external RDF/JS terms; @types/n3 narrows this helper to N3 terms.
const termToId = n3TermToId as (term: Term) => string;
/** Outgoing statements allowed on one fact, product or source node. */
export const MAX_NODE_STATEMENTS = 256;
/** Exact quotes kept per fact; extras are dropped in term order. */
export const MAX_FACT_QUOTES = 20;
/** Derived-from sources allowed per fact; more skip the fact (InvalidEvidence). */
export const MAX_FACT_SOURCES = 16;
/** Facts accepted per import; later facts in term order skip as ImportLimit. */
export const MAX_IMPORT_FACTS = 1000;
/** Evidence entries per import; the fact that would exceed it, and every later fact, skip as ImportLimit. */
export const MAX_IMPORT_EVIDENCE = 2000;
/**
 * Validate all outgoing terms, including fields not copied into the assertion,
 * with linear per-quad checks before anything reads the node. Blank-node objects
 * are refused (none is ever copied; named IRIs are required) and a node may have
 * at most MAX_NODE_STATEMENTS outgoing statements, so untrusted input cannot make
 * validation or the alias reads after it expensive.
 */
function validate(node: ReadNode): void {
  const quads: Quad[] = [];
  for (const quad of node.dataset.match(node.term)) {
    if (quads.length === MAX_NODE_STATEMENTS) throw new Skip("TooManyStatements");
    if (quad.object.termType === "BlankNode") throw new Skip("InvalidFact");
    quads.push(quad);
  }
  validateAssertionTerms(quads);
}
function checkedDate(term: Term, reason: string): Literal {
  if (
    term.termType !== "Literal" ||
    ![`${XSD}date`, `${XSD}dateTime`].includes(term.datatype.value) ||
    temporalTime(term) === undefined
  )
    throw new Skip(reason);
  if (term.datatype.value === `${XSD}dateTime`) {
    const year = new Date(temporalTime(term) as number).getUTCFullYear();
    if (!/(?:Z|[+-]\d\d:\d\d)$/.test(term.value) || year < 1 || year > 9999) throw new Skip(reason);
  } else if (!/^(?!0000)\d{4}-/.test(term.value)) throw new Skip(reason);
  return term;
}
function date(value: Term): Literal {
  const term = checkedDate(value, "InvalidFact");
  // Generated Date fields cannot preserve sub-millisecond precision. Refuse loss.
  if (/\.\d{3}\d*[1-9]\d*(?:Z|[+-]|$)/.test(term.value)) throw new Skip("UnsupportedDatePrecision");
  return term;
}
function appendDates(graph: Store, node: ReadNode): void {
  for (const [field, predicates] of [
    ["validFrom", schema("validFrom")],
    ["validThrough", schema("validThrough")],
    ["effectiveTime", [`${H}effectiveTime`]],
  ] as const) {
    const term = one(node, [...predicates]);
    if (!term) continue;
    const literal = date(term);
    const model =
      literal.datatype.value === `${XSD}date`
        ? entities.AssistantDateFields
        : entities.AssistantDateTimeFields;
    // Date-only values retain their calendar day, including an optional zone.
    const value =
      literal.datatype.value === `${XSD}date`
        ? new Date(`${literal.value.slice(0, 10)}T00:00:00Z`)
        : new Date(temporalTime(literal) as number);
    graph.addQuads([...model.build(node.value, { [field]: value })]);
  }
}
function readSource(
  term: Term,
  dataset: DatasetCore,
  model: string,
  owner: string,
): Source | undefined {
  try {
    const node = new ReadNode(iri(term), dataset);
    validate(node);
    if (node.owners.some((t) => t.termType !== "NamedNode" || t.value !== owner)) return undefined;
    // Assistant exports may repeat source names and creation dates. Keep the first
    // name in code-point order and the earliest date, so output is deterministic.
    const names = terms(node, schema("name")).map(string);
    if (!names.length) return undefined;
    // An explicitly empty title is kept only when no non-empty title exists.
    const title = (names.filter(Boolean).sort(codePointOrder)[0] ?? "") as string;
    const time = (literal: Literal) =>
      literal.datatype.value === `${XSD}date`
        ? Date.parse(`${literal.value.slice(0, 10)}T00:00:00Z`)
        : (temporalTime(literal) as number);
    const dates = terms(node, schema("dateCreated"))
      .map((value) => checkedDate(value, "InvalidSource"))
      .sort(
        (a, b) =>
          Math.floor(time(a) / 86400000) - Math.floor(time(b) / 86400000) ||
          Number(a.datatype.value === `${XSD}date`) - Number(b.datatype.value === `${XSD}date`) ||
          time(a) - time(b) ||
          termOrder(a, b),
      );
    const earliest = dates[0];
    if (!earliest) return undefined;
    const isDate = earliest.datatype.value === `${XSD}date`;
    return {
      id: node.value,
      url: node.value,
      kind: "document",
      title,
      // A calendar date stays a date; never invent a time of day for it.
      ...(isDate ? { date: earliest.value } : { created: new Date(time(earliest)).toISOString() }),
      model,
    };
  } catch {
    return undefined;
  }
}
function assertion(node: ReadNode, kind: string, owner: string): Store {
  const label = requireValue(name(node));
  const description = text(node, schema("description"));
  let graph: Store;
  switch (kind) {
    case "condition":
      graph = createFactAssertion(owner, {
        template: "condition",
        value: { id: node.value, name: label },
      });
      break;
    case "medication": {
      const product = new ReadNode(iri(requireValue(one(node, [`${H}medication`]))), node.dataset);
      validate(product);
      // A product that names another person is foreign data: never copy its name.
      if (product.owners.some((t) => t.termType !== "NamedNode" || t.value !== owner))
        throw new Skip("OtherSubject");
      if (
        !product
          .terms(RDF_TYPE)
          .some((t) => t.termType === "NamedNode" && t.value === `${H}MedicinalProduct`)
      )
        throw new Skip("InvalidFact");
      graph = createFactAssertion(owner, {
        template: "medication",
        value: {
          id: node.value,
          medication: { id: product.value, name: requireValue(name(product)) },
        },
      });
      graph.addQuads([
        ...entities.AssistantTextFields.build(node.value, {
          doseSchedule: text(node, schema("doseSchedule")),
        }),
      ]);
      break;
    }
    case "note":
      graph = entities.PropertyValue.build(node.value, {
        name: label,
        propertyID: label,
        textValue: requireValue(text(node, schema("value"))),
      });
      graph.addQuads([...entities.AssistantOwner.build(owner, { additionalProperty: node.value })]);
      break;
    case "observation": {
      graph = entities.Observation.build(node.value, {
        patient: owner,
        unitCode: text(node, [`${H}hasUnit`]),
      });
      const value = requireValue(one(node, [`${H}value`]));
      if (value.termType !== "Literal") throw new Skip("InvalidFact");
      if (value.datatype.value === `${XSD}string`)
        graph.addQuads([
          ...entities.AssistantTextValue.build(node.value, { textValue: string(value) }),
        ]);
      else {
        if (![`${XSD}integer`, `${XSD}decimal`].includes(value.datatype.value))
          throw new Skip("UnsupportedValue");
        const numericValue = readLiteral(value) as number;
        graph.addQuads([...entities.Observation.build(node.value, { numericValue })]);
      }
      break;
    }
    case "encounter":
      graph = entities.Encounter.build(node.value, { patient: owner });
      break;
    default:
      graph = entities.Immunization.build(node.value, { patient: owner });
  }
  graph.addQuads([...entities.AssistantTextFields.build(node.value, { name: label, description })]);
  appendDates(graph, node);
  return graph;
}

/** Convert an assistant's local Turtle export into owner-scoped, attributed claims. */
export async function importAssistantTurtle(
  turtle: string,
  options: AssistantTurtleOptions,
): Promise<{
  value: Nanopublications;
  skipped: { count: number; reasons: Record<string, number> };
}> {
  // Snapshot caller data so asynchronous parsing cannot change the build identity.
  let config: AssistantTurtleOptions;
  try {
    config = structuredClone(options);
    if (
      !isSafeAbsoluteIri(config.owner) ||
      !/^https?:/.test(config.owner) ||
      !isSafeAbsoluteIri(config.assistant.iri) ||
      !/^(?:https?:|urn:)/.test(config.assistant.iri) ||
      !config.assistant.label ||
      !config.batchId ||
      !/(?:Z|[+-]\d\d:\d\d)$/.test(config.generatedAt)
    )
      throw new Error();
    date(df.literal(config.generatedAt, df.namedNode(`${XSD}dateTime`)));
    string(df.literal(config.assistant.label));
    await serializeNanopublications(
      await buildNanopublications(
        {
          batch_id: config.batchId,
          worker: { agent_id: config.assistant.iri, agent_label: config.assistant.label },
          claims: [],
        },
        { owner: config.owner, generatedAt: config.generatedAt },
      ),
    );
  } catch {
    throw new HealthGraphError("invalid-input");
  }
  let dataset: DatasetCore;
  try {
    dataset = await parseReferenceRdf(turtle, "text/turtle");
  } catch {
    throw new HealthGraphError("read-failed");
  }
  const ids = new Map<string, Term>();
  const sourceTerms = new Map<string, Term>();
  for (const q of dataset) {
    if (
      q.predicate.value === RDF_TYPE &&
      q.object.termType === "NamedNode" &&
      schema("CreativeWork").includes(q.object.value)
    )
      sourceTerms.set(`${q.subject.termType}:${q.subject.value}`, q.subject);
    if (
      SUBJECT_LINK_PREDICATES.includes(q.predicate.value) ||
      (q.predicate.value === RDF_TYPE &&
        q.object.termType === "NamedNode" &&
        factTypes.has(q.object.value))
    )
      ids.set(`${q.subject.termType}:${q.subject.value}`, q.subject);
  }
  const sources = new Map<string, Source>();
  for (const term of [...sourceTerms.values()].sort(termOrder)) {
    const source = readSource(term, dataset, config.assistant.label, config.owner);
    if (source) sources.set(source.id, source);
  }
  const claims: Claim[] = [];
  // The export source IRI is reserved: an input source may never take it over.
  sources.delete(pkgId("assistant-export", config.batchId));
  const exportSource: Source = {
    id: pkgId("assistant-export", config.batchId),
    url: pkgId("assistant-export", config.batchId),
    kind: "document",
    title: `${config.assistant.label} export`,
    created: config.generatedAt,
    model: config.assistant.label,
  };
  const acceptedSources = new Map<string, Source>();
  const reasons: Record<string, number> = {};
  // Import-wide work bounds: once a limit is reached, later facts are not read.
  let evidenceCount = 0;
  let limited = false;
  for (const term of [...ids.values()].sort(termOrder)) {
    try {
      if (limited) throw new Skip("ImportLimit");
      iri(term);
      const node = new ReadNode(term, dataset);
      validate(node);
      // On a fact, schema:about is also a subject link (assistant exports use it so).
      const owners = [...node.owners, ...terms(node, schema("about"))];
      if (
        !owners.length ||
        owners.some((t) => t.termType !== "NamedNode" || t.value !== config.owner)
      )
        throw new Skip("OtherSubject");
      const kinds = new Set(
        node
          .terms(RDF_TYPE)
          .map((t) => (t.termType === "NamedNode" ? factTypes.get(t.value) : undefined))
          .filter(Boolean),
      );
      if (kinds.size !== 1) throw new Skip("UnsupportedType");
      const epistemicToken = text(
        node,
        PKG.map((ns) => `${ns}epistemicStatus`),
      );
      const epistemic = new Map<string | undefined, Claim["epistemic"]>([
        ["SelfReportedExplicit", "SelfReportedExplicit"],
        ["Inferred", "Inferred"],
        ["Uncertain", "SelfReportedHedged"],
      ]).get(epistemicToken);
      if (!epistemic) throw new Skip("UnknownEpistemicStatus");
      const validityToken = text(
        node,
        PKG.map((ns) => `${ns}validityStatus`),
      );
      if (validityToken !== "Current" && validityToken !== "Past")
        throw new Skip("UnknownValidityStatus");
      const derived = terms(node, [`${PROV}wasDerivedFrom`]);
      if (derived.length > MAX_FACT_SOURCES) throw new Skip("InvalidEvidence");
      // A quote must stay exact, so an over-long quote is dropped rather than cut.
      // The fact is kept when at least one usable quote remains. At most
      // MAX_FACT_QUOTES usable quotes are kept, the first in term order.
      const quotes = terms(node, [`${OA}exact`])
        .map(string)
        .filter((q) => q && [...q].length <= 300)
        .slice(0, MAX_FACT_QUOTES);
      if (!derived.length || !quotes.length) throw new Skip("InvalidEvidence");
      const factSources = derived.map((target): Source => {
        const source = sources.get(iri(target));
        if (!source) throw new Skip("InvalidSource");
        return source;
      });
      const evidenceSize =
        factSources.length === 1 ? quotes.length : factSources.length + quotes.length;
      if (
        claims.length === MAX_IMPORT_FACTS ||
        evidenceCount + evidenceSize > MAX_IMPORT_EVIDENCE
      ) {
        limited = true;
        throw new Skip("ImportLimit");
      }
      const graph = assertion(node, [...kinds][0] as string, config.owner);
      // Per-fact check, so one bad value skips its fact instead of failing the batch.
      validateAssertionTerms(graph);
      evidenceCount += evidenceSize;
      claims.push({
        id: pkgId("assistant-health-fact", node.value),
        assertion: graph,
        epistemic,
        validity: validityToken === "Past" ? "Historical" : "Current",
        attributed_to: config.assistant.iri,
        categories: ["pd:MedicalHealth"],
        evidence:
          factSources.length === 1
            ? quotes.map((quote) => ({ source: (factSources[0] as Source).id, quote }))
            : [
                ...factSources.map((source) => ({ source: source.id })),
                ...quotes.map((quote) => ({ source: exportSource.id, quote })),
              ],
      });
      for (const source of factSources) acceptedSources.set(source.id, source);
      if (factSources.length > 1) acceptedSources.set(exportSource.id, exportSource);
    } catch (error) {
      const reason = error instanceof Skip ? error.reason : "InvalidFact";
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
  }
  try {
    const emittedSources = [...acceptedSources.values()].sort((a, b) =>
      termOrder(df.namedNode(a.id), df.namedNode(b.id)),
    );
    const value = await buildNanopublications(
      {
        batch_id: config.batchId,
        worker: { agent_id: config.assistant.iri, agent_label: config.assistant.label },
        sources: emittedSources,
        claims,
      },
      { owner: config.owner, generatedAt: config.generatedAt },
    );
    // The document batch contract does not write created/model. Compose generated
    // metadata into the batch sources graph; assertion hashes are already final.
    const graph = new NamedGraphDataset(
      df.namedNode(pkgId("batch", config.batchId, "sources")),
      value.dataset,
      df,
    );
    for (const source of emittedSources)
      for (const record of [
        entities.DigitalDocument.build(source.id, { name: source.title }),
        entities.AssistantSourceMetadata.build(source.id, {
          instrument: source.model,
          ...(source.created ? { dateCreated: new Date(source.created) } : {}),
        }),
      ])
        for (const quad of record) graph.add(quad);
    // Only these direct-quote envelopes have blanks. Rebuild their targets and
    // selectors at stable IRIs through generated OA builders. Assertion graphs
    // and the memory builder's hash inputs remain untouched.
    for (const np of value.nanopubs) {
      const provenance = new NamedGraphDataset(df.namedNode(np.provenanceId), value.dataset, df);
      for (const quad of [...provenance])
        if (quad.subject.termType === "BlankNode" || quad.object.termType === "BlankNode")
          provenance.delete(quad);
      for (const evidence of np.evidence) {
        const target = pkgId("assistant-health-evidence", evidence.id, "target");
        const selector = pkgId("assistant-health-evidence", evidence.id, "quote");
        for (const record of [
          entities.AssistantAnnotation.build(evidence.id, { hasTarget: target }),
          entities.AssistantEvidenceTarget.build(target, {
            hasSource: evidence.source,
            hasSelector: evidence.quote === undefined ? undefined : selector,
          }),
          ...(evidence.quote === undefined
            ? []
            : [entities.AssistantQuoteSelector.build(selector, { exact: evidence.quote })]),
        ])
          for (const quad of record) provenance.add(quad);
      }
    }
    await serializeNanopublications(value);
    return {
      value,
      skipped: { count: Object.values(reasons).reduce((a, b) => a + b, 0), reasons },
    };
  } catch {
    throw new HealthGraphError("read-failed");
  }
}
