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
import { isHttpPattern } from "./compile.js";
import { localName } from "./shapes.js";
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
        }));
        for (const typeIri of entity.typeIris)
            out.set(typeIri, sortFields(fields));
    }
    return out;
}
function diffField(a, b) {
    const diffs = [];
    for (const key of ["name", "kind", "datatype", "minCount", "maxCount", "collection"]) {
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
/** (b) Every http(s) pattern is reflected as a scheme guard, and none is un-sourced. */
function assertPatternCoverage(shapes, compiled) {
    const provByField = new Map(compiled.provenance.map((p) => [p.fieldName, p]));
    const manifestFieldByPred = new Map(compiled.manifest.entities.flatMap((e) => e.fields.map((f) => [f.predicate, f])));
    for (const shape of shapes.nodeShapes) {
        for (const c of shape.properties) {
            const field = manifestFieldByPred.get(c.pathIri);
            if (!field)
                continue;
            const hasPattern = c.kind === "iri" && isHttpPattern(c.pattern);
            const hasGuard = field.guards?.iriScheme === "http-https";
            if (hasPattern && !hasGuard) {
                throw new FidelityError(`shape ${shape.iri} path ${c.pathIri} has an http(s) pattern but the manifest field has no iriScheme guard`);
            }
            // An iriScheme guard not from a pattern must be config-declared.
            if (hasGuard && !hasPattern) {
                const prov = provByField.get(field.name);
                if (!prov?.configGuards.includes("iriScheme")) {
                    throw new FidelityError(`manifest field ${field.name} has an iriScheme guard with no shape pattern and no config entry`);
                }
            }
        }
    }
}
/** (c) Every manifest guard is shape-derived or config-declared (no silent guard). */
function assertTraceability(compiled, shapes) {
    const provByField = new Map(compiled.provenance.map((p) => [p.fieldName, p]));
    const constraintByPred = new Map(shapes.nodeShapes.flatMap((s) => s.properties.map((c) => [c.pathIri, c])));
    for (const entity of compiled.manifest.entities) {
        for (const field of entity.fields) {
            const guards = field.guards;
            if (!guards)
                continue;
            const prov = provByField.get(field.name);
            const config = new Set(prov?.configGuards ?? []);
            const constraint = constraintByPred.get(field.predicate);
            const shapeDerivable = (guard) => {
                if (guard === "iriScheme")
                    return constraint?.kind === "iri" && isHttpPattern(constraint.pattern);
                if (guard === "requiredFailClosed")
                    return constraint?.minCount !== undefined && constraint.minCount >= 1;
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