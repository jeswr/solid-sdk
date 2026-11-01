// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { CATEGORY_SYSTEM, LOINC_SYSTEM, METRIC_CODES, UCUM_SYSTEM } from "./codes";
import type {
  CodedConcept,
  FhirBundle,
  FhirResource,
  ObservationResource,
  Quantity,
  Subject,
} from "./types";
import {
  array,
  date,
  id,
  markdown,
  numeric,
  patientReference,
  periodOrdered,
  record,
  requireValid,
  text,
  uuid,
} from "./validation";

function valid(condition: boolean): asserts condition {
  requireValid(condition, "INVALID_BUNDLE", "Invalid FHIR bundle structure");
}

function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  return record(value, required, optional, "INVALID_BUNDLE");
}

function coding(input: unknown, system: string): CodedConcept {
  const value = fields(input, ["coding"]);
  const items = array(value.coding, "INVALID_BUNDLE");
  valid(items.length === 1);
  const item = fields(items[0], ["system", "code"]);
  valid(item.system === system && typeof item.code === "string");
  return { coding: [{ system, code: item.code }] };
}

function quantity(input: unknown, unit: string): Quantity {
  const value = fields(input, ["value", "unit", "system", "code"]);
  valid(
    numeric(value.value) &&
      value.unit === unit &&
      value.system === UCUM_SYSTEM &&
      value.code === unit,
  );
  return { value: value.value, unit, system: UCUM_SYSTEM, code: unit };
}

function annotation(input: unknown, validateText = text): [{ text: string }] {
  const value = array(input, "INVALID_BUNDLE");
  valid(value.length === 1);
  const item = fields(value[0], ["text"]);
  valid(validateText(item.text));
  return [{ text: item.text }];
}

function subject(input: unknown): Subject {
  const value = fields(input, [], ["reference", "display"]);
  if (Object.hasOwn(value, "reference")) {
    valid(Object.keys(value).length === 1 && patientReference(value.reference));
    return { reference: value.reference };
  } else {
    valid(value.display === "Patient not supplied");
    return { display: value.display };
  }
}

function component(
  input: unknown,
  code: string,
  unit: string,
): { code: CodedConcept; valueQuantity: Quantity } {
  const value = fields(input, ["code", "valueQuantity"]);
  const concept = coding(value.code, LOINC_SYSTEM);
  valid(concept.coding[0].code === code);
  return { code: concept, valueQuantity: quantity(value.valueQuantity, unit) };
}

function observation(input: Record<string, unknown>, resourceId: string): ObservationResource {
  const value = fields(
    input,
    ["resourceType", "id", "status", "category", "code", "effectiveDateTime", "note"],
    ["subject", "valueQuantity", "component"],
  );
  valid(value.status === "final" && date(value.effectiveDateTime, false));
  const code = coding(value.code, LOINC_SYSTEM);
  const mapping = Object.values(METRIC_CODES).find((entry) => entry.code === code.coding[0].code);
  valid(mapping !== undefined);
  const category = array(value.category, "INVALID_BUNDLE");
  valid(category.length === 1);
  const categoryCode = coding(category[0], CATEGORY_SYSTEM);
  valid(categoryCode.coding[0].code === mapping.category);
  const resource: ObservationResource = {
    resourceType: "Observation",
    id: resourceId,
    status: value.status,
    category: [categoryCode],
    code,
    effectiveDateTime: value.effectiveDateTime,
    note: annotation(value.note, markdown),
  };
  if (mapping.code === "85354-9") {
    valid(!Object.hasOwn(value, "valueQuantity"));
    const components = array(value.component, "INVALID_BUNDLE");
    valid(components.length === 2);
    resource.component = [
      component(components[0], "8480-6", mapping.unit),
      component(components[1], "8462-4", mapping.unit),
    ];
  } else {
    valid(!Object.hasOwn(value, "component"));
    resource.valueQuantity = quantity(value.valueQuantity, mapping.unit);
  }
  if (Object.hasOwn(value, "subject")) resource.subject = subject(value.subject);
  return resource;
}

/** Return fresh validated JSON for this exporter's subset; not a FHIR profile validator. */
export function assertFhirBundle(input: unknown): FhirBundle {
  const value = fields(input, ["resourceType", "type", "timestamp"], ["entry"]);
  valid(
    value.resourceType === "Bundle" && value.type === "collection" && date(value.timestamp, false),
  );
  const bundle: FhirBundle = {
    resourceType: "Bundle",
    type: "collection",
    timestamp: value.timestamp,
  };
  if (!Object.hasOwn(value, "entry")) return bundle;
  const entries = array(value.entry, "INVALID_BUNDLE");
  valid(entries.length > 0);
  bundle.entry = [];
  const urls = new Set<string>();
  const ids = new Set<string>();
  for (const item of entries) {
    const entry = fields(item, ["fullUrl", "resource"]);
    valid(
      typeof entry.fullUrl === "string" &&
        entry.fullUrl.startsWith("urn:uuid:") &&
        uuid(entry.fullUrl.slice(9)),
    );
    const fullUrl = entry.fullUrl.toLowerCase();
    valid(!urls.has(fullUrl));
    urls.add(fullUrl);
    const resource = fields(
      entry.resource,
      ["resourceType", "id"],
      [
        "status",
        "category",
        "code",
        "subject",
        "effectiveDateTime",
        "note",
        "valueQuantity",
        "component",
        "medicationCodeableConcept",
        "effectivePeriod",
        "dosage",
        "onsetDateTime",
      ],
    );
    valid(id(resource.id));
    valid(
      resource.resourceType === "Observation" ||
        resource.resourceType === "MedicationStatement" ||
        resource.resourceType === "Condition",
    );
    const key = `${resource.resourceType}/${resource.id}`;
    valid(!ids.has(key));
    ids.add(key);
    let materialized: FhirResource;
    if (resource.resourceType === "Observation") {
      materialized = observation(resource, resource.id);
    } else if (resource.resourceType === "MedicationStatement") {
      const medication = fields(resource, [
        "resourceType",
        "id",
        "status",
        "medicationCodeableConcept",
        "subject",
        "effectivePeriod",
        "dosage",
      ]);
      valid(medication.status === "unknown");
      const concept = fields(medication.medicationCodeableConcept, ["text"]);
      valid(text(concept.text));
      const patient = subject(medication.subject);
      const period = fields(medication.effectivePeriod, ["start"], ["end"]);
      valid(date(period.start));
      const effectivePeriod: { start: string; end?: string } = { start: period.start };
      if (Object.hasOwn(period, "end")) {
        valid(date(period.end) && periodOrdered(period.start, period.end));
        effectivePeriod.end = period.end;
      }
      materialized = {
        resourceType: "MedicationStatement",
        id: resource.id,
        status: medication.status,
        medicationCodeableConcept: { text: concept.text },
        subject: patient,
        effectivePeriod,
        dosage: annotation(medication.dosage),
      };
    } else {
      const condition = fields(resource, [
        "resourceType",
        "id",
        "code",
        "subject",
        "onsetDateTime",
      ]);
      const concept = fields(condition.code, ["text"]);
      valid(text(concept.text) && date(condition.onsetDateTime));
      materialized = {
        resourceType: "Condition",
        id: resource.id,
        code: { text: concept.text },
        subject: subject(condition.subject),
        onsetDateTime: condition.onsetDateTime,
      };
    }
    bundle.entry.push({ fullUrl, resource: materialized });
  }
  return bundle;
}
