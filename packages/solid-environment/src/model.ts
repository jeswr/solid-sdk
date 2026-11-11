// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6

import type { DatasetCore } from "@rdfjs/types";
import { OptionalFrom } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import { entities, nodes } from "./generated/model.js";
import { httpIri, isoTime, validateReading } from "./policy.js";
import { type ObservableProperty, type ObservationUnit, SOSA_RESULT_TIME } from "./vocab.js";

export interface ObservationInput {
  sensor: string;
  property: ObservableProperty;
  featureOfInterest: string;
  resultTime: string | Date;
  value: number;
  unit: ObservationUnit;
}
export interface Observation extends Omit<ObservationInput, "resultTime"> {
  iri: string;
  resultTime: string;
}
export interface SensorInput {
  label: string;
  manufacturer?: string;
  model?: string;
  isHostedBy?: string;
}

/** Generated per-node views support many independently named roots in one Store. */
export function buildObservation(iri: string, input: ObservationInput): Store {
  httpIri(iri);
  validateReading(input.property, input.unit, input.value);
  const store = new Store();
  const observation = new nodes.Observation.observation.Wrapper(iri, store, DataFactory);
  observation.mark();
  observation.madeBySensor = httpIri(input.sensor);
  observation.observedProperty = input.property;
  observation.hasFeatureOfInterest = httpIri(input.featureOfInterest);
  observation.resultTime = new Date(isoTime(input.resultTime));
  observation.hasResult = `${iri}${iri.includes("#") ? "--result" : "#result"}`;
  const result = new nodes.Observation.result.Wrapper(observation.hasResult, store, DataFactory);
  result.mark();
  result.numericValue = input.value;
  result.unit = input.unit;
  if (!readObservation(iri, store))
    throw new TypeError("Observation does not satisfy the generated model");
  return store;
}

/** All RDF field/cardinality/datatype/enum reads use generated guarded accessors. */
export function readObservation(iri: string, dataset: DatasetCore): Observation | undefined {
  try {
    const observation = new nodes.Observation.observation.Wrapper(
      httpIri(iri),
      dataset,
      DataFactory,
    );
    if (!observation.isInstance) return undefined;
    const {
      madeBySensor: sensor,
      observedProperty: property,
      hasFeatureOfInterest: featureOfInterest,
      resultTime,
      hasResult,
    } = observation;
    if (
      sensor === undefined ||
      property === undefined ||
      featureOfInterest === undefined ||
      resultTime === undefined ||
      hasResult === undefined
    )
      return undefined;
    const result = new nodes.Observation.result.Wrapper(httpIri(hasResult), dataset, DataFactory);
    const { numericValue: value, unit } = result;
    if (!result.isInstance || value === undefined || unit === undefined) return undefined;
    validateReading(property, unit, value);
    return {
      iri,
      sensor: httpIri(sensor),
      property,
      featureOfInterest: httpIri(featureOfInterest),
      resultTime: isoTime(
        OptionalFrom.subjectPredicate(observation, SOSA_RESULT_TIME, (term) => term.value) ?? "",
      ),
      value,
      unit,
    };
  } catch {
    return undefined;
  }
}

export function buildSensor(iri: string, input: SensorInput): Store {
  const store = new Store();
  const sensor = new nodes.Sensor.sensor.Wrapper(httpIri(iri), store, DataFactory);
  sensor.mark();
  sensor.label = input.label;
  sensor.manufacturer = input.manufacturer;
  sensor.model = input.model;
  if (input.isHostedBy !== undefined) {
    sensor.isHostedBy = httpIri(input.isHostedBy);
    new nodes.Sensor.platform.Wrapper(sensor.isHostedBy, store, DataFactory).mark();
  }
  const parsed = parseSensor(iri, store);
  if (
    !parsed ||
    (input.manufacturer !== undefined && parsed.manufacturer === undefined) ||
    (input.model !== undefined && parsed.model === undefined)
  ) {
    throw new TypeError("Sensor does not satisfy the generated model");
  }
  return store;
}
export function parseSensor(iri: string, dataset: DatasetCore): SensorInput | undefined {
  try {
    const sensor = new nodes.Sensor.sensor.Wrapper(httpIri(iri), dataset, DataFactory);
    const { label, manufacturer, model, isHostedBy } = sensor;
    if (!sensor.isInstance || label === undefined) return undefined;
    if (
      isHostedBy !== undefined &&
      !new nodes.Sensor.platform.Wrapper(httpIri(isHostedBy), dataset, DataFactory).isInstance
    )
      return undefined;
    return { label, manufacturer, model, isHostedBy };
  } catch {
    return undefined;
  }
}
export function buildRoom(iri: string, input: { label: string }): Store {
  const store = entities.Room.build(httpIri(iri), input);
  if (!entities.Room.parse(iri, store)) throw new TypeError("Room requires a nonblank label");
  return store;
}
export const storeToTurtle = (store: Store): Promise<string> =>
  entities.Observation.storeToTurtle(store);
