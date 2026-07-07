// AUTHORED-BY Claude Opus 4.8
/**
 * THE P0 EXIT CRITERION — the build-time FIDELITY ASSERTION (design §7.2). model.json
 * is a VERIFIED PROJECTION of shapes.ttl, not a bespoke schema: at generation time
 * the generator re-derives an order-independent projection of the merged shapes and
 * asserts, field-for-field and constraint-for-constraint, that model.json covers it
 * exactly — failing the build on any mismatch. Guard flags with no shapes source
 * must trace to the committed config (traceability), so a guard can never be minted
 * silently.
 *
 * Three checks, all order-independent:
 *   (a) STRUCTURAL: {name, predicate, kind, datatype, cardinality, collection}
 *       match field-for-field between the shapes and the manifest.
 *   (b) PATTERN COVERAGE: every `^https?://` shape pattern is reflected as an
 *       http(s) scheme guard in the manifest, and no un-sourced scheme guard exists.
 *   (c) TRACEABILITY: every manifest guard is shape-derived or config-declared.
 */

import {
  type CompositeManifestEntity,
  expandDatatype,
  isCompositeEntity,
  type ManifestField,
  type ManifestFieldGuards,
  type ModelManifest,
} from "@jeswr/model-runtime";
import {
  type CompileResult,
  type FieldProvenance,
  isFailClosedSeverity,
  isHttpPattern,
} from "./compile.js";
import {
  localName,
  type NormalizedShapes,
  type ShapeConstraint,
  type ShapeScalar,
} from "./shapes.js";

/** The shape-derived projection of one field (the constraints model.json must cover). */
interface FieldProjection {
  name: string;
  predicate: string;
  kind: "iri" | "literal";
  datatype: string | null;
  minCount: number | null;
  maxCount: number | null;
  collection: boolean;
  /** JSON of the closed `sh:in` value set, or null when the field has none. */
  inValues: string | null;
}

/** Canonical JSON of a closed value set (order preserved), or null when absent/empty. */
function inJson(values: ShapeScalar[] | undefined): string | null {
  return values !== undefined && values.length > 0 ? JSON.stringify(values) : null;
}

/** Thrown when model.json is not a faithful projection of shapes.ttl. */
export class FidelityError extends Error {
  override readonly name = "FidelityError";
}

function norm(datatype: string | undefined): string | null {
  return datatype === undefined ? null : expandDatatype(datatype);
}

function sortFields(fields: FieldProjection[]): FieldProjection[] {
  return fields.slice().sort((a, b) => a.predicate.localeCompare(b.predicate));
}

function projectShapes(shapes: NormalizedShapes): Map<string, FieldProjection[]> {
  const out = new Map<string, FieldProjection[]>();
  for (const shape of shapes.nodeShapes) {
    const fields: FieldProjection[] = shape.properties.map((c) => ({
      // Fallback MUST match compile's (localName), so an unnamed field agrees.
      name: c.name ?? localName(c.pathIri),
      predicate: c.pathIri,
      kind: c.kind,
      datatype: norm(c.datatype),
      minCount: c.minCount ?? null,
      maxCount: c.maxCount ?? null,
      collection: c.maxCount !== 1,
      inValues: inJson(c.in),
    }));
    out.set(shape.targetClass, sortFields(fields));
  }
  return out;
}

function projectManifest(manifest: ModelManifest): Map<string, FieldProjection[]> {
  const out = new Map<string, FieldProjection[]>();
  for (const entity of manifest.entities) {
    if (isCompositeEntity(entity)) continue; // composites verified by assertCompositeFidelity
    const fields: FieldProjection[] = entity.fields.map((f) => ({
      name: f.name,
      predicate: f.predicate,
      // A flat entity's fields are only iri/literal (the runtime rejects a `nested`
      // field outside a composite), so this narrowing cast is always sound.
      kind: f.kind as "iri" | "literal",
      datatype: norm(f.datatype),
      minCount: f.minCount ?? null,
      maxCount: f.maxCount ?? null,
      collection: f.collection === "set",
      inValues: inJson(f.in as ShapeScalar[] | undefined),
    }));
    for (const typeIri of entity.typeIris) out.set(typeIri, sortFields(fields));
  }
  return out;
}

