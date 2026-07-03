// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Phase 3a — Literature hooks (§3). Europe PMC REST is the PRIMARY feed
 * (CORS-open, keyless, a proven recency sort `P_PDATE_D desc`, a `citedByCount`
 * signal, and a `pubType`/`source` field to filter credibility). PubMed
 * E-utilities is a FALLBACK / PMID resolver only — its recency-sort token was
 * rejected live (§9), so recency is never depended on there.
 *
 * The design is honesty-first + misinformation-proof by construction:
 *   - only allowlisted hosts are reachable (`fetch.ts`);
 *   - the default external query is GENERIC (no health interest leaves the device);
 *   - preprints are excluded by default and retracted items are HARD-EXCLUDED;
 *   - ranking is a pure, interpretable scoring function (no black box) whose
 *     inputs (type, date, citations) are shown to the user;
 *   - the app never paraphrases a medical claim — it shows title + metadata + the
 *     canonical DOI/PMID link and the user reads the source.
 */
import { knowledgeJson } from "./fetch";
import { GENERIC_COELIAC_QUERY, triggerLocalKeywords } from "./terms";

const EPMC_SEARCH = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const PUBMED_ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_ESUMMARY = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

/** A normalised Europe PMC search result (only the fields we render / rank on). */
export interface EpmcResult {
  readonly id: string;
  readonly source: string;
  readonly pmid?: string;
  readonly pmcid?: string;
  readonly doi?: string;
  readonly title: string;
  readonly authorString?: string;
  readonly journalTitle?: string;
  readonly pubYear?: string;
  /** Lowercased publication-type tokens (e.g. `["review","journal article"]`). */
  readonly pubTypes: readonly string[];
  readonly isOpenAccess: boolean;
  readonly citedByCount: number;
  readonly firstPublicationDate?: string;
  /** True when a retraction / expression-of-concern signal was detected. */
  readonly retracted: boolean;
  /** The canonical link a reader can reach the primary source at. */
  readonly url: string;
}

/** A ranked literature item — the score + its breakdown are SHOWN (the app's "show your working" rule). */
export interface RankedLiterature {
  readonly result: EpmcResult;
  readonly score: number;
  readonly authorityWeight: number;
  readonly recencyWeight: number;
  readonly impactWeight: number;
  readonly personalBoost: number;
  /** Whether a tracked-trigger keyword matched the title (local personalisation). */
  readonly matchedTrigger: boolean;
}

export interface EpmcSearchResult {
  readonly hitCount: number;
  readonly nextCursorMark?: string;
  readonly results: readonly EpmcResult[];
}

const RETRACTION_MARKERS = ["retract", "expression of concern"];

/** Coerce an unknown JSON value to a non-empty trimmed string, else undefined. */
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

/**
 * Normalise the many shapes EPMC uses for publication type into a lowercased
 * token array: `pubType` may be a single `"a; b"` string OR a `pubTypeList`
 * object with a `pubType` string|array. Defensive on every branch.
 */
export function normalizePubTypes(raw: Record<string, unknown>): string[] {
  const out = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === "string") {
      for (const part of v.split(/[;,]/)) {
        const t = part.trim().toLowerCase();
        if (t) out.add(t);
      }
    }
  };
  add(raw.pubType);
  const list = raw.pubTypeList as Record<string, unknown> | undefined;
  if (list && typeof list === "object") {
    const inner = (list as { pubType?: unknown }).pubType;
    if (Array.isArray(inner)) for (const v of inner) add(v);
    else add(inner);
  }
  return [...out];
}

/**
 * Detect a retraction / expression-of-concern signal on a raw EPMC record.
 * Two signals, either is a HARD exclude (§3.3):
 *   (a) a `pubType` token containing "retract" / "expression of concern";
 *   (b) a `commentCorrectionList.commentCorrection[].type` of `Retraction` /
 *       `Expression of concern` (present inline on many EPMC records).
 */
export function detectRetraction(raw: Record<string, unknown>, pubTypes: readonly string[]): boolean {
  if (pubTypes.some((t) => RETRACTION_MARKERS.some((m) => t.includes(m)))) return true;
  const cc = raw.commentCorrectionList as Record<string, unknown> | undefined;
  const inner = cc && typeof cc === "object" ? (cc as { commentCorrection?: unknown }).commentCorrection : undefined;
  const arr = Array.isArray(inner) ? inner : inner ? [inner] : [];
  for (const c of arr) {
    const type = str((c as Record<string, unknown>)?.type)?.toLowerCase();
    if (type && RETRACTION_MARKERS.some((m) => type.includes(m))) return true;
  }
  return false;
}

