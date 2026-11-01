// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  canonicalUnit,
  convertUnit,
  type HealthUnit,
  type Measure,
  normaliseObservation,
  resolveUnit,
  UnitError,
  type UnitErrorCode,
  type UnitObservation,
} from "../src/apps/health/lib/units";

function expectCode(run: () => unknown, code: UnitErrorCode): void {
  expect(run).toThrow(UnitError);
  expect(run).toThrow(expect.objectContaining({ name: "UnitError", code }));
}

// Independent known quantities, rather than expectations calculated from the table.
const quantities: readonly (readonly [Measure, HealthUnit, number, number])[] = [
  ["mass", "kg", 2, 2],
  ["mass", "g", 2500, 2.5],
  ["mass", "mg", 2500000, 2.5],
  ["mass", "[lb_av]", 1, 0.45359237],
  ["mass", "[oz_av]", 16, 0.45359237],
  ["length", "m", 2, 2],
  ["length", "mm", 2500, 2.5],
  ["length", "cm", 250, 2.5],
  ["length", "km", 2, 2000],
  ["length", "[in_i]", 12, 0.3048],
  ["length", "[ft_i]", 3, 0.9144],
  ["length", "[yd_i]", 1, 0.9144],
  ["distance", "[mi_i]", 1, 1609.344],
  ["temperature", "Cel", 37, 37],
  ["temperature", "[degF]", 98.6, 37],
  ["temperature", "K", 310.15, 37],
  ["blood-glucose", "mg/dL", 90.078, 5],
  ["blood-glucose", "mmol/L", 5, 5],
  ["blood-pressure", "mm[Hg]", 120, 120],
  ["energy", "kJ", 4.184, 4.184],
  ["energy", "J", 4184, 4.184],
  ["energy", "kcal", 1, 4.184],
  ["duration", "ms", 1500, 1.5],
  ["duration", "s", 90, 90],
  ["duration", "min", 90, 5400],
  ["duration", "h", 1.5, 5400],
  ["duration", "d", 2, 172800],
];

