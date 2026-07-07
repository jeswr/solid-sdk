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
import { expandDatatype } from "@jeswr/model-runtime";
import { isFailClosedSeverity, isHttpPattern, } from "./compile.js";
import { localName } from "./shapes.js";
/** Canonical JSON of a closed value set (order preserved), or null when absent/empty. */
function inJson(values) {
    return values !== undefined && values.length > 0 ? JSON.stringify(values) : null;
}
/** Thrown when model.json is not a faithful projection of shapes.ttl. */
export class FidelityError extends Error {
    name = "FidelityError";
}
function norm(datatype) {
    return datatype === undefined ? null : expandDatatype(datatype);
}
function sortFields(fields) {
    return fields.slice().sort((a, b) => a.predicate.localeCompare(b.predicate));
}
function projectShapes(shapes) {
    const out = new Map();
    for (const shape of shapes.nodeShapes) {
        const fields = shape.properties.map((c) => ({
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
function projectManifest(manifest) {
    const out = new Map();
    for (const entity of manifest.entities) {
        const fields = entity.fields.map((f) => ({
            name: f.name,
            predicate: f.predicate,
            kind: f.kind,
            datatype: norm(f.datatype),
            minCount: f.minCount ?? null,
            maxCount: f.maxCount ?? null,
            collection: f.collection === "set",
            inValues: inJson(f.in),
        }));
        for (const typeIri of entity.typeIris)
            out.set(typeIri, sortFields(fields));
    }
    return out;
}
function diffField(a, b) {
    const diffs = [];
    for (const key of [
        "name",
        "kind",
        "datatype",
        "minCount",
        "maxCount",
        "collection",
        "inValues",
    ]) {
        if (a[key] !== b[key])
            diffs.push(`${key}: shapes=${JSON.stringify(a[key])} manifest=${JSON.stringify(b[key])}`);
    }
    return diffs;
}
/** (a) Structural projection equality — the core fidelity check. */
function assertStructural(shapes, manifest) {
    const shapeProj = projectShapes(shapes);
    const manifestProj = projectManifest(manifest);
    for (const [targetClass, shapeFields] of shapeProj) {
        const manifestFields = manifestProj.get(targetClass);
        if (!manifestFields) {
            throw new FidelityError(`manifest has no entity for shape target class ${targetClass}`);
        }
        const manifestByPred = new Map(manifestFields.map((f) => [f.predicate, f]));
        if (manifestFields.length !== shapeFields.length) {
            throw new FidelityError(`field-count mismatch for ${targetClass}: shapes=${shapeFields.length} manifest=${manifestFields.length}`);
        }
        for (const sf of shapeFields) {
            const mf = manifestByPred.get(sf.predicate);
            if (!mf) {
                throw new FidelityError(`manifest is missing field for ${targetClass} path ${sf.predicate}`);
            }
            const diffs = diffField(sf, mf);
            if (diffs.length > 0) {
                throw new FidelityError(`field mismatch for ${targetClass} path ${sf.predicate}: ${diffs.join("; ")}`);
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
const provKey = (targetClass, fieldName) => `${targetClass}${NUL}${fieldName}`;
function provenanceIndex(compiled) {
    return new Map(compiled.provenance.map((p) => [provKey(p.targetClass, p.fieldName), p]));
}
function shapeByTargetClass(shapes) {
    return new Map(shapes.nodeShapes.map((s) => [s.targetClass, s]));
}
/** (b) Every http(s) pattern is reflected as a scheme guard, and none is un-sourced. */
function assertPatternCoverage(shapes, compiled) {
    const provByKey = provenanceIndex(compiled);
    const shapeByTarget = shapeByTargetClass(shapes);
    for (const entity of compiled.manifest.entities) {
        for (const targetClass of entity.typeIris) {
            const shape = shapeByTarget.get(targetClass);
            if (!shape)
                continue;
            const constraintByPred = new Map(shape.properties.map((c) => [c.pathIri, c]));
            for (const field of entity.fields) {
                const c = constraintByPred.get(field.predicate);
                if (!c)
                    continue;
                const hasPattern = c.kind === "iri" && isHttpPattern(c.pattern);
                const hasGuard = field.guards?.iriScheme === "http-https";
                if (hasPattern && !hasGuard) {
                    throw new FidelityError(`shape ${shape.iri} path ${c.pathIri} has an http(s) pattern but the manifest field has no iriScheme guard`);
                }
                if (hasGuard && !hasPattern) {
                    const prov = provByKey.get(provKey(targetClass, field.name));
                    if (!prov?.configGuards.includes("iriScheme")) {
                        throw new FidelityError(`manifest field ${field.name} (${targetClass}) has an iriScheme guard with no shape pattern and no config entry`);
                    }
                }
            }
        }
    }
}
/** (c) Every manifest guard is shape-derived or config-declared (no silent guard). */
function assertTraceability(compiled, shapes) {
    const provByKey = provenanceIndex(compiled);
    const shapeByTarget = shapeByTargetClass(shapes);
    for (const entity of compiled.manifest.entities) {
        const constraintByPred = new Map(entity.typeIris
            .flatMap((tc) => shapeByTarget.get(tc)?.properties ?? [])
            .map((c) => [c.pathIri, c]));
        const targetClass = entity.typeIris[0] ?? "";
        for (const field of entity.fields) {
            const guards = field.guards;
            if (!guards)
                continue;
            const prov = provByKey.get(provKey(targetClass, field.name));
            const config = new Set(prov?.configGuards ?? []);
            const constraint = constraintByPred.get(field.predicate);
            // A guard is shape-derived only when BOTH the shape carries the corresponding
            // constraint AND the emitted guard VALUE equals it — checking the key alone
            // (does the shape have SOME minInclusive?) let a tampered value (e.g.
            // `guards.minInclusive = 999` against a `sh:minInclusive 1` shape) trace as
            // sourced. Boolean guards must be exactly `true`; a `false` guard is a runtime
            // no-op and must not count as shape-derived.
            const shapeDerivable = (guard) => {
                if (constraint === undefined)
                    return false;
                if (guard === "iriScheme")
                    return (guards.iriScheme === "http-https" &&
                        constraint.kind === "iri" &&
                        isHttpPattern(constraint.pattern));
                // Severity-aware (G1): a required guard is shape-derived only when the
                // minCount ≥ 1 constraint is Violation-graded (or severity absent) AND the
                // emitted guard actually fails closed (=== true).
                if (guard === "requiredFailClosed")
                    return (guards.requiredFailClosed === true &&
                        constraint.minCount !== undefined &&
                        constraint.minCount >= 1 &&
                        isFailClosedSeverity(constraint.severity));
                if (guard === "minInclusive")
                    return (constraint.minInclusive !== undefined && guards.minInclusive === constraint.minInclusive);
                if (guard === "maxInclusive")
                    return (constraint.maxInclusive !== undefined && guards.maxInclusive === constraint.maxInclusive);
                if (guard === "minLength")
                    return constraint.minLength !== undefined && guards.minLength === constraint.minLength;
                if (guard === "nonBlank")
                    return (guards.nonBlank === true &&
                        constraint.minLength !== undefined &&
                        constraint.minLength >= 1 &&
                        constraint.maxCount === 1 &&
                        constraint.kind === "literal");
                return false;
            };
            const guardKeys = Object.keys(guards);
            for (const key of guardKeys) {
                if (!shapeDerivable(key) && !config.has(key)) {
                    throw new FidelityError(`manifest field ${field.name} guard "${key}" is neither shape-derived nor config-declared`);
                }
            }
            // Field-level defaults are config-only data too.
            if (field.default !== undefined && !config.has("default")) {
                throw new FidelityError(`manifest field ${field.name} default is not config-declared`);
            }
            if (field.defaultNow !== undefined && !config.has("defaultNow")) {
                throw new FidelityError(`manifest field ${field.name} defaultNow is not config-declared`);
            }
            if (field.materializeDefault !== undefined && !config.has("materializeDefault")) {
                throw new FidelityError(`manifest field ${field.name} materializeDefault is not config-declared`);
            }
        }
    }
}
/**
 * Assert model.json is a faithful, fully-traceable projection of shapes.ttl.
 * Throws {@link FidelityError} on any mismatch (fails the build). This is the P0
 * exit criterion; a seeded manifest mutation must make it throw.
 */
export function assertFidelity(shapes, compiled) {
    assertStructural(shapes, compiled.manifest);
    assertPatternCoverage(shapes, compiled);
    assertTraceability(compiled, shapes);
}
//# sourceMappingURL=fidelity.js.map