/** The canonical reader link for a result: DOI > PMC > PubMed > EPMC abstract page. */
export function epmcResultUrl(r: {
  doi?: string;
  pmcid?: string;
  pmid?: string;
  source: string;
  id: string;
}): string {
  if (r.doi) return `https://doi.org/${r.doi}`;
  if (r.pmcid) return `https://www.ncbi.nlm.nih.gov/pmc/articles/${r.pmcid}/`;
  if (r.pmid) return `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/`;
  return `https://europepmc.org/article/${encodeURIComponent(r.source)}/${encodeURIComponent(r.id)}`;
}

/** Normalise one raw EPMC result object into an {@link EpmcResult}. */
export function normalizeEpmcResult(raw: unknown): EpmcResult | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const title = str(o.title);
  const id = str(o.id);
  const source = str(o.source);
  if (!title || !id || !source) return undefined; // a result with no title/id is unusable
  const pubTypes = normalizePubTypes(o);
  const citedByCount = typeof o.citedByCount === "number" && o.citedByCount >= 0 ? o.citedByCount : 0;
  const doi = str(o.doi);
  const pmcid = str(o.pmcid);
  const pmid = str(o.pmid);
  return {
    id,
    source,
    pmid,
    pmcid,
    doi,
    title,
    authorString: str(o.authorString),
    journalTitle: str(o.journalTitle),
    pubYear: str(o.pubYear),
    pubTypes,
    isOpenAccess: o.isOpenAccess === "Y" || o.isOpenAccess === true,
    citedByCount,
    firstPublicationDate: str(o.firstPublicationDate),
    retracted: detectRetraction(o, pubTypes),
    url: epmcResultUrl({ doi, pmcid, pmid, source, id }),
  };
}

/** Parse a full EPMC `/search?format=json` response body defensively. */
export function parseEpmcResponse(body: unknown): EpmcSearchResult {
  const o = (body ?? {}) as Record<string, unknown>;
  const hitCount = typeof o.hitCount === "number" ? o.hitCount : 0;
  const nextCursorMark = str(o.nextCursorMark);
  const rl = o.resultList as Record<string, unknown> | undefined;
  const rawResults = rl && Array.isArray(rl.result) ? (rl.result as unknown[]) : [];
  const results = rawResults
    .map(normalizeEpmcResult)
    .filter((r): r is EpmcResult => r !== undefined);
  return { hitCount, nextCursorMark, results };
}

/** Build a Europe PMC search URL. `query` is URL-encoded; recency sort is the verified `P_PDATE_D desc`. */
export function buildEpmcSearchUrl(opts: {
  query?: string;
  pageSize?: number;
  cursorMark?: string;
  sortByRecency?: boolean;
} = {}): string {
  const query = opts.query ?? GENERIC_COELIAC_QUERY;
  const pageSize = Math.min(Math.max(opts.pageSize ?? 25, 1), 100);
  const params = new URLSearchParams({ query, format: "json", pageSize: String(pageSize) });
  if (opts.sortByRecency !== false) params.set("sort", "P_PDATE_D desc");
  if (opts.cursorMark) params.set("cursorMark", opts.cursorMark);
  return `${EPMC_SEARCH}?${params.toString()}`;
}

// ---- Ranking (§3.3) — pure, interpretable ----------------------------------

const AUTHORITY_WEIGHTS: ReadonlyArray<{ match: string; weight: number }> = [
  { match: "guideline", weight: 5 },
  { match: "meta-analysis", weight: 5 },
  { match: "systematic review", weight: 5 },
  { match: "practice guideline", weight: 5 },
  { match: "randomized controlled trial", weight: 4 },
  { match: "randomised controlled trial", weight: 4 },
  { match: "clinical trial", weight: 4 },
  { match: "review", weight: 3 },
];

/** Whether a result's types mark it as a guideline (recency-exempt in ranking). */
export function isGuideline(r: EpmcResult): boolean {
  return r.pubTypes.some((t) => t.includes("guideline"));
}

/** Whether a result is a preprint (EPMC `source === "PPR"`) — excluded by default. */
export function isPreprint(r: EpmcResult): boolean {
  return r.source.toUpperCase() === "PPR";
}

