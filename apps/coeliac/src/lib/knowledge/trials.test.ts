// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Trials (§4): CT.gov v2 parsing, the NAME-based (not ISO) country filter, the
 * read-only eligibility summary, and the HARD RAIL — the module never emits an
 * eligibility / enrolment verdict.
 */
import { describe, expect, it, vi } from "vitest";
import * as trials from "./trials";
import {
  buildCtgovSearchUrl,
  countryNameForLocale,
  eligibilitySummary,
  fetchAllRecruitingTrials,
  fetchRecruitingTrials,
  filterTrialsByCountry,
  normalizeTrialStudy,
  parseCtgovResponse,
  trialUrl,
  type TrialStudy,
} from "./trials";
import { knowledgeFetch } from "./fetch";

// A recorded-shape CT.gov v2 /studies body (§1.1): country is a NAME, not an ISO code.
const CTGOV_BODY = {
  studies: [
    {
      protocolSection: {
        identificationModule: { nctId: "NCT07298343", briefTitle: "ZED1227 in Non-responsive Celiac Disease" },
        statusModule: { overallStatus: "RECRUITING" },
        conditionsModule: { conditions: ["Celiac Disease"] },
        designModule: { studyType: "INTERVENTIONAL", phases: ["PHASE2"] },
        eligibilityModule: {
          eligibilityCriteria:
            "Inclusion Criteria:\n- Adults 18-70 with biopsy-confirmed celiac disease.\n".repeat(20),
        },
        contactsLocationsModule: {
          locations: [
            { city: "London", country: "United Kingdom" },
            { city: "Berlin", country: "Germany" },
          ],
        },
      },
    },
    {
      protocolSection: {
        identificationModule: { nctId: "NCT06001177", briefTitle: "KAN-101 ACeD-it" },
        statusModule: { overallStatus: "RECRUITING" },
        conditionsModule: { conditions: ["Celiac Disease"] },
        designModule: { studyType: "INTERVENTIONAL", phases: ["PHASE2"] },
        eligibilityModule: { eligibilityCriteria: "Short criteria." },
        contactsLocationsModule: { locations: [{ city: "Chicago", country: "United States" }] },
      },
    },
    {
      protocolSection: {
        identificationModule: { nctId: "NCT05555555", briefTitle: "Study in Japan only" },
        statusModule: { overallStatus: "RECRUITING" },
        designModule: { studyType: "OBSERVATIONAL", phases: [] },
        contactsLocationsModule: { locations: [{ city: "Tokyo", country: "Japan" }] },
      },
    },
  ],
  nextPageToken: "TOK123",
};

describe("CT.gov parsing", () => {
  it("parses the recorded shape with token pagination", () => {
    const parsed = parseCtgovResponse(CTGOV_BODY);
    expect(parsed.studies).toHaveLength(3);
    expect(parsed.nextPageToken).toBe("TOK123");
    const zed = parsed.studies[0];
    expect(zed.nctId).toBe("NCT07298343");
    expect(zed.phases).toEqual(["PHASE2"]);
    expect(zed.url).toBe("https://clinicaltrials.gov/study/NCT07298343");
    expect(zed.locations[0]).toEqual({ city: "London", country: "United Kingdom" });
  });

  it("drops a study with no NCT id / title (unusable)", () => {
    expect(normalizeTrialStudy({ protocolSection: { identificationModule: {} } })).toBeUndefined();
    expect(normalizeTrialStudy(null)).toBeUndefined();
  });

  it("validates NCT ids in trialUrl (path-injection guard)", () => {
    expect(trialUrl("NCT07298343")).toContain("/study/NCT07298343");
    expect(() => trialUrl("../../evil")).toThrow();
  });
});

describe("country filter (NAME not ISO — §4.1)", () => {
  const studies = parseCtgovResponse(CTGOV_BODY).studies;
  it("maps a locale to the CT.gov country NAME", () => {
    expect(countryNameForLocale("en-GB")).toBe("United Kingdom");
    expect(countryNameForLocale("en-US")).toBe("United States");
    expect(countryNameForLocale("en-IE")).toBe("Ireland");
    expect(countryNameForLocale("xx-ZZ")).toBeUndefined();
  });

  it("filters UK / US / non-US by country NAME", () => {
    expect(filterTrialsByCountry(studies, "United Kingdom").map((s) => s.nctId)).toEqual(["NCT07298343"]);
    expect(filterTrialsByCountry(studies, "United States").map((s) => s.nctId)).toEqual(["NCT06001177"]);
    expect(filterTrialsByCountry(studies, "Japan").map((s) => s.nctId)).toEqual(["NCT05555555"]);
  });

  it("does NOT match on a raw ISO code (that would hide every trial)", () => {
    expect(filterTrialsByCountry(studies, "GB")).toHaveLength(0);
    expect(filterTrialsByCountry(studies, "US")).toHaveLength(0);
  });

  it("null ⇒ all countries", () => {
    expect(filterTrialsByCountry(studies, null)).toHaveLength(3);
  });
});

