// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import { entities } from "../src/generated/model.js";
import {
  decodeOrdered,
  durationFromMinutes,
  durationMinutes,
  encodeOrdered,
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

  describe.each([
    ["ingredients", "orderedIngredients"],
    ["instructions", "orderedInstructions"],
  ] as const)("reconciling %s with %s", (standard, ordered) => {
    const privateLines = ["Second", "First", "Second"];
    it.each([
      ["adds an item", ["First", "Second", "Added"]],
      ["removes an item", ["First"]],
      ["removes every item", []],
      ["replaces an item", ["First", "Replacement"]],
    ])("keeps external schema.org edits when a writer %s", async (_change, values) => {
      const ttl = await entities.Recipe.serialize(url, {
        name: "External soup",
        [standard]: values,
        [ordered]: encodeOrdered(privateLines),
      });
      const parsed = await parseRecipe(url, ttl);
      expect(parsed?.[standard]).toEqual(values);
      if (!parsed) throw new Error("Expected a recipe");

      const saved = await serializeRecipe(url, { ...parsed, favourite: true });
      const raw = await entities.Recipe.parseDocument(url, saved);
      expect(raw?.[standard] ?? []).toEqual(values);
      expect(raw?.[ordered] ?? []).toEqual(encodeOrdered(values));
      expect(await parseRecipe(url, saved)).toMatchObject({
        [standard]: values,
        favourite: true,
      });
    });

    it("preserves private order and duplicates when both sets agree", async () => {
      const ttl = await entities.Recipe.serialize(url, {
        name: "Soup",
        [standard]: ["First", "Second"],
        [ordered]: encodeOrdered(privateLines),
      });
      expect((await parseRecipe(url, ttl))?.[standard]).toEqual(privateLines);
    });
  });

  it.each([
    ["unprefixed values", ["First", "Second"]],
    ["mixed values", ["000000:First", "Second"]],
    ["duplicate positions", ["000000:First", "000000:Second"]],
    ["repeated identical positions", ["000000:First", "000000:First", "000001:Second"]],
    ["missing zero", ["000001:First", "000002:Second"]],
    ["gaps", ["000000:First", "000002:Second"]],
    ["short positions", ["00000:First", "000001:Second"]],
    ["long positions", ["0000000:First", "000001:Second"]],
    ["missing colon", ["000000First", "000001:Second"]],
    ["empty lines", ["", "000001:Second"]],
  ])("rejects private copies with %s", (_reason, values) => {
    expect(decodeOrdered(values)).toBeUndefined();
    expect(decodeOrdered([...values].reverse())).toBeUndefined();
  });

  describe.each([
    ["ingredients", "orderedIngredients"],
    ["instructions", "orderedInstructions"],
  ] as const)("validating private %s", (standard, ordered) => {
    it.each([
      ["unprefixed", ["Second", "First"]],
      ["mixed", ["000000:Second", "First"]],
      ["duplicate", ["000000:Second", "000000:First"]],
      ["nonzero start", ["000001:Second", "000002:First"]],
      ["gapped", ["000000:Second", "000002:First"]],
      [
        "overlong",
        Array.from(
          { length: 2001 },
          (_, index) => `${String(index).padStart(6, "0")}:${index % 2 ? "First" : "Second"}`,
        ),
      ],
    ])("falls back to standard order for a %s private sequence with matching text", async (_reason, lines) => {
      const ttl = await entities.Recipe.serialize(url, {
        name: "Soup",
        [standard]: ["First", "Second"],
        [ordered]: lines,
      });
      expect((await parseRecipe(url, ttl))?.[standard]).toEqual(["First", "Second"]);
    });
  });

  it("accepts only bounded contiguous positions, keeping duplicates and text intact", () => {
    expect(decodeOrdered([])).toEqual([]);
    expect(decodeOrdered(["000002:First", "000000:First", "000001:Second\nline"])).toEqual([
      "First",
      "Second\nline",
      "First",
    ]);
    const lines = Array.from({ length: 2000 }, (_, index) => `line ${index}`);
    expect(decodeOrdered(encodeOrdered(lines).reverse())).toEqual(lines);
    expect(decodeOrdered([...encodeOrdered(lines), "002000:excess"])).toBeUndefined();
    expect(() => encodeOrdered([...lines, "excess"])).toThrow("2,000");
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