/** `W_authority`: highest matching publication-type weight (default 2 = observational/other). */
export function authorityWeight(r: EpmcResult): number {
  let best = 2;
  for (const t of r.pubTypes) {
    for (const { match, weight } of AUTHORITY_WEIGHTS) {
      if (t.includes(match) && weight > best) best = weight;
    }
  }
  return best;
}

/** `W_recency`: monotone decay on age; guidelines exempt (kept at 1). */
export function recencyWeight(r: EpmcResult, now: Date): number {
  if (isGuideline(r)) return 1;
  const dateStr = r.firstPublicationDate ?? (r.pubYear ? `${r.pubYear}-01-01` : undefined);
  if (!dateStr) return 0.5;
  const t = Date.parse(dateStr);
  if (Number.isNaN(t)) return 0.5;
  const ageYears = Math.max(0, (now.getTime() - t) / (365.25 * 24 * 3600 * 1000));
  // 1.0 within the last year, decaying to ~0.3 by ~8 years old, floor 0.25.
  return Math.max(0.25, 1 / (1 + 0.35 * ageYears));
}

/** `W_impact`: mild citation + open-access tie-breaker (never buries a new important paper). */
export function impactWeight(r: EpmcResult): number {
  const citeBoost = Math.log10(1 + Math.max(0, r.citedByCount)) * 0.15;
  const oaBoost = r.isOpenAccess ? 0.05 : 0;
  return 1 + citeBoost + oaBoost;
}

/**
 * Rank EPMC results: hard-exclude retracted + (by default) preprints, then score
 * `authority × recency × impact × personalBoost`, descending. Personalisation is
 * LOCAL — a tracked-trigger keyword in the title gives a small boost; the trigger
 * terms never leave the device.
 */
export function rankLiterature(
  results: readonly EpmcResult[],
  opts: { now?: Date; trackedTriggers?: readonly string[]; includePreprints?: boolean } = {},
): RankedLiterature[] {
  const now = opts.now ?? new Date();
  const keywords = (opts.trackedTriggers ?? []).flatMap((slug) => triggerLocalKeywords(slug));
  const ranked: RankedLiterature[] = [];
  for (const result of results) {
    if (result.retracted) continue; // HARD exclude — never down-ranked
    if (isPreprint(result) && !opts.includePreprints) continue;
    const aw = authorityWeight(result);
    const rw = recencyWeight(result, now);
    const iw = impactWeight(result);
    const matchedTrigger =
      keywords.length > 0 && keywords.some((k) => result.title.toLowerCase().includes(k));
    const personalBoost = matchedTrigger ? 1.25 : 1;
    const score = aw * rw * iw * personalBoost;
    ranked.push({
      result,
      score,
      authorityWeight: aw,
      recencyWeight: rw,
      impactWeight: iw,
      personalBoost,
      matchedTrigger,
    });
  }
  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

/**
 * Fetch + rank the latest credible coeliac literature from EPMC (primary feed).
 * Uses the GENERIC query by default — no health interest leaves the device.
 */
export async function fetchLatestLiterature(
  knowledgeFetchFn: typeof globalThis.fetch,
  opts: {
    query?: string;
    pageSize?: number;
    now?: Date;
    trackedTriggers?: readonly string[];
    includePreprints?: boolean;
  } = {},
): Promise<{ hitCount: number; ranked: RankedLiterature[] }> {
  const url = buildEpmcSearchUrl({ query: opts.query, pageSize: opts.pageSize });
  const body = await knowledgeJson(knowledgeFetchFn, url);
  const parsed = parseEpmcResponse(body);
  const ranked = rankLiterature(parsed.results, {
    now: opts.now,
    trackedTriggers: opts.trackedTriggers,
    includePreprints: opts.includePreprints,
  });
  return { hitCount: parsed.hitCount, ranked };
}

// ---- PubMed fallback / resolver (§1.1 / §9) --------------------------------

export interface PubmedEsearchResult {
  readonly count: number;
  readonly idlist: readonly string[];
}

/**
 * Build a PubMed E-utilities `esearch` URL. NOTE (verified §9): the recency-sort
 * token is NOT confirmed (`sort=most+recent` was rejected live), so we DO NOT set
 * a sort param here — PubMed is a fallback/PMID resolver, and EPMC (verified
 * `P_PDATE_D desc`) is the primary recency feed. Callers must not depend on
 * PubMed ordering being by recency.
 */
export function buildPubmedEsearchUrl(opts: { term: string; retmax?: number }): string {
  const retmax = Math.min(Math.max(opts.retmax ?? 25, 1), 100);
  const params = new URLSearchParams({
    db: "pubmed",
    term: opts.term,
    retmode: "json",
    retmax: String(retmax),
  });
  return `${PUBMED_ESEARCH}?${params.toString()}`;
}

/** Parse a PubMed `esearch` JSON response defensively (count + PMID list). */
export function parsePubmedEsearch(body: unknown): PubmedEsearchResult {
  const o = (body ?? {}) as Record<string, unknown>;
  const esr = (o.esearchresult ?? {}) as Record<string, unknown>;
  const countRaw = esr.count;
  const count = typeof countRaw === "string" ? Number.parseInt(countRaw, 10) || 0 : typeof countRaw === "number" ? countRaw : 0;
  const idlist = Array.isArray(esr.idlist)
    ? (esr.idlist as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  return { count, idlist };
}

/** PubMed fallback: resolve PMIDs for a term (used when EPMC is unavailable). */
export async function fetchPubmedIds(
  knowledgeFetchFn: typeof globalThis.fetch,
  term: string,
  retmax = 25,
): Promise<PubmedEsearchResult> {
  const body = await knowledgeJson(knowledgeFetchFn, buildPubmedEsearchUrl({ term, retmax }));
  return parsePubmedEsearch(body);
}

/** Build a PubMed `esummary` URL for a set of PMIDs (metadata for the fallback cards). */
export function buildPubmedEsummaryUrl(ids: readonly string[]): string {
  const params = new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "json" });
  return `${PUBMED_ESUMMARY}?${params.toString()}`;
}

