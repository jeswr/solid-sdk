// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
//
// Round-trip (parse∘build == identity) + untrusted-input discipline for the
// Meal / FoodItem / Exposure entities.

import { parseRdf } from "@jeswr/fetch-rdf";
import { Store } from "n3";
import { describe, expect, it } from "vitest";
import { deriveExposures } from "./derive.js";
import {
  buildMeal,
  exposureSubject,
  foodItemSubject,
  type MealData,
  mealSubject,
  parseExposure,
  parseFoodItem,
  parseMeal,
  parseMealTtl,
  serializeMeal,
} from "./meal.js";

const URL_ = "https://alice.pod.example/health/diary/meals/2026/07/01.ttl";
const ME = "https://alice.pod.example/profile/card#me";

function fullMeal(): MealData {
  const item0 = foodItemSubject(URL_, 0);
  const item1 = foodItemSubject(URL_, 1);
  return {
    id: mealSubject(URL_),
    startTime: new Date("2026-07-01T08:30:00.000Z"),
    context: "restaurant",
    venue: "The Corner Cafe",
    location: "https://example.org/places/corner-cafe",
    portion: "normal",
    note: "brunch",
    patient: ME,
    created: new Date("2026-07-01T08:31:00.000Z"),
    items: [
      {
        id: item0,
        name: "Multigrain toast",
        offBarcode: "5000000000001",
        offRef: "https://world.openfoodfacts.org/product/5000000000001",
        ingredientsText: "wheat flour, water, salt",
        declaredAllergen: ["en:gluten"],
        traceAllergen: ["en:nuts"],
        additive: ["en:e300"],
        offCategory: ["en:breads"],
        sourceConfidence: "off",
      },
      {
        id: item1,
        name: "Dried apricots",
        offCategory: ["en:dried-apricots"],
        sourceConfidence: "manual",
      },
    ],
    exposures: [
      {
        id: exposureSubject(URL_, 0),
        trigger: "gluten",
        exposureLevel: "present",
        derivedFrom: [item0],
      },
    ],
  };
}

