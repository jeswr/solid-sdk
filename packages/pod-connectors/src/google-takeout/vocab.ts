// AUTHORED-BY Codex GPT-6.1-Sol
import { LiteralFrom, NamedNodeAs, NamedNodeFrom, OptionalAs, SetFrom } from "@rdfjs/wrapper";
import { ExerciseAction, PodThing, SCHEMA } from "../core/vocab.js";

export class PlaceVisit extends PodThing {
  set address(value: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}address`, value, LiteralFrom.string);
  }
  set latitude(value: number | undefined) {
    OptionalAs.object(this, `${SCHEMA}latitude`, value, LiteralFrom.double);
  }
  set longitude(value: number | undefined) {
    OptionalAs.object(this, `${SCHEMA}longitude`, value, LiteralFrom.double);
  }
  set start(value: Date | undefined) {
    OptionalAs.object(this, `${SCHEMA}startTime`, value, LiteralFrom.dateTime);
  }
  set end(value: Date | undefined) {
    OptionalAs.object(this, `${SCHEMA}endTime`, value, LiteralFrom.dateTime);
  }
}
export class FitDay extends ExerciseAction {
  get metrics(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SCHEMA}additionalProperty`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
}
export class FitMetric extends PodThing {
  set measurement(value: number) {
    OptionalAs.object(this, `${SCHEMA}value`, value, LiteralFrom.double);
  }
  set unit(value: string) {
    OptionalAs.object(this, `${SCHEMA}unitText`, value, LiteralFrom.string);
  }
}
