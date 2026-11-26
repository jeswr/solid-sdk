// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Claude Opus 5.5
import {
  isSafeAbsoluteIri,
  MAX_ORDERED_ITEMS,
  type ManifestOrdered,
  VALIDATED_DATATYPES,
} from "@jeswr/model-runtime";
import { AdmissionError } from "./admission.js";
import { type CodegenConfig, isCompositeConfig } from "./config.js";
import { RDF, SH, XSD } from "./rdf.js";
import {
  localName,
  type NodeShapeModel,
  type NormalizedShapes,
  propertySources,
  type ShapeConstraint,
} from "./shapes.js";

const METADATA = ["name", "description", "message", "order", "group", "severity"];
export interface OrderedShape {
  item: NodeShapeModel;
  position: ShapeConstraint;
  value: ShapeConstraint;
  descriptor: ManifestOrdered;
}

/** Closed item admission, reused independently by compiler and fidelity. */
export function resolveOrdered(shapes: NormalizedShapes, outer: ShapeConstraint): OrderedShape {
  const name = outer.name ?? localName(outer.pathIri);
  const fail = (reason: string): never => {
    throw new AdmissionError([
      {
        code: "invalid-ordered",
        severity: "error",
        subject: outer.shapeIri,
        message: `ordered field ${name}, item shape ${outer.node ?? "(missing sh:node)"}: ${reason}`,
      },
    ]);
  };
  const cfg = outer.ordered;
  if (
    !cfg ||
    typeof cfg !== "object" ||
    Array.isArray(cfg) ||
    Object.keys(cfg).sort().join(",") !== "position,value" ||
    !isSafeAbsoluteIri(cfg.position) ||
    !isSafeAbsoluteIri(cfg.value) ||
    new Set([cfg.position, cfg.value, outer.pathIri, `${RDF}type`]).size !== 4
  )
    return fail("ordered config requires exactly distinct safe position and value IRIs");
  if (
    !outer.node ||
    outer.kind !== "iri" ||
    outer.datatype !== undefined ||
    outer.aliasPredicates !== undefined ||
    (outer.nodeKind !== undefined && outer.nodeKind !== `${SH}IRI`)
  )
    return fail("requires an unaliased IRI sh:node link");
  const nodeRef = outer.node;
  const item = shapes.nodeShapes.find((s) => (s.shapeIris ?? [s.iri]).includes(nodeRef));
  if (!item || item.aliasTypeIris !== undefined || (item.shapeIris?.length ?? 1) !== 1)
    return fail("requires one named item NodeShape with one targetClass");
  if (
    !shapes.quads.some(
      (q) =>
        q.subject.value === item.iri &&
        q.predicate.value === `${RDF}type` &&
        q.object.termType === "NamedNode" &&
        q.object.value === `${SH}NodeShape`,
    )
  )
    return fail("item must declare sh:NodeShape");
  for (const q of shapes.quads) {
    if (
      q.subject.value === item.iri &&
      q.predicate.value.startsWith(SH) &&
      ![...METADATA, "targetClass", "property"].includes(q.predicate.value.slice(SH.length))
    )
      return fail(`unsupported item-shape constraint ${q.predicate.value}`);
  }
  // Every read fails closed and every write throws above the runtime item cap, so an
  // unsatisfiable or unreachable outer cardinality is a generation-time error.
  if (
    [outer, ...propertySources(outer)].some(
      (c) => (c.minCount ?? 0) > MAX_ORDERED_ITEMS || (c.maxCount ?? 0) > MAX_ORDERED_ITEMS,
    )
  )
    return fail(`outer sh:minCount / sh:maxCount must not exceed ${MAX_ORDERED_ITEMS} items`);
  if (outer.hasClass !== undefined && outer.hasClass !== item.targetClass)
    return fail("outer sh:class must equal the item targetClass");
  const position = item.properties.find((c) => c.pathIri === cfg.position);
  const value = item.properties.find((c) => c.pathIri === cfg.value);
  if (item.properties.length !== 2 || !position || !value)
    return fail("item must have exactly the configured position and ONE value property");
  const checkComponents = (c: ShapeConstraint, allowed: string[]) => {
    const ids = new Set(propertySources(c).map((s) => s.shapeIri));
    for (const q of shapes.quads) {
      if (!ids.has(q.subject.value) || !q.predicate.value.startsWith(SH)) continue;
      const key = q.predicate.value.slice(SH.length);
      if (![...METADATA, ...allowed].includes(key)) fail(`unsupported ${key} on ${c.shapeIri}`);
      if (
        !METADATA.includes(key) &&
        shapes.quads.filter(
          (other) => other.subject.equals(q.subject) && other.predicate.equals(q.predicate),
        ).length !== 1
      )
        fail(`multiple ${key} parameters on ${c.shapeIri}`);
    }
  };
  checkComponents(outer, ["path", "node", "nodeKind", "class", "minCount", "maxCount"]);
  checkComponents(position, [
    "path",
    "datatype",
    "nodeKind",
    "minCount",
    "maxCount",
    "minInclusive",
  ]);
  checkComponents(value, [
    "path",
    "datatype",
    "nodeKind",
    "minCount",
    "maxCount",
    "in",
    "pattern",
    "minLength",
    "minInclusive",
    "maxInclusive",
  ]);
  for (const c of [position, value]) {
    if (
      c.minCount !== 1 ||
      c.maxCount !== 1 ||
      c.aliasPredicates !== undefined ||
      c.ordered !== undefined ||
      c.node !== undefined ||
      c.hasClass !== undefined
    )
      return fail(`item property ${c.pathIri} requires minCount 1 / maxCount 1 and a scalar value`);
    // The runtime enforces item properties at the OUTER severity; an advisory item
    // severity would make the emitted SHACL laxer than the runtime, so reject it.
    if (
      propertySources(c).some(
        (source) => source.severity !== undefined && source.severity !== `${SH}Violation`,
      )
    )
      return fail(`item property ${c.pathIri} must not carry a non-Violation sh:severity`);
  }
  if (
    position.kind !== "literal" ||
    position.datatype !== `${XSD}integer` ||
    (position.nodeKind !== undefined && position.nodeKind !== `${SH}Literal`)
  )
    return fail("position requires xsd:integer");
  if (
    position.minInclusive !== undefined &&
    (!Number.isSafeInteger(position.minInclusive) || position.minInclusive > 1)
  )
    return fail(
      "position minInclusive must be a safe integer no greater than 1 (writes start at 1)",
    );
  if (
    value.kind === "literal"
      ? !value.datatype || !VALIDATED_DATATYPES.includes(value.datatype)
      : value.datatype !== undefined || value.nodeKind !== `${SH}IRI`
  )
    return fail("value requires an admitted literal datatype or explicit sh:IRI");
  const severity = propertySources(outer).some(
    (c) => c.severity === undefined || c.severity === `${SH}Violation`,
  )
    ? "Violation"
    : outer.severity === `${SH}Info`
      ? "Info"
      : "Warning";
  return {
    item,
    position,
    value,
    descriptor: {
      itemClass: item.targetClass,
      position: cfg.position,
      value: cfg.value,
      ...(position.minInclusive !== undefined ? { minPosition: position.minInclusive } : {}),
      severity,
    },
  };
}

