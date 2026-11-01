// AUTHORED-BY Claude Opus 4.8
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

import type { NormalizedOntology } from "./adapter.js";
import type { NormalizedShapes } from "./shapes.js";

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
): AdmissionReport {
  const violations: AdmissionViolation[] = [];
  const add = (code: string, severity: AdmissionSeverity, subject: string, message: string) =>
    violations.push({ code, severity, subject, message });

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
