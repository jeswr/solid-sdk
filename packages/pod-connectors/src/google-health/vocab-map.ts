// AUTHORED-BY Codex GPT-6.1-Sol
import { LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, SetFrom } from "@rdfjs/wrapper";
import { ExerciseAction, SCHEMA } from "../core/vocab.js";
import { createVocabMap } from "../core/vocab-map.js";
import { FitMetric } from "../google-takeout/vocab.js";

export const HEALTH_VOCAB = {
  PropertyValue: `${SCHEMA}PropertyValue`,
  startTime: `${SCHEMA}startTime`,
} as const;

/** Retain the Fitbit schema.org exercise model; measurements use existing Fit properties. */
export const vocabMap = createVocabMap({});
export class HealthAction extends ExerciseAction {
  set end(value: Date) {
    OptionalAs.object(this, `${SCHEMA}endTime`, value, LiteralFrom.dateTime);
  }
  get parts(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SCHEMA}hasPart`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get metrics(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SCHEMA}additionalProperty`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}
export class HealthMetric extends FitMetric {
  set time(value: Date) {
    OptionalAs.object(this, `${SCHEMA}dateMeasured`, value, LiteralFrom.dateTime);
  }
}