describe("bounded UCUM conversions", () => {
  it.each(
    quantities,
  )("converts %s %s to and from its canonical unit", (measure, unit, value, base) => {
    const canonical = canonicalUnit(measure);
    expect(convertUnit(value, unit, canonical, measure)).toBeCloseTo(base, 10);
    expect(convertUnit(base, canonical, unit, measure)).toBeCloseTo(value, 8);
    expect(resolveUnit(unit)).toBe(unit);
  });

  it.each([
    ["lb", "[lb_av]", "mass"],
    ["oz", "[oz_av]", "mass"],
    ["in", "[in_i]", "length"],
    ["ft", "[ft_i]", "length"],
    ["yd", "[yd_i]", "length"],
    ["mi", "[mi_i]", "distance"],
    ["mmHg", "mm[Hg]", "blood-pressure"],
  ] as const)("resolves only the explicit alias %s", (alias, unit, measure) => {
    expect(resolveUnit(alias)).toBe(unit);
    expect(convertUnit(12.345, alias, unit, measure)).toBe(12.345);
    expect(convertUnit(12.345, unit, alias, measure)).toBe(12.345);
    expect(normaliseObservation({ measure, value: 12.345, unit: alias }).unit).toBe(
      canonicalUnit(measure),
    );
  });

  it("converts directly between noncanonical units and shares length units with distance", () => {
    expect(convertUnit(1, "mi", "km", "distance")).toBe(1.609344);
    expect(convertUnit(1, "ft", "in", "length")).toBe(12);
    expect(convertUnit(2, "lb", "oz", "mass")).toBe(32);
    expect(convertUnit(2, "h", "min", "duration")).toBe(120);
    expect(convertUnit(1, "km", "cm", "length")).toBe(100000);
  });

  it("uses temperature offsets in both directions, including freezing and signed readings", () => {
    expect(convertUnit(32, "[degF]", "Cel", "temperature")).toBe(0);
    expect(convertUnit(0, "Cel", "[degF]", "temperature")).toBe(32);
    expect(convertUnit(-40, "Cel", "[degF]", "temperature")).toBe(-40);
    expect(convertUnit(273.15, "K", "[degF]", "temperature")).toBe(32);
    expect(convertUnit(32, "[degF]", "K", "temperature")).toBe(273.15);
    expect(convertUnit(0, "K", "Cel", "temperature")).toBe(-273.15);
    expect(convertUnit(-273.15, "Cel", "K", "temperature")).toBe(0);
  });

  it("uses the documented glucose molar mass without display rounding", () => {
    expect(convertUnit(1, "mmol/L", "mg/dL", "blood-glucose")).toBe(18.0156);
    expect(convertUnit(18.0156, "mg/dL", "mmol/L", "blood-glucose")).toBeCloseTo(1, 14);
    expect(convertUnit(100, "mg/dL", "mmol/L", "blood-glucose")).toBeCloseTo(5.550744909966918, 14);
  });

  it("preserves identity values exactly, including signed zero and numeric boundaries", () => {
    for (const value of [0, -0, 0.1, -0.1, Number.MIN_VALUE, Number.MAX_VALUE]) {
      expect(Object.is(convertUnit(value, "K", "K", "temperature"), value)).toBe(true);
      expect(Object.is(convertUnit(value, "kg", "kg", "mass"), value)).toBe(true);
    }
    expect(convertUnit(0, "kg", "g", "mass")).toBe(0);
    expect(convertUnit(-2, "kg", "g", "mass")).toBe(-2000);
  });

  it("rejects overflow, underflow and temperature changes lost to offset rounding", () => {
    for (const value of [Number.MAX_VALUE, -Number.MAX_VALUE]) {
      expectCode(() => convertUnit(value, "kg", "mg", "mass"), "numeric-range");
    }
    for (const value of [Number.MIN_VALUE, -Number.MIN_VALUE]) {
      expectCode(() => convertUnit(value, "mg", "kg", "mass"), "numeric-range");
    }
    expectCode(() => convertUnit(1e-20, "Cel", "K", "temperature"), "numeric-range");
    // Scaling the ratio first avoids an intermediate multiplication overflow.
    expect(convertUnit(Number.MAX_VALUE, "mg", "g", "mass")).toBe(Number.MAX_VALUE * 0.001);
  });

  it.each([
    "",
    "KG",
    " kg",
    "kg ",
    "lbs",
    "°C",
    "F",
    "month",
    "a",
    "mmol/l",
    "mg/dL{glucose}",
    "kg/m2",
    "constructor",
    "__proto__",
    "toString",
  ])("rejects unsupported code %s in either position, even for identity", (unit) => {
    expectCode(() => resolveUnit(unit), "unknown-unit");
    expectCode(() => convertUnit(1, unit, "kg", "mass"), "unknown-unit");
    expectCode(() => convertUnit(1, "kg", unit, "mass"), "unknown-unit");
    expectCode(() => convertUnit(1, unit, unit, "mass"), "unknown-unit");
  });

  it.each([null, undefined, 1, {}, [], Symbol("unit")])("rejects non-string units %s", (value) => {
    expectCode(() => resolveUnit(value as string), "unknown-unit");
  });

  it.each([
    "weight",
    "glucose",
    "",
    "constructor",
    "__proto__",
    null,
    undefined,
    {},
    1,
  ])("rejects unknown or missing measure %s", (measure) => {
    expectCode(() => canonicalUnit(measure as Measure), "unknown-measure");
    expectCode(() => convertUnit(1, "kg", "kg", measure as Measure), "unknown-measure");
  });

  it("rejects mismatches in source, target, and identity without inferring the measure", () => {
    expectCode(() => convertUnit(1, "kg", "s", "duration"), "incompatible-unit");
    expectCode(() => convertUnit(1, "kg", "s", "mass"), "incompatible-unit");
    expectCode(() => convertUnit(1, "mg/dL", "mmol/L", "mass"), "incompatible-unit");
    expectCode(() => convertUnit(1, "mmHg", "mmHg", "blood-glucose"), "incompatible-unit");
    expectCode(() => convertUnit(1, "kg", "g", "blood-glucose"), "incompatible-unit");
  });

  it.each([
    NaN,
    Infinity,
    -Infinity,
    "2",
    null,
    undefined,
    {},
    BigInt(2),
  ])("rejects invalid values %s even for identity", (value) => {
    expectCode(() => convertUnit(value as number, "kg", "kg", "mass"), "invalid-value");
  });
});

