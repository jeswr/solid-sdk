// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { CATEGORY_SYSTEM, concept, METRIC_CODES, quantity } from "./codes";
import {
  type FhirBundle,
  FhirExportError,
  type FhirExportOptions,
  type FhirResource,
  type HealthRecords,
  type ObservationResource,
  type Subject,
} from "./types";
import {
  array,
  arrayLength,
  checkCount,
  date,
  id,
  numeric,
  patientReference,
  periodOrdered,
  record,
  requireValid,
  text,
  uuid,
} from "./validation";

function subject(patientUrl: string | undefined): Subject {
  return patientUrl === undefined ? { display: "Patient not supplied" } : { reference: patientUrl };
}

function observation(input: unknown, patientUrl: string | undefined): ObservationResource {
  const value = record(input, ["id", "metric", "value", "unit", "effective", "source"]);
  requireValid(
    id(value.id) && date(value.effective, false) && text(value.source, "Source: ".length),
    "INVALID_INPUT",
    "Invalid observation fields",
  );
  requireValid(
    typeof value.metric === "string" && Object.hasOwn(METRIC_CODES, value.metric),
    "UNSUPPORTED_METRIC",
    "Unsupported health metric",
  );
  const metric = value.metric as keyof typeof METRIC_CODES;
  const mapping = METRIC_CODES[metric];
  requireValid(
    value.unit === mapping.unit,
    "UNIT_MISMATCH",
    "Convert the value to the required UCUM unit first",
  );
  const resource: ObservationResource = {
    resourceType: "Observation",
    id: value.id,
    status: "final",
    category: [concept(mapping.category, CATEGORY_SYSTEM)],
    code: concept(mapping.code),
    ...(patientUrl === undefined ? {} : { subject: subject(patientUrl) }),
    effectiveDateTime: value.effective,
    note: [{ text: `Source: ${value.source}` }],
  };
  if (metric === "bloodPressure") {
    const pressure = record(value.value, ["systolic", "diastolic"]);
    requireValid(
      numeric(pressure.systolic) && numeric(pressure.diastolic),
      "INVALID_INPUT",
      "Invalid blood pressure values",
    );
    resource.component = [
      { code: concept("8480-6"), valueQuantity: quantity(pressure.systolic, mapping.unit) },
      { code: concept("8462-4"), valueQuantity: quantity(pressure.diastolic, mapping.unit) },
    ];
  } else {
    requireValid(numeric(value.value), "INVALID_INPUT", "Invalid observation value");
    resource.valueQuantity = quantity(value.value, mapping.unit);
  }
  return resource;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : Number(a > b);
}

function effective(resource: FhirResource): string {
  if (resource.resourceType === "Observation") return resource.effectiveDateTime;
  if (resource.resourceType === "MedicationStatement") return resource.effectivePeriod.start;
  return resource.onsetDateTime;
}

/** Build fresh JSON data. All records validate before clock/UUID callbacks run. */
export function buildFhirBundle(input: HealthRecords, options: FhirExportOptions): FhirBundle {
  const data = record(input, ["observations", "medications", "conditions"]);
  const observationCount = arrayLength(data.observations, "INVALID_INPUT");
  const medicationCount = arrayLength(data.medications, "INVALID_INPUT");
  const conditionCount = arrayLength(data.conditions, "INVALID_INPUT");
  checkCount(observationCount + medicationCount + conditionCount);
  const injected = record(options, ["uuid", "clock"], ["patientReference"], "INVALID_OPTIONS");
  requireValid(
    typeof injected.uuid === "function" && typeof injected.clock === "function",
    "INVALID_OPTIONS",
    "Clock and UUID generator are required",
  );
  requireValid(
    !Object.hasOwn(injected, "patientReference") || patientReference(injected.patientReference),
    "INVALID_OPTIONS",
    "Expected an absolute HTTP(S) Patient reference",
  );
  const patientUrl = injected.patientReference as string | undefined;
  const observations = array(data.observations, "INVALID_INPUT", observationCount);
  const medications = array(data.medications, "INVALID_INPUT", medicationCount);
  const conditions = array(data.conditions, "INVALID_INPUT", conditionCount);
  const resources: FhirResource[] = [];
  for (const value of observations) resources.push(observation(value, patientUrl));
  for (const item of medications) {
    const value = record(item, ["id", "name", "dosageText", "start"], ["end"]);
    requireValid(
      id(value.id) && text(value.name) && text(value.dosageText) && date(value.start),
      "INVALID_INPUT",
      "Invalid medication fields",
    );
    const effectivePeriod: { start: string; end?: string } = { start: value.start };
    if (Object.hasOwn(value, "end")) {
      requireValid(
        date(value.end) && periodOrdered(value.start, value.end),
        "INVALID_INPUT",
        "Invalid medication end date",
      );
      effectivePeriod.end = value.end;
    }
    resources.push({
      resourceType: "MedicationStatement",
      id: value.id,
      status: "unknown",
      medicationCodeableConcept: { text: value.name },
      subject: subject(patientUrl),
      effectivePeriod,
      dosage: [{ text: value.dosageText }],
    });
  }
  for (const item of conditions) {
    const value = record(item, ["id", "name", "onset"]);
    requireValid(
      id(value.id) && text(value.name) && date(value.onset),
      "INVALID_INPUT",
      "Invalid condition fields",
    );
    resources.push({
      resourceType: "Condition",
      id: value.id,
      code: { text: value.name },
      subject: subject(patientUrl),
      onsetDateTime: value.onset,
    });
  }
  const ids = new Set<string>();
  for (const resource of resources) {
    const key = `${resource.resourceType}/${resource.id}`;
    requireValid(!ids.has(key), "INVALID_INPUT", "Duplicate resource ID within a kind");
    ids.add(key);
  }
  resources.sort(
    (a, b) =>
      compare(a.resourceType, b.resourceType) ||
      Date.parse(effective(a)) - Date.parse(effective(b)) ||
      compare(a.id, b.id),
  );
  let timestamp: string;
  try {
    const now: unknown = injected.clock();
    requireValid(now instanceof Date, "INVALID_OPTIONS", "Clock must return a Date");
    // Format the Date value itself, without invoking callback-supplied methods.
    timestamp = Date.prototype.toISOString.call(now);
  } catch {
    throw new FhirExportError("INVALID_OPTIONS", "Clock must return a valid Date");
  }
  requireValid(date(timestamp, false), "INVALID_OPTIONS", "Clock is outside the FHIR date range");
  const urls = new Set<string>();
  const entry = resources.map((resource) => {
    let generated: unknown;
    try {
      generated = injected.uuid();
    } catch {
      throw new FhirExportError("INVALID_OPTIONS", "UUID generator failed");
    }
    requireValid(uuid(generated), "INVALID_OPTIONS", "UUID generator must return a UUID");
    const fullUrl = `urn:uuid:${generated.toLowerCase()}`;
    requireValid(!urls.has(fullUrl), "INVALID_OPTIONS", "UUID generator returned a duplicate");
    urls.add(fullUrl);
    return { fullUrl, resource };
  });
  return {
    resourceType: "Bundle",
    type: "collection",
    timestamp,
    ...(entry.length === 0 ? {} : { entry }),
  };
}

/** Stable key order comes from the explicit resource builders, never input key order. */
export function serialiseFhirBundle(input: HealthRecords, options: FhirExportOptions): string {
  return JSON.stringify(buildFhirBundle(input, options));
}
