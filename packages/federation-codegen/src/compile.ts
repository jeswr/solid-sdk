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
  literalMapper,
  type ManifestEntity,
  type ManifestField,
  type ManifestFieldGuards,
  type ModelManifest,
  RUNTIME_MAJOR,
  validateManifest,
} from "@jeswr/model-runtime";
import { type CodegenConfig, entityConfigFor, type FieldConfig } from "./config.js";
import { SH } from "./rdf.js";
import {
  localName,
  type NodeShapeModel,
  type NormalizedShapes,
  type ShapeConstraint,
} from "./shapes.js";

/**
 * A `sh:minCount ≥ 1` compiles to a fail-closed requirement ONLY at
 * `sh:severity sh:Violation` (SHACL's default when severity is ABSENT). A
 * Warning/Info-graded minCount is ADVISORY — it stays in shapes.ttl for
 * validation-time but compiles to NO runtime guard (design G1).
 */
export function isFailClosedSeverity(severity: string | undefined): boolean {
  return severity === undefined || severity === `${SH}Violation`;
}

/** Which guards on a field came from the config (vs the shape) — for traceability. */
export interface FieldProvenance {
  /** The entity's target class — provenance is keyed per ENTITY, not globally. */
  targetClass: string;
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

/**
 * True when a field's runtime value is a JS string — the ONLY surface the runtime's
 * lexical guards (`minLength` / `nonBlank`) act on (`applyScalarGuards` gates them on
 * `typeof value === "string"`). An IRI value is a string; a literal is a string only
 * for string-valued datatypes — a numeric / boolean / date datatype surfaces as a
 * `number` / `boolean` / `Date`, where the runtime SKIPS these guards, so emitting one
 * there is a silent no-op the fidelity assertion would miscount as real coverage. The
 * datatype → JS-type decision is single-sourced from the audited runtime's
 * `literalMapper`, never re-encoded here.
 */
function hasStringRuntimeValue(constraint: ShapeConstraint): boolean {
  if (constraint.kind === "iri") return true;
  if (constraint.datatype === undefined) return true;
  return literalMapper(constraint.datatype).jsType === "string";
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
  // G2 — a closed `sh:in` value set compiles to the manifest's enum list. An empty
  // array is present-but-malformed (admission blocks it) — never emit an empty enum.
  if (constraint.in !== undefined && constraint.in.length > 0) field.in = constraint.in;

  const guards: ManifestFieldGuards = {};

  // Shape-derived: http(s) scheme guard from an ^https?:// pattern on an IRI field.
  if (constraint.kind === "iri" && isHttpPattern(constraint.pattern)) {
    guards.iriScheme = "http-https";
  }
  // G1 — SEVERITY-AWARE requiredness: fail-closed on absence only when the required
  // constraint is Violation-graded (or severity absent, SHACL's default). A
  // Warning/Info minCount ≥ 1 is advisory and compiles to NO runtime guard.
  if (
    constraint.minCount !== undefined &&
    constraint.minCount >= 1 &&
    isFailClosedSeverity(constraint.severity)
  ) {
    guards.requiredFailClosed = true;
  }
  // G3 — closed, named numeric-range / string-length guards (pure DATA numbers).
  if (constraint.minInclusive !== undefined) guards.minInclusive = constraint.minInclusive;
  if (constraint.maxInclusive !== undefined) guards.maxInclusive = constraint.maxInclusive;
  // minLength is a LEXICAL guard — emit it only where the runtime value is a string
  // (an IRI or a string-valued literal). On a numeric / boolean / date literal the
  // runtime never applies it, so emitting it would be a no-op that fidelity would
  // wrongly count as coverage.
  if (constraint.minLength !== undefined && hasStringRuntimeValue(constraint)) {
    guards.minLength = constraint.minLength;
  }
  // G3 — a singleton non-blank string guard (minLength ≥ 1 on a single literal),
  // mirroring the set-level dropBlank for scalar fields; string-valued literals only.
  if (
    constraint.minLength !== undefined &&
    constraint.minLength >= 1 &&
    collection === undefined &&
    constraint.kind === "literal" &&
    hasStringRuntimeValue(constraint)
  ) {
    guards.nonBlank = true;
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
  // The entity name is emitted into model.d.ts in identifier + string-literal
  // positions; require a plain identifier so it can never break the generated
  // types (defence in depth — the config is trusted, but a typo must fail loudly).
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entityConfig.name)) {
    throw new Error(`codegen config entity name "${entityConfig.name}" is not a valid identifier`);
  }
  const fields: ManifestField[] = shape.properties.map((constraint) => {
    const name = constraint.name ?? localName(constraint.pathIri);
    const prov: FieldProvenance = {
      targetClass: shape.targetClass,
      fieldName: name,
      configGuards: [],
    };
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
