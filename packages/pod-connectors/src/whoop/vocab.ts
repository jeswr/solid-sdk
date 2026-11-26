// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { NS } from "@jeswr/suite-vocab";
import { LiteralAs, LiteralFrom, OptionalAs, OptionalFrom } from "@rdfjs/wrapper";
import { ActionThing } from "../core/vocab.js";

/** Reconciliation marker for one WHOOP source record (`schema:Dataset`).
 * It carries only source bookkeeping (dct:source and the record's schema.org
 * window); no health terms. Health observations are written exclusively by the
 * generated `@jeswr/solid-health` model.
 */
export class RecordMarker extends ActionThing {
  get source(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.DCT}source`, LiteralAs.string);
  }
  set source(value: string | undefined) {
    OptionalAs.object(this, `${NS.DCT}source`, value, LiteralFrom.string);
  }
  get endTime(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.SCHEMA}endTime`, LiteralAs.date);
  }
  set endTime(value: Date | undefined) {
    OptionalAs.object(this, `${NS.SCHEMA}endTime`, value, LiteralFrom.dateTime);
  }
}
