// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Literature (§3): EPMC parsing, the interpretable ranking, and the SAFETY-CRITICAL
 * retraction hard-exclude + preprint exclusion. Fixtures follow the shapes recorded
 * live 2026-07-03 (§1.1); retracted + expression-of-concern records are included so
 * the exclusion is PROVEN, not assumed (§3.3).
 */
import { describe, expect, it, vi } from "vitest";
import {
  authorityWeight,
  buildEpmcSearchUrl,
  buildPubmedEsearchUrl,
  detectRetraction,
  epmcResultUrl,
  fetchLatestLiterature,
  fetchPubmedFallback,
  isGuideline,
  isPreprint,
  normalizePubTypes,
  parseEpmcResponse,
  parsePubmedEsearch,
  parsePubmedEsummary,
  rankLiterature,
  recencyWeight,
} from "./literature";
import { knowledgeFetch } from "./fetch";

// A recorded-shape EPMC /search?format=json body (§1.1).
const EPMC_BODY = {
  version: "6.9",
  hitCount: 2709,
  nextCursorMark: "AoJ456",
  resultList: {
    result: [
      {
        id: "40000001",
        source: "MED",
        pmid: "40000001",
        doi: "10.1000/guideline",
        title: "ACG Clinical Guideline for Celiac Disease",
        authorString: "Smith J, et al.",
        journalTitle: "Am J Gastroenterol",
        pubYear: "2023",
        pubType: "guideline; Journal Article",
        isOpenAccess: "Y",
        citedByCount: 40,
        firstPublicationDate: "2023-01-05",
      },
      {
        id: "40000002",
        source: "MED",
        pmid: "40000002",
        doi: "10.1000/rct",
        title: "Randomized controlled trial of a gluten challenge",
        journalTitle: "Gut",
        pubYear: "2026",
        pubTypeList: { pubType: ["Randomized Controlled Trial", "Journal Article"] },
        isOpenAccess: "N",
        citedByCount: 2,
        firstPublicationDate: "2026-06-01",
      },
      {
        id: "PPR999",
        source: "PPR",
        title: "A preprint about lactose and coeliac disease",
        pubType: "preprint",
        citedByCount: 0,
        firstPublicationDate: "2026-06-20",
      },
      {
        id: "40000003",
        source: "MED",
        pmid: "40000003",
        title: "Retracted: fabricated celiac cohort study",
        pubType: "retracted publication; Journal Article",
        citedByCount: 99,
        firstPublicationDate: "2025-01-01",
      },
      {
        id: "40000004",
        source: "MED",
        pmid: "40000004",
        title: "Concerning celiac observational study",
        pubType: "Journal Article",
        citedByCount: 5,
        firstPublicationDate: "2024-01-01",
        commentCorrectionList: {
          commentCorrection: [{ id: "x", type: "Expression of concern" }],
        },
      },
    ],
  },
};

describe("EPMC parsing", () => {
  it("parses the recorded shape (hitCount, cursor, results)", () => {
    const parsed = parseEpmcResponse(EPMC_BODY);
    expect(parsed.hitCount).toBe(2709);
    expect(parsed.nextCursorMark).toBe("AoJ456");
    expect(parsed.results).toHaveLength(5);
  });

  it("normalises both pubType-string and pubTypeList shapes", () => {
    expect(normalizePubTypes({ pubType: "guideline; Journal Article" })).toEqual([
      "guideline",
      "journal article",
    ]);
    expect(normalizePubTypes({ pubTypeList: { pubType: ["Review", "Meta-Analysis"] } })).toEqual([
      "review",
      "meta-analysis",
    ]);
  });

  it("resolves the canonical reader link DOI > PMC > PubMed > EPMC", () => {
    expect(epmcResultUrl({ doi: "10.1/x", source: "MED", id: "1" })).toBe("https://doi.org/10.1/x");
    expect(epmcResultUrl({ pmcid: "PMC1", source: "MED", id: "1" })).toContain("/pmc/articles/PMC1/");
    expect(epmcResultUrl({ pmid: "9", source: "MED", id: "1" })).toContain("pubmed.ncbi.nlm.nih.gov/9/");
    expect(epmcResultUrl({ source: "MED", id: "42" })).toContain("europepmc.org/article/MED/42");
  });
});

