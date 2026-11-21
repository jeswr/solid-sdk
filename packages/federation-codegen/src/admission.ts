// AUTHORED-BY Claude Opus 4.8
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
/**
 * L1 (tier-a) — the STRUCTURAL admission validator (design §4). Pure JS,
 * FAIL-CLOSED, run on every generation: it refuses to generate from an ontology /
 * profile that would produce a silently-incomplete model. The reasoner (tier-b) is
 * a publish-time concern and NOT part of this module.
 *
 * Checks (scoped to the sector namespace — reused external terms are not gated):
 *   1. Every class + property carries a label AND a definition.
 *   2. Every property carries rdfs:domain + rdfs:range OR a machine-readable
 *      waiver (`fedgen:deliberatelyUnconstrained`).
 *   3. Every instance-data class has a NodeShape, every literal property in it
 *      states an explicit sh:datatype, and every property states a cardinality.
 *   4. Every closed `sh:in` enumeration is a well-formed, NON-EMPTY RDF list — an
 *      empty/malformed `sh:in` fails closed (design §4 item 4 / G2). The shape model
 *      surfaces a present-but-malformed list as an empty value set.
 */

import { literalMapper, VALIDATED_DATATYPES } from "@jeswr/model-runtime";
import type { NormalizedOntology } from "./adapter.js";
import { isFailClosedSeverity, isHttpPattern, stringPatternGuard } from "./compile.js";
import { type CodegenConfig, isCompositeConfig } from "./config.js";
import { Graph, RDF, SH } from "./rdf.js";
import {
  implicitClassTargets,
  localName,
  type NormalizedShapes,
  sharedAliasPredicates,
} from "./shapes.js";

export type AdmissionSeverity = "error" | "warning";

export interface AdmissionViolation {
  code: string;
  severity: AdmissionSeverity;
  subject: string;
  message: string;
}

export interface AdmissionReport {
  /** True when there are no ERROR-severity violations (warnings do not block). */
  ok: boolean;
  namespace: string;
  violations: AdmissionViolation[];
}

/** Thrown by {@link assertAdmitted} when the ontology / profile is not admissible. */
export class AdmissionError extends Error {
  override readonly name = "AdmissionError";
  readonly violations: AdmissionViolation[];
  constructor(violations: AdmissionViolation[]) {
    const errors = violations.filter((v) => v.severity === "error");
    super(
      `ontology admission failed (${errors.length} error(s)):\n` +
        errors.map((v) => `  [${v.code}] ${v.subject}: ${v.message}`).join("\n"),
    );
    this.violations = violations;
  }
}

function inNamespace(iri: string, namespace: string): boolean {
  return iri.startsWith(namespace);
}

/**
 * Run the tier-a structural checks. `namespace` scopes which terms are gated
 * (typically the ontology's `vann:preferredNamespaceUri`).
 */
