// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import {
  decodeOrdered,
  durationMinutes,
  encodeOrdered,
  extractRecipeJsonLd,
  formatDuration,
  fromSchemaOrgJsonLd,
  importRecipe,
  parseMealPlan,
  parseRecipe,
  type RecipeData,
  recipeSubject,
  scaleIngredient,
  serializeMealPlan,
  serializeRecipe,
  validateRecipe,
} from "../src/index.js";

const basic: RecipeData = {
  name: "Test stew",
  ingredients: ["2 cups flour", "1 egg", "2 cups flour"],
  instructions: ["Mix", "Cook", "Mix"],
};
describe("generated model facade", () => {
  it("round trips every recipe field including order and duplicate literals", async () => {
    const data = {
      ...basic,
      description: "A nice stew",
      author: "Fictional Cook",
      image: "https://example.org/stew.jpg",
      url: "https://example.org/stew",
      recipeYield: "4 servings",
      prepTime: "PT10M",
      cookTime: "PT1H",
      totalTime: "PT1H10M",
      category: "Dinner",
      cuisine: "British",
      keywords: ["quick", "simple"],
      rating: 4.5,
      favourite: true,
      calories: "450 kcal",
      created: new Date("2026-11-01T00:00:00Z"),
      modified: new Date("2026-11-02T00:00:00Z"),
    };
    const url = "https://pod.example/recipes/one.ttl";
    const ttl = await serializeRecipe(url, data);
    expect(ttl).toContain("NutritionInformation");
    expect(ttl).toContain("reviewRating");
    expect(ttl).toContain("ratingValue");
    expect(ttl).not.toContain("aggregateRating");
    expect(await parseRecipe(url, ttl)).toEqual(data);
    expect(recipeSubject(url)).toBe(`${url}#it`);
    expect(() => recipeSubject("relative")).toThrow();
  });
  it("keeps optional nutrition absent and supplies empty arrays", async () => {
    const ttl = await serializeRecipe("https://pod.example/r", {
      name: "Soup",
      ingredients: [],
      instructions: [],
    });
    expect(await parseRecipe("https://pod.example/r", ttl)).toMatchObject({
      name: "Soup",
      favourite: false,
      ingredients: [],
      instructions: [],
    });
    expect(ttl).not.toContain("NutritionInformation");
    expect(await parseRecipe("relative", ttl)).toBeUndefined();
    expect(await parseRecipe("https://pod.example/r", "")).toBeUndefined();
  });
  it.each([
    "image",
    "url",
    "prepTime",
    "cookTime",
    "totalTime",
    "rating",
    "created",
    "modified",
  ] as const)("reports invalid optional %s instead of silently dropping it", (key) => {
    expect(() =>
      validateRecipe({
        ...basic,
        [key]:
          key === "rating"
            ? 6
            : key === "created" || key === "modified"
              ? new Date("bad")
              : "not-valid",
      }),
    ).toThrow();
  });
  it("rejects missing names and invalid private copies", () => {
    expect(() => validateRecipe({ ...basic, name: " " })).toThrow();
    expect(decodeOrdered(["000002:third", "000000:first", "000001:second"])).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(decodeOrdered(["a", "b", "123:literal"])).toBeUndefined();
    expect(encodeOrdered(["000001:text", "x", "x"])).toEqual([
      "000000:000001:text",
      "000001:x",
      "000002:x",
    ]);
    expect(() => encodeOrdered(new Array(1000000))).toThrow();
  });
  it("round trips seven independent generated meal plan references", async () => {
    const data = {
      name: "2026-11-09",
      monday: "https://pod.example/recipes/a#it",
      tuesday: "https://pod.example/recipes/b#it",
      wednesday: "https://pod.example/recipes/a#it",
      thursday: "https://pod.example/recipes/a#it",
      friday: "https://pod.example/recipes/b#it",
      saturday: "https://pod.example/recipes/a#it",
      sunday: "https://pod.example/recipes/b#it",
    };
    expect(
      await parseMealPlan(
        "https://pod.example/plan",
        await serializeMealPlan("https://pod.example/plan", data),
      ),
    ).toEqual({ ...data, startDate: new Date("2026-11-09T00:00:00Z") });
  });
});
describe("ingredient scaling", () => {
  it.each([
    ["2 1/2 cups flour", 2, "5 cups flour"],
    ["½ cup milk", 3, "1 1/2 cup milk"],
    ["1½ cups", 2, "3 cups"],
    ["1 ½ cups", 2, "3 cups"],
    ["1/3 cup", 2, "2/3 cup"],
    ["2–3 carrots", 2, "4–6 carrots"],
    ["1 - 2 tsp", 0.5, "1/2–1 tsp"],
    ["1 to 2 tbsp", 3, "3–6 tbsp"],
    ["1—2 apples", 2, "2–4 apples"],
    ["  2 eggs", 0.5, "  1 eggs"],
    ["1.25 litres", 2, "2 1/2 litres"],
    ["2 tins (400 g each)", 2, "4 tins (400 g each)"],
    ["Salt to taste", 2, "Salt to taste"],
    ["1/0 cup", 2, "1/0 cup"],
    ["1 to 1/0 cups", 2, "1 to 1/0 cups"],
    ["2 cups", 1, "2 cups"],
    ["2", 2, "4"],
    ["⅛ tsp", 3, "3/8 tsp"],
    ["1 cup", 0.625, "5/8 cup"],
    ["1 cup", 0.75, "3/4 cup"],
    ["1 cup", 0.875, "7/8 cup"],
    ["1 cup", 0.1, "0.1 cup"],
    ["200g flour", 2, "200g flour"],
  ])("scales %s by %s", (line, factor, result) =>
    expect(scaleIngredient(line as string, factor as number)).toBe(result));
  it.each([0, -1, NaN, Infinity])("rejects multiplier %s", (factor) =>
    expect(() => scaleIngredient("2 eggs", factor)).toThrow());
});
describe("duration formatting", () => {
  it.each([
    [undefined, ""],
    ["PT0M", "0 min"],
    ["PT30S", "Less than a minute"],
    ["PT45M", "45 min"],
    ["PT2H", "2 hr"],
    ["PT1H30M", "1 hr 30 min"],
    ["P1DT2H", "26 hr"],
    ["P1M", "P1M"],
    ["PT", "PT"],
    ["P", "P"],
    ["P1DT", "P1DT"],
  ])("formats %s", (input, output) => expect(formatDuration(input)).toBe(output));
  it("returns finite minute values", () => {
    expect(durationMinutes("PT1.5H")).toBeUndefined();
    expect(durationMinutes("PT")).toBeUndefined();
    expect(durationMinutes(`P${"9".repeat(400)}D`)).toBeUndefined();
  });
});
describe("untrusted Recipe JSON-LD import", () => {
  it("maps @graph, type arrays, object images/authors, sections and ISO durations", () => {
    const json = [
      { "@type": "WebSite" },
      {
        "@graph": [
          {
            "@type": ["Thing", "https://schema.org/Recipe"],
            name: "Bean soup",
            description: " Warm ",
            image: [{ url: "javascript:bad" }, { contentUrl: "https://example.org/a.jpg" }],
            author: [{ name: "Fictional Cook" }, "Test Kitchen"],
            url: { "@id": "https://example.org/recipe" },
            recipeYield: [4, "servings"],
            prepTime: "PT10M",
            cookTime: "PT30M",
            totalTime: "PT40M",
            recipeCategory: ["Dinner", "Soup"],
            recipeCuisine: "British",
            keywords: ["beans, quick", " easy "],
            recipeIngredient: ["1 tin beans", "water"],
            recipeInstructions: [
              {
                "@type": "HowToSection",
                name: "Soup",
                itemListElement: [{ "@type": "HowToStep", text: "Boil\nStir" }, { name: "Serve" }],
              },
            ],
            nutrition: { calories: "350 kcal" },
            aggregateRating: { ratingValue: 5 },
          },
        ],
      },
    ];
    expect(fromSchemaOrgJsonLd(json)).toEqual({
      name: "Bean soup",
      description: "Warm",
      image: "https://example.org/a.jpg",
      url: "https://example.org/recipe",
      author: "Fictional Cook, Test Kitchen",
      recipeYield: "4, servings",
      prepTime: "PT10M",
      cookTime: "PT30M",
      totalTime: "PT40M",
      category: "Dinner, Soup",
      cuisine: "British",
      keywords: ["beans", "quick", "easy"],
      ingredients: ["1 tin beans", "water"],
      instructions: ["Boil", "Stir", "Serve"],
      calories: "350 kcal",
      favourite: false,
    });
  });
  it("handles compact and http types, bare string images, fallbacks and weeks", () => {
    for (const type of ["Recipe", "http://schema.org/Recipe", "schema:Recipe"]) {
      const row = fromSchemaOrgJsonLd({
        mainEntity: {
          "@type": type,
          name: "Soup",
          image: "https://example.org/img",
          mainEntityOfPage: "https://example.org/source",
          author: "Cook",
          prepTime: "P1W",
          cookTime: "invalid",
          recipeInstructions: "Boil\nServe",
        },
      });
      expect(row.prepTime).toBe("PT168H");
      expect(row.cookTime).toBeUndefined();
      expect(row.instructions).toEqual(["Boil", "Serve"]);
      expect(row.url).toBe("https://example.org/source");
    }
    expect(fromSchemaOrgJsonLd('{"@type":"Recipe","name":"Soup"}').ingredients).toEqual([]);
  });
  it("drops unsafe links and tolerates mixed malformed optional values", () => {
    const row = fromSchemaOrgJsonLd({
      "@type": "Recipe",
      name: "Soup",
      image: [{}, "relative", "https://user:password@example.org/img"],
      url: "javascript:bad",
      author: [{}, null],
      recipeIngredient: [false, {}, "Salt"],
      recipeInstructions: [null, {}, "Stir"],
      recipeYield: false,
      nutrition: { calories: Infinity },
    });
    expect(row.image).toBeUndefined();
    expect(row.url).toBeUndefined();
    expect(row.author).toBeUndefined();
    expect(row.ingredients).toEqual(["Salt"]);
    expect(row.instructions).toEqual(["Stir"]);
  });
  it("bounds graph cycles and nested steps", () => {
    const graph: Record<string, unknown> = {};
    graph["@graph"] = graph;
    expect(() => fromSchemaOrgJsonLd(graph)).toThrow("No schema.org Recipe");
    let nested: unknown = "Stir";
    for (let index = 0; index < 32; index++) nested = { itemListElement: nested };
    expect(() =>
      fromSchemaOrgJsonLd({ "@type": "Recipe", name: "Soup", recipeInstructions: nested }),
    ).toThrow("deeply");
    expect(() => fromSchemaOrgJsonLd({ "@type": "Recipe" })).toThrow("name");
    expect(() => fromSchemaOrgJsonLd(null)).toThrow();
    expect(() => fromSchemaOrgJsonLd("bad JSON")).toThrow();
  });
  it("extracts inert script text, skips invalid and unrelated blocks, and imports a later recipe", () => {
    const html = `<html><script>throw new Error('never run')</script><script data-label=">" TYPE = 'application/ld+json'>broken</script><script type=application/ld+json>{"@type":"WebSite"}</script><script type="application/ld+json">{"@type":"Recipe","name":"Soup","recipeInstructions":"Serve"}</script></html>`;
    expect(extractRecipeJsonLd(html)).toHaveLength(2);
    expect(importRecipe(html).name).toBe("Soup");
    expect(importRecipe('{"@type":"Recipe","name":"Soup"}').name).toBe("Soup");
    expect(
      extractRecipeJsonLd('<script type="APPLICATION/LD+JSON"><!-- {"a":1} --></script>'),
    ).toEqual([{ a: 1 }]);
    expect(() => importRecipe("<html>No recipe</html>")).toThrow("No recipe found");
    expect(() => extractRecipeJsonLd("x".repeat(5000001))).toThrow("5 MB");
    expect(() => importRecipe("x".repeat(5000001))).toThrow("5 MB");
  });
});