describe("retraction hard-exclude (safety)", () => {
  it("detects a retraction from the pubType marker", () => {
    expect(detectRetraction({}, ["retracted publication"])).toBe(true);
  });
  it("detects an expression of concern from commentCorrectionList", () => {
    const raw = { commentCorrectionList: { commentCorrection: [{ type: "Expression of concern" }] } };
    expect(detectRetraction(raw, ["journal article"])).toBe(true);
  });
  it("a clean record is not flagged", () => {
    expect(detectRetraction({}, ["review"])).toBe(false);
  });
});

describe("ranking (§3.3)", () => {
  const now = new Date("2026-07-03T00:00:00Z");
  it("HARD-excludes retracted + expression-of-concern items and preprints by default", () => {
    const parsed = parseEpmcResponse(EPMC_BODY);
    const ranked = rankLiterature(parsed.results, { now });
    const ids = ranked.map((r) => r.result.id);
    expect(ids).not.toContain("40000003"); // retracted
    expect(ids).not.toContain("40000004"); // expression of concern
    expect(ids).not.toContain("PPR999"); // preprint excluded by default
    expect(ids).toContain("40000001");
    expect(ids).toContain("40000002");
  });

  it("a retracted item with 99 citations is DROPPED, never merely down-ranked", () => {
    const parsed = parseEpmcResponse(EPMC_BODY);
    const ranked = rankLiterature(parsed.results, { now, includePreprints: true });
    expect(ranked.find((r) => r.result.id === "40000003")).toBeUndefined();
  });

  it("weights guideline/meta/systematic-review above RCT above observational", () => {
    expect(authorityWeight({ pubTypes: ["guideline"] } as never)).toBe(5);
    expect(authorityWeight({ pubTypes: ["randomized controlled trial"] } as never)).toBe(4);
    expect(authorityWeight({ pubTypes: ["journal article"] } as never)).toBe(2);
  });

  it("guidelines are recency-exempt; other work decays with age", () => {
    const guide = { pubTypes: ["guideline"], firstPublicationDate: "2014-01-01" } as never;
    const old = { pubTypes: ["review"], firstPublicationDate: "2014-01-01" } as never;
    const fresh = { pubTypes: ["review"], firstPublicationDate: "2026-06-01" } as never;
    expect(recencyWeight(guide, now)).toBe(1);
    expect(recencyWeight(fresh, now)).toBeGreaterThan(recencyWeight(old, now));
  });

  it("boosts a result locally when its title mentions a tracked trigger — WITHOUT sending the term out", () => {
    const parsed = parseEpmcResponse(EPMC_BODY);
    // include the preprint (mentions lactose) so we can see the boost applied
    const withBoost = rankLiterature(parsed.results, {
      now,
      trackedTriggers: ["lactose"],
      includePreprints: true,
    });
    const preprint = withBoost.find((r) => r.result.id === "PPR999");
    expect(preprint?.matchedTrigger).toBe(true);
    expect(preprint?.personalBoost).toBeGreaterThan(1);
  });

  it("flags guidelines + preprints via helpers", () => {
    expect(isGuideline({ pubTypes: ["guideline"] } as never)).toBe(true);
    expect(isPreprint({ source: "PPR" } as never)).toBe(true);
    expect(isPreprint({ source: "MED" } as never)).toBe(false);
  });
});

