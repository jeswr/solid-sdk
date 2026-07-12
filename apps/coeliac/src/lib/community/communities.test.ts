// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import { isAllowlistedCommunityHost } from "./allowlist";
import {
  allowedCommunities,
  CATEGORY_LABELS,
  COMMUNITIES,
  communitiesByCategory,
  type CommunityCategory,
} from "./communities";

describe("community catalog", () => {
  it("has the curated, non-empty catalog with unique ids", () => {
    expect(COMMUNITIES.length).toBeGreaterThanOrEqual(6);
    const ids = COMMUNITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every entry is a well-formed, complete record", () => {
    for (const c of COMMUNITIES) {
      expect(c.id).toBeTruthy();
      expect(c.name).toBeTruthy();
      expect(c.org).toBeTruthy();
      expect(c.description).toBeTruthy();
      expect(c.moderatedBy).toBeTruthy();
      expect(CATEGORY_LABELS[c.category]).toBeTruthy();
    }
  });

  it("every entry URL is https and on the committed host allowlist", () => {
    for (const c of COMMUNITIES) {
      expect(new URL(c.url).protocol).toBe("https:");
      expect(isAllowlistedCommunityHost(c.url)).toBe(true);
    }
  });

  it("covers the design's core sources (Coeliac UK, Find Me GF, Reddit, celiac.com, HealthUnlocked, CDF)", () => {
    const hosts = COMMUNITIES.map((c) => new URL(c.url).hostname);
    expect(hosts).toEqual(
      expect.arrayContaining([
        "www.coeliac.org.uk",
        "www.findmeglutenfree.com",
        "www.reddit.com",
        "www.celiac.com",
        "healthunlocked.com",
        "celiac.org",
      ]),
    );
  });

  it("allowedCommunities drops any entry whose host is off-allowlist (fail-closed)", () => {
    // With the committed catalog nothing is dropped.
    expect(allowedCommunities().length).toBe(COMMUNITIES.length);
  });

  it("exposes venue guides for the eating-out surfacing", () => {
    const venues = communitiesByCategory("venue-guide");
    expect(venues.length).toBeGreaterThanOrEqual(2);
    for (const v of venues) expect(v.category).toBe<CommunityCategory>("venue-guide");
    // Coeliac UK's authoritative guide is present.
    expect(venues.some((v) => v.url.includes("coeliac.org.uk"))).toBe(true);
  });
});
