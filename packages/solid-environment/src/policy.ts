// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { isSafeAbsoluteIri, readLiteral } from "@jeswr/model-runtime";
import { DataFactory } from "n3";
import { type ObservableProperty, type ObservationUnit, PROPERTY_UNITS, XSD } from "./vocab.js";

/** Preserve RDF identities; refuse URL spellings that a scheme guard would rewrite. */
export function httpIri(value: string): string {
  if (typeof value !== "string" || !/^https?:\/\//.test(value) || !isSafeAbsoluteIri(value)) {
    throw new TypeError("Expected an absolute http(s) IRI");
  }
  const url = new URL(value);
  if (url.href !== value || url.username || url.password) {
    throw new TypeError("Expected a canonical http(s) IRI without credentials");
  }
  return value;
}

/** ISO timestamp with an explicit timezone, validated by the shared XSD reader. */
export function isoTime(value: string | Date): string {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new TypeError("Invalid observation time");
    value = value.toISOString();
  }
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value)
  ) {
    throw new TypeError("Expected an ISO timestamp with a timezone");
  }
  const parsed = readLiteral(DataFactory.literal(value, DataFactory.namedNode(`${XSD}dateTime`)));
  if (!(parsed instanceof Date) || !Number.isFinite(parsed.getTime())) {
    throw new TypeError("Invalid observation time");
  }
  return parsed.toISOString();
}

export function validateReading(property: string, unit: string, value: number): void {
  if (
    !Object.hasOwn(PROPERTY_UNITS, property) ||
    PROPERTY_UNITS[property as ObservableProperty] !== (unit as ObservationUnit)
  ) {
    throw new TypeError("Unit does not match observable property");
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError("Observation value must be finite");
  }
}

export function slug(value: string): string {
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  ) {
    throw new TypeError(
      "Expected a lowercase sensor slug (letters, digits, hyphens; at most 128 characters)",
    );
  }
  return value;
}

export function utcDay(value: string | Date): string {
  if (typeof value === "string" && /^\d{4}-\d\d-\d\d$/.test(value)) {
    const normalized = isoTime(`${value}T00:00:00Z`).slice(0, 10);
    if (normalized !== value) throw new TypeError("Invalid UTC date");
    return normalized;
  }
  return isoTime(value).slice(0, 10);
}

export function observationDocPath(sensorSlug: string, date: string | Date): string {
  return `environment/${slug(sensorSlug)}/${utcDay(date).replaceAll("-", "/")}.ttl`;
}
export function sensorDocPath(sensorSlug: string): string {
  return `environment/${slug(sensorSlug)}/sensor.ttl`;
}