describe("Meal round-trip (parse∘build == identity)", () => {
  it("a fully-populated meal round-trips through Turtle", async () => {
    const data = fullMeal();
    const ttl = await serializeMeal(URL_, data);
    const parsed = await parseMealTtl(URL_, ttl, "text/turtle");
    expect(parsed).toEqual(data);
  });

  it("a minimal meal (startTime + one item) round-trips", async () => {
    const data: MealData = {
      id: mealSubject(URL_),
      startTime: new Date("2026-07-01T12:00:00.000Z"),
      created: new Date("2026-07-01T12:00:05.000Z"),
      items: [{ id: foodItemSubject(URL_, 0), name: "Apple" }],
    };
    const parsed = parseMeal(URL_, buildMeal(URL_, data));
    expect(parsed).toEqual(data);
  });

  it("parses undefined for a document that is not a diet:Meal", async () => {
    const parsed = await parseMealTtl(
      URL_,
      "<#it> <http://example.org/p> <http://example.org/o> .",
    );
    expect(parsed).toBeUndefined();
  });

  it("rejects a Meal with NO ingestion time (never coerces to the 1970 epoch)", async () => {
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      <${URL_}#it> a diet:Meal ; diet:hasItem <${URL_}#item-0> .
      <${URL_}#item-0> a diet:FoodItem .
    `;
    expect(await parseMealTtl(URL_, ttl)).toBeUndefined();
  });
});

describe("Meal exposure scoping (no cross-meal misattribution)", () => {
  it("parseMeal from a dataset holding TWO meals only picks its OWN exposures", () => {
    const Other = "https://alice.pod.example/health/diary/meals/2026/07/02.ttl";
    const mine = buildMeal(URL_, {
      startTime: new Date("2026-07-01T09:00:00.000Z"),
      created: new Date("2026-07-01T09:00:00.000Z"),
      items: [
        { id: foodItemSubject(URL_, 0), name: "Apricots", offCategory: ["en:dried-apricots"] },
      ],
      exposures: [
        {
          id: exposureSubject(URL_, 0),
          trigger: "sulphites",
          exposureLevel: "possible-undeclared",
        },
      ],
    });
    const other = buildMeal(Other, {
      startTime: new Date("2026-07-02T09:00:00.000Z"),
      created: new Date("2026-07-02T09:00:00.000Z"),
      items: [{ id: foodItemSubject(Other, 0), name: "Bread", declaredAllergen: ["en:gluten"] }],
      exposures: [{ id: exposureSubject(Other, 0), trigger: "gluten", exposureLevel: "present" }],
    });
    const combined = new Store([...mine, ...other]);

    // Each meal sees ONLY its own exposure, never the other document's.
    expect(parseMeal(URL_, combined)?.exposures?.map((e) => e.trigger)).toEqual(["sulphites"]);
    expect(parseMeal(Other, combined)?.exposures?.map((e) => e.trigger)).toEqual(["gluten"]);
  });

  it("normalises an externally-supplied exposure id into the meal document (still discovered)", () => {
    const item0 = foodItemSubject(URL_, 0);
    const data: MealData = {
      id: mealSubject(URL_),
      startTime: new Date("2026-07-01T09:00:00.000Z"),
      created: new Date("2026-07-01T09:00:00.000Z"),
      items: [{ id: item0, name: "Apricots", offCategory: ["en:dried-apricots"] }],
      exposures: [
        {
          // An out-of-document exposure id — buildMeal must mint it IN-document so
          // the doc-scoped parseMeal can still discover it (no silent round-trip break).
          id: "https://elsewhere.example/other.ttl#x",
          trigger: "sulphites",
          exposureLevel: "possible-undeclared",
          derivedFrom: [item0],
        },
      ],
    };
    const parsed = parseMeal(URL_, buildMeal(URL_, data));
    expect(parsed?.exposures).toHaveLength(1);
    // Found; its id is the in-document minted subject, not the external one.
    expect(parsed?.exposures?.[0]?.id).toBe(exposureSubject(URL_, 0));
    expect(parsed?.exposures?.[0]?.trigger).toBe("sulphites");
    expect(parsed?.exposures?.[0]?.derivedFrom).toEqual([item0]);
  });
});

describe("Meal untrusted-input discipline", () => {
  it("parseMeal FAILS CLOSED on a duplicated single-valued predicate (two schema:startTime)", async () => {
    // sh:maxCount 1: two startTime values must NOT be parsed with an arbitrary one.
    const dupStart = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix schema: <http://schema.org/> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${URL_}#it> a diet:Meal ;
        schema:startTime "2026-07-01T08:30:00.000Z"^^xsd:dateTime ,
                         "2026-07-02T09:00:00.000Z"^^xsd:dateTime ;
        diet:hasItem <${URL_}#item-0> .
      <${URL_}#item-0> a diet:FoodItem ; schema:name "Toast" .`;
    expect(await parseMealTtl(URL_, dupStart)).toBeUndefined();
  });

  it("parseMeal ACCEPTS a document with repeated NON-modeled/extension predicates (open-world)", async () => {
    // The SHACL profile is OPEN: extra triples on the subject (multilingual labels,
    // owl:sameAs, foreign metadata) are NOT sh:maxCount 1 and must NOT invalidate
    // the parse — only the model's OWN singleton fields are checked.
    const withExtensions = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix schema: <http://schema.org/> .
      @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
      @prefix owl: <http://www.w3.org/2002/07/owl#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${URL_}#it> a diet:Meal ;
        schema:startTime "2026-07-01T08:30:00.000Z"^^xsd:dateTime ;
        rdfs:label "Brunch"@en , "Brunch"@fr ;
        owl:sameAs <https://other.example/meal/1> , <https://other.example/meal/2> ;
        diet:hasItem <${URL_}#item-0> .
      <${URL_}#item-0> a diet:FoodItem ; schema:name "Toast" .`;
    const parsed = await parseMealTtl(URL_, withExtensions);
    expect(parsed).toBeDefined();
    expect(parsed?.items).toHaveLength(1);
  });

  it("drops a non-http(s) location / patient / offRef rather than write a malformed IRI", async () => {
    const data: MealData = {
      startTime: new Date("2026-07-01T00:00:00.000Z"),
      created: new Date("2026-07-01T00:00:00.000Z"),
      location: "javascript:alert(1)",
      patient: "urn:not-a-webid",
      items: [{ name: "x", offRef: "not-a-url" }],
    };
    const parsed = parseMeal(URL_, buildMeal(URL_, data));
    expect(parsed?.location).toBeUndefined();
    expect(parsed?.patient).toBeUndefined();
    expect(parsed?.items[0]?.offRef).toBeUndefined();
  });

  it("buildMeal FAILS CLOSED on an itemless meal (SHACL MUST: ≥1 FoodItem)", () => {
    expect(() =>
      buildMeal(URL_, { startTime: new Date("2026-07-01T00:00:00.000Z"), items: [] }),
    ).toThrow(/at least one/);
  });

  it("buildMeal FAILS CLOSED on an unnamed FoodItem (SHACL MUST: schema:name)", () => {
    expect(() =>
      buildMeal(URL_, {
        startTime: new Date("2026-07-01T00:00:00.000Z"),
        items: [{ offBarcode: "5000000000001" }],
      }),
    ).toThrow(/name/);
  });

  it("buildMeal FAILS CLOSED on an exposure with a missing/unknown trigger or level (SHACL MUSTs)", () => {
    const okItem = { name: "Toast" };
    const start = new Date("2026-07-01T00:00:00.000Z");
    expect(() =>
      buildMeal(URL_, {
        startTime: start,
        items: [okItem],
        exposures: [{ exposureLevel: "present" } as never],
      } as MealData),
    ).toThrow(/trigger/);
    expect(() =>
      buildMeal(URL_, {
        startTime: start,
        items: [okItem],
        exposures: [{ trigger: "not-a-trigger", exposureLevel: "present" } as never],
      } as MealData),
    ).toThrow(/trigger/);
    expect(() =>
      buildMeal(URL_, {
        startTime: start,
        items: [okItem],
        exposures: [{ trigger: "gluten" } as never],
      } as MealData),
    ).toThrow(/exposureLevel/);
    expect(() =>
      buildMeal(URL_, {
        startTime: start,
        items: [okItem],
        exposures: [{ trigger: "gluten", exposureLevel: "bogus" } as never],
      } as MealData),
    ).toThrow(/exposureLevel/);
  });

  it("buildMeal FAILS CLOSED on a missing/invalid startTime (SHACL MUST: ingestion time)", () => {
    // Bad casts / JS callers could smuggle a non-Date or an Invalid Date.
    expect(() => buildMeal(URL_, { items: [{ name: "Toast" }] } as unknown as MealData)).toThrow(
      /startTime/,
    );
    expect(() =>
      buildMeal(URL_, { startTime: new Date("nonsense"), items: [{ name: "Toast" }] }),
    ).toThrow(/startTime/);
  });

  it("parseMeal does NOT crash on a wrong-DATATYPE term (fails closed to undefined)", async () => {
    // schema:startTime typed xsd:string (not xsd:dateTime) makes the @rdfjs/wrapper
    // date mapper THROW; the tryRead guard must catch it and return undefined rather
    // than crash the read on a malformed/hostile pod document.
    const wrongType = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix schema: <http://schema.org/> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${URL_}#it> a diet:Meal ;
        schema:startTime "2026-07-01"^^xsd:string ;
        diet:hasItem <${URL_}#item-0> .
      <${URL_}#item-0> a diet:FoodItem ; schema:name "Toast" .`;
    // Must resolve to undefined, NOT reject/throw (await would surface a throw).
    await expect(parseMealTtl(URL_, wrongType)).resolves.toBeUndefined();
  });

  it("buildMeal FAILS CLOSED on duplicate FoodItem ids (silent overwrite guard)", () => {
    const dup = foodItemSubject(URL_, 0);
    expect(() =>
      buildMeal(URL_, {
        startTime: new Date("2026-07-01T00:00:00.000Z"),
        items: [
          { id: dup, name: "Toast" },
          { id: dup, name: "Jam" },
        ],
      }),
    ).toThrow(/duplicate/);
  });

  it("parseMeal REJECTS a meal whose startTime literal is a malformed date (not an Invalid Date)", async () => {
    // A malformed date literal parses to a truthy `Invalid Date`; a bare truthiness
    // check would let it through and corrupt every lag calculation. Must reject.
    const bad = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix schema: <http://schema.org/> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${URL_}#it> a diet:Meal ;
        schema:startTime "not-a-real-date"^^xsd:dateTime ;
        diet:hasItem <${URL_}#item-0> .
      <${URL_}#item-0> a diet:FoodItem ; schema:name "Toast" .`;
    expect(await parseMealTtl(URL_, bad)).toBeUndefined();
  });

  it("parseMeal DROPS a FoodItem linked via a non-http(s) subject (hostile diet:hasItem)", async () => {
    // A hostile document links a typed, NAMED FoodItem at a `javascript:` subject —
    // parseFoodItem must reject the non-http(s) subject, so the item is dropped and
    // (being the only item) the whole meal fails closed to undefined.
    const hostile = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix schema: <http://schema.org/> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${URL_}#it> a diet:Meal ;
        schema:startTime "2026-07-01T08:30:00.000Z"^^xsd:dateTime ;
        diet:hasItem <javascript:alert(1)> .
      <javascript:alert(1)> a diet:FoodItem ; schema:name "Toast" .`;
    expect(await parseMealTtl(URL_, hostile)).toBeUndefined();
  });

  it("parseMeal FAILS CLOSED on a meal whose only FoodItem lacks schema:name (SHACL MUST)", async () => {
    // Hand-written (buildMeal refuses to emit this) — a nameless FoodItem is an
    // unusable intake record, so it is dropped; with no valid item left the whole
    // meal is unusable and parseMeal returns undefined (never a food-less meal).
    const namelessTtl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix schema: <http://schema.org/> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${URL_}#it> a diet:Meal ;
        schema:startTime "2026-07-01T08:30:00.000Z"^^xsd:dateTime ;
        diet:hasItem <${URL_}#item-0> .
      <${URL_}#item-0> a diet:FoodItem .`;
    expect(await parseMealTtl(URL_, namelessTtl)).toBeUndefined();
  });

  it("parseMeal FAILS CLOSED on a meal with no FoodItem at all (SHACL MUST: ≥1 item)", async () => {
    const noItemsTtl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix schema: <http://schema.org/> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${URL_}#it> a diet:Meal ;
        schema:startTime "2026-07-01T08:30:00.000Z"^^xsd:dateTime .`;
    expect(await parseMealTtl(URL_, noItemsTtl)).toBeUndefined();
  });

  it("parseExposure returns undefined for a non-http(s) subject (direct hostile-subject call)", async () => {
    const ds = await parseRdf(
      `@prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
       <javascript:steal()> a diet:Exposure ;
         diet:trigger diet:sulphites ;
         diet:exposureLevel diet:possibleUndeclared .`,
      "text/turtle",
      { baseIRI: URL_ },
    );
    expect(parseExposure("javascript:steal()", ds)).toBeUndefined();
  });

  it("parseFoodItem returns undefined for a FoodItem missing schema:name (fail-closed)", async () => {
    const ds = await parseRdf(
      `@prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
       <${URL_}#item-0> a diet:FoodItem .`,
      "text/turtle",
      { baseIRI: URL_ },
    );
    expect(parseFoodItem(`${URL_}#item-0`, ds)).toBeUndefined();
  });

  it("parseMeal DROPS non-http(s) URL-valued fields from a HOSTILE document (no js:/data: surfaced)", async () => {
    // A malicious pod document carrying javascript:/data:/urn: IRIs in the URL-valued
    // fields (location, patient, offRef, exposure derivedFrom). The read path must be
    // symmetric with the writer and drop every one, never surfacing a dangerous IRI.
    const hostile = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix schema: <http://schema.org/> .
      @prefix health: <https://w3id.org/jeswr/sectors/health#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${URL_}#it> a diet:Meal ;
        schema:startTime "2026-07-01T08:30:00.000Z"^^xsd:dateTime ;
        schema:location <javascript:alert(1)> ;
        health:patient <urn:not-a-webid> ;
        diet:hasItem <${URL_}#item-0> .
      <${URL_}#item-0> a diet:FoodItem ;
        schema:name "Toast" ;
        diet:offRef <data:text/html,evil> .
      <${URL_}#exposure-0> a diet:Exposure ;
        diet:trigger diet:sulphites ;
        diet:exposureLevel diet:possibleUndeclared ;
        diet:derivedFrom <javascript:steal()> .`;
    const parsed = await parseMealTtl(URL_, hostile);
    expect(parsed).toBeDefined();
    expect(parsed?.location).toBeUndefined();
    expect(parsed?.patient).toBeUndefined();
    expect(parsed?.items[0]?.offRef).toBeUndefined();
    // the exposure survives (trigger+level valid) but its hostile derivedFrom is dropped
    expect(parsed?.exposures?.[0]?.derivedFrom).toBeUndefined();
  });
});

describe("deriveExposures integrated into a built Meal", () => {
  it("derived exposures written into the meal round-trip and keep provenance", async () => {
    const item0 = foodItemSubject(URL_, 0);
    const exposures = deriveExposures([
      { id: item0, name: "Dried apricots", offCategory: ["en:dried-apricots"] },
    ]).map((e, i) => ({ ...e, id: exposureSubject(URL_, i) }));
    const data: MealData = {
      id: mealSubject(URL_),
      startTime: new Date("2026-07-01T09:00:00.000Z"),
      created: new Date("2026-07-01T09:00:00.000Z"),
      items: [{ id: item0, name: "Dried apricots", offCategory: ["en:dried-apricots"] }],
      exposures,
    };
    const parsed = parseMeal(URL_, buildMeal(URL_, data));
    expect(parsed?.exposures?.[0]?.trigger).toBe("sulphites");
    expect(parsed?.exposures?.[0]?.exposureLevel).toBe("possible-undeclared");
    expect(parsed?.exposures?.[0]?.derivedFrom).toEqual([item0]);
  });
});