function diffField(a: FieldProjection, b: FieldProjection): string[] {
  const diffs: string[] = [];
  for (const key of [
    "name",
    "kind",
    "datatype",
    "minCount",
    "maxCount",
    "collection",
    "inValues",
  ] as const) {
    if (a[key] !== b[key])
      diffs.push(`${key}: shapes=${JSON.stringify(a[key])} manifest=${JSON.stringify(b[key])}`);
  }
  return diffs;
}

/** (a) Structural projection equality — the core fidelity check. */
function assertStructural(shapes: NormalizedShapes, manifest: ModelManifest): void {
  const shapeProj = projectShapes(shapes);
  const manifestProj = projectManifest(manifest);

  for (const [targetClass, shapeFields] of shapeProj) {
    const manifestFields = manifestProj.get(targetClass);
    if (!manifestFields) {
      throw new FidelityError(`manifest has no entity for shape target class ${targetClass}`);
    }
    const manifestByPred = new Map(manifestFields.map((f) => [f.predicate, f]));
    if (manifestFields.length !== shapeFields.length) {
      throw new FidelityError(
        `field-count mismatch for ${targetClass}: shapes=${shapeFields.length} manifest=${manifestFields.length}`,
      );
    }
    for (const sf of shapeFields) {
      const mf = manifestByPred.get(sf.predicate);
      if (!mf) {
        throw new FidelityError(
          `manifest is missing field for ${targetClass} path ${sf.predicate}`,
        );
      }
      const diffs = diffField(sf, mf);
      if (diffs.length > 0) {
        throw new FidelityError(
          `field mismatch for ${targetClass} path ${sf.predicate}: ${diffs.join("; ")}`,
        );
      }
    }
  }
  for (const targetClass of manifestProj.keys()) {
    if (!shapeProj.has(targetClass)) {
      throw new FidelityError(`manifest entity ${targetClass} has no corresponding shape`);
    }
  }
}

// Provenance + shape lookups are keyed per ENTITY (target class + name/predicate),
// so a field name or predicate shared across two entities can never be misattributed.
const NUL = String.fromCharCode(0);
const provKey = (targetClass: string, fieldName: string): string =>
  `${targetClass}${NUL}${fieldName}`;

function provenanceIndex(compiled: CompileResult): Map<string, FieldProvenance> {
  return new Map(compiled.provenance.map((p) => [provKey(p.targetClass, p.fieldName), p]));
}
function shapeByTargetClass(
  shapes: NormalizedShapes,
): Map<string, NormalizedShapes["nodeShapes"][number]> {
  return new Map(shapes.nodeShapes.map((s) => [s.targetClass, s]));
}

/** (b) Every http(s) pattern is reflected as a scheme guard, and none is un-sourced. */
function assertPatternCoverage(shapes: NormalizedShapes, compiled: CompileResult): void {
  const provByKey = provenanceIndex(compiled);
  const shapeByTarget = shapeByTargetClass(shapes);

  for (const entity of compiled.manifest.entities) {
    if (isCompositeEntity(entity)) continue; // composites verified by assertCompositeFidelity
    for (const targetClass of entity.typeIris) {
      const shape = shapeByTarget.get(targetClass);
      if (!shape) continue;
      const constraintByPred = new Map(shape.properties.map((c) => [c.pathIri, c] as const));
      for (const field of entity.fields) {
        const c = constraintByPred.get(field.predicate);
        if (!c) continue;
        const hasPattern = c.kind === "iri" && isHttpPattern(c.pattern);
        const hasGuard = field.guards?.iriScheme === "http-https";
        if (hasPattern && !hasGuard) {
          throw new FidelityError(
            `shape ${shape.iri} path ${c.pathIri} has an http(s) pattern but the manifest field has no iriScheme guard`,
          );
        }
        if (hasGuard && !hasPattern) {
          const prov = provByKey.get(provKey(targetClass, field.name));
          if (!prov?.configGuards.includes("iriScheme")) {
            throw new FidelityError(
              `manifest field ${field.name} (${targetClass}) has an iriScheme guard with no shape pattern and no config entry`,
            );
          }
        }
      }
    }
  }
}

