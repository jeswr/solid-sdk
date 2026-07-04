// AUTHORED-BY Claude Sonnet 5
//
// G8 — the per-ACTION PROV activity-bundle emitter (agent-delegation profile
// §8, `docs/delegation-profile.md`). The sibling of `delegationProvenance`
// (`src/delegation.ts`, the chain-attribution overlay): where that function
// traces a DELEGATION CHAIN back to its issuing principals,
// `actionProvenance` traces a single PERFORMED ACTION — an agent taking an
// action under a delegated/authorized permission — as a `prov:Activity`
// bundle: `prov:wasAssociatedWith` the acting agent, `prov:used` the
// resource(s)/authorizing target, `prov:generated` any produced artifact(s),
// and a `prov:qualifiedAssociation` naming the authorizing plan
// (`prov:hadPlan` — the leaf Agreement) alongside the standing
// `prov:actedOnBehalfOf` edge when the actor is itself a delegate.
//
// Ported from `accountable-agent-runtime`'s runtime-local G8 stand-in
// (`src/trace/activity.ts`) verbatim in shape — same `ActionProvenanceInput`
// fields, same emitted triple set — so the runtime can delete its local copy
// and depend on this package instead (BUILD-PLAN.md Phase 1 item 2).
//
// CRITICAL: every written IRI routes through the SAME `GraphBuilder`
// `iriTerm`/`escapeIri` chokepoint `delegationProvenance` uses (never a
// hand-built triple) — the keystone's audit-trail triple-injection HIGH must
// not reopen here. The JSON-LD sibling ({@link actionProvenanceJsonLd})
// mirrors `policyToJsonLd`'s escaping discipline (`escapeIri` on every @id /
// IRI-valued field) so a hostile IRI cannot break out of either
// serialisation, and the two paths stay byte-identical on the shared fields
// (delegatedUnder-style escaping parity).

import type { Quad } from "@rdfjs/types";
import { escapeIri } from "./iri.js";
import {
  PROV_ACTED_ON_BEHALF_OF,
  PROV_ACTIVITY,
  PROV_AGENT,
  PROV_ASSOCIATION,
  PROV_ENDED_AT_TIME,
  PROV_GENERATED,
  PROV_HAD_PLAN,
  PROV_INLINE_CONTEXT,
  PROV_QUALIFIED_ASSOCIATION,
  PROV_STARTED_AT_TIME,
  PROV_USED,
  PROV_WAS_ASSOCIATED_WITH,
  PROV_WAS_DERIVED_FROM,
  PROV_WAS_GENERATED_BY,
  RDF_TYPE,
  XSD_DATETIME,
} from "./vocab.js";
import { GraphBuilder, iriRef } from "./wrappers.js";

/** The inputs to a per-action PROV bundle (delegation profile §8). */
export interface ActionProvenanceInput {
  /** The activity IRI (`<#act>`). */
  readonly activity: string;
  /** The acting agent's WebID (`prov:wasAssociatedWith`). */
  readonly agent: string;
  /** The principal the agent acted on behalf of (`prov:actedOnBehalfOf`). Optional — omit for a direct (non-delegated) actor. */
  readonly onBehalfOf?: string;
  /** The resource(s) the activity used (`prov:used`). */
  readonly used: string | readonly string[];
  /** The artifact(s) the activity generated (`prov:generated`). Optional. */
  readonly generated?: string | readonly string[];
  /** The plan the activity was carried out under — the leaf Agreement IRI (`prov:hadPlan`). */
  readonly plan: string;
  /** The activity start instant. */
  readonly started: Date;
  /** The activity end instant. Optional. */
  readonly ended?: Date;
}

function asArray(v: string | readonly string[] | undefined): readonly string[] {
  if (v === undefined) {
    return [];
  }
  return typeof v === "string" ? [v] : v;
}

/**
 * Emit the per-action PROV activity bundle (delegation profile §8) as quads —
 * `prov:Activity` with `wasAssociatedWith` / `used` / `generated` / times and
 * a `qualifiedAssociation` naming the `hadPlan` (the leaf Agreement), plus the
 * `actedOnBehalfOf` edge and, per generated artifact, `wasDerivedFrom` the
 * used resources + `wasGeneratedBy` the activity. Built via the typed
 * {@link GraphBuilder} write path — no hand-built triples, and every IRI is
 * percent-escaped at the same chokepoint {@link delegationProvenance} uses,
 * so a hostile `agent`/`activity`/`plan`/`used`/`generated` value can never
 * inject a triple (it fails closed inside its own escaped IRI instead).
 */
