// AUTHORED-BY Claude Opus 4.8
/**
 * Compile a normalized SHACL shape model + the per-domain codegen config into a
 * {@link ModelManifest} (model.json) — the VERIFIED PROJECTION of shapes.ttl
 * (design §7.2). Shape-derived fields (name, predicate, kind, datatype, cardinality,
 * the http(s) scheme guard from an `^https?://` pattern, requiredFailClosed from
 * minCount) come straight from the shape; the historical lexical guards come from
 * the config. Every field's guard provenance is recorded so the fidelity assertion
 * can prove each traces to EITHER a shape constraint OR a config entry.
 *
 * The result is validated fail-closed by the runtime's own `validateManifest`.
 */

import {
  type ManifestEntity,
  type ManifestField,
  type ManifestFieldGuards,
  type ModelManifest,
  RUNTIME_MAJOR,
  validateManifest,
} from "@jeswr/model-runtime";
import { type CodegenConfig, entityConfigFor, type FieldConfig } from "./config.js";
import {
  localName,
  type NodeShapeModel,
  type NormalizedShapes,
  type ShapeConstraint,
} from "./shapes.js";

/** Which guards on a field came from the config (vs the shape) — for traceability. */
export interface FieldProvenance {
  fieldName: string;
  configGuards: string[];
}

export interface CompileResult {
  manifest: ModelManifest;
  provenance: FieldProvenance[];
}

/** True for a `sh:pattern` that restricts values to http(s) schemes. */
export function isHttpPattern(pattern: string | undefined): boolean {
  if (pattern === undefined) return false;
  const p = pattern.replace(/\s+/g, "");
  return p === "^https?://" || p === "^https://" || p === "^http://";
}

function collectionOf(constraint: ShapeConstraint): "set" | undefined {
  return constraint.maxCount === 1 ? undefined : "set";
}

function compileField(
  constraint: ShapeConstraint,
  fieldConfig: FieldConfig | undefined,
  provenance: FieldProvenance,
): ManifestField {
  const name = constraint.name ?? localName(constraint.pathIri);
  const field: ManifestField = {
    name,
    predicate: constraint.pathIri,
    kind: constraint.kind,
  };
  const collection = collectionOf(constraint);
  if (collection) field.collection = collection;
  if (constraint.kind === "literal" && constraint.datatype) field.datatype = constraint.datatype;
  if (constraint.minCount !== undefined) field.minCount = constraint.minCount;
  if (constraint.maxCount !== undefined) field.maxCount = constraint.maxCount;

  const guards: ManifestFieldGuards = {};

  // Shape-derived: http(s) scheme guard from an ^https?:// pattern on an IRI field.
  if (constraint.kind === "iri" && isHttpPattern(constraint.pattern)) {
    guards.iriScheme = "http-https";
  }
  // Shape-derived: fail-closed on absence when the field is required (minCount ≥ 1).
  if (constraint.minCount !== undefined && constraint.minCount >= 1) {
    guards.requiredFailClosed = true;
  }

  // Config-supplied guards (recorded as provenance so fidelity can trace them).
  if (fieldConfig) {
    const record = (key: string) => provenance.configGuards.push(key);
    if (fieldConfig.iriScheme !== undefined) {
      guards.iriScheme = fieldConfig.iriScheme;
      record("iriScheme");
    }
    if (fieldConfig.requiredFailClosed !== undefined) {
      guards.requiredFailClosed = fieldConfig.requiredFailClosed;
      record("requiredFailClosed");
    }
    if (fieldConfig.emptyStringDrop !== undefined) {
      guards.emptyStringDrop = fieldConfig.emptyStringDrop;
      record("emptyStringDrop");
    }
    if (fieldConfig.sanitizeText !== undefined) {
      guards.sanitizeText = fieldConfig.sanitizeText;
      record("sanitizeText");
    }
    if (fieldConfig.trim !== undefined) {
      guards.trim = fieldConfig.trim;
      record("trim");
    }
    if (fieldConfig.dropBlank !== undefined) {
      guards.dropBlank = fieldConfig.dropBlank;
      record("dropBlank");
    }
    if (fieldConfig.sortOnRead !== undefined) {
      guards.sortOnRead = fieldConfig.sortOnRead;
      record("sortOnRead");
    }
    if (fieldConfig.default !== undefined) {
      field.default = fieldConfig.default;
      record("default");
    }
    if (fieldConfig.defaultNow !== undefined) {
      field.defaultNow = fieldConfig.defaultNow;
      record("defaultNow");
    }
    if (fieldConfig.materializeDefault !== undefined) {
      field.materializeDefault = fieldConfig.materializeDefault;
      record("materializeDefault");
    }
  }

  if (Object.keys(guards).length > 0) field.guards = guards;
  return field;
}

function compileEntity(
  shape: NodeShapeModel,
  config: CodegenConfig,
  provenance: FieldProvenance[],
): ManifestEntity {
  const entityConfig = entityConfigFor(config, shape.targetClass);
  if (!entityConfig) {
    throw new Error(`no codegen config entity for target class ${shape.targetClass}`);
  }
  const fields: ManifestField[] = shape.properties.map((constraint) => {
    const name = constraint.name ?? localName(constraint.pathIri);
    const prov: FieldProvenance = { fieldName: name, configGuards: [] };
    const fieldConfig = entityConfig.fields?.[name];
    const field = compileField(constraint, fieldConfig, prov);
    provenance.push(prov);
    return field;
  });

  // Reject a config that references a field the shape does not declare (a silent
  // guard on a non-existent field would never be traceable).
  const shapeFieldNames = new Set(fields.map((f) => f.name));
  for (const configuredName of Object.keys(entityConfig.fields ?? {})) {
    if (!shapeFieldNames.has(configuredName)) {
      throw new Error(
        `codegen config for ${shape.targetClass} configures unknown field "${configuredName}"`,
      );
    }
  }

  return {
    name: entityConfig.name,
    typeIris: [shape.targetClass],
    subject: entityConfig.subject,
    fields,
  };
}

/** Compile the normalized shapes + config into a validated manifest + provenance. */
export function compileManifest(shapes: NormalizedShapes, config: CodegenConfig): CompileResult {
  const provenance: FieldProvenance[] = [];
  const entities = shapes.nodeShapes.map((shape) => compileEntity(shape, config, provenance));

  const manifest: ModelManifest = validateManifest({
    manifestVersion: 1,
    runtime: { name: "@jeswr/model-runtime", major: RUNTIME_MAJOR },
    prefixes: config.prefixes,
    entities,
  });

  return { manifest, provenance };
}