/**
 * A guard is shape-derived only when BOTH the shape carries the corresponding
 * constraint AND the emitted guard VALUE equals it — checking the key alone (does the
 * shape have SOME minInclusive?) would let a tampered value (`guards.minInclusive = 999`
 * against a `sh:minInclusive 1` shape) trace as sourced. Boolean guards must be exactly
 * `true`; a `false` guard is a runtime no-op and must not count as shape-derived. Shared
 * by the flat + composite traceability checks so both agree on what a shape licenses.
 */
function guardIsShapeDerived(
  guards: ManifestFieldGuards,
  constraint: ShapeConstraint | undefined,
  guard: string,
): boolean {
  if (constraint === undefined) return false;
  if (guard === "iriScheme")
    return (
      guards.iriScheme === "http-https" &&
      constraint.kind === "iri" &&
      isHttpPattern(constraint.pattern)
    );
  // Severity-aware (G1): a required guard is shape-derived only when the minCount ≥ 1
  // constraint is Violation-graded (or severity absent) AND the guard fails closed.
  if (guard === "requiredFailClosed")
    return (
      guards.requiredFailClosed === true &&
      constraint.minCount !== undefined &&
      constraint.minCount >= 1 &&
      isFailClosedSeverity(constraint.severity)
    );
  if (guard === "minInclusive")
    return constraint.minInclusive !== undefined && guards.minInclusive === constraint.minInclusive;
  if (guard === "maxInclusive")
    return constraint.maxInclusive !== undefined && guards.maxInclusive === constraint.maxInclusive;
  if (guard === "minLength")
    return constraint.minLength !== undefined && guards.minLength === constraint.minLength;
  if (guard === "nonBlank")
    return (
      guards.nonBlank === true &&
      constraint.minLength !== undefined &&
      constraint.minLength >= 1 &&
      constraint.maxCount === 1 &&
      constraint.kind === "literal"
    );
  return false;
}

/** Assert every guard + default on `field` is shape-derived or config-declared (no silent guard). */
function assertFieldGuardsTraceable(
  field: ManifestField,
  constraint: ShapeConstraint | undefined,
  configGuards: Set<string>,
  where: string,
): void {
  const guards = field.guards;
  if (guards) {
    for (const key of Object.keys(guards)) {
      if (!guardIsShapeDerived(guards, constraint, key) && !configGuards.has(key)) {
        throw new FidelityError(
          `${where} field ${field.name} guard "${key}" is neither shape-derived nor config-declared`,
        );
      }
    }
  }
  if (field.default !== undefined && !configGuards.has("default")) {
    throw new FidelityError(`${where} field ${field.name} default is not config-declared`);
  }
  if (field.defaultNow !== undefined && !configGuards.has("defaultNow")) {
    throw new FidelityError(`${where} field ${field.name} defaultNow is not config-declared`);
  }
  if (field.materializeDefault !== undefined && !configGuards.has("materializeDefault")) {
    throw new FidelityError(
      `${where} field ${field.name} materializeDefault is not config-declared`,
    );
  }
}