describe("URL builders", () => {
  it("EPMC uses the VERIFIED recency sort P_PDATE_D desc + url-encodes the query", () => {
    const url = buildEpmcSearchUrl({ query: '(coeliac OR "celiac disease")', pageSize: 30 });
    expect(url).toContain("format=json");
    // URLSearchParams encodes the space in the sort token as '+'
    expect(url.replace(/\+/g, " ")).toContain("sort=P_PDATE_D desc");
    expect(url).toContain("pageSize=30");
    // the parens/quotes are percent-encoded, never raw in the query string
    const qs = url.split("?")[1];
    expect(qs).toContain("%28"); // (
    expect(qs).toContain("%22"); // "
    expect(qs).not.toContain('"');
    expect(qs).not.toContain("(");
  });

  it("PubMed esearch does NOT set a recency sort token (unverified §9) and stays keyless", () => {
    const url = buildPubmedEsearchUrl({ term: "celiac disease", retmax: 10 });
    expect(url).toContain("db=pubmed");
    expect(url).toContain("retmode=json");
    expect(url).not.toContain("sort=");
    expect(url).not.toContain("api_key");
  });

  it("parses a PubMed esearch response", () => {
    const body = { esearchresult: { count: "5", idlist: ["1", "2", "3"] } };
    const parsed = parsePubmedEsearch(body);
    expect(parsed.count).toBe(5);
    expect(parsed.idlist).toEqual(["1", "2", "3"]);
  });
});

describe("PubMed fallback (§3.1) — renders EpmcResult-shaped cards", () => {
  const ESUMMARY = {
    result: {
      uids: ["111", "222"],
      "111": {
        uid: "111",
        title: "A coeliac review from PubMed",
        pubdate: "2026 Jun",
        fulljournalname: "Gut",
        pubtype: ["Review"],
        articleids: [{ idtype: "doi", value: "10.1/pm" }],
      },
      "222": {
        uid: "222",
        title: "Retracted PubMed paper",
        pubdate: "2025 Jan",
        pubtype: ["Retracted Publication"],
        articleids: [],
      },
    },
  };

  it("maps esummary records to results and keeps the retraction hard-exclude", () => {
    const results = parsePubmedEsummary(ESUMMARY);
    expect(results).toHaveLength(2);
    const clean = results.find((r) => r.id === "111");
    expect(clean?.title).toContain("coeliac review");
    expect(clean?.url).toBe("https://doi.org/10.1/pm");
    expect(clean?.retracted).toBe(false);
    expect(results.find((r) => r.id === "222")?.retracted).toBe(true);
  });

  it("fetchPubmedFallback does esearch → esummary through the allowlist", async () => {
    const spy = vi.fn(async (u: RequestInfo | URL) => {
      const url = String(u);
      if (url.includes("esearch")) {
        return new Response(JSON.stringify({ esearchresult: { count: "2", idlist: ["111", "222"] } }), {
          status: 200,
        });
      }
      return new Response(JSON.stringify(ESUMMARY), { status: 200 });
    });
    const kf = knowledgeFetch(spy as unknown as typeof globalThis.fetch);
    const results = await fetchPubmedFallback(kf, "celiac disease", 25);
    expect(results.map((r) => r.id)).toEqual(["111", "222"]);
  });

  it("returns [] when nothing resolves", async () => {
    const spy = vi.fn(async () =>
      new Response(JSON.stringify({ esearchresult: { count: "0", idlist: [] } }), { status: 200 }),
    );
    const kf = knowledgeFetch(spy as unknown as typeof globalThis.fetch);
    expect(await fetchPubmedFallback(kf, "celiac disease")).toEqual([]);
  });
});

describe("fetchLatestLiterature (through the allowlist)", () => {
  it("fetches EPMC via the allowlist and returns ranked, non-retracted results", async () => {
    let calledUrl = "";
    const spy = vi.fn(async (u: RequestInfo | URL) => {
      calledUrl = String(u);
      return new Response(JSON.stringify(EPMC_BODY), { status: 200 });
    });
    const kf = knowledgeFetch(spy as unknown as typeof globalThis.fetch);
    const { hitCount, ranked } = await fetchLatestLiterature(kf, { now: new Date("2026-07-03") });
    expect(hitCount).toBe(2709);
    expect(ranked.every((r) => !r.result.retracted)).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    // it hit the EPMC host, nothing else
    expect(calledUrl).toContain("www.ebi.ac.uk");
  });
});