describe("observation normalisation", () => {
  it.each(
    quantities,
  )("normalises %s %s with metadata preserved", (measure, unit, value, expected) => {
    const observation = Object.freeze({
      id: "https://example.org/health/observations/fictional-1",
      timestamp: 1761436800000,
      source: Object.freeze({ name: "Fictional device" }),
      measure,
      unit,
      value,
    });
    const result = normaliseObservation(observation);
    expect(result).not.toBe(observation);
    expect(result).toEqual({
      ...observation,
      unit: canonicalUnit(measure),
      value: expect.any(Number),
    });
    expect(Reflect.get(result, "source")).toBe(observation.source);
    expect(result.value).toBeCloseTo(expected, 10);
    expect(observation).toMatchObject({ unit, value });
    expect(normaliseObservation(result)).toEqual(result);
  });

  it("returns the canonical unit's literal type without retaining a literal input value", () => {
    const result = normaliseObservation({ measure: "mass", unit: "lb", value: 2 } as const);
    const unit: "kg" = result.unit;
    const value: number = result.value;
    expect(unit).toBe("kg");
    expect(value).toBe(0.90718474);
  });

  it("materialises prototype observation getters into an idempotent plain record", () => {
    class Reading implements UnitObservation {
      get measure() {
        return "mass" as const;
      }
      get value() {
        return 2500;
      }
      get unit() {
        return "g";
      }
      get source() {
        return "Fictional device";
      }
      describe() {
        return "Fictional reading";
      }
    }
    const observation = Object.freeze(new Reading());
    const result = normaliseObservation(observation);
    expect(result).toEqual({ measure: "mass", value: 2.5, unit: "kg" });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(normaliseObservation(result)).toEqual(result);
    expect(result).not.toHaveProperty("source");
    expect(result).not.toHaveProperty("describe");
    expectTypeOf(result).toEqualTypeOf<{
      readonly measure: "mass";
      readonly value: number;
      readonly unit: "kg";
    }>();
    expect(observation.value).toBe(2500);
  });

  it("materialises required non-enumerable fields without promising metadata in its type", () => {
    const observation = {
      measure: "mass",
      value: 2500,
      unit: "g",
      source: "Fictional device",
    } as const;
    for (const key of ["measure", "value", "unit", "source"]) {
      Object.defineProperty(observation, key, { enumerable: false });
    }
    const result = normaliseObservation(Object.freeze(observation));
    expect(result).toEqual({ measure: "mass", value: 2.5, unit: "kg" });
    expect(normaliseObservation(result)).toEqual(result);
    expect(result).not.toHaveProperty("source");
    expectTypeOf(result).toEqualTypeOf<{
      readonly measure: "mass";
      readonly value: number;
      readonly unit: "kg";
    }>();
  });

  it("shallow-copies own enumerable metadata getters and symbol keys as values", () => {
    const key = Symbol("metadata");
    const source = Object.freeze({ name: "Fictional device" });
    const observation = Object.freeze({
      measure: "mass",
      value: 2500,
      unit: "g",
      get source() {
        return source;
      },
      [key]: source,
    } as const);
    const result = normaliseObservation(observation);
    expect(Object.getOwnPropertyDescriptor(result, "source")).toEqual({
      value: source,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    expect(Reflect.get(result, "source")).toBe(source);
    expect(Reflect.get(result, key)).toBe(source);
    expectTypeOf(result).toEqualTypeOf<{
      readonly measure: "mass";
      readonly value: number;
      readonly unit: "kg";
    }>();
  });

  it.each([null, undefined, [], 1, "observation"])("rejects malformed observation %s", (value) => {
    expectCode(
      () => normaliseObservation(value as unknown as UnitObservation),
      "invalid-observation",
    );
  });

  it("propagates typed validation errors without modifying an observation", () => {
    const base = Object.freeze({ measure: "mass", value: 2, unit: "kg" } as const);
    expectCode(() => normaliseObservation({ ...base, unit: "unknown" }), "unknown-unit");
    expectCode(() => normaliseObservation({ ...base, unit: "s" }), "incompatible-unit");
    expectCode(() => normaliseObservation({ ...base, value: NaN }), "invalid-value");
    expectCode(() => normaliseObservation({} as UnitObservation), "unknown-measure");
    expectCode(
      () => normaliseObservation({ measure: "distance", unit: "km", value: Number.MAX_VALUE }),
      "numeric-range",
    );
    expect(base).toEqual({ measure: "mass", value: 2, unit: "kg" });
  });
});