/**
 * Parse a PubMed `esummary` JSON response into {@link EpmcResult}s so the Research
 * view can render them identically to EPMC (title + type + date + canonical link).
 * Defensive on every field; a retracted `pubtype` is still hard-detected so the
 * fallback path keeps the same safety exclusion as the primary feed.
 */
export function parsePubmedEsummary(body: unknown): EpmcResult[] {
  const o = (body ?? {}) as Record<string, unknown>;
  const result = (o.result ?? {}) as Record<string, unknown>;
  const uids = Array.isArray(result.uids) ? (result.uids as unknown[]).filter((x): x is string => typeof x === "string") : [];
  const out: EpmcResult[] = [];
  for (const uid of uids) {
    const rec = result[uid] as Record<string, unknown> | undefined;
    const title = str(rec?.title);
    if (!rec || !title) continue;
    const pubTypes = Array.isArray(rec.pubtype)
      ? (rec.pubtype as unknown[]).filter((x): x is string => typeof x === "string").map((t) => t.toLowerCase())
      : [];
    const articleIds = Array.isArray(rec.articleids) ? (rec.articleids as unknown[]) : [];
    let doi: string | undefined;
    for (const a of articleIds) {
      const ao = a as Record<string, unknown>;
      if (ao?.idtype === "doi") doi = str(ao.value);
    }
    const pubdate = str(rec.pubdate);
    const pubYear = pubdate ? pubdate.slice(0, 4) : undefined;
    out.push({
      id: uid,
      source: "MED",
      pmid: uid,
      doi,
      title,
      authorString: undefined,
      journalTitle: str(rec.fulljournalname) ?? str(rec.source),
      pubYear,
      pubTypes,
      isOpenAccess: false,
      citedByCount: 0,
      firstPublicationDate: pubdate,
      retracted: detectRetraction(rec, pubTypes),
      url: epmcResultUrl({ doi, pmid: uid, source: "MED", id: uid }),
    });
  }
  return out;
}

/**
 * PubMed FALLBACK feed (§3.1): when Europe PMC is unavailable, resolve PMIDs for a
 * term then fetch their summaries, returning renderable {@link EpmcResult}s. NOTE
 * (§9): PubMed recency ordering is NOT depended on — this is a resilience fallback,
 * not the primary recency feed. Returns [] if nothing resolves.
 */
export async function fetchPubmedFallback(
  knowledgeFetchFn: typeof globalThis.fetch,
  term: string,
  retmax = 25,
): Promise<EpmcResult[]> {
  const { idlist } = await fetchPubmedIds(knowledgeFetchFn, term, retmax);
  if (idlist.length === 0) return [];
  const body = await knowledgeJson(knowledgeFetchFn, buildPubmedEsummaryUrl(idlist));
  return parsePubmedEsummary(body);
}
