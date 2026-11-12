// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { isSafeAbsoluteIri, readLiteral, sanitizeText } from "@jeswr/model-runtime";
import {
  buildNanopublications,
  type Claim,
  canonicalizeAssertion,
  createFactAssertion,
  type Nanopublications,
  parseReferenceRdf,
  pkgId,
  type Source,
  serializeNanopublications,
} from "@jeswr/pkg-memory";
import type { DatasetCore, Literal, Term } from "@rdfjs/types";
import { NamedGraphDataset } from "@rdfjs/wrapper";
import { DataFactory as df, Store } from "n3";
import { entities } from "./generated/model.js";
import { H, RDF_TYPE, ReadNode, S, XSD } from "./read.js";
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
function terms(node: ReadNode, predicates: string[]): Term[] {
  const result: Term[] = [];
  for (const predicate of predicates)
    for (const term of node.terms(predicate))
      if (!result.some((other) => term.equals(other))) result.push(term);
  return result.sort((a, b) => a.value.localeCompare(b.value));
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
 * Read one display name. Names that differ only in letter case are the same name
 * (assistant exports repeat them); the first in code-point order is kept. Names
 * that genuinely differ are refused rather than guessed between.
 */
function name(node: ReadNode): string | undefined {
  const names = [...new Set(terms(node, schema("name")).map(string))].sort(codePointOrder);
  if (new Set(names.map((n) => n.toLowerCase())).size > 1) throw new Skip("InvalidFact");
  return names[0];
}
/** Code-point order for distinct strings (RDF literal sets never repeat a value). */
function codePointOrder(a: string, b: string): number {
  return a < b ? -1 : 1;
}
function iri(term: Term): string {
  if (term.termType !== "NamedNode" || !isSafeAbsoluteIri(term.value))
    throw new Skip("InvalidFact");
  return term.value;
}
/** Validate all outgoing terms, including fields not copied into the assertion. */
function validate(node: ReadNode): void {
  canonicalizeAssertion(new Store([...node.dataset.match(node.term)]));
}
function date(term: Term): Literal {
  if (
    term.termType !== "Literal" ||
    ![`${XSD}date`, `${XSD}dateTime`].includes(term.datatype.value) ||
    temporalTime(term) === undefined
  )
    throw new Skip("InvalidFact");
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
function readSource(term: Term, dataset: DatasetCore, model: string): Source | undefined {
  try {
    const node = new ReadNode(iri(term), dataset);
    validate(node);
    // Assistant exports may repeat source names and creation dates. Keep the first
    // name in code-point order and the earliest date, so output is deterministic.
    const names = terms(node, schema("name")).map(string);
    if (!names.length) return undefined;
    // An explicitly empty title is kept only when no non-empty title exists.
    const title = (names.filter(Boolean).sort(codePointOrder)[0] ?? "") as string;
    let earliest: { literal: Literal; time: number } | undefined;
    for (const value of terms(node, schema("dateCreated"))) {
      const literal = sourceDate(value);
      const time = temporalTime(literal) as number;
      if (!earliest || time < earliest.time) earliest = { literal, time };
    }
    if (!earliest) return undefined;
    const isDate = earliest.literal.datatype.value === `${XSD}date`;
    return {
      id: node.value,
      url: node.value,
      kind: "document",
      title,
      // A calendar date stays a date; never invent a time of day for it.
      ...(isDate
        ? { date: earliest.literal.value }
        : { created: new Date(earliest.time).toISOString() }),
      model,
    };
  } catch {
    return undefined;
  }
}
/** Source dates are provenance metadata: sub-millisecond digits are truncated. */
function sourceDate(term: Term): Literal {
  if (
    term.termType !== "Literal" ||
    ![`${XSD}date`, `${XSD}dateTime`].includes(term.datatype.value) ||
    temporalTime(term) === undefined
  )
    throw new Skip("InvalidSource");
  return term;
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
      q.predicate.value === `${H}patient` ||
      schema("about").includes(q.predicate.value) ||
      (q.predicate.value === RDF_TYPE &&
        q.object.termType === "NamedNode" &&
        factTypes.has(q.object.value))
    )
      ids.set(`${q.subject.termType}:${q.subject.value}`, q.subject);
  }
  const sources = new Map<string, Source>();
  for (const term of [...sourceTerms.values()].sort((a, b) => a.value.localeCompare(b.value))) {
    const source = readSource(term, dataset, config.assistant.label);
    if (source) sources.set(source.id, source);
  }
  const claims: Claim[] = [];
  const reasons: Record<string, number> = {};
  for (const term of [...ids.values()].sort((a, b) => a.value.localeCompare(b.value))) {
    try {
      iri(term);
      const node = new ReadNode(term, dataset);
      const owners = terms(node, [`${H}patient`, ...schema("about")]);
      if (
        !owners.length ||
        owners.some((t) => t.termType !== "NamedNode" || t.value !== config.owner)
      )
        throw new Skip("OtherSubject");
      validate(node);
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
      // A quote must stay exact, so an over-long quote is dropped rather than cut.
      // The fact is kept when at least one usable quote remains.
      const quotes = terms(node, [`${OA}exact`])
        .map(string)
        .filter((q) => q && [...q].length <= 300);
      if (!derived.length || !quotes.length) throw new Skip("InvalidEvidence");
      const factSources = derived.map((target): Source => {
        const source = sources.get(iri(target));
        if (!source) throw new Skip("InvalidSource");
        return source;
      });
      const graph = assertion(node, [...kinds][0] as string, config.owner);
      canonicalizeAssertion(graph);
      claims.push({
        id: pkgId("assistant-health-fact", node.value),
        assertion: graph,
        epistemic,
        validity: validityToken === "Past" ? "Historical" : "Current",
        attributed_to: config.assistant.iri,
        categories: ["pd:MedicalHealth"],
        evidence: factSources.flatMap((source) =>
          quotes.map((quote) => ({ source: source.id, quote })),
        ),
      });
    } catch (error) {
      const reason = error instanceof Skip ? error.reason : "InvalidFact";
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
  }
  try {
    const value = await buildNanopublications(
      {
        batch_id: config.batchId,
        worker: { agent_id: config.assistant.iri, agent_label: config.assistant.label },
        sources: [...sources.values()],
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
    for (const source of sources.values())
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
            hasSelector: selector,
          }),
          entities.AssistantQuoteSelector.build(selector, { exact: evidence.quote }),
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
