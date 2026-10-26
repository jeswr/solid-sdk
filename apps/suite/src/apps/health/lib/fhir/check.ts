// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { CATEGORY_SYSTEM, LOINC_SYSTEM, METRIC_CODES, UCUM_SYSTEM } from "./codes";
import type { FhirBundle } from "./types";
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

function valid(condition: boolean): asserts condition {
  requireValid(condition, "INVALID_BUNDLE", "Invalid FHIR bundle structure");
}

function fields(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): asserts value is Record<string, unknown> {
  record(value, required, optional, "INVALID_BUNDLE");
}

function coding(value: unknown, system: string, code: string): void {
  fields(value, ["coding"]);
  array(value.coding, "INVALID_BUNDLE");
  valid(value.coding.length === 1);
  const item = value.coding[0];
  fields(item, ["system", "code"]);
  valid(item.system === system && item.code === code);
}

function quantity(value: unknown, unit: string): void {
  fields(value, ["value", "unit", "system", "code"]);
  valid(
    numeric(value.value) &&
      value.unit === unit &&
      value.system === UCUM_SYSTEM &&
      value.code === unit,
  );
}

function annotation(value: unknown): void {
  array(value, "INVALID_BUNDLE");
  valid(value.length === 1);
  fields(value[0], ["text"]);
  valid(text(value[0].text));
}

function subject(value: unknown): void {
  fields(value, [], ["reference", "display"]);
  if (Object.hasOwn(value, "reference")) {
    valid(
      Object.keys(value).length === 1 &&
        typeof value.reference === "string" &&
        value.reference.startsWith("Patient/") &&
        id(value.reference.slice(8)),
    );
  } else {
    valid(value.display === "Patient not supplied");
  }
}

function observation(value: Record<string, unknown>): void {
  fields(
    value,
    ["resourceType", "id", "status", "category", "code", "effectiveDateTime", "note"],
    ["subject", "valueQuantity", "component"],
  );
  valid(value.status === "final" && date(value.effectiveDateTime, false));
  fields(value.code, ["coding"]);
  array(value.code.coding, "INVALID_BUNDLE");
  valid(value.code.coding.length === 1);
  const code = value.code.coding[0];
  fields(code, ["system", "code"]);
  const mapping = Object.values(METRIC_CODES).find((entry) => entry.code === code.code);
  valid(mapping !== undefined);
  coding(value.code, LOINC_SYSTEM, mapping.code);
  array(value.category, "INVALID_BUNDLE");
  valid(value.category.length === 1);
  coding(value.category[0], CATEGORY_SYSTEM, mapping.category);
  annotation(value.note);
  if (mapping.code === "85354-9") {
    valid(!Object.hasOwn(value, "valueQuantity"));
    array(value.component, "INVALID_BUNDLE");
    valid(value.component.length === 2);
    for (const [index, componentCode] of ["8480-6", "8462-4"].entries()) {
      const component = value.component[index];
      fields(component, ["code", "valueQuantity"]);
      coding(component.code, LOINC_SYSTEM, componentCode);
      quantity(component.valueQuantity, mapping.unit);
    }
  } else {
    valid(!Object.hasOwn(value, "component"));
    quantity(value.valueQuantity, mapping.unit);
  }
  if (Object.hasOwn(value, "subject")) subject(value.subject);
}

/** Validate this exporter's subset, including required subjects; not a FHIR profile validator. */
export function assertFhirBundle(value: unknown): asserts value is FhirBundle {
  fields(value, ["resourceType", "type", "timestamp"], ["entry"]);
  valid(
    value.resourceType === "Bundle" && value.type === "collection" && date(value.timestamp, false),
  );
  if (!Object.hasOwn(value, "entry")) return;
  valid(Array.isArray(value.entry));
  checkCount(value.entry.length);
  valid(value.entry.length > 0);
  array(value.entry, "INVALID_BUNDLE");
  const urls = new Set<string>();
  const ids = new Set<string>();
  for (const entry of value.entry) {
    fields(entry, ["fullUrl", "resource"]);
    valid(
      typeof entry.fullUrl === "string" &&
        entry.fullUrl.startsWith("urn:uuid:") &&
        uuid(entry.fullUrl.slice(9)),
    );
    const fullUrl = entry.fullUrl.toLowerCase();
    valid(!urls.has(fullUrl));
    urls.add(fullUrl);
    fields(
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
    const resource = entry.resource;
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
      fields(resource, [
        "resourceType",
        "id",
        "status",
        "medicationCodeableConcept",
        "subject",
        "effectivePeriod",
        "dosage",
      ]);
      valid(resource.status === "unknown");
      fields(resource.medicationCodeableConcept, ["text"]);
      valid(text(resource.medicationCodeableConcept.text));
      subject(resource.subject);
      fields(resource.effectivePeriod, ["start"], ["end"]);
      valid(date(resource.effectivePeriod.start));
      if (Object.hasOwn(resource.effectivePeriod, "end")) {
        valid(
          date(resource.effectivePeriod.end) &&
            Date.parse(resource.effectivePeriod.end) >= Date.parse(resource.effectivePeriod.start),
        );
      }
      annotation(resource.dosage);
    } else {
      fields(resource, ["resourceType", "id", "code", "subject", "onsetDateTime"]);
      fields(resource.code, ["text"]);
      valid(text(resource.code.text) && date(resource.onsetDateTime));
      subject(resource.subject);
    }
  }
}
