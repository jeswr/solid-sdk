// AUTHORED-BY Codex GPT-6.1-Sol

import { NS } from "@jeswr/suite-vocab";
import type { Term } from "@rdfjs/types";
import {
  DatasetWrapper,
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
} from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { HealthTerm } from "./canonical-vocab.js";
import { Details } from "./metrics.js";
import type { HealthDocument } from "./model.js";

export class ExerciseAction extends HealthTerm {
  get start(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.SCHEMA}startTime`, LiteralAs.string);
  }
  get end(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.SCHEMA}endTime`, LiteralAs.string);
  }
  get activity(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.SCHEMA}exerciseType`, LiteralAs.string);
  }
  get distance(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.SCHEMA}distance`, LiteralAs.string);
  }
}
class ConnectorDocument extends DatasetWrapper {
  get workouts(): Iterable<ExerciseAction> {
    return this.instancesOf(`${NS.SCHEMA}ExerciseAction`, ExerciseAction);
  }
}
export class WorkoutFile extends HealthTerm {
  get gpx(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.SCHEMA}encoding`, NamedNodeAs.string);
  }
  set gpx(value: string | undefined) {
    OptionalAs.object(this, `${NS.SCHEMA}encoding`, value, NamedNodeFrom.string);
  }
  get format(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${NS.SCHEMA}encodingFormat`, LiteralAs.string);
  }
  set format(value: string | undefined) {
    OptionalAs.object(this, `${NS.SCHEMA}encodingFormat`, value, LiteralFrom.string);
  }
}
export interface WorkoutSummary {
  iri: string;
  name: string | undefined;
  activity: string | undefined;
  start: Date | undefined;
  end: Date | undefined;
  distance: number | string | undefined;
  gpx: string | undefined;
  source: string | undefined;
}
/** Read both the existing GPX model and PM's ExerciseAction connector output. */
export function workouts(document: HealthDocument): WorkoutSummary[] {
  const local = [...document.workouts].map((workout) => ({
    iri: workout.value,
    name: new Details(workout as Term, document, DataFactory).name,
    activity: workout.activityType,
    start: workout.startTime,
    end: workout.endTime,
    distance: workout.distance,
    gpx: new WorkoutFile(workout as Term, document, DataFactory).gpx,
    source: new Details(workout as Term, document, DataFactory).source,
  }));
  const connector = new ConnectorDocument(document, DataFactory);
  const result: WorkoutSummary[] = [...local];
  for (const workout of connector.workouts) {
    if (result.some((entry) => entry.iri === workout.value)) continue;
    result.push({
      iri: workout.value,
      name: new Details(workout as Term, document, DataFactory).name,
      activity: workout.activity,
      start: date(workout.start),
      end: date(workout.end),
      distance: workout.distance,
      gpx: new WorkoutFile(workout as Term, document, DataFactory).gpx,
      source: new Details(workout as Term, document, DataFactory).source,
    });
  }
  return result;
}
function date(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;
  const result = new Date(value);
  return Number.isFinite(result.getTime()) ? result : undefined;
}
