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
  checkCount,
  date,
  id,
  numeric,
  record,
  requireValid,
  text,
  uuid,
} from "./validation";

function subject(patientId: string | undefined): Subject {
  return patientId === undefined
    ? { display: "Patient not supplied" }
    : { reference: `Patient/${patientId}` };
}

function observation(value: unknown, patientId: string | undefined): ObservationResource {
  record(value, ["id", "metric", "value", "unit", "effective", "source"]);
  requireValid(
    id(value.id) && date(value.effective, false) && text(value.source),
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
    ...(patientId === undefined ? {} : { subject: subject(patientId) }),
    effectiveDateTime: value.effective,
    note: [{ text: `Source: ${value.source}` }],
  };
  if (metric === "bloodPressure") {
    record(value.value, ["systolic", "diastolic"]);
    requireValid(
      numeric(value.value.systolic) && numeric(value.value.diastolic),
      "INVALID_INPUT",
      "Invalid blood pressure values",
    );
    resource.component = [
      { code: concept("8480-6"), valueQuantity: quantity(value.value.systolic, mapping.unit) },
      { code: concept("8462-4"), valueQuantity: quantity(value.value.diastolic, mapping.unit) },
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
  record(input, ["observations", "medications", "conditions"]);
  requireValid(
    Array.isArray(input.observations) &&
      Array.isArray(input.medications) &&
      Array.isArray(input.conditions),
    "INVALID_INPUT",
    "Expected record arrays",
  );
  checkCount(input.observations.length + input.medications.length + input.conditions.length);
  record(options, ["uuid", "clock"], ["patientId"], "INVALID_OPTIONS");
  requireValid(
    typeof options.uuid === "function" && typeof options.clock === "function",
    "INVALID_OPTIONS",
    "Clock and UUID generator are required",
  );
  requireValid(
    !Object.hasOwn(options, "patientId") || id(options.patientId),
    "INVALID_OPTIONS",
    "Expected a FHIR patient logical ID",
  );
  for (const values of [input.observations, input.medications, input.conditions])
    array(values, "INVALID_INPUT");
  const resources: FhirResource[] = [];
  for (const value of input.observations) resources.push(observation(value, options.patientId));
  for (const value of input.medications) {
    record(value, ["id", "name", "dosageText", "start"], ["end"]);
    requireValid(
      id(value.id) && text(value.name) && text(value.dosageText) && date(value.start),
      "INVALID_INPUT",
      "Invalid medication fields",
    );
    const effectivePeriod: { start: string; end?: string } = { start: value.start };
    if (Object.hasOwn(value, "end")) {
      requireValid(
        date(value.end) && Date.parse(value.end) >= Date.parse(value.start),
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
      subject: subject(options.patientId),
      effectivePeriod,
      dosage: [{ text: value.dosageText }],
    });
  }
  for (const value of input.conditions) {
    record(value, ["id", "name", "onset"]);
    requireValid(
      id(value.id) && text(value.name) && date(value.onset),
      "INVALID_INPUT",
      "Invalid condition fields",
    );
    resources.push({
      resourceType: "Condition",
      id: value.id,
      code: { text: value.name },
      subject: subject(options.patientId),
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
    const now: unknown = options.clock();
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
      generated = options.uuid();
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
