// AUTHORED-BY Codex GPT-6.1-Sol
import { isSafeAbsoluteIri, readLiteral, subjectIri } from "@jeswr/model-runtime";
import { NS } from "@jeswr/suite-vocab";
import type { DatasetCore } from "@rdfjs/types";
import { DataFactory, Store } from "n3";
import { entities, type ObservationData as GeneratedData, nodes } from "./generated/model.js";
import { code } from "./helpers.js";
import { focusDataset } from "./identity.js";
import { HEALTH, UNITS } from "./vocab.js";

export { code, loincCode, monthlyDocumentPath } from "./helpers.js";
export { CODE_SCHEMES, HEALTH, UNITS } from "./vocab.js";
// These are generated constructors, never handwritten accessor subclasses.
export const HealthObservation = nodes.Observation.observation.Wrapper;
export const HealthCode = nodes.Observation.code.Wrapper;
export const HealthInstant = nodes.Observation.instant.Wrapper;
export const HealthPatient = nodes.Observation.patient.Wrapper;
export type HealthObservation = InstanceType<typeof HealthObservation>;
export type HealthCode = InstanceType<typeof HealthCode>;
export type HealthInstant = InstanceType<typeof HealthInstant>;
export type HealthPatient = InstanceType<typeof HealthPatient>;
export const MAX_OBSERVATION_QUADS = 100_000;
export const MAX_OBSERVATIONS = 5_000;
export type ObservationType =
  | typeof HEALTH.Observation
  | typeof HEALTH.HeartRate
  | typeof HEALTH.Steps
  | typeof HEALTH.Sleep;
export interface ObservationData extends Omit<GeneratedData, "dateTime"> {
  dateTime: string | Date;
  type?: ObservationType;
}
export interface ParsedObservation extends GeneratedData {
  id: string;
}
const nn = DataFactory.namedNode;
const timezone = /(?:Z|[+-]\d{2}:\d{2})$/;
function parseAt(id: string, dataset: DatasetCore): GeneratedData | undefined {
  if (!isSafeAbsoluteIri(id)) return undefined;
  const observation = new HealthObservation(id, dataset, DataFactory);
  if (observation.patient === id || observation.patient !== `${id.split("#")[0]}#subject`)
    return undefined;
  for (const [type, entity] of [
    [HEALTH.HeartRate, entities.HeartRate],
    [HEALTH.Steps, entities.Steps],
    [HEALTH.Sleep, entities.Sleep],
  ] as const) {
    if (observation.types.has(type) && !entity.parse(id, dataset)) return undefined;
  }
  const timestamp = dataset.match(nn(observation.time ?? ""), nn(`${NS.TIME}inXSDDateTimeStamp`));
  for (const quad of timestamp) if (!timezone.test(quad.object.value)) return undefined;
  return entities.Observation.parse(
    id,
    focusDataset(dataset, entities.Observation.subject(id), id),
  );
}
/** Build one observation at an explicit, document-local fragment; validate every
 * generated MUST before returning. Code/time IDs preserve existing connector RDF.
 */
export function buildObservation(id: string, data: ObservationData): Store {
  subjectIri(id);
  if (!id.includes("#") || !id.split("#")[1])
    throw new TypeError("Observation requires a document fragment");
  const lexical = data.dateTime instanceof Date ? data.dateTime.toISOString() : data.dateTime;
  if (!timezone.test(lexical))
    throw new TypeError("Observation time requires an explicit timezone");
  if (!(readLiteral(DataFactory.literal(lexical, nn(`${NS.XSD}dateTime`))) instanceof Date))
    throw new TypeError("Invalid observation time");
  const store = new Store();
  const observation = new HealthObservation(id, store, DataFactory).mark();
  const type = data.type ?? HEALTH.Observation;
  if (![HEALTH.Observation, HEALTH.HeartRate, HEALTH.Steps, HEALTH.Sleep].includes(type))
    throw new TypeError("Unknown observation type");
  observation.types.add(HEALTH.ClinicalEntry);
  observation.types.add(type);
  if (type === HEALTH.HeartRate) observation.types.add(HEALTH.VitalSign);
  observation.measuredValue = data.measuredValue;
  observation.unit =
    data.unit ??
    (type === HEALTH.HeartRate
      ? UNITS.pulse
      : type === HEALTH.Steps
        ? UNITS.count
        : type === HEALTH.Sleep
          ? UNITS.seconds
          : undefined);
  observation.unitCode = data.unitCode;
  observation.name = data.name;
  observation.description = data.description;
  observation.source = data.source;
  observation.code = `${id}-code`;
  observation.time = `${id}-time`;
  observation.patient = `${id.split("#")[0]}#subject`;
  const concept = new HealthCode(observation.code, store, DataFactory).mark();
  concept.codeValue = data.codeValue;
  concept.display = data.display;
  concept.scheme = code(data.codeValue, data.display, data.scheme).scheme;
  const instant = new HealthInstant(observation.time, store, DataFactory).mark();
  instant.types.add(HEALTH.TemporalEntity);
  instant.dateTime = new Date(lexical);
  new nodes.Observation.patient.Wrapper(observation.patient, store, DataFactory).mark();
  if (!parseAt(id, store) || (data.unit !== undefined && observation.unit !== data.unit))
    throw new TypeError("Invalid health observation");
  return store;
}
/** Bounded reads fail closed on oversized documents. Each candidate is validated
 * by the generated composite against unchanged raw RDF terms and linked classes.
 */
export function parseObservations(
  dataset: DatasetCore,
  maxObservations = MAX_OBSERVATIONS,
): ParsedObservation[] {
  if (
    !Number.isSafeInteger(maxObservations) ||
    maxObservations < 1 ||
    maxObservations > MAX_OBSERVATIONS
  )
    throw new RangeError("Invalid observation limit");
  if (dataset.size > MAX_OBSERVATION_QUADS)
    throw new RangeError("Health document quad budget exceeded");
  const result: ParsedObservation[] = [];
  let candidates = 0;
  for (const quad of dataset.match(null, nn(`${NS.RDF}type`), nn(HEALTH.Observation))) {
    if (++candidates > maxObservations) throw new RangeError("Health observation budget exceeded");
    if (quad.subject.termType !== "NamedNode") continue;
    const data = parseAt(quad.subject.value, dataset);
    if (data) result.push({ id: quad.subject.value, ...data });
  }
  return result;
}
