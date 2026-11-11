// AUTHORED-BY Codex GPT-6.1-Sol
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
} from "@rdfjs/wrapper";
import { DigitalDocument, ExerciseAction, PodThing, SCHEMA } from "../core/vocab.js";
import { FitDay } from "../google-takeout/vocab.js";

/** Same ExerciseAction/TravelAction and additionalProperty metrics as file imports. */
export class ActivityResource extends FitDay {
  get end(): Date | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}endTime`, LiteralAs.date);
  }
  set end(v: Date | undefined) {
    OptionalAs.object(this, `${SCHEMA}endTime`, v, LiteralFrom.dateTime);
  }
  set creator(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}creator`, v, LiteralFrom.string);
  }
  set track(v: string) {
    OptionalAs.object(this, `${SCHEMA}subjectOf`, v, NamedNodeFrom.string);
  }
  get originals(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SCHEMA}encoding`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}
export class TrackResource extends DigitalDocument {
  get count(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}numberOfItems`, LiteralAs.number);
  }
  set count(v: number | undefined) {
    OptionalAs.object(this, `${SCHEMA}numberOfItems`, v, LiteralFrom.integer);
  }
  set line(v: string) {
    OptionalAs.object(this, `${SCHEMA}line`, v, LiteralFrom.string);
  }
  get samples(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}text`, LiteralAs.string);
  }
  set samples(v: string) {
    OptionalAs.object(this, `${SCHEMA}text`, v, LiteralFrom.string);
  }
}
export class ActivityIndexEntry extends ExerciseAction {
  get target(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}mainEntity`, NamedNodeAs.string);
  }
  set target(v: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}mainEntity`, v, NamedNodeFrom.string);
  }
}

export const ACTIVITY_CLASSES = {
  GeoShape: `${SCHEMA}GeoShape`,
  PropertyValue: `${SCHEMA}PropertyValue`,
} as const;

export class MetricValue extends PodThing {
  get measurement(): number | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}value`, LiteralAs.number);
  }
}
