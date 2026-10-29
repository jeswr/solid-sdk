/**
 * SYNTHETIC Australian public energy comparison (UC-03) as durable, independently initialised
 * agents: public retailer plan services and a local comparator. Both compose the EXISTING
 * domain handlers (`domains/energy.ts`); the runtime (public configuration, signatures,
 * pinned keys, model negotiation, transmission checks) is unchanged.
 *
 *  - `energy-retailer`: serves its synthetic plan list to ANYONE under the public-readonly
 *    configuration. It asks for nothing and never learns who asked (public-http carriage: no
 *    token, no principal). Responses are signed with its pinned service key.
 *  - `energy-comparator`: holds the household's usage curve and distributor zone LOCALLY
 *    (`energy-household.json`), sends ANONYMOUS unsigned requests to pinned retailers, validates
 *    every plan against the accepted model version, isolates incompatible endpoints, and computes
 *    deterministic estimates. Retailer statements and the comparator's derivations stay
 *    separately attributed; every ranked plan cites its signed source message. Collected plans
 *    live in the runtime's own durable domain state; rounds and comparison outputs (with
 *    provenance) are persisted by the role, so a restart preserves them.
 * All tariffs and usage are synthetic; the plan shape is a CDS-inspired subset, not a CDS/CDR
 * protocol implementation.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { digestOf, newUrn } from "../core/canonical.js";
import type { Iri, JsonObject, Json as JsonValue } from "../core/types.js";
import {
  CDS_SUBSET,
  CDS_SUBSET_OLD,
  ComparatorHandler,
  type ComparatorState,
  comparePlans,
  ENERGY_PLANS_OP,
  RetailerPlansHandler,
} from "../domains/energy.js";
import { publicServiceMandate, WATTLE } from "../fixtures/energy.js";
import { CONFIG_PUBLIC } from "../profile/configurations.js";
import { readJson, writeAtomic } from "./common.js";
import { durableHandler, scopedStateKey } from "./durable.js";
import type { Json, OperatorOperation, RoleDefinition } from "./types.js";

export const PLANS_FILE = "energy-plans.json";
export const HOUSEHOLD_FILE = "energy-household.json";
export const ROUNDS_FILE = "energy-rounds.json";
export const COMPARISONS_FILE = "energy-comparisons.json";
const STATE_KEY = "comparator";

const plansFile = z.strictObject({
  version: z.literal(1),
  model: z.enum(["current", "old"]),
  access: z.enum(["public", "represented"]),
  // The retailer serves its list as is (it may contain entries the comparator rejects); only
  // the shape is bounded here.
  plans: z.array(z.record(z.string(), z.unknown())).max(200),
});
const householdFile = z.strictObject({
  version: z.literal(1),
  household: z.string().min(3).max(256),
  distributor: z.string().min(1).max(64),
  days: z.number().int().min(1).max(366),
  usage: z.array(z.number().min(0).max(100)).length(48),
  synthetic: z.literal(true),
});

// ------------------------------------------------------------------ retailer

export const ENERGY_RETAILER_ROLE: RoleDefinition = {
  id: "energy-retailer",
  label: "Synthetic energy retailer — public plan list (anonymous, signed responses)",
  synthetic: true,
  mandate: publicServiceMandate,
  representationOperations: [ENERGY_PLANS_OP.id],
  accepted: [CONFIG_PUBLIC],
  inputs: {
    plans:
      "JSON {version:1, model:'current'|'old', access:'public'|'represented', plans:[…]} (synthetic tariffs)",
  },
  async init({ trust, options }) {
    if (!options.plans) throw new Error("energy-retailer init needs --role-input plans=FILE");
    const file = plansFile.parse(JSON.parse(readFileSync(options.plans, "utf8")));
    return { trust, files: { [PLANS_FILE]: file } };
  },
  build(ctx) {
    const file = plansFile.parse(JSON.parse(readFileSync(join(ctx.dir, PLANS_FILE), "utf8")));
    const model = file.model === "old" ? CDS_SUBSET_OLD : CDS_SUBSET;
    return {
      handlers: [
        new RetailerPlansHandler(ctx.party, file.plans as JsonObject[], file.access, model),
      ],
      effects: [],
      operations: () => [],
      status: () => ({ plans: file.plans.length, model, access: file.access }),
    };
  },
};

// ------------------------------------------------------------------ comparator

interface Round {
  id: Iri;
  startedAt: string;
  conversations: Record<Iri, Iri>; // retailer actor → conversation
}
interface Comparison extends Json {
  id: Iri;
  round: Iri;
  at: string;
  household: string;
  inputsDigest: string;
  ranked: Json[];
  excluded: Json[];
  rejected: Json[];
  incompatibilities: Json[];
  sources: Json[];
  assumptions: string[];
  deterministic: boolean;
}

export const ENERGY_COMPARATOR_ROLE: RoleDefinition = {
  id: "energy-comparator",
  label: "Synthetic energy comparator — anonymous public retrieval; usage and location stay local",
  synthetic: true,
  identity: { party: WATTLE.party, actor: WATTLE.actor, operator: WATTLE.operator },
  mandate: publicServiceMandate,
  representationOperations: [ENERGY_PLANS_OP.id],
  accepted: [CONFIG_PUBLIC],
  inputs: {
    profile: "JSON household profile (synthetic): household, distributor, days, usage[48]",
  },
  async init({ trust, options }) {
    if (!options.profile) throw new Error("energy-comparator init needs --role-input profile=FILE");
    const file = householdFile.parse(JSON.parse(readFileSync(options.profile, "utf8")));
    return { trust, files: { [HOUSEHOLD_FILE]: file } };
  },
  build(ctx) {
    const household = householdFile.parse(
      JSON.parse(readFileSync(join(ctx.dir, HOUSEHOLD_FILE), "utf8")),
    );
    const comparator = durableHandler(new ComparatorHandler(), {
      key: STATE_KEY,
      snapshot: (h) => h.state as unknown as JsonValue,
      restore: (h, s) => {
        const saved = s as unknown as ComparatorState;
        h.state.sources.splice(0, h.state.sources.length, ...saved.sources);
        h.state.rejected.splice(0, h.state.rejected.length, ...saved.rejected);
        h.state.plans.splice(0, h.state.plans.length, ...saved.plans);
      },
    });
    const roundsPath = join(ctx.dir, ROUNDS_FILE);
    const comparisonsPath = join(ctx.dir, COMPARISONS_FILE);
    const rounds = () => readJson<{ rounds: Round[] }>(roundsPath, { rounds: [] }).rounds;
    const comparisons = () =>
      readJson<{ comparisons: Comparison[] }>(comparisonsPath, { comparisons: [] }).comparisons;
    return {
      handlers: [comparator],
      effects: [],
      status: () => {
        const last = comparisons().at(-1);
        return {
          localProfile: {
            household: household.household,
            distributor: household.distributor,
            note: "held locally; never sent",
          },
          rounds: rounds().map((r) => ({
            id: r.id,
            startedAt: r.startedAt,
            retailers: Object.keys(r.conversations).length,
          })),
          lastComparison: last
            ? {
                id: last.id,
                round: last.round,
                at: last.at,
                ranked: last.ranked.map((r) => ({
                  rank: r.rank,
                  retailer: r.retailer,
                  planId: r.planId,
                  estimateAudPerYear: r.estimateAudPerYear,
                  sourceMessage: r.sourceMessage,
                })),
                excluded: last.excluded.length,
                incompatibilities: last.incompatibilities,
              }
            : null,
        };
      },
      operations: (op): OperatorOperation[] => [
        {
          name: "request_plans",
          title: "Request public plan lists (anonymous)",
          description:
            "Start one ANONYMOUS public request per pinned retailer (or the listed ones). Nothing about the household is sent. " +
            "Dispatch with dispatch_outbound (public-http carriage); then compare_plans.",
          input: { retailers: z.array(z.string().min(8).max(512)).min(1).max(16).optional() },
          async run(raw) {
            const { retailers } = raw as { retailers?: string[] };
            const targets =
              retailers ??
              op.trust.keys.filter((k) => k.role === "actor" && k.party).map((k) => k.subject);
            const round: Round = {
              id: newUrn(),
              startedAt: op.now().toISOString(),
              conversations: {},
            };
            const outbound = [];
            for (const actor of [...new Set(targets)]) {
              const peer = op.pinnedPeer(actor);
              const step = await op.rt.startInvocation({
                peer,
                operation: ENERGY_PLANS_OP,
                input: { fuelType: "ELECTRICITY", effective: "CURRENT" },
                basis: { kind: "public" },
                models: [CDS_SUBSET],
              });
              round.conversations[actor] = step.conversation as Iri;
              outbound.push(...step.outbound);
            }
            writeAtomic(roundsPath, { rounds: [...rounds(), round] });
            return {
              round: round.id,
              retailers: Object.keys(round.conversations),
              outbound: op.show(await op.prepare(outbound)),
              notice: "anonymous public requests; dispatch_outbound carries them",
            };
          },
        },
        {
          name: "compare_plans",
          title: "Compare collected plans (deterministic, local usage)",
          description:
            "Deterministic annual estimates from the plans collected in a round (default: the latest), using the LOCAL " +
            "household profile. Every ranked plan cites its signed source message; retailer figures and comparator " +
            "derivations are kept apart. The result is persisted with its provenance.",
          input: { round: z.string().min(8).max(512).optional() },
          async run(raw) {
            const all = rounds();
            const round = (raw as { round?: string }).round
              ? all.find((r) => r.id === (raw as { round: string }).round)
              : all.at(-1);
            if (!round) throw new Error("no request round yet (request_plans first)");
            const state = op.rt.domainState(scopedStateKey(ENERGY_PLANS_OP, STATE_KEY)) as
              | ComparatorState
              | undefined;
            // Only messages received in THIS round's conversations count.
            const inbound = new Set<string>();
            const incompatibilities: Json[] = [];
            for (const [retailer, conv] of Object.entries(round.conversations)) {
              const c = op.rt.conversation(conv);
              for (const h of c?.history ?? []) if (h.direction === "in") inbound.add(h.id);
              if (c?.phase !== "completed")
                incompatibilities.push({
                  retailer,
                  phase: c?.phase ?? "unknown",
                  observed: c?.closedReason ?? "not completed",
                  note: "isolated: observed incompatibility or refusal, not a finding of non-compliance",
                });
            }
            const roundState: ComparatorState = {
              sources: (state?.sources ?? []).filter((s) => inbound.has(s.messageId)),
              rejected: (state?.rejected ?? []).filter((r) =>
                (state?.sources ?? []).some(
                  (s) => inbound.has(s.messageId) && s.retailer === r.retailer,
                ),
              ),
              plans: (state?.plans ?? []).filter((p) => inbound.has(p.sourceMessage)),
            };
            const local = {
              distributor: household.distributor,
              usage: household.usage,
              days: household.days,
            };
            const result = comparePlans(roundState, local);
            const again = comparePlans(roundState, local);
            const comparison: Comparison = {
              id: newUrn(),
              round: round.id,
              at: op.now().toISOString(),
              household: household.household,
              inputsDigest: digestOf({ plans: roundState.plans, local } as unknown as JsonObject),
              ranked: result.ranked as unknown as Json[],
              excluded: result.excluded as unknown as Json[],
              rejected: roundState.rejected as unknown as Json[],
              incompatibilities,
              sources: roundState.sources as unknown as Json[],
              assumptions: result.assumptions,
              deterministic: JSON.stringify(result) === JSON.stringify(again),
            };
            writeAtomic(comparisonsPath, { comparisons: [...comparisons(), comparison] });
            return comparison;
          },
        },
      ],
    };
  },
};