/** (c) Every manifest guard is shape-derived or config-declared (no silent guard). */
function assertTraceability(compiled: CompileResult, shapes: NormalizedShapes): void {
  const provByKey = provenanceIndex(compiled);
  const shapeByTarget = shapeByTargetClass(shapes);

  for (const entity of compiled.manifest.entities) {
    if (isCompositeEntity(entity)) continue; // composites verified by assertCompositeFidelity
    const constraintByPred = new Map(
      entity.typeIris
        .flatMap((tc) => shapeByTarget.get(tc)?.properties ?? [])
        .map((c) => [c.pathIri, c] as const),
    );
    const targetClass = entity.typeIris[0] ?? "";
    for (const field of entity.fields) {
      // Validate any field carrying a config-sourced attribute — guards OR a default OR a
      // build-time default flag (defaultNow / materializeDefault). A field with ONLY a
      // defaultNow/materializeDefault (no guards, no `default`) must NOT be skipped, else a
      // tampered manifest could add an un-sourced build-time default unchecked.
      if (
        field.guards === undefined &&
        field.default === undefined &&
        field.defaultNow === undefined &&
        field.materializeDefault === undefined
      ) {
        continue;
      }
      const prov = provByKey.get(provKey(targetClass, field.name));
      const config = new Set(prov?.configGuards ?? []);
      const constraint = constraintByPred.get(field.predicate);
      assertFieldGuardsTraceable(field, constraint, config, "manifest");
    }
  }
}

/** True for a shape property that requires PRESENCE at Violation grade (a runtime MUST). */
function isPresenceMust(constraint: ShapeConstraint): boolean {
  return (
    constraint.minCount !== undefined &&
    constraint.minCount >= 1 &&
    isFailClosedSeverity(constraint.severity)
  );
}

/**
 * Composite fidelity — the P0 exit criterion extended to the multi-node projection. Per
 * node: every projected field (flat or nested) traces to a shape property at its
 * predicate; a NESTED field maps an IRI-link property, and a Violation-graded link
 * carries the requiredFailClosed cross-node MUST (and only a Violation link may);
 * FLAT-field guards + structure trace exactly as for a flat entity (the name is a
 * codegen rename, not a shape property, so it is NOT compared). Crucially, every
 * presence-MUST (minCount ≥ 1, Violation) of a projected node MUST be covered by a field
 * — a security-critical constraint can never be silently dropped from the projection.
 */