export function actionProvenance(input: ActionProvenanceInput): Quad[] {
  const b = new GraphBuilder();
  const act = iriRef(input.activity);
  b.addIri(act, RDF_TYPE, PROV_ACTIVITY);
  b.addIri(act, PROV_WAS_ASSOCIATED_WITH, input.agent);
  const used = asArray(input.used);
  for (const u of used) {
    b.addIri(act, PROV_USED, u);
  }
  const generated = asArray(input.generated);
  for (const g of generated) {
    b.addIri(act, PROV_GENERATED, g);
  }
  b.addLiteral(act, PROV_STARTED_AT_TIME, input.started.toISOString(), XSD_DATETIME);
  if (input.ended !== undefined) {
    b.addLiteral(act, PROV_ENDED_AT_TIME, input.ended.toISOString(), XSD_DATETIME);
  }
  const assoc = b.linkBlankNode(act, PROV_QUALIFIED_ASSOCIATION);
  b.addIri(assoc, RDF_TYPE, PROV_ASSOCIATION);
  b.addIri(assoc, PROV_AGENT, input.agent);
  b.addIri(assoc, PROV_HAD_PLAN, input.plan);
  if (input.onBehalfOf !== undefined) {
    b.addIri(iriRef(input.agent), PROV_ACTED_ON_BEHALF_OF, input.onBehalfOf);
  }
  for (const g of generated) {
    const artifact = iriRef(g);
    for (const u of used) {
      b.addIri(artifact, PROV_WAS_DERIVED_FROM, u);
    }
    b.addIri(artifact, PROV_WAS_GENERATED_BY, input.activity);
  }
  return b.quads();
}

/**
 * The JSON-LD sibling of {@link actionProvenance} — same bundle, expressed as
 * a self-contained `@graph` document (no remote `@context` dependency, same
 * rationale as `policyToJsonLd`). Every IRI-valued field is escaped through
 * the same scheme-agnostic `escapeIri` that `policyToJsonLd` already applies
 * to `delegatedUnder` (the fix that closed the delegation-chain JSON-LD
 * escaping gap, roborev Medium), so a hostile value is neutralised
 * identically in both this JSON-LD path and the RDF path above — the
 * escaping parity extends to the action bundle rather than reopening the
 * gap here.
 */
export function actionProvenanceJsonLd(input: ActionProvenanceInput): Record<string, unknown> {
  const act = escapeIri(input.activity);
  const agent = escapeIri(input.agent);
  const plan = escapeIri(input.plan);
  const used = asArray(input.used).map(escapeIri);
  const generated = asArray(input.generated).map(escapeIri);
  const assocId = "_:association";

  const activityNode: Record<string, unknown> = {
    "@id": act,
    "@type": "prov:Activity",
    wasAssociatedWith: { "@id": agent },
    startedAtTime: input.started.toISOString(),
    qualifiedAssociation: { "@id": assocId },
  };
  if (used.length > 0) {
    activityNode.used = used.map((u) => ({ "@id": u }));
  }
  if (generated.length > 0) {
    activityNode.generated = generated.map((g) => ({ "@id": g }));
  }
  if (input.ended !== undefined) {
    activityNode.endedAtTime = input.ended.toISOString();
  }

  const associationNode: Record<string, unknown> = {
    "@id": assocId,
    "@type": "prov:Association",
    agent: { "@id": agent },
    hadPlan: { "@id": plan },
  };

  const graph: Record<string, unknown>[] = [activityNode, associationNode];

  if (input.onBehalfOf !== undefined) {
    graph.push({
      "@id": agent,
      actedOnBehalfOf: { "@id": escapeIri(input.onBehalfOf) },
    });
  }

  for (const g of generated) {
    graph.push({
      "@id": g,
      ...(used.length > 0 ? { wasDerivedFrom: used.map((u) => ({ "@id": u })) } : {}),
      wasGeneratedBy: { "@id": act },
    });
  }

  return { "@context": PROV_INLINE_CONTEXT, "@graph": graph };
}
