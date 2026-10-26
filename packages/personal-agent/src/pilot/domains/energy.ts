/**
 * Domain adapter: UC-03 public energy-plan comparison (synthetic retailers and tariffs).
 *
 * Requests are ANONYMOUS and unsigned under the public-readonly configuration: no name,
 * account, consent or credential. Responses are signed by each retailer's pinned key so
 * plan data is attributable. The comparator keeps location and usage local, validates each
 * plan against the accepted model version, isolates incompatible endpoints, and computes a
 * deterministic annual estimate with a per-plan calculation trace. Retailer figures and the
 * comparator's estimates stay separately attributed.
 *
 * The plan shape is a small SYNTHETIC SUBSET inspired by the Consumer Data Standards
 * EnergyPlan detail; it is not a conformant CDS payload and no public endpoint is called.
 */
import { z } from "zod";
import { digestOf } from "../core/canonical.js";
import type { DeliverBody, InvokeBody, Iri, JsonObject } from "../core/types.js";
import type { OperationDescription } from "../profile/description.js";
import { AWP, PURPOSE } from "../profile/vocabulary.js";
import type { HandlerContext, HandlerReply, OperationHandler } from "../runtime/operations.js";

export const ENERGY_PLANS_OP = { id: `${AWP}op/energy-plans-list`, version: "0.1" } as const;
export const CDS_SUBSET = {
  id: "https://consumerdatastandardsaustralia.github.io/standards/#energy-plans",
  version: "1.36.0-synthetic-subset",
} as const;
export const CDS_SUBSET_OLD = { id: CDS_SUBSET.id, version: "1.20.0-synthetic-subset" } as const;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[03]0$/);
export const planSchema = z.strictObject({
  planId: z.string().min(1).max(64),
  lastUpdated: z.string().max(40),
  displayName: z.string().max(120),
  fuelType: z.literal("ELECTRICITY"),
  customerType: z.literal("RESIDENTIAL"),
  geography: z
    .strictObject({ distributors: z.array(z.string().max(64)).min(1).max(32) })
    .optional(),
  tariff: z.strictObject({
    type: z.enum(["SINGLE_RATE", "TIME_OF_USE"]),
    dailySupplyChargeCents: z.number().min(0).max(1000),
    rates: z
      .array(
        z.strictObject({
          band: z.string().max(32),
          centsPerKWh: z.number().min(0).max(500),
          unit: z.literal("KWH"),
          window: z.strictObject({ start: hhmm, end: hhmm }).optional(),
        }),
      )
      .min(1)
      .max(8),
  }),
  discounts: z
    .array(
      z.strictObject({
        type: z.enum(["CONDITIONAL", "GUARANTEED"]),
        condition: z.string().max(64).optional(),
        percentOfUsage: z.number().min(0).max(100),
      }),
    )
    .max(4),
});
export type Plan = z.infer<typeof planSchema>;

export function plansDescription(
  access: "public" | "represented",
  model: { id: string; version: string } = CDS_SUBSET,
): OperationDescription {
  return {
    id: ENERGY_PLANS_OP.id,
    version: ENERGY_PLANS_OP.version,
    label: "Public generic energy plan list (synthetic CDS-like subset)",
    pattern: "invoke",
    access,
    roles: ["responder"],
    models: [model],
    purposes: [PURPOSE.priceComparison],
    effects: ["none (read-only)"],
    outcomes: ["signed plan list"],
    limitations: ["synthetic retailer and tariffs", "not a CDS-conformant payload"],
  };
}

/** A retailer's public plan service. Serves the same list to everyone; asks for nothing. */
export class RetailerPlansHandler implements OperationHandler {
  readonly description: OperationDescription;
  readonly inputSchema = z.strictObject({
    fuelType: z.literal("ELECTRICITY"),
    effective: z.literal("CURRENT"),
  }) as unknown as z.ZodType<JsonObject>;
  readonly requiresRepresentation = false;

  constructor(
    private readonly retailer: Iri,
    private readonly plans: readonly JsonObject[],
    access: "public" | "represented" = "public",
    model: { id: string; version: string } = CDS_SUBSET,
  ) {
    this.description = plansDescription(access, model);
  }