describe("eligibility summary is READ-ONLY (§4.3)", () => {
  it("truncates the verbatim text and returns a string — never a boolean/verdict", () => {
    const long = parseCtgovResponse(CTGOV_BODY).studies[0].eligibilityCriteria;
    const summary = eligibilitySummary(long, 100);
    expect(typeof summary).toBe("string");
    expect((summary as string).length).toBeLessThanOrEqual(101);
    expect(summary).toMatch(/…$/);
    expect(eligibilitySummary("Short.")).toBe("Short.");
    expect(eligibilitySummary(undefined)).toBeUndefined();
  });
});

describe("THE HARD RAIL — no eligibility/enrolment verdict exists (§4.3)", () => {
  it("exports no function that judges eligibility / matching / enrolment", () => {
    const forbidden = /(is|check|compute|match|assess)?eligib|qualif|enrol|shouldenrol|recommend/i;
    const offenders = Object.keys(trials).filter((k) => forbidden.test(k) && k !== "eligibilitySummary");
    expect(offenders).toEqual([]);
  });

  it("no trials function returns a boolean 'you match' verdict for a study", () => {
    const study = parseCtgovResponse(CTGOV_BODY).studies[0];
    // Only eligibilitySummary consumes the criteria, and it yields text, not a decision.
    expect(typeof eligibilitySummary(study.eligibilityCriteria)).not.toBe("boolean");
  });
});

describe("URL builder + fetch", () => {
  it("builds a GENERIC-condition simple GET (no auth, default fields)", () => {
    const url = buildCtgovSearchUrl({ pageSize: 40 });
    expect(url).toContain("/api/v2/studies");
    expect(url.replace(/\+/g, " ")).toContain("query.cond=celiac disease");
    expect(url).toContain("filter.overallStatus=RECRUITING");
    expect(url).not.toContain("Authorization");
  });

  it("an opt-in term narrows by a named intervention", () => {
    const url = buildCtgovSearchUrl({ term: "ZED1227" });
    expect(url).toContain("query.term=ZED1227");
  });

  it("follows nextPageToken across pages (so the country filter sees the full set)", async () => {
    const page1 = {
      studies: [
        {
          protocolSection: {
            identificationModule: { nctId: "NCT00000001", briefTitle: "Page1 study" },
            contactsLocationsModule: { locations: [{ country: "United Kingdom" }] },
          },
        },
      ],
      nextPageToken: "P2",
    };
    const page2 = {
      studies: [
        {
          protocolSection: {
            identificationModule: { nctId: "NCT00000002", briefTitle: "Page2 study" },
            contactsLocationsModule: { locations: [{ country: "Ireland" }] },
          },
        },
      ],
    };
    const calls: string[] = [];
    const spy = vi.fn(async (u: RequestInfo | URL) => {
      const url = String(u);
      calls.push(url);
      return new Response(JSON.stringify(url.includes("pageToken=P2") ? page2 : page1), { status: 200 });
    });
    const kf = knowledgeFetch(spy as unknown as typeof globalThis.fetch);
    const studies = await fetchAllRecruitingTrials(kf, { pageSize: 40, maxPages: 5 });
    expect(studies.map((s) => s.nctId)).toEqual(["NCT00000001", "NCT00000002"]);
    expect(calls.some((u) => u.includes("pageToken=P2"))).toBe(true);
  });

  it("stops at maxPages even if the registry keeps returning a token", async () => {
    const spy = vi.fn(async (u: RequestInfo | URL) => {
      const n = String(u).includes("pageToken") ? "b" : "a";
      return new Response(
        JSON.stringify({
          studies: [
            {
              protocolSection: {
                identificationModule: { nctId: `NCT0000000${n === "a" ? 1 : 2}`, briefTitle: "s" },
              },
            },
          ],
          nextPageToken: "loop",
        }),
        { status: 200 },
      );
    });
    const kf = knowledgeFetch(spy as unknown as typeof globalThis.fetch);
    await fetchAllRecruitingTrials(kf, { maxPages: 2 });
    expect(spy).toHaveBeenCalledTimes(2); // capped, never an infinite loop
  });

  it("fetches recruiting trials through the allowlist (CT.gov host only)", async () => {
    let calledUrl = "";
    const spy = vi.fn(async (u: RequestInfo | URL) => {
      calledUrl = String(u);
      return new Response(JSON.stringify(CTGOV_BODY), { status: 200 });
    });
    const kf = knowledgeFetch(spy as unknown as typeof globalThis.fetch);
    const result = await fetchRecruitingTrials(kf, { pageSize: 40 });
    expect(result.studies).toHaveLength(3);
    expect(calledUrl).toContain("clinicaltrials.gov");
  });
});

// Type-only sanity: TrialStudy carries no "eligible"/"match" field.
const _sample: TrialStudy = parseCtgovResponse(CTGOV_BODY).studies[0];
void _sample;
