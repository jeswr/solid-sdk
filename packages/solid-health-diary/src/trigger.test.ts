// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.

import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import { dietVocabTtl } from "./shape.js";
import {
  buildTriggerClass,
  buildTriggerScheme,
  defaultTriggerClass,
  EVIDENCE_PRIOR_LAG,
  parseTriggerClass,
  serializeTriggerClass,
  type TriggerClassData,
  toXsdDecimalLexical,
} from "./trigger.js";
import { diet, TRIGGER_SLUGS, triggerIri } from "./vocab.js";

describe("TriggerClass round-trip + evidence-prior lag profiles", () => {
  it("a trigger class round-trips through Turtle", async () => {
    const data: TriggerClassData = {
      slug: "gluten",
      label: "gluten",
      lagWindowMin: 0,
      lagWindowMax: 72,
      lagMode: 3,
    };
    const ttl = await serializeTriggerClass(data);
    const store = new Store(new Parser().parse(ttl));
    expect(parseTriggerClass("gluten", store)).toEqual(data);
  });

  it("every trigger slug has an evidence-prior profile with a sane window", () => {
    for (const slug of TRIGGER_SLUGS) {
      const p = EVIDENCE_PRIOR_LAG[slug];
      expect(p).toBeDefined();
      expect(p.lagWindowMax).toBeGreaterThanOrEqual(p.lagWindowMin);
      // lagMode (the modal lag, hours) sits within the window.
      expect(p.lagMode).toBeGreaterThanOrEqual(p.lagWindowMin);
      expect(p.lagMode).toBeLessThanOrEqual(p.lagWindowMax);
    }
  });

  it("gluten / lactose / sulphite priors match RESEARCH §2.1 / §2.7 (hours)", () => {
    // Gluten: wide window 0–72 h, modal a few hours.
    expect(EVIDENCE_PRIOR_LAG.gluten).toEqual({ lagWindowMin: 0, lagWindowMax: 72, lagMode: 3 });
    // Lactose: tight, acute ~0.5–6 h.
    expect(EVIDENCE_PRIOR_LAG.lactose).toEqual({ lagWindowMin: 0.5, lagWindowMax: 6, lagMode: 2 });
    // Sulphites: tight, acute ~0.25–6 h.
    expect(EVIDENCE_PRIOR_LAG.sulphites).toEqual({
      lagWindowMin: 0.25,
      lagWindowMax: 6,
      lagMode: 1,
    });
    // FODMAP subgroups: the mid window 0.5–24 h.
    for (const slug of ["fructose", "fructan", "galactan", "polyol"] as const) {
      expect(EVIDENCE_PRIOR_LAG[slug].lagWindowMax).toBe(24);
    }
  });

  it("defaultTriggerClass seeds a slug with its evidence prior", () => {
    expect(defaultTriggerClass("lactose")).toEqual({
      slug: "lactose",
      label: "lactose",
      lagWindowMin: 0.5,
      lagWindowMax: 6,
      lagMode: 2,
    });
  });

  it("buildTriggerScheme writes every trigger class into one store", () => {
    const store = buildTriggerScheme();
    for (const slug of TRIGGER_SLUGS) {
      expect(parseTriggerClass(slug, store)).toBeDefined();
    }
  });

  it("buildTriggerScheme applies per-slug overrides (per-user learning seam)", () => {
    const store = buildTriggerScheme({ gluten: { lagWindowMax: 96 } });
    expect(parseTriggerClass("gluten", store)?.lagWindowMax).toBe(96);
    // Untouched slugs keep their prior.
    expect(parseTriggerClass("lactose", store)?.lagWindowMax).toBe(6);
  });

  it("a fractional (0.5 h) window round-trips exactly", async () => {
    const data = defaultTriggerClass("lactose");
    const ttl = await serializeTriggerClass(data);
    expect(parseTriggerClass("lactose", new Store(new Parser().parse(ttl)))?.lagWindowMin).toBe(
      0.5,
    );
  });

  it("EVIDENCE_PRIOR_LAG matches the landed diet: ontology EXACTLY (no drift with 1B)", () => {
    // Cross-check every prior against the vendored vocab (solid-federation-vocab
    // @ Brief 1B) — the reconciliation the coordinator required before finalising.
    const store = new Store(new Parser().parse(dietVocabTtl()));
    const num = (subject: string, predicate: string): number | undefined => {
      for (const q of store.match(
        { termType: "NamedNode", value: subject } as never,
        { termType: "NamedNode", value: predicate } as never,
      )) {
        return Number((q.object as { value: string }).value);
      }
      return undefined;
    };
    for (const slug of TRIGGER_SLUGS) {
      const iri = triggerIri(slug);
      expect(num(iri, diet("lagWindowMin"))).toBe(EVIDENCE_PRIOR_LAG[slug].lagWindowMin);
      expect(num(iri, diet("lagWindowMax"))).toBe(EVIDENCE_PRIOR_LAG[slug].lagWindowMax);
      expect(num(iri, diet("lagMode"))).toBe(EVIDENCE_PRIOR_LAG[slug].lagMode);
    }
  });
});

