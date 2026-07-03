// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Query-term policy (§3.2 / §8): the default is the GENERIC coeliac term (no
 * health interest leaves the device), and the intolerance→query map is a CURATED
 * constant so a hostile pod value cannot inject a query. Plus the cache-slug
 * path-injection guard.
 */
import { describe, expect, it } from "vitest";
import { assertKnowledgeSlug, knowledgeCacheUrl } from "../pod/layout";
import {
  GENERIC_COELIAC_CONDITION,
  GENERIC_COELIAC_QUERY,
  triggerLocalKeywords,
  triggerQueryFragment,
} from "./terms";

describe("query-term policy", () => {
  it("the default external query is the generic, non-identifying coeliac term", () => {
    expect(GENERIC_COELIAC_QUERY.toLowerCase()).toContain("coeliac");
    expect(GENERIC_COELIAC_CONDITION).toBe("celiac disease");
  });

  it("maps a known tracked trigger to a vetted public condition phrase", () => {
    expect(triggerQueryFragment("lactose")).toBe("lactose intolerance");
    expect(triggerQueryFragment("histamine")).toBe("histamine intolerance");
  });

  it("an unknown / hostile trigger value maps to nothing (injection fail-closed)", () => {
    expect(triggerQueryFragment("'; DROP TABLE --")).toBeUndefined();
    expect(triggerQueryFragment("../../secret")).toBeUndefined();
    expect(triggerQueryFragment("")).toBeUndefined();
  });

  it("local-boost keywords stay on-device (returned, not sent) and are empty for unknown", () => {
    expect(triggerLocalKeywords("sulphites")).toContain("sulphite");
    expect(triggerLocalKeywords("nonsense")).toEqual([]);
  });
});

describe("knowledge cache slug guard", () => {
  it("accepts the fixed slugs and rejects traversal", () => {
    expect(assertKnowledgeSlug("research-latest")).toBe("research-latest");
    expect(() => assertKnowledgeSlug("../off/secret")).toThrow();
    expect(() => assertKnowledgeSlug("a/b")).toThrow();
    expect(() => assertKnowledgeSlug("UPPER")).toThrow();
  });

  it("builds a knowledge cache URL under the diary root", () => {
    expect(knowledgeCacheUrl("https://alice.example/", "guidelines")).toBe(
      "https://alice.example/health/diary/cache/knowledge/guidelines.json",
    );
  });
});