/** Scalar projection combines all item-value constraints with OUTER presence/cardinality. */
export function orderedScalar(outer: ShapeConstraint, value: ShapeConstraint): ShapeConstraint {
  const {
    minCount: _min,
    maxCount: _max,
    severity: _severity,
    sources: _sources,
    ...scalar
  } = value;
  return {
    ...scalar,
    name: outer.name,
    pathIri: outer.pathIri,
    shapeIri: outer.shapeIri,
    ordered: outer.ordered,
    minCount: outer.minCount,
    maxCount: outer.maxCount,
    severity: outer.severity,
    sources: propertySources(outer).map((source) => ({
      ...scalar,
      minCount: source.minCount,
      severity: source.severity,
    })),
  };
}

/** Item shapes belong to their ordered field; never also silently emit a flat entity. */
export function orderedItemTargets(shapes: NormalizedShapes, config?: CodegenConfig): Set<string> {
  const targets = new Set<string>();
  for (const shape of shapes.nodeShapes)
    for (const c of shape.properties) {
      if (c.ordered === undefined) continue;
      const { item } = resolveOrdered(shapes, c);
      targets.add(item.targetClass);
      if (
        config?.entities.some((e) =>
          (isCompositeConfig(e) ? Object.values(e.nodes) : [e]).some(
            (n) => n.targetClass === item.targetClass,
          ),
        )
      )
        throw new AdmissionError([
          {
            code: "invalid-ordered",
            severity: "error",
            subject: item.iri,
            message: `ordered field ${c.name ?? localName(c.pathIri)} item shape has competing entity ownership`,
          },
        ]);
    }
  return targets;
}
