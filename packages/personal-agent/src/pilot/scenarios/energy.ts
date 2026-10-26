/**
 * UC-03 executable workflow: WattleCompare (anonymous comparator) queries four synthetic
 * retailer services over the direct binding under the public-readonly configuration.
 */

import { DirectBus } from "../bindings/direct.js";
import {
  CDS_SUBSET,
  CDS_SUBSET_OLD,
  ComparatorHandler,
  comparePlans,
  ENERGY_PLANS_OP,
  RetailerPlansHandler,
  syntheticUsageCurve,
} from "../domains/energy.js";
import {
  GATED,
  HARBOUR,
  HARBOUR_PLANS,
  OLDSCHEMA,
  publicServiceMandate,
  SOUTHERN,
  SOUTHERN_PLANS,
  WATTLE,
} from "../fixtures/energy.js";
import { CONFIG_PUBLIC } from "../profile/configurations.js";
import type { OutboundMessage } from "../runtime/agent.js";
import { verifyLedger } from "../store/ledger.js";
import { Cast } from "./common.js";

export { GATED, HARBOUR, HARBOUR_PLANS, OLDSCHEMA, SOUTHERN, SOUTHERN_PLANS, WATTLE };

export async function runEnergy(now: () => Date) {
  const cast = new Cast(now);
  const noMandate = publicServiceMandate();
  for (const r of [SOUTHERN, HARBOUR, GATED, OLDSCHEMA, WATTLE])
    await cast.add(r, noMandate, [ENERGY_PLANS_OP.id]);
  // The comparator pins the retailers' published service keys (one-directional; the
  // retailers learn nothing about the comparator).
  for (const r of [SOUTHERN, HARBOUR, GATED, OLDSCHEMA]) cast.pin("wattlecompare", r.name);

  const comparator = new ComparatorHandler();
  const wattle = await cast.runtime("wattlecompare", [comparator], [], [CONFIG_PUBLIC]);
  const services = [
    await cast.runtime(
      "southern-current",
      [new RetailerPlansHandler(SOUTHERN.party, SOUTHERN_PLANS)],
      [],
      [CONFIG_PUBLIC],
    ),
    await cast.runtime(
      "harbour-light",
      [new RetailerPlansHandler(HARBOUR.party, HARBOUR_PLANS)],
      [],
      [CONFIG_PUBLIC],
    ),
    await cast.runtime(
      "gated-power",
      [new RetailerPlansHandler(GATED.party, [], "represented")],
      [],
      [CONFIG_PUBLIC],
    ),
    await cast.runtime(
      "oldschema-energy",
      [new RetailerPlansHandler(OLDSCHEMA.party, SOUTHERN_PLANS, "public", CDS_SUBSET_OLD)],
      [],
      [CONFIG_PUBLIC],
    ),
  ];
  const bus = new DirectBus().register(wattle.runtime, ...services.map((s) => s.runtime));
  const conversations: Record<string, string> = {};
  for (const r of [SOUTHERN, HARBOUR, GATED, OLDSCHEMA]) {
    const step = await wattle.runtime.startInvocation({
      peer: { actor: r.actor, party: r.party },
      operation: ENERGY_PLANS_OP,
      input: { fuelType: "ELECTRICITY", effective: "CURRENT" },
      basis: { kind: "public" },
      models: [CDS_SUBSET],
    });
    conversations[r.name] = step.conversation as string;
    bus.send(wattle.runtime, step);
  }
  const comparatorOut: OutboundMessage[] = [];
  await bus.run(({ from, out }) => {
    if (from === wattle.runtime) comparatorOut.push(out);
    return undefined;
  });

  const local = { distributor: "CitiPower", usage: syntheticUsageCurve(), days: 365 };
  const comparison = comparePlans(comparator.state, local);
  const again = comparePlans(comparator.state, local);
  const outcomes = Object.fromEntries(
    Object.entries(conversations).map(([name, id]) => {
      const c = wattle.runtime.conversation(id);
      return [name, { phase: c?.phase, reason: c?.closedReason }];
    }),
  );
  return {
    obs: {
      outcomes,
      incompatibilities: Object.entries(outcomes)
        .filter(([, o]) => o.phase !== "completed")
        .map(([name, o]) => ({
          endpoint: name,
          observed: o.reason,
          note: "observed incompatibility; not a finding of non-compliance",
        })),
      comparatorRequests: comparatorOut.length,
      identityFreeRequests: comparatorOut.every(
        (o) =>
          o.wire.format === "awp-unsigned-json/0.1" &&
          Object.keys(o.message.from).length === 0 &&
          (o.message.evidence ?? []).length === 0,
      ),
      serviceRepresentationChecks: services.reduce(
        (n, s) =>
          n +
          s.ledger.entries().filter((e) => e.record.type === "representation-assessment").length,
        0,
      ),
      serviceAuthorisationDecisions: services.reduce(
        (n, s) =>
          n + s.ledger.entries().filter((e) => e.record.type === "authorisation-decision").length,
        0,
      ),
      effects: [wattle, ...services].reduce(
        (n, s) => n + s.ledger.entries().filter((e) => e.record.type === "activity").length,
        0,
      ),
      rejected: comparator.state.rejected,
      ranked: comparison.ranked.map((r) => ({
        rank: r.rank,
        retailer: r.retailer,
        planId: r.planId,
        estimateAudPerYear: r.estimateAudPerYear,
        conditionalReductions: r.conditionalReductions,
        sourceMessage: r.sourceMessage,
      })),
      excluded: comparison.excluded,
      assumptions: comparison.assumptions,
      deterministic: JSON.stringify(comparison) === JSON.stringify(again),
      citationsComplete: comparison.ranked.every((r) =>
        comparator.state.sources.some(
          (s) => s.messageId === r.sourceMessage && s.retailer === r.retailer,
        ),
      ),
      sources: comparator.state.sources,
      calculationTrace: comparison.ranked.map((r) => ({ planId: r.planId, trace: r.trace })),
      ledgers: [wattle, ...services].every((s) => verifyLedger(s.ledger.entries()).ok),
      requirementManifest: [
        {
          id: "AU-CDR-E-01",
          kind: "published requirement (cited in regional-use-cases.md)",
          exercised: "anonymous product-data retrieval; no fee/credential",
          status: "exercised against synthetic fixtures only",
        },
        {
          id: "AU-CDR-E-03",
          kind: "published standard version (CDS v1.36.0)",
          exercised: "model version negotiation; older version isolated",
          status: "synthetic subset; not CDS conformance",
        },
        {
          id: "AU-CDR-E-04",
          kind: "listed in regional-use-cases.md",
          exercised: "not mapped in this pilot",
          status: "gap",
        },
      ],
      environment: "local-simulation",
    },
    trace: bus.trace,
  };
}
