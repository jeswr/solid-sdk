// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Codex GPT-6
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
  literalMapper,
  type ManifestField,
  type ManifestFieldGuards,
  type ModelManifest,
} from "@jeswr/model-runtime";
import {
  type CompileResult,
  type FieldProvenance,
  iriSchemeForPattern,
  isFailClosedSeverity,
  isHttpPattern,
  linkTargetConforms,
} from "./compile.js";
import {
  enumValues,
  implicitClassTargets,
  localName,
  type NormalizedShapes,
  propertySources,
  type ShapeConstraint,
  type ShapeScalar,
  sharedAliasPredicates,
} from "./shapes.js";

/** The shape-derived projection of one field (the constraints model.json must cover). */
interface FieldProjection {
  name: string;
  predicate: string;
  aliasPredicates: string;
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
      aliasPredicates: JSON.stringify(c.aliasPredicates ?? []),
      kind: c.kind,
      datatype: norm(c.datatype),
      minCount: c.minCount ?? null,
      maxCount: c.maxCount ?? null,
      collection: c.maxCount !== 1,
      inValues: inJson(enumValues(c)),
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
      aliasPredicates: JSON.stringify(f.aliasPredicates ?? []),
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
    "aliasPredicates",
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

/** Alias types trace exactly to the extra targetClasses, in both directions. */
function assertTypeAliases(
  shape: { targetClass: string; aliasTypeIris?: string[] },
  node: { typeIris: string[]; aliasTypeIris?: string[] },
): void {
  if (
    JSON.stringify(node.typeIris) !== JSON.stringify([shape.targetClass]) ||
    JSON.stringify(node.aliasTypeIris ?? []) !== JSON.stringify(shape.aliasTypeIris ?? [])
  ) {
    throw new FidelityError(`type alias mismatch for ${shape.targetClass}`);
  }
}

/** (a) Structural projection equality — the core fidelity check. */
function assertStructural(shapes: NormalizedShapes, manifest: ModelManifest): void {
  for (const entity of manifest.entities) {
    if (isCompositeEntity(entity)) continue;
    const shape = shapes.nodeShapes.find((s) => entity.typeIris.includes(s.targetClass));
    if (shape) assertTypeAliases(shape, entity);
  }
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
        const hasGuard = field.guards?.iriScheme !== undefined;
        if (hasPattern && field.guards?.iriScheme !== iriSchemeForPattern(c.pattern)) {
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
  if (guard === "iriEnum") return guards.iriEnum === true && constraint.conceptIris !== undefined;
  if (guard === "iriScheme")
    return (
      guards.iriScheme === iriSchemeForPattern(constraint.pattern) &&
      constraint.kind === "iri" &&
      isHttpPattern(constraint.pattern)
    );
  if (guard === "iriPattern")
    return (
      constraint.kind === "iri" &&
      isHttpPattern(constraint.pattern) &&
      guards.iriPattern === iriSchemeForPattern(constraint.pattern)
    );
  // Severity-aware (G1): a required guard is shape-derived only when the minCount ≥ 1
  // constraint is Violation-graded (or severity absent) AND the guard fails closed.
  if (guard === "requiredFailClosed")
    return guards.requiredFailClosed === true && isPresenceMust(constraint);
  if (guard === "minInclusive")
    return constraint.minInclusive !== undefined && guards.minInclusive === constraint.minInclusive;
  if (guard === "maxInclusive")
    return constraint.maxInclusive !== undefined && guards.maxInclusive === constraint.maxInclusive;
  if (guard === "minLength")
    return constraint.minLength !== undefined && guards.minLength === constraint.minLength;
  if (guard === "nonBlank") return guards.nonBlank === true && constraint.pattern === "\\S";
  return false;
}

/** Re-derive ALL required scalar guards from SHACL, independently of the compiler. */
function requiredShapeGuards(c: ShapeConstraint): ManifestFieldGuards {
  const required: ManifestFieldGuards = {};
  if (c.conceptIris !== undefined) required.iriEnum = true;
  if (isPresenceMust(c)) required.requiredFailClosed = true;
  if (c.kind === "iri" && isHttpPattern(c.pattern)) {
    required.iriScheme = iriSchemeForPattern(c.pattern);
    required.iriPattern = iriSchemeForPattern(c.pattern);
  }
  if (c.minInclusive !== undefined) required.minInclusive = c.minInclusive;
  if (c.maxInclusive !== undefined) required.maxInclusive = c.maxInclusive;
  const stringValue =
    c.kind === "iri" || (c.datatype !== undefined && literalMapper(c.datatype).jsType === "string");
  if (c.minLength !== undefined && stringValue) required.minLength = c.minLength;
  if (stringValue && c.pattern === "\\S") {
    required.nonBlank = true;
  }
  return required;
}

/** Assert every guard + default on `field` is shape-derived or config-declared (no silent guard). */
function assertFieldGuardsTraceable(
  field: ManifestField,
  constraint: ShapeConstraint | undefined,
  configGuards: Set<string>,
  where: string,
): void {
  const guards = field.guards;
  if (
    constraint !== undefined &&
    isPresenceMust(constraint) &&
    guards?.requiredFailClosed !== true
  ) {
    throw new FidelityError(`${where} field ${field.name} drops a MUST (requiredFailClosed)`);
  }
  if (
    constraint?.kind === "iri" &&
    isHttpPattern(constraint.pattern) &&
    guards?.iriScheme !== iriSchemeForPattern(constraint.pattern)
  ) {
    throw new FidelityError(
      `${where} field ${field.name} widens or drops the shape pattern scheme`,
    );
  }
  if (constraint !== undefined) {
    const required = requiredShapeGuards(constraint);
    for (const key of Object.keys(required) as (keyof ManifestFieldGuards)[]) {
      if (guards?.[key] !== required[key]) {
        throw new FidelityError(
          `${where} field ${field.name} drops or weakens shape guard "${key}"`,
        );
      }
    }
    if (isPresenceMust(constraint) && field.default !== undefined) {
      throw new FidelityError(
        `${where} field ${field.name} default cannot satisfy a Violation MUST`,
      );
    }
  }
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
      const prov = provByKey.get(provKey(targetClass, field.name));
      const config = new Set(prov?.configGuards ?? []);
      const constraint = constraintByPred.get(field.predicate);
      assertFieldGuardsTraceable(field, constraint, config, "manifest");
    }
  }
}

