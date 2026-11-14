// AUTHORED-BY Codex GPT-6
/** Presentation metadata only. Labels never identify a party for a security decision. */
import { isSafeAbsoluteIri } from "@jeswr/model-runtime";
import { LiteralFrom, RequiredAs } from "@rdfjs/wrapper";
import { Resource } from "@solid/object";
import { DataFactory } from "n3";
import type { Namer } from "../trace/packet.js";
import type { TraceEventInput, TraceRef } from "../trace/types.js";
import { vocabularyDataset } from "../wire/vocabulary.js";

const LABEL = "http://www.w3.org/2000/01/rdf-schema#label";
const IRI_IN_TEXT = /(?:https?:\/\/|urn:|did:)[^\s<>"'\\()[\]{},;]+/g;

/** A per-run RDF label index, using the SDK's standard Resource.label accessor. */
export class LabelIndex {
  private readonly dataset = vocabularyDataset();

  add(iri: string, label: string): void {
    if (!isSafeAbsoluteIri(iri) || !label.trim() || /https?:\/\/|urn:|did:/i.test(label)) return;
    const node = new Resource(iri, this.dataset, DataFactory);
    if (node.label === undefined) RequiredAs.object(node, LABEL, label, LiteralFrom.string);
  }

  get(iri: string): string | undefined {
    if (!isSafeAbsoluteIri(iri)) return undefined;
    return new Resource(iri, this.dataset, DataFactory).label;
  }

  readonly name: Namer = (iri) =>
    iri === undefined ? "anonymous" : (this.get(iri) ?? "the unlabelled resource");

  /** Render identifiers in generated annotations and retain their exact values as refs. */
  annotations(event: TraceEventInput, meaningSuite: string): TraceEventInput {
    if (event.packet) this.add(event.packet.id, `${event.packet.kind} message`);
    if (event.fact) this.add(event.fact.id, event.fact.label);
    const identifiers = new Set<string>();
    const render = (text: string) =>
      text.replace(IRI_IN_TEXT, (matched) => {
        let iri = matched;
        let punctuation = "";
        while (!this.get(iri) && /[.:]$/.test(iri)) {
          punctuation = iri.slice(-1) + punctuation;
          iri = iri.slice(0, -1);
        }
        identifiers.add(iri);
        return this.name(iri) + punctuation;
      });
    const plainWords = (text: string) =>
      text
        .replace(/\b[A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z][A-Za-z0-9_-]*)+\b/g, (token) =>
          token.replace(/[._-]/g, " "),
        )
        .replace(/([a-z])([A-Z])/g, "$1 $2");
    const caption = plainWords(render(event.caption));
    const rule = event.rule
      ? { ...event.rule, text: plainWords(render(event.rule.text)) }
      : undefined;
    const refs: TraceRef[] = [...(event.refs ?? [])];
    for (const id of identifiers)
      if (!refs.some((ref) => ref.id === id))
        refs.push({ layer: "meaning", suite: meaningSuite, id });
    // Exact original content and exact-action review remain untouched in chat.text.
    return { ...event, caption, ...(rule ? { rule } : {}), ...(refs.length ? { refs } : {}) };
  }
}

const bundled = new LabelIndex();
export function vocabularyLabel(iri: string): string | undefined {
  return bundled.get(iri);
}
