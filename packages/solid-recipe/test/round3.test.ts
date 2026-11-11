// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import model, { entities } from "../src/generated/model.js";
import {
  parseMealPlan,
  parseRecipe,
  RECIPE_CLASS,
  serializeMealPlan,
  serializeRecipe,
} from "../src/index.js";

const url = "https://pod.example/recipes/soup";
const recipe = {
  name: "Soup",
  ingredients: ["Beans", "Water", "Beans"],
  instructions: ["Boil", "Stir"],
  author: "Fictional Cook",
  description: "A warming lunch",
  image: "https://example.org/soup.jpg",
  url: "https://example.org/soup",
  recipeYield: "4 servings",
  prepTime: "PT5M",
  cookTime: "PT20M",
  totalTime: "PT25M",
  category: "Lunch",
  cuisine: "British",
  keywords: ["beans", "easy"],
  calories: "350 kcal",
  rating: 4.5,
  favourite: true,
  created: new Date("2026-11-09T00:00:00Z"),
  modified: new Date("2026-11-10T00:00:00Z"),
};
const monday = new Date("2026-11-09T00:00:00Z");

describe("HTTP schema.org vocabulary", () => {
  it("writes the suite's HTTP class, fields and composite links", async () => {
    expect(RECIPE_CLASS).toBe("http://schema.org/Recipe");
    const ttl = await serializeRecipe(url, recipe);
    expect(ttl).toContain("<http://schema.org/>");
    expect(ttl).not.toContain("https://schema.org/");
    expect(await parseRecipe(url, ttl)).toEqual(recipe);
  });
});

describe("keyword set policy", () => {
  it("records trimming, blank removal and sorted reads in the generated guards", () => {
    const generated = model.manifest.entities.find((entity) => entity.name === "Recipe");
    expect(generated?.kind).toBe("composite");
    if (generated?.kind !== "composite") throw new Error("Expected a composite");
    const root = generated.nodes.find((node) => node.name === "recipe");
    expect(root?.fields.find((field) => field.name === "keywords")?.guards).toMatchObject({
      trim: true,
      dropBlank: true,
      sortOnRead: true,
    });
  });

  it("normalises keyword sets on read/write", async () => {
    const ttl = await entities.Recipe.serialize(url, {
      name: "Soup",
      keywords: [" zesty ", "", " ", "easy", " easy ", "beans"],
    });
    expect((await parseRecipe(url, ttl))?.keywords).toEqual(["beans", "easy", "zesty"]);
  });
});

describe("dated meal plans", () => {
  it("materialises a name-encoded Monday as optional xsd:date on new writes", async () => {
    const ttl = await serializeMealPlan(url, { name: "2026-11-09" });
    expect(ttl).toContain("startDate");
    expect(ttl).toContain("date");
    expect(await entities.MealPlan.parseDocument(url, ttl)).toEqual({
      name: "2026-11-09",
      startDate: monday,
    });
    expect(await parseMealPlan(url, ttl)).toEqual({ name: "2026-11-09", startDate: monday });
  });

  it("reads legacy name-only weeks", async () => {
    const ttl = await entities.MealPlan.serialize(url, {
      name: "2026-11-09",
      monday: `${url}#it`,
    });
    expect(await parseMealPlan(url, ttl)).toEqual({
      name: "2026-11-09",
      startDate: monday,
      monday: `${url}#it`,
    });
  });

  it("uses a valid explicit week date to repair a stale legacy week name", async () => {
    const data = { name: "2026-11-02", startDate: monday };
    expect(await parseMealPlan(url, await entities.MealPlan.serialize(url, data))).toEqual({
      name: "2026-11-09",
      startDate: monday,
    });
    expect(await parseMealPlan(url, await serializeMealPlan(url, data))).toEqual({
      name: "2026-11-09",
      startDate: monday,
    });
  });

  it.each([
    "old week",
    "2026-11-10",
    "2026-02-30",
    "2026-99-99",
  ])("keeps legacy name %s without inventing a Monday", async (name) => {
    expect(await parseMealPlan(url, await serializeMealPlan(url, { name }))).toEqual({ name });
    expect(await parseMealPlan(url, await entities.MealPlan.serialize(url, { name }))).toEqual({
      name,
    });
  });

  it.each([
    new Date("bad"),
    new Date("2026-11-10T00:00:00Z"),
    new Date("2026-11-09T12:00:00Z"),
  ])("rejects an explicitly invalid week date %s on writes", async (startDate) => {
    await expect(serializeMealPlan(url, { name: "2026-11-09", startDate })).rejects.toThrow(
      "Monday",
    );
  });

  it("ignores an invalid optional week date on read and falls back to the legacy name", async () => {
    const ttl = await entities.MealPlan.serialize(url, {
      name: "2026-11-09",
      startDate: new Date("2026-11-10T00:00:00Z"),
    });
    expect(await parseMealPlan(url, ttl)).toEqual({ name: "2026-11-09", startDate: monday });
    expect(await parseMealPlan(url, "")).toBeUndefined();
  });
});