  onInvoke(ctx: HandlerContext, _body: InvokeBody): HandlerReply {
    ctx.record({
      type: "public-access-served",
      operation: ENERGY_PLANS_OP.id,
      requesterIdentified: Boolean(ctx.message?.from.actor),
      note: "no identity, consent or credential requested",
    });
    return {
      type: "deliver",
      output: {
        retailer: this.retailer,
        schema: { ...this.description.models[0] } as JsonObject,
        retrievedAt: ctx.now,
        plans: [...this.plans],
      },
    };
  }
}

// ------------------------------------------------------------------ comparator

/** Synthetic half-hourly usage (kWh) for one typical day, 48 values; kept local. */
export function syntheticUsageCurve(): number[] {
  return Array.from({ length: 48 }, (_, i) => {
    const h = i / 2;
    if (h < 6) return 0.15;
    if (h < 9 && h >= 7) return 0.4;
    if (h >= 17 && h < 21) return 0.6;
    return 0.2;
  });
}

function slotIndex(t: string): number {
  const [h, m] = t.split(":").map((x) => Number.parseInt(x, 10));
  return (h ?? 0) * 2 + ((m ?? 0) >= 30 ? 1 : 0);
}

/** Map each half-hour to a rate band, or report why the tariff is incomparable. */
export function bandBySlot(plan: Plan): { bands: string[] } | { problem: string } {
  if (plan.tariff.type === "SINGLE_RATE") {
    if (plan.tariff.rates.length !== 1)
      return { problem: "single-rate tariff must have exactly one rate" };
    return {
      bands: Array.from({ length: 48 }, () => (plan.tariff.rates[0] as { band: string }).band),
    };
  }
  const bands: Array<string | undefined> = Array.from({ length: 48 }, () => undefined);
  for (const r of plan.tariff.rates) {
    if (!r.window) return { problem: `time-of-use band ${r.band} has no window` };
    let i = slotIndex(r.window.start);
    const end = slotIndex(r.window.end);
    for (let n = 0; n < 48 && i !== end; n++, i = (i + 1) % 48) {
      if (bands[i] !== undefined) return { problem: "time-of-use windows overlap" };
      bands[i] = r.band;
    }
  }
  if (bands.some((b) => b === undefined))
    return { problem: "time-of-use windows do not cover the whole day" };
  return { bands: bands as string[] };
}

export interface ComparatorState {
  readonly sources: Array<{
    retailer: Iri;
    messageId: Iri;
    digest: string;
    retrievedAt: string;
    schema: JsonObject;
  }>;
  readonly rejected: Array<{ retailer: Iri; planId?: string; reason: string }>;
  readonly plans: Array<{ retailer: Iri; plan: Plan; sourceMessage: Iri }>;
}

export class ComparatorHandler implements OperationHandler {
  readonly description: OperationDescription = {
    ...plansDescription("public"),
    roles: ["initiator"],
  };
  readonly requiresRepresentation = false;
  readonly state: ComparatorState = { sources: [], rejected: [], plans: [] };

  intentForInvoke(): undefined {
    return undefined; // retrieval of public data: no consequential action to authorise
  }

  onDeliver(ctx: HandlerContext, body: DeliverBody): HandlerReply {
    const retailer = ctx.message?.from.actor ?? "unknown";
    const out = body.output as {
      retailer?: unknown;
      schema?: JsonObject;
      retrievedAt?: unknown;
      plans?: unknown;
    };
    this.state.sources.push({
      retailer,
      messageId: ctx.message?.id ?? "unknown",
      digest: digestOf(ctx.message ?? {}),
      retrievedAt: String(out.retrievedAt ?? ""),
      schema: out.schema ?? {},
    });
    if (!Array.isArray(out.plans)) {
      this.state.rejected.push({ retailer, reason: "no plan list" });
      return { type: "none" };
    }
    for (const raw of out.plans.slice(0, 200)) {
      const parsed = planSchema.safeParse(raw);
      if (!parsed.success) {
        this.state.rejected.push({
          retailer,
          planId: String((raw as { planId?: unknown })?.planId ?? "?"),
          reason: `schema validation: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`,
        });
        continue;
      }
      this.state.plans.push({
        retailer,
        plan: parsed.data,
        sourceMessage: ctx.message?.id ?? "unknown",
      });
    }
    return { type: "none" };
  }
}

export interface RankedPlan {
  readonly rank: number;
  readonly retailer: Iri;
  readonly planId: string;
  readonly lastUpdated: string;
  readonly sourceMessage: Iri;
  readonly estimateAudPerYear: number;
  readonly conditionalReductions: ReadonlyArray<{ condition: string; audPerYear: number }>;
  readonly trace: JsonObject;
}