function assertCompositeFidelity(
  shapes: NormalizedShapes,
  compiled: CompileResult,
  composite: CompositeManifestEntity,
): void {
  const shapeByTarget = shapeByTargetClass(shapes);
  const provByKey = provenanceIndex(compiled);

  for (const node of composite.nodes) {
    const targetClass = node.typeIris[0] ?? "";
    const shape = shapeByTarget.get(targetClass);
    if (!shape) {
      throw new FidelityError(
        `composite ${composite.name} node "${node.name}" has no shape for target class ${targetClass}`,
      );
    }
    const constraintByPred = new Map(shape.properties.map((c) => [c.pathIri, c] as const));
    const coveredPreds = new Set<string>();

    for (const field of node.fields) {
      const constraint = constraintByPred.get(field.predicate);
      if (!constraint) {
        throw new FidelityError(
          `composite ${composite.name} node "${node.name}" field ${field.name} has no shape property at ${field.predicate}`,
        );
      }
      coveredPreds.add(field.predicate);

      if (field.kind === "nested") {
        // A nested link may only map an IRI-valued (object-property) shape property.
        if (constraint.kind !== "iri") {
          throw new FidelityError(
            `composite ${composite.name} node "${node.name}" nested link ${field.name} maps a non-IRI shape property`,
          );
        }
        // A nested link is a SINGLE-VALUED tree edge (the runtime models it as maxCount 1);
        // fidelity is the tamper defense, so it must MIRROR the compile-time invariant — a
        // manifest mapping a nested link to an unbounded / maxCount>1 shape property is
        // rejected (set-valued nested links are a documented future feature).
        if (constraint.maxCount !== 1) {
          throw new FidelityError(
            `composite ${composite.name} node "${node.name}" nested link ${field.name} maps the multi-valued shape property ${field.predicate} (maxCount ${constraint.maxCount ?? "unbounded"}); a nested link must be single-valued (sh:maxCount 1)`,
          );
        }
        const required = field.guards?.requiredFailClosed === true;
        if (required && !isPresenceMust(constraint)) {
          throw new FidelityError(
            `composite ${composite.name} node "${node.name}" nested link ${field.name} requiredFailClosed is not shape-derived (not a Violation-graded minCount ≥ 1)`,
          );
        }
        if (isPresenceMust(constraint) && !required) {
          throw new FidelityError(
            `composite ${composite.name} node "${node.name}" nested link ${field.name} drops a Violation-graded MUST (missing requiredFailClosed)`,
          );
        }
        // A nested link carries no other guard (the runtime validator enforces this).
        for (const key of Object.keys(field.guards ?? {})) {
          if (key !== "requiredFailClosed") {
            throw new FidelityError(
              `composite ${composite.name} node "${node.name}" nested link ${field.name} carries an unexpected guard "${key}"`,
            );
          }
        }
        continue;
      }

      // FLAT field — structural check (kind / datatype / cardinality / collection /
      // inValues), aligned by predicate (the name is a codegen rename choice).
      const shapeProj: FieldProjection = {
        name: field.name,
        predicate: constraint.pathIri,
        kind: constraint.kind,
        datatype: norm(constraint.datatype),
        minCount: constraint.minCount ?? null,
        maxCount: constraint.maxCount ?? null,
        collection: constraint.maxCount !== 1,
        inValues: inJson(constraint.in),
      };
      const manifestProj: FieldProjection = {
        name: field.name,
        predicate: field.predicate,
        kind: field.kind,
        datatype: norm(field.datatype),
        minCount: field.minCount ?? null,
        maxCount: field.maxCount ?? null,
        collection: field.collection === "set",
        inValues: inJson(field.in as ShapeScalar[] | undefined),
      };
      const diffs = diffField(shapeProj, manifestProj).filter((d) => !d.startsWith("name:"));
      if (diffs.length > 0) {
        throw new FidelityError(
          `composite ${composite.name} node "${node.name}" field ${field.name} mismatches its shape property ${field.predicate}: ${diffs.join("; ")}`,
        );
      }

      const prov = provByKey.get(provKey(targetClass, field.name));
      assertFieldGuardsTraceable(
        field,
        constraint,
        new Set(prov?.configGuards ?? []),
        `composite ${composite.name} node "${node.name}"`,
      );
    }

    // MUST-coverage — every presence-MUST property of the node must be projected.
    for (const constraint of shape.properties) {
      if (isPresenceMust(constraint) && !coveredPreds.has(constraint.pathIri)) {
        throw new FidelityError(
          `composite ${composite.name} node "${node.name}" omits the Violation-graded MUST property ${constraint.pathIri}`,
        );
      }
    }
  }
}

/**
 * Assert model.json is a faithful, fully-traceable projection of shapes.ttl.
 * Throws {@link FidelityError} on any mismatch (fails the build). This is the P0
 * exit criterion; a seeded manifest mutation must make it throw. Flat entities and
 * composite entities are verified separately (each shape a composite claims as a node
 * is projected inside that composite, never also as a flat entity).
 */
export function assertFidelity(shapes: NormalizedShapes, compiled: CompileResult): void {
  const composites = compiled.manifest.entities.filter(isCompositeEntity);
  const claimed = new Set<string>();
  for (const composite of composites) {
    for (const node of composite.nodes) if (node.typeIris[0]) claimed.add(node.typeIris[0]);
  }

  // Flat checks over ONLY the flat entities + the shapes NOT claimed by a composite.
  const flatEntities = compiled.manifest.entities.filter((e) => !isCompositeEntity(e));
  const flatManifest: ModelManifest = { ...compiled.manifest, entities: flatEntities };
  const flatCompiled: CompileResult = { ...compiled, manifest: flatManifest };
  const flatShapes: NormalizedShapes = {
    ...shapes,
    nodeShapes: shapes.nodeShapes.filter((s) => !claimed.has(s.targetClass)),
  };
  assertStructural(flatShapes, flatManifest);
  assertPatternCoverage(flatShapes, flatCompiled);
  assertTraceability(flatCompiled, flatShapes);

  for (const composite of composites) assertCompositeFidelity(shapes, compiled, composite);
}
