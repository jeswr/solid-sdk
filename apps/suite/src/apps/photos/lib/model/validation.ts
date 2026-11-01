// AUTHORED-BY Codex GPT-6.1-Sol
import { safeHttpIri } from "@jeswr/rdf-serialize";
import { exifDateToIso } from "./exif.js";

/** Validate before RDF term construction; preserve lexical RDF identity. */
export function httpIri(value: string): string {
  const safe = safeHttpIri(value);
  if (!safe || new URL(safe).username || new URL(safe).password) {
    throw new TypeError("Expected an absolute HTTP(S) IRI without credentials");
  }
  return safe;
}

export function documentUrl(value: string): string {
  const safe = httpIri(value);
  if (new URL(safe).hash || new URL(safe).search || safe.endsWith("/")) {
    throw new TypeError("Expected a document URL without query or fragment");
  }
  return safe;
}

export function isoDate(value: string): string {
  const date = exifDateToIso(value);
  if (!date) throw new TypeError("Expected a valid ISO date-time");
  return date;
}

export function identifier(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)) throw new TypeError("Invalid identifier");
  return value;
}
