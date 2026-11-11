// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { AdmissionError } from "./admission.js";
import { compareStrings, SH } from "./rdf.js";
import {
  enumValues,
  type NodeShapeModel,
  propertySources,
  type ShapeConstraint,
} from "./shapes.js";

/** Conjoin class-targeted shapes without losing any source constraint graph. */
export function mergeNodeShapes(shapes: NodeShapeModel[]): NodeShapeModel[] {
  const groups = new Map<string, NodeShapeModel[]>();
  for (const shape of shapes) {
    const group = groups.get(shape.targetClass) ?? [];
    group.push(shape);
    groups.set(shape.targetClass, group);
  }
  return [...groups.values()].map((group) => {
    group.sort((a, b) => compareStrings(a.iri, b.iri));
    const first = group[0] as NodeShapeModel;
    if (group.length === 1) return first;
    const properties = new Map<string, ShapeConstraint>();
    const owners = new Map<string, string>();
    const paths = new Map<string, string>();
    const conflict = (left: string, right: string, reason: string): never => {
      throw new AdmissionError([
        {
          code: "conflicting-node-shapes",
          severity: "error",
          subject: first.targetClass,
          message: `NodeShapes ${left} and ${right} conflict: ${reason}`,
        },
      ]);
    };
    for (const shape of group) {
      if (JSON.stringify(shape.aliasTypeIris ?? []) !== JSON.stringify(first.aliasTypeIris ?? []))
        conflict(first.iri, shape.iri, "different targetClass alias sets");
      for (const c of shape.properties) {
        const prior = properties.get(c.pathIri);
        const owner = owners.get(c.pathIri) as string;
        for (const path of [c.pathIri, ...(c.aliasPredicates ?? [])]) {
          const canonical = paths.get(path);
          if (canonical !== undefined && canonical !== c.pathIri)
            conflict(owners.get(canonical) as string, shape.iri, `overlapping path ${path}`);
          paths.set(path, c.pathIri);
        }
        if (!prior) {
          properties.set(c.pathIri, c);
          owners.set(c.pathIri, shape.iri);
          continue;
        }
        const fail = (reason: string): never =>
          conflict(owner, shape.iri, `${c.pathIri}: ${reason}`);
        // A missing parameter is unconstrained; two different explicit parameters
        // cannot silently select the first source's kind, class, or child shape.
        for (const key of [
          "datatype",
          "hasClass",
          "nodeKind",
          "node",
          "name",
          "pattern",
        ] as const) {
          if (prior[key] !== undefined && c[key] !== undefined && prior[key] !== c[key])
            fail(`different ${key}`);
        }
        if (JSON.stringify(prior.aliasPredicates ?? []) !== JSON.stringify(c.aliasPredicates ?? []))
          fail("different alternative paths");
        const merged: ShapeConstraint = { ...prior, sources: [...propertySources(prior), c] };
        for (const key of [
          "datatype",
          "hasClass",
          "nodeKind",
          "node",
          "name",
          "pattern",
          "conceptIris",
        ] as const) {
          if (merged[key] === undefined) Object.assign(merged, { [key]: c[key] });
        }
        if (
          merged.datatype !== undefined &&
          (merged.hasClass !== undefined ||
            merged.node !== undefined ||
            merged.nodeKind === `${SH}IRI`)
        )
          fail("incompatible datatype and IRI constraints");
        if (
          merged.nodeKind === `${SH}Literal` &&
          (merged.hasClass !== undefined || merged.node !== undefined)
        )
          fail("incompatible literal and class/node constraints");
        merged.kind =
          merged.datatype !== undefined || merged.nodeKind === `${SH}Literal` ? "literal" : "iri";
        for (const [key, combine] of [
          ["minCount", Math.max],
          ["minInclusive", Math.max],
          ["minLength", Math.max],
          ["maxCount", Math.min],
          ["maxInclusive", Math.min],
        ] as const) {
          const a = prior[key],
            b = c[key];
          if (b !== undefined) merged[key] = a === undefined ? b : combine(a, b);
        }
        if (
          merged.minCount !== undefined &&
          merged.maxCount !== undefined &&
          merged.minCount > merged.maxCount
        )
          fail("minCount > maxCount");
        if (
          merged.minInclusive !== undefined &&
          merged.maxInclusive !== undefined &&
          merged.minInclusive > merged.maxInclusive
        )
          fail("minInclusive > maxInclusive");
        if (c.in !== undefined)
          merged.in = prior.in === undefined ? c.in : prior.in.filter((v) => c.in?.includes(v));
        if (enumValues(merged)?.length === 0) fail("empty enumeration intersection");
        properties.set(c.pathIri, merged);
        owners.set(c.pathIri, `${owner}, ${shape.iri}`);
      }
    }
    return {
      ...first,
      shapeIris: group.map((s) => s.iri),
      properties: [...properties.values()].sort((a, b) => compareStrings(a.pathIri, b.pathIri)),
    };
  });
}