/** True for a shape property that requires PRESENCE at Violation grade (a runtime MUST). */
function isPresenceMust(constraint: ShapeConstraint): boolean {
  return propertySources(constraint).some(
    (c) => (c.minCount ?? 0) >= 1 && isFailClosedSeverity(c.severity),
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
  typeAliases: ReadonlySet<string>,
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
    assertTypeAliases(shape, node);
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
        if (field.aliasPredicates !== undefined || constraint.aliasPredicates !== undefined) {
          throw new FidelityError("read aliases are not supported on nested links");
        }
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
        if (
          (field.classOnly === true) !==
          (constraint.node === undefined && constraint.hasClass !== undefined)
        ) {
          throw new FidelityError(
            `composite link ${field.name} changes class-only constraint semantics`,
          );
        }
        if (field.hasClass !== constraint.hasClass) {
          throw new FidelityError(
            `composite ${composite.name} link ${field.name} changes or drops sh:class`,
          );
        }
        const target = composite.nodes.find((candidate) => candidate.name === field.node);
        if (constraint.hasClass !== undefined && typeAliases.has(constraint.hasClass)) {
          throw new FidelityError(
            `composite ${composite.name} link ${field.name} sh:class ${constraint.hasClass} is a target type alias removed by migration`,
          );
        }
        if (
          target?.typeIris.length !== 1 ||
          !linkTargetConforms(shapes, constraint, target.typeIris[0] as string)
        ) {
          throw new FidelityError(
            `composite ${composite.name} link ${field.name} target class does not conform to sh:class / sh:node`,
          );
        }
        if (field.minCount !== constraint.minCount) {
          throw new FidelityError(
            `composite ${composite.name} nested link ${field.name} minCount differs from its shape`,
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

      if (
        node.name !== composite.root &&
        constraint.hasClass !== undefined &&
        constraint.conceptIris === undefined
      ) {
        throw new FidelityError(
          `child shape sh:class constraint ${field.predicate} requires a projected composite link`,
        );
      }
      // FLAT field — structural check (kind / datatype / cardinality / collection /
      // inValues), aligned by predicate (the name is a codegen rename choice).
      const shapeProj: FieldProjection = {
        name: field.name,
        predicate: constraint.pathIri,
        aliasPredicates: JSON.stringify(constraint.aliasPredicates ?? []),
        kind: constraint.kind,
        datatype: norm(constraint.datatype),
        minCount: constraint.minCount ?? null,
        maxCount: constraint.maxCount ?? null,
        collection: constraint.maxCount !== 1,
        inValues: inJson(enumValues(constraint)),
      };
      const manifestProj: FieldProjection = {
        name: field.name,
        predicate: field.predicate,
        aliasPredicates: JSON.stringify(field.aliasPredicates ?? []),
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

    // Children require full constraint coverage; roots require MUST/alias coverage.
    for (const constraint of shape.properties) {
      if (node.name !== composite.root && !coveredPreds.has(constraint.pathIri)) {
        throw new FidelityError(
          `composite ${composite.name} omits child shape constraint ${constraint.pathIri}`,
        );
      }
      if (constraint.aliasPredicates !== undefined && !coveredPreds.has(constraint.pathIri)) {
        throw new FidelityError(`composite omits aliased property ${constraint.pathIri}`);
      }
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
  if (implicitClassTargets(shapes.quads).length)
    throw new FidelityError("implicit class targets are not modeled by the runtime");
  if (sharedAliasPredicates(shapes).length)
    throw new FidelityError(
      "shared canonical predicate with aliases has potentially overlapping owners",
    );
  // Independently mirror the compiler's pre-projection satisfiability checks.
  for (const shape of shapes.nodeShapes) {
    for (const c of shape.properties) {
      if (c.conceptIris !== undefined && (c.kind !== "iri" || enumValues(c)?.length === 0))
        throw new FidelityError(`property ${c.shapeIri} has an invalid concept IRI enumeration`);
      if (c.kind === "iri" && c.datatype !== undefined) {
        throw new FidelityError(
          `property ${c.shapeIri} has an incompatible datatype and IRI node kind`,
        );
      }
      if (c.minCount !== undefined && c.maxCount !== undefined && c.minCount > c.maxCount) {
        throw new FidelityError(
          `property ${c.shapeIri} has impossible cardinality: minCount > maxCount`,
        );
      }
    }
  }
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

  const typeAliases = new Set([
    ...shapes.nodeShapes.flatMap((shape) => shape.aliasTypeIris ?? []),
    ...compiled.manifest.entities.flatMap((entity) =>
      isCompositeEntity(entity)
        ? entity.nodes.flatMap((node) => node.aliasTypeIris ?? [])
        : (entity.aliasTypeIris ?? []),
    ),
  ]);
  for (const composite of composites) {
    assertCompositeFidelity(shapes, compiled, composite, typeAliases);
  }
}