export function admit(
  ontology: NormalizedOntology,
  shapes: NormalizedShapes,
  namespace: string,
  config?: CodegenConfig,
): AdmissionReport {
  const violations: AdmissionViolation[] = [];
  const add = (code: string, severity: AdmissionSeverity, subject: string, message: string) =>
    violations.push({ code, severity, subject, message });

  // Inspect the ORIGINAL constraint graph, not just the lossy normalized projection.
  // Metadata never constrains accepted instance data. Every other sh:* predicate
  // must have an effective runtime projection; unknown components fail even at
  // advisory severity. This also covers external / orphan / nested shape subjects.
  for (const subject of implicitClassTargets(shapes.quads)) {
    add(
      "implicit-class-target",
      "error",
      subject,
      "implicit class targets are not modeled by the runtime",
    );
  }
  for (const predicate of sharedAliasPredicates(shapes)) {
    add(
      "shared-canonical-alias",
      "error",
      predicate,
      "shared canonical predicate with aliases has potentially overlapping owners",
    );
  }
  const childTargets = new Set(
    (config?.entities ?? []).flatMap((entity) =>
      isCompositeConfig(entity)
        ? Object.entries(entity.nodes)
            .filter(([name]) => name !== entity.root)
            .map(([, node]) => node.targetClass)
        : [],
    ),
  );
  const childProperties = new Set(
    shapes.nodeShapes
      .filter((shape) => childTargets.has(shape.targetClass))
      .flatMap((shape) => shape.properties.map((c) => c.shapeIri)),
  );
  const graph = new Graph(shapes.quads);
  const shapeByIri = new Map(shapes.nodeShapes.map((shape) => [shape.iri, shape]));
  const constraintByIri = new Map(
    shapes.nodeShapes.flatMap((shape) => shape.properties.map((c) => [c.shapeIri, c] as const)),
  );
  const nestedShapeIris = new Set<string>();
  for (const entity of config?.entities ?? []) {
    if (!isCompositeConfig(entity)) continue;
    for (const node of Object.values(entity.nodes)) {
      const shape = shapes.nodeShapes.find((s) => s.targetClass === node.targetClass);
      for (const c of shape?.properties ?? []) {
        if (node.links?.[c.name ?? localName(c.pathIri)] !== undefined)
          nestedShapeIris.add(c.shapeIri);
      }
    }
  }
  const structuralPredicates = new Set(
    [...constraintByIri.values()]
      .filter((c) => nestedShapeIris.has(c.shapeIri))
      .map((c) => c.pathIri),
  );
  structuralPredicates.add(`${RDF}type`);
  for (const c of constraintByIri.values()) {
    if (
      (!nestedShapeIris.has(c.shapeIri) && structuralPredicates.has(c.pathIri)) ||
      (c.aliasPredicates ?? []).some((alias) => structuralPredicates.has(alias))
    ) {
      add("reserved-predicate", "error", c.shapeIri, "field claims a runtime structural predicate");
    }
  }
  // Only complex paths already checked by parseShapes have a runtime projection.
  // Orphan paths and unsupported sh:* components still fail the closed allowlist.
  const aliasPathRoots = new Set(
    shapes.quads
      .filter(
        (q) =>
          q.predicate.value === `${SH}path` &&
          q.object.termType === "BlankNode" &&
          (constraintByIri.get(q.subject.value)?.aliasPredicates?.length ?? 0) > 0,
      )
      .map((q) => q.object.value),
  );
  const metadata = new Set(["name", "description", "message", "order", "group", "severity"]);
  const propertyComponents = new Set([
    "path",
    "datatype",
    "nodeKind",
    "minCount",
    "maxCount",
    "in",
    "minInclusive",
    "maxInclusive",
    "minLength",
    "pattern",
    "class",
    "node",
  ]);
  const nodeComponents = new Set(["targetClass", "property"]);
  const aliasPathComponents = new Set(["alternativePath"]);
  const subjects = new Map(
    shapes.quads
      .filter(
        (q) =>
          q.predicate.value.startsWith(SH) ||
          (q.predicate.value === `${RDF}type` &&
            [`${SH}NodeShape`, `${SH}PropertyShape`].includes(q.object.value)),
      )
      .map((q) => [q.subject.value, q.subject]),
  );
  for (const subject of subjects.values()) {
    const isProperty =
      graph.objects(subject, `${SH}path`).length > 0 ||
      graph.has(subject, `${RDF}type`, `${SH}PropertyShape`);
    const c = constraintByIri.get(subject.value);
    const isNested = nestedShapeIris.has(subject.value);
    for (const q of graph.store.getQuads(subject, null, null, null)) {
      if (!q.predicate.value.startsWith(SH)) continue;
      const component = q.predicate.value.slice(SH.length);
      if (metadata.has(component)) continue;
      const unsupported = (reason: string, severity: AdmissionSeverity = "error") =>
        add("unsupported-constraint", severity, subject.value, `${q.predicate.value}: ${reason}`);
      const components = aliasPathRoots.has(subject.value)
        ? aliasPathComponents
        : isProperty
          ? propertyComponents
          : nodeComponents;
      if (!components.has(component)) {
        unsupported("no runtime projection");
        continue;
      }
      const isAliasedTarget =
        component === "targetClass" &&
        (shapeByIri.get(subject.value)?.aliasTypeIris?.length ?? 0) > 0;
      if (
        component !== "property" &&
        !isAliasedTarget &&
        graph.objects(subject, q.predicate.value).length !== 1
      ) {
        unsupported("multiple constraint parameters cannot be projected");
      }
      if (
        component === "path" &&
        q.object.termType !== "NamedNode" &&
        !aliasPathRoots.has(q.object.value)
      )
        unsupported("only direct IRI or admitted alternative paths are supported");
      if (component === "nodeKind" && ![`${SH}IRI`, `${SH}Literal`].includes(q.object.value))
        unsupported("only IRI and Literal node kinds are projected");
      if (component === "datatype" && !VALIDATED_DATATYPES.includes(q.object.value)) {
        unsupported("datatype has no validated runtime mapping");
      }
      if (component === "pattern") {
        const isString =
          c?.kind === "iri" ||
          (c?.datatype !== undefined && literalMapper(c.datatype).jsType === "string");
        if (
          !c ||
          (!(c.kind === "iri" && isHttpPattern(c.pattern)) &&
            !(isString && c.pattern === "\\S") &&
            stringPatternGuard(c) === undefined)
        )
          unsupported("unknown pattern; no reviewed closed guard");
      }
      if (
        component === "minLength" &&
        c?.kind !== "iri" &&
        (!c?.datatype || literalMapper(c.datatype).jsType !== "string")
      )
        unsupported("minLength requires a string-valued projection");
      if (
        ["minInclusive", "maxInclusive"].includes(component) &&
        (!c?.datatype || literalMapper(c.datatype).jsType !== "number")
      )
        unsupported("numeric bounds require a numeric projection");
      if (
        isNested &&
        ["pattern", "in", "minLength", "minInclusive", "maxInclusive"].includes(component)
      )
        unsupported("nested links cannot carry scalar guards");
      if (component === "node") {
        if (
          q.object.termType !== "NamedNode" ||
          c?.node !== q.object.value ||
          !shapeByIri.has(q.object.value)
        ) {
          unsupported("inline or unprojected sh:node reference");
        }
        if (config !== undefined && !isNested)
          unsupported("sh:node requires a projected composite link");
      }
      if (component === "class" && !isNested && config !== undefined) {
        // Root advisory hints retain their documented omission policy. A child
        // reached through sh:node must enforce even present optional constraints.
        const advisory = !childProperties.has(subject.value) && !isFailClosedSeverity(c?.severity);
        unsupported(
          "class conformance requires a composite link; advisory flat hints are omitted",
          advisory ? "warning" : "error",
        );
      }
    }
  }

  // 1. Labels + definitions on every sector class + property.
  for (const c of ontology.classes) {
    if (!inNamespace(c.iri, namespace)) continue;
    if (c.labels.length === 0)
      add("missing-label", "error", c.iri, "class has no rdfs:label / skos:prefLabel");
    if (c.definitions.length === 0)
      add("missing-definition", "error", c.iri, "class has no rdfs:comment / skos:definition");
  }
  for (const p of ontology.properties) {
    if (!inNamespace(p.iri, namespace)) continue;
    if (p.labels.length === 0)
      add("missing-label", "error", p.iri, "property has no rdfs:label / skos:prefLabel");
    if (p.definitions.length === 0)
      add("missing-definition", "error", p.iri, "property has no rdfs:comment / skos:definition");
    // 2. domain + range, or an explicit waiver.
    if (!(p.domain && p.range) && !p.unconstrainedWaiver) {
      add(
        "missing-domain-range",
        "error",
        p.iri,
        "property lacks rdfs:domain + rdfs:range and has no fedgen:deliberatelyUnconstrained waiver",
      );
    }
  }

  // 3. Every instance-data class (a sector owl:Class) has a NodeShape covering it;
  //    literal properties carry a datatype; every property states a cardinality.
  const shapeByTarget = new Map(shapes.nodeShapes.map((s) => [s.targetClass, s]));
  for (const c of ontology.classes) {
    if (!inNamespace(c.iri, namespace)) continue;
    const shape = shapeByTarget.get(c.iri);
    if (!shape) {
      add(
        "missing-shape",
        "error",
        c.iri,
        "instance-data class has no SHACL NodeShape (sh:targetClass)",
      );
      continue;
    }
    for (const prop of shape.properties) {
      if (prop.kind === "literal" && prop.datatype === undefined) {
        add(
          "missing-datatype",
          "error",
          prop.pathIri,
          `literal property in ${shape.iri} has no explicit sh:datatype`,
        );
      }
      // 4. A declared sh:in must extract to a non-empty, well-formed value set.
      if (prop.in !== undefined && prop.in.length === 0) {
        add(
          "invalid-enum",
          "error",
          prop.pathIri,
          `property in ${shape.iri} declares an empty or malformed sh:in enumeration`,
        );
      }
      // A property SHOULD state a cardinality (warning, not blocking): a legitimately
      // unbounded set (e.g. tags) has neither, which is intentional — the ratchet.
      if (prop.minCount === undefined && prop.maxCount === undefined) {
        add(
          "missing-cardinality",
          "warning",
          prop.pathIri,
          `property in ${shape.iri} states neither sh:minCount nor sh:maxCount (unbounded set — advisory)`,
        );
      }
    }
  }

  const ok = violations.every((v) => v.severity !== "error");
  return { ok, namespace, violations };
}

/** Admit or throw {@link AdmissionError} fail-closed. */
export function assertAdmitted(
  ontology: NormalizedOntology,
  shapes: NormalizedShapes,
  namespace: string,
): AdmissionReport {
  const report = admit(ontology, shapes, namespace);
  if (!report.ok) throw new AdmissionError(report.violations);
  return report;
}
