// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import { entities } from "../src/generated/model.js";
import {
  decodeOrdered,
  durationFromMinutes,
  durationMinutes,
  extractRecipeJsonLd,
  fromSchemaOrgJsonLd,
  normalizeDuration,
  parseRecipe,
  serializeRecipe,
} from "../src/index.js";

const url = "https://pod.example/recipes/soup";
describe("clean schema.org values and private ordering", () => {
  it("exposes clean standard values while privately preserving duplicate ingredients and steps", async () => {
    const data = {
      name: "Soup",
      ingredients: ["2 eggs", "123456: hi", "2 eggs"],
      instructions: ["Mix", "000001: literal text", "Mix"],
    };
    const ttl = await serializeRecipe(url, data);
    const raw = await entities.Recipe.parseDocument(url, ttl, "text/turtle");
    expect(raw?.ingredients).toEqual(["2 eggs", "123456: hi"]);
    expect(raw?.instructions).toEqual(["Mix", "000001: literal text"]);
    expect(raw?.orderedIngredients).toEqual([
      "000000:2 eggs",
      "000001:123456: hi",
      "000002:2 eggs",
    ]);
    expect(await parseRecipe(url, ttl)).toEqual({ ...data, favourite: false });
  });

  it("never decodes plain external strings that happen to resemble position prefixes", async () => {
    const ttl = await entities.Recipe.serialize(url, {
      name: "External soup",
      ingredients: ["123456: hi", "000001:2 eggs", "Salt"],
      instructions: ["123456: wait", "Stir"],
    });
    expect(await parseRecipe(url, ttl)).toMatchObject({
      ingredients: ["123456: hi", "000001:2 eggs", "Salt"],
      instructions: ["123456: wait", "Stir"],
    });
  });

  it("sorts mixed private copies with a consistent total order, including duplicate keys", () => {
    const values = ["000002:C", "z", "000001:B", "000001:A", "a"];
    const expected = ["A", "B", "C", "a", "z"];
    expect(decodeOrdered(values)).toEqual(expected);
    expect(decodeOrdered([...values].reverse())).toEqual(expected);
    expect(decodeOrdered([...values.slice(2), ...values.slice(0, 2)])).toEqual(expected);
    expect(decodeOrdered(["000001:same", "000001:same"])).toEqual(["same", "same"]);
  });
});

describe("XSD cooking duration normalisation", () => {
  it.each([
    [0, "PT0M"],
    [0.5, "PT30S"],
    [0.75, "PT45S"],
    [1.5, "PT1M30S"],
    [60.5, "PT1H30S"],
    [90, "PT1H30M"],
    [1440.5, "PT24H30S"],
    [0.000001 / 60, "PT0.000001S"],
    [59.999999999, "PT1H"],
  ])("encodes %s minutes as %s", async (minutes, duration) => {
    expect(durationFromMinutes(minutes)).toBe(duration);
    const ttl = await serializeRecipe(url, {
      name: "Soup",
      ingredients: [],
      instructions: [],
      prepTime: duration,
    });
    expect((await parseRecipe(url, ttl))?.prepTime).toBe(duration);
  });
  it.each([-1, NaN, Infinity, Number.MAX_VALUE])("rejects unusable minute input %s", (value) => {
    expect(() => durationFromMinutes(value)).toThrow("cooking time");
  });
  it.each([
    "PT1.5H",
    "PT1.5M",
    "P1.5D",
    "P",
    "PT",
    "P1DT",
    "PT1e2S",
    "PT-1S",
    "P1M",
    "-PT1M",
  ])("omits invalid or unsupported optional cooking duration %s without failing import", (duration) => {
    expect(durationMinutes(duration)).toBeUndefined();
    expect(normalizeDuration(duration)).toBeUndefined();
    expect(
      fromSchemaOrgJsonLd({
        "@type": "Recipe",
        name: "Soup",
        prepTime: duration,
        cookTime: duration,
        totalTime: duration,
      }),
    ).toMatchObject({
      name: "Soup",
      prepTime: undefined,
      cookTime: undefined,
      totalTime: undefined,
    });
  });
  it.each([
    ["PT.5S", "PT0.5S"],
    ["PT1.S", "PT1S"],
    ["P1DT2H90M45.25S", "PT27H30M45.25S"],
  ])("accepts runtime-valid seconds spelling %s", (input, output) => {
    expect(normalizeDuration(input)).toBe(output);
    expect(fromSchemaOrgJsonLd({ "@type": "Recipe", name: "Soup", prepTime: input }).prepTime).toBe(
      output,
    );
  });
  it("omits finite durations too large for safe normalisation", () => {
    expect(normalizeDuration("P999999999999D")).toBeUndefined();
    expect(normalizeDuration(`P${"9".repeat(400)}D`)).toBeUndefined();
  });
});

describe("linear inert HTML script scan", () => {
  it("stops at one unclosed raw-text block even with many apparent nested starts", () => {
    expect(extractRecipeJsonLd('<script type="application/ld+json">'.repeat(100_000))).toEqual([]);
  });
  it("handles malformed headers, quoted angle brackets, script-like names and mixed casing", () => {
    expect(extractRecipeJsonLd('<script type="application/ld+json')).toEqual([]);
    expect(extractRecipeJsonLd('<script type="application/ld+json" data-x="unterminated>')).toEqual(
      [],
    );
    expect(extractRecipeJsonLd("<scripture>{}</scripture>")).toEqual([]);
    expect(
      extractRecipeJsonLd(
        '<SCRIPT data-x=">" TYPE=application/ld+json>{"safe":true}</SCRIPT   >tail',
      ),
    ).toEqual([{ safe: true }]);
  });
});
