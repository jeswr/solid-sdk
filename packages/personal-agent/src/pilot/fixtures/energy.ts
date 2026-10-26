/**
 * SYNTHETIC Australian public energy comparison (UC-03) fixture: retailer and comparator
 * identities, synthetic tariffs, the public-service mandate and the comparator's LOCAL household
 * profile. Used by BOTH the in-process scenario (`scenarios/energy.ts`) and the durable roles
 * (`roles/energy.ts`). All retailers, plans and usage are synthetic; the plan shape is a small
 * CDS-inspired subset, not a conformant Consumer Data Standards payload.
 */
import type { JsonObject } from "../core/types.js";
import { AWP, PURPOSE } from "../profile/vocabulary.js";
import { mandateOf, permit } from "../scenarios/common.js";

const R = (name: string, host: string) => ({
  name,
  party: `https://${host}/#org`,
  actor: `https://${host}/agents/plans#service`,
  operator: `https://${host}/#org`,
});
export const SOUTHERN = R("southern-current", "southerncurrent.example");
export const HARBOUR = R("harbour-light", "harbourlight.example");
export const GATED = R("gated-power", "gatedpower.example");
export const OLDSCHEMA = R("oldschema-energy", "oldschema.example");
export const WATTLE = {
  name: "wattlecompare",
  party: "https://wattlecompare.example/#org",
  actor: "urn:awp:local-client:wattlecompare",
  operator: "https://wattlecompare.example/#org",
};

/** Public services hold no outbound authority: a never-matching rule (nothing to authorise). */
export function publicServiceMandate() {
  return mandateOf("public-service", [permit("read", `${AWP}op/none`, [PURPOSE.priceComparison])]);
}

const rate = (band: string, c: number, window?: { start: string; end: string }) => ({
  band,
  centsPerKWh: c,
  unit: "KWH",
  ...(window ? { window } : {}),
});
const plan = (
  planId: string,
  displayName: string,
  tariff: JsonObject,
  distributors: string[] | undefined,
  discounts: JsonObject[] = [],
  lastUpdated = "2026-09-01T00:00:00Z",
): JsonObject => ({
  planId,
  lastUpdated,
  displayName,
  fuelType: "ELECTRICITY",
  customerType: "RESIDENTIAL",
  ...(distributors ? { geography: { distributors } } : {}),
  tariff,
  discounts,
});

export const SOUTHERN_PLANS: JsonObject[] = [
  plan(
    "SC-BASIC-1",
    "Southern Basic",
    { type: "SINGLE_RATE", dailySupplyChargeCents: 110, rates: [rate("ALL", 28.5)] },
    ["CitiPower", "Jemena"],
    [{ type: "CONDITIONAL", condition: "PAY_ON_TIME", percentOfUsage: 5 }],
  ),
  plan(
    "SC-TOU-1",
    "Southern Time-of-Use",
    {
      type: "TIME_OF_USE",
      dailySupplyChargeCents: 120,
      rates: [
        rate("PEAK", 38, { start: "15:00", end: "21:00" }),
        rate("SHOULDER", 24, { start: "07:00", end: "15:00" }),
        rate("OFFPEAK", 18, { start: "21:00", end: "07:00" }),
      ],
    },
    ["CitiPower"],
  ),
  plan(
    "SC-SOLAR-1",
    "Southern Solar Saver",
    { type: "SINGLE_RATE", dailySupplyChargeCents: 105, rates: [rate("ALL", 29)] },
    undefined,
  ),
];
export const HARBOUR_PLANS: JsonObject[] = [
  plan(
    "HL-FLAT-2",
    "Harbour Flat",
    { type: "SINGLE_RATE", dailySupplyChargeCents: 125, rates: [rate("ALL", 26.9)] },
    ["CitiPower", "Powercor"],
    [{ type: "GUARANTEED", percentOfUsage: 3 }],
  ),
  plan(
    "HL-BROKEN-1",
    "Harbour Broken Fixture",
    { type: "SINGLE_RATE", dailySupplyChargeCents: 100, rates: [rate("ALL", -5)] },
    ["CitiPower"],
  ),
  plan(
    "HL-FLAT-3",
    "Harbour Flat 3",
    { type: "SINGLE_RATE", dailySupplyChargeCents: 100, rates: [rate("ALL", 25)] },
    ["CitiPower"],
    [],
    "2026-08-01T00:00:00Z",
  ),
  plan(
    "HL-FLAT-3",
    "Harbour Flat 3",
    { type: "SINGLE_RATE", dailySupplyChargeCents: 100, rates: [rate("ALL", 31)] },
    ["CitiPower"],
    [],
    "2026-09-15T00:00:00Z",
  ),
];

/**
 * The comparator's LOCAL household profile (personal data that never leaves the comparator):
 * a synthetic household marker, the distributor zone (location) and a daily usage curve.
 */
export function syntheticHousehold(usage: readonly number[]): JsonObject {
  return {
    version: 1,
    household: "urn:awp:household:synthetic-h1",
    distributor: "CitiPower",
    days: 365,
    usage: [...usage],
    synthetic: true,
  };
}