describe("lag-profile validation (finite, non-negative, ordered)", () => {
  it("toXsdDecimalLexical never emits exponent notation (valid xsd:decimal lexical)", () => {
    // normal magnitudes pass through unchanged
    expect(toXsdDecimalLexical(3)).toBe("3");
    expect(toXsdDecimalLexical(0.5)).toBe("0.5");
    expect(toXsdDecimalLexical(0.25)).toBe("0.25");
    // extreme magnitudes that String() would render with an exponent are expanded
    for (const n of [1e21, 1e-7, 1.5e-8, 6.02e23]) {
      const lex = toXsdDecimalLexical(n);
      expect(lex).not.toMatch(/[eE]/);
      expect(Number(lex)).toBe(n); // value-preserving
    }
  });

  it("emits the three lag values as xsd:decimal (matching the vocab rdfs:range)", () => {
    const store = buildTriggerClass(defaultTriggerClass("gluten"));
    const subject = DataFactory.namedNode(triggerIri("gluten"));
    for (const p of ["lagWindowMin", "lagWindowMax", "lagMode"]) {
      const quads = store.getQuads(subject, DataFactory.namedNode(diet(p)), null, null);
      expect(quads).toHaveLength(1);
      expect((quads[0]?.object as { datatype: { value: string } }).datatype.value).toBe(
        "http://www.w3.org/2001/XMLSchema#decimal",
      );
    }
  });

  it("buildTriggerClass throws on an unknown slug", () => {
    expect(() =>
      buildTriggerClass({
        slug: "not-a-trigger",
        lagWindowMin: 0,
        lagWindowMax: 1,
        lagMode: 0,
      } as unknown as TriggerClassData),
    ).toThrow(/slug/);
  });

  it("buildTriggerClass throws on a negative or unordered lag profile", () => {
    expect(() =>
      buildTriggerClass({ slug: "gluten", lagWindowMin: -1, lagWindowMax: 72, lagMode: 3 }),
    ).toThrow(/lag profile/);
    // Unordered: mode above max.
    expect(() =>
      buildTriggerClass({ slug: "gluten", lagWindowMin: 0, lagWindowMax: 2, lagMode: 50 }),
    ).toThrow(/lag profile/);
    // Non-finite.
    expect(() =>
      buildTriggerClass({
        slug: "gluten",
        lagWindowMin: 0,
        lagWindowMax: Number.POSITIVE_INFINITY,
        lagMode: 3,
      }),
    ).toThrow(/lag profile/);
  });

  it("buildTriggerScheme throws when an override yields an invalid (unordered) profile", () => {
    // gluten prior is min 0 / max 72; forcing min above max breaks ordering.
    expect(() => buildTriggerScheme({ gluten: { lagWindowMin: 100 } })).toThrow(
      /invalid lag profile/,
    );
  });

  it("parseTriggerClass falls back to the evidence prior for a broken (unordered) document", () => {
    // A hostile document with an unordered lag window (min 100 > max 1) must not be
    // surfaced — parseTriggerClass discards it and returns the trusted prior.
    const ttl = `
      @prefix diet: <https://w3id.org/jeswr/sectors/health/diet#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      ${triggerIri("gluten").replace(/^/, "<").concat(">")} a diet:TriggerClass ;
        diet:lagWindowMin "100"^^xsd:double ;
        diet:lagWindowMax "1"^^xsd:double ;
        diet:lagMode "50"^^xsd:double .`;
    const parsed = parseTriggerClass("gluten", new Store(new Parser().parse(ttl)));
    expect(parsed?.lagWindowMin).toBe(EVIDENCE_PRIOR_LAG.gluten.lagWindowMin);
    expect(parsed?.lagWindowMax).toBe(EVIDENCE_PRIOR_LAG.gluten.lagWindowMax);
    expect(parsed?.lagMode).toBe(EVIDENCE_PRIOR_LAG.gluten.lagMode);
  });
});
