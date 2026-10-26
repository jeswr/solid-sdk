// AUTHORED-BY Codex GPT-6.1-Sol
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
} from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { FEDERATION, FEDERATION_PROPERTIES } from "./federation-vocab.js";
import type { VocabMap } from "./types.js";
import { Message, PodThing, safeIri } from "./vocab.js";
import { createVocabMap } from "./vocab-map.js";

/** Required sector properties, written through the same typed RDF seam as legacy data. */
export class SectorThing extends PodThing {
  get title(): string | undefined {
    return OptionalFrom.subjectPredicate(this, FEDERATION_PROPERTIES.title, LiteralAs.string);
  }
  set title(value: string | undefined) {
    OptionalAs.object(this, FEDERATION_PROPERTIES.title, value, LiteralFrom.string);
  }
  get content(): string | undefined {
    return OptionalFrom.subjectPredicate(this, FEDERATION_PROPERTIES.content, LiteralAs.string);
  }
  set content(value: string | undefined) {
    OptionalAs.object(this, FEDERATION_PROPERTIES.content, value, LiteralFrom.string);
  }
  get about(): string | undefined {
    return OptionalFrom.subjectPredicate(this, FEDERATION_PROPERTIES.about, NamedNodeAs.string);
  }
  set about(value: string | undefined) {
    OptionalAs.object(this, FEDERATION_PROPERTIES.about, safeIri(value), NamedNodeFrom.string);
  }
  get dataSubject(): string | undefined {
    return OptionalFrom.subjectPredicate(this, FEDERATION_PROPERTIES.subject, NamedNodeAs.string);
  }
  set dataSubject(value: string | undefined) {
    OptionalAs.object(this, FEDERATION_PROPERTIES.subject, safeIri(value), NamedNodeFrom.string);
  }
}

/** Complete the sector types added by Tier C without changing source fields. */
export function createFileVocabMap(types: Readonly<Record<string, string>>): VocabMap {
  const mapTypes = createVocabMap(types);
  return (doc, context) => {
    const mapped = mapTypes(doc);
    const dataset = mapped.dataset;
    const subjects = new Set(
      [...doc.dataset]
        .filter((q) => q.subject.termType === "NamedNode")
        .map((q) => q.subject.value),
    );
    for (const subject of subjects) {
      const item = new SectorThing(subject, dataset, DataFactory);
      if (item.types.has(FEDERATION.CreativeWork)) item.title = item.name ?? "";
      if (item.types.has(FEDERATION.Note))
        item.content = new Message(subject, dataset, DataFactory).text ?? "";
      if (item.types.has(FEDERATION.TransactionRecord)) {
        const webId = context?.webId;
        if (!webId || !safeIri(webId) || !URL.canParse(webId))
          throw new Error(
            "Financial file imports require the importing user's WebID on PodWriter.",
          );
        item.dataSubject = webId;
        new PodThing(webId, dataset, DataFactory).types.add(FEDERATION.Agent);
        // A statement line documents an activity distinct from the record. The
        // source may omit currency, amount or posting time, so do not assert the
        // more specific fin:Transaction contract or invent those missing facts.
        item.about = `${subject}-activity`;
        new PodThing(item.about, dataset, DataFactory).types.add(FEDERATION.Activity);
      }
    }
    return mapped;
  };
}
