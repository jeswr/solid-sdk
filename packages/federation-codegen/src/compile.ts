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
  type AnyManifestEntity,
  type CompositeManifestEntity,
  literalMapper,
  type ManifestEntity,
  type ManifestField,
  type ManifestFieldGuards,
  type ManifestNode,
  type ModelManifest,
  RUNTIME_MAJOR,
  validateManifest,
} from "@jeswr/model-runtime";
import {
  type CodegenConfig,
  type CompositeEntityConfig,
  entityConfigFor,
  type FieldConfig,
  isCompositeConfig,
} from "./config.js";
import { SH } from "./rdf.js";
import {
  localName,
  type NodeShapeModel,
  type NormalizedShapes,
  type ShapeConstraint,
} from "./shapes.js";

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

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
  resolvedName?: string,
): ManifestField {
  const name = resolvedName ?? constraint.name ?? localName(constraint.pathIri);
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

// The entity / composite name is emitted into model.d.ts in identifier + string-literal
// positions; require a plain identifier so it can never break the generated types
// (defence in depth — the config is trusted, but a typo must fail loudly).
function assertIdentifier(name: string, what: string): void {
  if (!IDENTIFIER_RE.test(name)) throw new Error(`${what} "${name}" is not a valid identifier`);
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
  assertIdentifier(entityConfig.name, "codegen config entity name");
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

/**
 * Compile a COMPOSITE entity config over the shapes it CLAIMS (one NodeShape per node,
 * by target class). Each node's shape properties are partitioned by the node config:
 * `fields` → flat fields (via {@link compileField}, with the composite rename), `links`
 * → nested link fields (an IRI-link property → a sub-node; the requiredFailClosed
 * cross-node MUST derives from the shape's Violation-graded minCount, G1). A property in
 * neither is omitted — a Violation-graded (MUST) omission is caught by the fidelity
 * assertion, so a security constraint can never be silently dropped.
 */
function compileCompositeEntity(
  compConfig: CompositeEntityConfig,
  shapeByTarget: Map<string, NodeShapeModel>,
  provenance: FieldProvenance[],
): CompositeManifestEntity {
  assertIdentifier(compConfig.name, "codegen composite entity name");
  const nodeNames = Object.keys(compConfig.nodes);
  if (!nodeNames.includes(compConfig.root)) {
    throw new Error(
      `composite ${compConfig.name} root "${compConfig.root}" is not a declared node`,
    );
  }
  // Fidelity + provenance key composite fields by node target class, so the nodes must
  // have distinct target classes (a config-level restriction, documented).
  const seenTargets = new Set<string>();
  for (const nodeName of nodeNames) {
    const tc = compConfig.nodes[nodeName]?.targetClass as string;
    if (seenTargets.has(tc)) {
      throw new Error(`composite ${compConfig.name} reuses target class ${tc} across nodes`);
    }
    seenTargets.add(tc);
  }

  // The composite projects ONE flat object, so EVERY emitted field name (a flat field's
  // resolved/renamed name AND a nested link's name) must be globally unique across the
  // nodes — a collision would produce an ambiguous *Data / duplicate TS property. Tracked
  // here, keyed name → the node that first claimed it, so a clash names both nodes.
  const claimedNames = new Map<string, string>();
  const claimName = (name: string, nodeName: string): void => {
    const prior = claimedNames.get(name);
    if (prior !== undefined) {
      throw new Error(
        `composite ${compConfig.name} emits duplicate field name "${name}" (nodes "${prior}" and "${nodeName}"); the flat projection needs globally-unique names — use a distinct rename`,
      );
    }
    claimedNames.set(name, nodeName);
  };

  const nodes: ManifestNode[] = nodeNames.map((nodeName) => {
    const nodeConfig = compConfig.nodes[nodeName];
    if (!nodeConfig) throw new Error(`composite ${compConfig.name} node "${nodeName}" missing`);
    const shape = shapeByTarget.get(nodeConfig.targetClass);
    if (!shape) {
      throw new Error(
        `composite ${compConfig.name} node "${nodeName}" references target class ${nodeConfig.targetClass} with no NodeShape`,
      );
    }
    const flatCfg = nodeConfig.fields ?? {};
    const links = nodeConfig.links ?? {};
    const shapeFieldNames = new Set(shape.properties.map((c) => c.name ?? localName(c.pathIri)));
    // A shape field may not be both a flat field and a link.
    for (const fieldName of Object.keys(flatCfg)) {
      if (fieldName in links) {
        throw new Error(
          `composite ${compConfig.name} node "${nodeName}" projects "${fieldName}" as both a field and a link`,
        );
      }
      if (!shapeFieldNames.has(fieldName)) {
        throw new Error(
          `composite ${compConfig.name} node "${nodeName}" configures unknown field "${fieldName}"`,
        );
      }
    }
    for (const [fieldName, targetNode] of Object.entries(links)) {
      if (!shapeFieldNames.has(fieldName)) {
        throw new Error(
          `composite ${compConfig.name} node "${nodeName}" links unknown field "${fieldName}"`,
        );
      }
      if (!nodeNames.includes(targetNode)) {
        throw new Error(
          `composite ${compConfig.name} link "${fieldName}" targets unknown node "${targetNode}"`,
        );
      }
    }

    const fields: ManifestField[] = [];
    for (const constraint of shape.properties) {
      const shapeFieldName = constraint.name ?? localName(constraint.pathIri);
      const targetNode = links[shapeFieldName];
      if (targetNode !== undefined) {
        // A NESTED link — the shape property MUST be an IRI-valued link.
        if (constraint.kind !== "iri") {
          throw new Error(
            `composite ${compConfig.name} node "${nodeName}" links non-IRI property "${shapeFieldName}"`,
          );
        }
        // A nested link is a SINGLE-VALUED tree edge (the runtime models it as maxCount 1):
        // a multi-valued (or unbounded) link property would silently drop its set semantics
        // if compiled as one edge, so reject it fail-closed. Set-valued nested links are a
        // documented future feature.
        if (constraint.maxCount !== 1) {
          throw new Error(
            `composite ${compConfig.name} node "${nodeName}" links the multi-valued property "${shapeFieldName}" (maxCount ${constraint.maxCount ?? "unbounded"}); a nested link must be single-valued (sh:maxCount 1) — set-valued nested links are a documented future feature`,
          );
        }
        claimName(shapeFieldName, nodeName);
        const nested: ManifestField = {
          name: shapeFieldName,
          predicate: constraint.pathIri,
          kind: "nested",
          node: targetNode,
        };
        // G1 — the cross-node MUST: fail-closed only when Violation-graded (or severity
        // absent, SHACL's default). A Warning/Info link is advisory (no runtime guard).
        if (
          constraint.minCount !== undefined &&
          constraint.minCount >= 1 &&
          isFailClosedSeverity(constraint.severity)
        ) {
          nested.guards = { requiredFailClosed: true };
        }
        // The nested requiredFailClosed is shape-derived (no config guards).
        provenance.push({
          targetClass: nodeConfig.targetClass,
          fieldName: shapeFieldName,
          configGuards: [],
        });
        fields.push(nested);
        continue;
      }
      const fieldConfig = flatCfg[shapeFieldName];
      if (fieldConfig === undefined) continue; // omitted (fidelity enforces MUST-coverage)
      const resolvedName = fieldConfig.rename ?? constraint.name ?? localName(constraint.pathIri);
      assertIdentifier(resolvedName, "composite field name");
      claimName(resolvedName, nodeName);
      const prov: FieldProvenance = {
        targetClass: nodeConfig.targetClass,
        fieldName: resolvedName,
        configGuards: [],
      };
      const field = compileField(constraint, fieldConfig, prov, resolvedName);
      provenance.push(prov);
      fields.push(field);
    }

    return {
      name: nodeName,
      typeIris: [nodeConfig.targetClass],
      fragment: nodeConfig.fragment,
      fields,
    };
  });

  return { name: compConfig.name, kind: "composite", root: compConfig.root, nodes };
}

/** Compile the normalized shapes + config into a validated manifest + provenance. */
export function compileManifest(shapes: NormalizedShapes, config: CodegenConfig): CompileResult {
  const provenance: FieldProvenance[] = [];
  const shapeByTarget = new Map(shapes.nodeShapes.map((s) => [s.targetClass, s]));

  // Every target class a composite claims as a node — such a shape is NOT also compiled
  // to a flat entity (the composite owns it). A double-claim across composites is an error.
  const claimedByComposite = new Map<string, string>(); // target class → composite name
  for (const entityConfig of config.entities) {
    if (!isCompositeConfig(entityConfig)) continue;
    for (const nodeName of Object.keys(entityConfig.nodes)) {
      const tc = entityConfig.nodes[nodeName]?.targetClass as string;
      const prior = claimedByComposite.get(tc);
      if (prior !== undefined) {
        throw new Error(
          prior === entityConfig.name
            ? `composite ${entityConfig.name} reuses target class ${tc} across its nodes`
            : `target class ${tc} is claimed by both composites ${prior} and ${entityConfig.name}`,
        );
      }
      claimedByComposite.set(tc, entityConfig.name);
    }
  }

  // Flat entities in shape order (skipping composite-claimed shapes); then composites in
  // config order — a deterministic ordering.
  const flatEntities: AnyManifestEntity[] = shapes.nodeShapes
    .filter((shape) => !claimedByComposite.has(shape.targetClass))
    .map((shape) => compileEntity(shape, config, provenance));
  const compositeEntities: AnyManifestEntity[] = config.entities
    .filter(isCompositeConfig)
    .map((c) => compileCompositeEntity(c, shapeByTarget, provenance));

  const manifest: ModelManifest = validateManifest({
    manifestVersion: 1,
    runtime: { name: "@jeswr/model-runtime", major: RUNTIME_MAJOR },
    prefixes: config.prefixes,
    entities: [...flatEntities, ...compositeEntities],
  });

  return { manifest, provenance };
}
