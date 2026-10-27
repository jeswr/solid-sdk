// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { CATEGORY_SYSTEM, LOINC_SYSTEM, METRIC_CODES, UCUM_SYSTEM } from "./codes";
import type { FhirBundle } from "./types";
import {
  array,
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

function coding(input: unknown, system: string): unknown {
  const value = fields(input, ["coding"]);
  const items = array(value.coding, "INVALID_BUNDLE");
  valid(items.length === 1);
  const item = fields(items[0], ["system", "code"]);
  valid(item.system === system);
  return item.code;
}

function quantity(input: unknown, unit: string): void {
  const value = fields(input, ["value", "unit", "system", "code"]);
  valid(
    numeric(value.value) &&
      value.unit === unit &&
      value.system === UCUM_SYSTEM &&
      value.code === unit,
  );
}

function annotation(input: unknown): void {
  const value = array(input, "INVALID_BUNDLE");
  valid(value.length === 1);
  const item = fields(value[0], ["text"]);
  valid(text(item.text));
}

function subject(input: unknown): void {
  const value = fields(input, [], ["reference", "display"]);
  if (Object.hasOwn(value, "reference")) {
    valid(Object.keys(value).length === 1 && patientReference(value.reference));
  } else {
    valid(value.display === "Patient not supplied");
  }
}

function observation(input: Record<string, unknown>): void {
  const value = fields(
    input,
    ["resourceType", "id", "status", "category", "code", "effectiveDateTime", "note"],
    ["subject", "valueQuantity", "component"],
  );
  valid(value.status === "final" && date(value.effectiveDateTime, false));
  const code = coding(value.code, LOINC_SYSTEM);
  const mapping = Object.values(METRIC_CODES).find((entry) => entry.code === code);
  valid(mapping !== undefined);
  const category = array(value.category, "INVALID_BUNDLE");
  valid(category.length === 1);
  valid(coding(category[0], CATEGORY_SYSTEM) === mapping.category);
  annotation(value.note);
  if (mapping.code === "85354-9") {
    valid(!Object.hasOwn(value, "valueQuantity"));
    const components = array(value.component, "INVALID_BUNDLE");
    valid(components.length === 2);
    for (const [index, componentCode] of ["8480-6", "8462-4"].entries()) {
      const component = fields(components[index], ["code", "valueQuantity"]);
      valid(coding(component.code, LOINC_SYSTEM) === componentCode);
      quantity(component.valueQuantity, mapping.unit);
    }
  } else {
    valid(!Object.hasOwn(value, "component"));
    quantity(value.valueQuantity, mapping.unit);
  }
  if (Object.hasOwn(value, "subject")) subject(value.subject);
}

/** Validate this exporter's subset, including required subjects; not a FHIR profile validator. */
export function assertFhirBundle(input: unknown): asserts input is FhirBundle {
  const value = fields(input, ["resourceType", "type", "timestamp"], ["entry"]);
  valid(
    value.resourceType === "Bundle" && value.type === "collection" && date(value.timestamp, false),
  );
  if (!Object.hasOwn(value, "entry")) return;
  const entries = array(value.entry, "INVALID_BUNDLE");
  valid(entries.length > 0);
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
    if (resource.resourceType === "Observation") {
      observation(resource);
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
      subject(medication.subject);
      const period = fields(medication.effectivePeriod, ["start"], ["end"]);
      valid(date(period.start));
      if (Object.hasOwn(period, "end")) {
        valid(date(period.end) && periodOrdered(period.start, period.end));
      }
      annotation(medication.dosage);
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
      subject(condition.subject);
    }
  }
}