/** Deterministic comparison: eligibility, comparability, cost; every input cited. */
export function comparePlans(
  state: ComparatorState,
  local: { distributor: string; usage: readonly number[]; days: number },
): {
  ranked: RankedPlan[];
  excluded: Array<{ retailer: Iri; planId: string; reason: string }>;
  assumptions: string[];
} {
  const excluded: Array<{ retailer: Iri; planId: string; reason: string }> = [];
  const counts = new Map<string, number>();
  for (const p of state.plans)
    counts.set(
      `${p.retailer}|${p.plan.planId}`,
      (counts.get(`${p.retailer}|${p.plan.planId}`) ?? 0) + 1,
    );
  const ranked: Omit<RankedPlan, "rank">[] = [];
  for (const { retailer, plan, sourceMessage } of state.plans) {
    if ((counts.get(`${retailer}|${plan.planId}`) ?? 0) > 1) {
      excluded.push({
        retailer,
        planId: plan.planId,
        reason: "conflicting versions of the same plan id; kept separately attributed, not ranked",
      });
      continue;
    }
    if (!plan.geography) {
      excluded.push({
        retailer,
        planId: plan.planId,
        reason: "eligibility (distributor geography) missing; cannot rank",
      });
      continue;
    }
    if (!plan.geography.distributors.includes(local.distributor)) {
      excluded.push({
        retailer,
        planId: plan.planId,
        reason: "not offered in the local distributor zone",
      });
      continue;
    }
    const map = bandBySlot(plan);
    if ("problem" in map) {
      excluded.push({
        retailer,
        planId: plan.planId,
        reason: `incomparable tariff: ${map.problem}`,
      });
      continue;
    }
    const byBand: Record<string, number> = {};
    local.usage.forEach((kwh, i) => {
      const band = map.bands[i] as string;
      byBand[band] = (byBand[band] ?? 0) + kwh * local.days;
    });
    let usageCents = 0;
    const bandTrace: JsonObject[] = [];
    for (const r of plan.tariff.rates) {
      const kwh = byBand[r.band] ?? 0;
      usageCents += kwh * r.centsPerKWh;
      bandTrace.push({
        band: r.band,
        kwh: Math.round(kwh * 10) / 10,
        centsPerKWh: r.centsPerKWh,
        source: `tariff.rates[band=${r.band}].centsPerKWh`,
      });
    }
    const supplyCents = plan.tariff.dailySupplyChargeCents * local.days;
    const guaranteed = plan.discounts
      .filter((d) => d.type === "GUARANTEED")
      .reduce((s, d) => s + d.percentOfUsage, 0);
    const totalCents = supplyCents + usageCents * (1 - guaranteed / 100);
    const conditional = plan.discounts
      .filter((d) => d.type === "CONDITIONAL")
      .map((d) => ({
        condition: d.condition ?? "unspecified",
        audPerYear: Math.round((usageCents * d.percentOfUsage) / 100) / 100,
      }));
    ranked.push({
      retailer,
      planId: plan.planId,
      lastUpdated: plan.lastUpdated,
      sourceMessage,
      estimateAudPerYear: Math.round(totalCents) / 100,
      conditionalReductions: conditional,
      trace: {
        assertedByRetailer: {
          dailySupplyChargeCents: plan.tariff.dailySupplyChargeCents,
          rates: plan.tariff.rates as unknown as JsonObject[],
          discounts: plan.discounts as unknown as JsonObject[],
        },
        derivedByComparator: {
          supplyCents,
          usageCents: Math.round(usageCents),
          guaranteedDiscountPercent: guaranteed,
          bands: bandTrace,
        },
      },
    });
  }
  ranked.sort(
    (a, b) => a.estimateAudPerYear - b.estimateAudPerYear || a.planId.localeCompare(b.planId),
  );
  return {
    ranked: ranked.map((r, i) => ({ ...r, rank: i + 1 })),
    excluded,
    assumptions: [
      `${local.days} days; the same synthetic 48-point daily usage curve every day`,
      "time-of-use windows interpreted in local time; no daylight-saving adjustment of the curve",
      "conditional discounts are listed, not included in the estimate",
      "estimates are the comparator's derivation, not retailer statements",
    ],
  };
}
