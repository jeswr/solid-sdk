// AUTHORED-BY Claude Opus 5.5
// Resolving parameter values from an ActionRequest, and checking them against the
// parameter's declared range and options before they reach a request.

import type { ActionRequest, Parameter } from "@jeswr/site-model";
import { SAB, SCHEMA } from "@jeswr/site-model";

export const XSD = "http://www.w3.org/2001/XMLSchema#";
export const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";

export class BindingError extends Error {
  override name = "BindingError";
}

/** Normalise http://schema.org/ IRIs to https://schema.org/. */
export function normaliseIri(iri: string): string {
  return iri.startsWith("http://schema.org/")
    ? `https://schema.org/${iri.slice("http://schema.org/".length)}`
    : iri;
}

const PREFIXES: Readonly<Record<string, string>> = { schema: SCHEMA, sab: SAB, xsd: XSD, rdf: RDF };

/** Expand a schema:/sab:/xsd:/rdf: CURIE, else normalise the IRI. */
export function expandIri(term: string): string {
  const m = /^([a-z]+):(?!\/\/)(.*)$/.exec(term);
  if (m && (m[1] as string) in PREFIXES) return `${PREFIXES[m[1] as string]}${m[2]}`;
  return normaliseIri(term);
}

const INTEGER_TYPES = new Set(
  [
    "integer",
    "int",
    "long",
    "short",
    "byte",
    "nonNegativeInteger",
    "positiveInteger",
    "negativeInteger",
    "nonPositiveInteger",
    "unsignedInt",
    "unsignedLong",
    "unsignedShort",
    "unsignedByte",
  ].map((t) => XSD + t),
);
const DECIMAL_TYPES = new Set(["decimal", "double", "float"].map((t) => XSD + t));
const BOOLEAN_TYPE = `${XSD}boolean`;
const ANY_URI = `${XSD}anyURI`;

/** A range is a class (the value is a node, not a literal) unless it is an XSD or rdf datatype. */
export function isClassRange(range: string): boolean {
  return (
    !range.startsWith(XSD) && range !== `${RDF}langString` && range !== `${RDF}HTML` && range !== ""
  );
}

function isAbsoluteIri(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/.test(value) && !/^[A-Za-z]:\\/.test(value);
}

/** The last non-empty path segment of an IRI (decoded), or the urn's last colon part. */
export function idFromIri(iri: string): string {
  try {
    const url = new URL(iri);
    if (url.protocol === "http:" || url.protocol === "https:") {
      const segments = url.pathname.split("/").filter((s) => s !== "");
      const last = segments.at(-1);
      if (last !== undefined) {
        try {
          return decodeURIComponent(last);
        } catch {
          return last;
        }
      }
      return iri;
    }
  } catch {
    // fall through
  }
  const colon = iri.lastIndexOf(":");
  return colon === -1 ? iri : iri.slice(colon + 1);
}

/** Properties that carry an identifier directly on a referenced node (checked before mining the IRI). */
export const ID_PROPERTIES = [`${SCHEMA}sku`, `${SCHEMA}productID`, `${SCHEMA}identifier`];

export interface Resolved {
  value: string | undefined;
  /** True when the value came from the request (not a default). */
  fromRequest: boolean;
}

/**
 * Resolve one parameter from the request: follow `param.path`; a class-ranged
 * parameter whose value is an IRI yields the node's sku/id property when the
 * request supplies one, else the IRI's last path segment. Falls back to the default.
 */
export function resolveParameter(param: Parameter, request: ActionRequest): Resolved {
  if (param.path.length > 0) {
    const path = param.path.map(normaliseIri);
    const value = request.values(path)[0];
    if (value !== undefined) {
      if (!isClassRange(param.range)) return { value, fromRequest: true };
      for (const idProp of ID_PROPERTIES) {
        const direct = request.values([...path, idProp])[0];
        if (direct !== undefined) return { value: direct, fromRequest: true };
      }
      if (isAbsoluteIri(value) && !value.startsWith("_:"))
        return { value: idFromIri(value), fromRequest: true };
      // A blank node without an id property cannot name anything on the site.
      if (!value.startsWith("_:")) return { value, fromRequest: true };
    }
  }
  return { value: param.default, fromRequest: false };
}

/** Typed JSON value for a parameter (whole-value JSON placeholders keep JSON types). */
export function jsonValue(param: Parameter | undefined, value: string): string | number | boolean {
  if (!param) return value;
  if (INTEGER_TYPES.has(param.range) || DECIMAL_TYPES.has(param.range)) return Number(value);
  if (param.range === BOOLEAN_TYPE) return value === "true" || value === "1";
  return value;
}

/** Check a value against the parameter's range and options; throws BindingError. */
export function validateValue(param: Parameter, value: string): void {
  if (param.options && param.options.length > 0 && !param.options.includes(value)) {
    throw new BindingError(`value for "${param.name}" is not one of its allowed options`);
  }
  if (INTEGER_TYPES.has(param.range)) {
    if (!/^[+-]?\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
      throw new BindingError(`value for "${param.name}" is not a valid integer`);
    }
    const n = Number(value);
    const local = param.range.slice(XSD.length);
    if ((local.startsWith("unsigned") || local === "nonNegativeInteger") && n < 0) {
      throw new BindingError(`value for "${param.name}" must not be negative`);
    }
    if (local === "positiveInteger" && n < 1)
      throw new BindingError(`value for "${param.name}" must be positive`);
    if (local === "negativeInteger" && n > -1)
      throw new BindingError(`value for "${param.name}" must be negative`);
    if (local === "nonPositiveInteger" && n > 0) {
      throw new BindingError(`value for "${param.name}" must not be positive`);
    }
  } else if (DECIMAL_TYPES.has(param.range)) {
    if (
      !/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(value) ||
      !Number.isFinite(Number(value))
    ) {
      throw new BindingError(`value for "${param.name}" is not a valid number`);
    }
  } else if (param.range === BOOLEAN_TYPE) {
    if (!["true", "false", "1", "0"].includes(value)) {
      throw new BindingError(`value for "${param.name}" is not a valid boolean`);
    }
  } else if (param.range === ANY_URI && !isAbsoluteIri(value)) {
    throw new BindingError(`value for "${param.name}" is not an absolute IRI`);
  }
}
