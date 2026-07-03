// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Phase 3b — Clinical-trials hooks (§4). ClinicalTrials.gov API v2 surfaces
 * RECRUITING coeliac trials with location + an eligibility SUMMARY, as information
 * to DISCUSS WITH A CLINICIAN.
 *
 * HARD RAIL (§4.3): this module NEVER computes eligibility, NEVER emits a "you
 * match / you qualify / you should enrol" verdict, and NEVER reads any pod
 * health/genetic field into trial logic. Eligibility criteria are surfaced
 * VERBATIM (truncated) as read-only information; the decision is the clinician's.
 * There is no function here that returns an eligibility boolean — by construction.
 *
 * CT.gov v2 transport constraint (§1.1, verified): a CORS *preflight* 403s, so the
 * request MUST be a "simple" GET — no custom headers, no `Authorization`, default
 * `Accept`. The knowledge fetch's `simple` mode enforces this.
 */
import { knowledgeJson } from "./fetch";
import { GENERIC_COELIAC_CONDITION } from "./terms";

const CTGOV_STUDIES = "https://clinicaltrials.gov/api/v2/studies";

/** The fields we request + render (nothing is parsed into a decision). */
const CTGOV_FIELDS = [
  "NCTId",
  "BriefTitle",
  "OverallStatus",
  "Condition",
  "Phase",
  "StudyType",
  "LocationCountry",
  "LocationCity",
  "EligibilityCriteria",
].join("|");

/** A recruiting-location city + human-readable country NAME (not an ISO code). */
export interface TrialLocation {
  readonly city?: string;
  readonly country?: string;
}

/** A normalised CT.gov study (only the rendered fields). */
export interface TrialStudy {
  readonly nctId: string;
  readonly briefTitle: string;
  readonly overallStatus?: string;
  readonly conditions: readonly string[];
  readonly studyType?: string;
  readonly phases: readonly string[];
  /** RAW eligibility text — shown truncated + read-only, NEVER parsed into a match. */
  readonly eligibilityCriteria?: string;
  readonly locations: readonly TrialLocation[];
  /** The canonical study page a reader is sent to ("Read on ClinicalTrials.gov"). */
  readonly url: string;
}

export interface TrialsResult {
  readonly studies: readonly TrialStudy[];
  readonly nextPageToken?: string;
}

/**
 * Locale → the CT.gov human-readable country NAME (§4.1, verified caveat). The
 * `locations[].country` field is a NAME (e.g. `"United Kingdom"`), NOT an ISO
 * code — filtering on a raw `GB`/`US` code would hide every trial. This map is the
 * deterministic bridge; unknown locales fall back to "all countries".
 */
export const LOCALE_COUNTRY_NAME: Readonly<Record<string, string>> = Object.freeze({
  GB: "United Kingdom",
  UK: "United Kingdom",
  US: "United States",
  IE: "Ireland",
  AU: "Australia",
  NZ: "New Zealand",
  CA: "Canada",
  DE: "Germany",
  FR: "France",
  IT: "Italy",
  ES: "Spain",
  NL: "Netherlands",
  SE: "Sweden",
  NO: "Norway",
  FI: "Finland",
  DK: "Denmark",
});

/** The CT.gov country NAME for a BCP-47 locale (e.g. `en-GB` → "United Kingdom"), or undefined. */
export function countryNameForLocale(locale: string | undefined): string | undefined {
  if (!locale) return undefined;
  const region = locale.split("-").pop()?.toUpperCase();
  return region ? LOCALE_COUNTRY_NAME[region] : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}
function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
}

/**
 * Build a CT.gov v2 studies URL. `query.cond` defaults to the GENERIC coeliac
 * condition (privacy §2.4); `term` (optional, opt-in) narrows by a named
 * intervention (e.g. a therapy candidate). Simple GET — the caller uses the
 * knowledge fetch's `simple` mode so no preflight is triggered.
 */
export function buildCtgovSearchUrl(opts: {
  cond?: string;
  term?: string;
  status?: string;
  pageSize?: number;
  pageToken?: string;
} = {}): string {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 30, 1), 100);
  const params = new URLSearchParams();
  params.set("query.cond", opts.cond ?? GENERIC_COELIAC_CONDITION);
  if (opts.term) params.set("query.term", opts.term);
  params.set("filter.overallStatus", opts.status ?? "RECRUITING");
  params.set("pageSize", String(pageSize));
  params.set("fields", CTGOV_FIELDS);
  if (opts.pageToken) params.set("pageToken", opts.pageToken);
  return `${CTGOV_STUDIES}?${params.toString()}`;
}

/** Normalise one raw CT.gov study object into a {@link TrialStudy}. */
export function normalizeTrialStudy(raw: unknown): TrialStudy | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const ps = (raw as Record<string, unknown>).protocolSection as Record<string, unknown> | undefined;
  if (!ps || typeof ps !== "object") return undefined;
  const idMod = (ps.identificationModule ?? {}) as Record<string, unknown>;
  const statusMod = (ps.statusModule ?? {}) as Record<string, unknown>;
  const condMod = (ps.conditionsModule ?? {}) as Record<string, unknown>;
  const designMod = (ps.designModule ?? {}) as Record<string, unknown>;
  const eligMod = (ps.eligibilityModule ?? {}) as Record<string, unknown>;
  const locMod = (ps.contactsLocationsModule ?? {}) as Record<string, unknown>;
  const nctId = str(idMod.nctId);
  const briefTitle = str(idMod.briefTitle);
  if (!nctId || !briefTitle) return undefined;
  const rawLocs = Array.isArray(locMod.locations) ? (locMod.locations as unknown[]) : [];
  const locations: TrialLocation[] = rawLocs
    .map((l) => {
      const lo = (l ?? {}) as Record<string, unknown>;
      return { city: str(lo.city), country: str(lo.country) };
    })
    .filter((l) => l.city || l.country);
  return {
    nctId,
    briefTitle,
    overallStatus: str(statusMod.overallStatus),
    conditions: strArray(condMod.conditions),
    studyType: str(designMod.studyType),
    phases: strArray(designMod.phases),
    eligibilityCriteria: str(eligMod.eligibilityCriteria),
    locations,
    url: trialUrl(nctId),
  };
}

const NCT_RE = /^NCT\d{8}$/;

/** The canonical CT.gov study page for a validated NCT id. */
export function trialUrl(nctId: string): string {
  if (!NCT_RE.test(nctId)) throw new Error(`invalid NCT id: ${nctId}`);
  return `https://clinicaltrials.gov/study/${nctId}`;
}

/** Parse a full CT.gov v2 `/studies` response body defensively. */
export function parseCtgovResponse(body: unknown): TrialsResult {
  const o = (body ?? {}) as Record<string, unknown>;
  const rawStudies = Array.isArray(o.studies) ? (o.studies as unknown[]) : [];
  const studies = rawStudies
    .map(normalizeTrialStudy)
    .filter((s): s is TrialStudy => s !== undefined);
  return { studies, nextPageToken: str(o.nextPageToken) };
}

/**
 * A truncated, READ-ONLY eligibility summary — for INFORMATION ONLY. This never
 * parses criteria into a match; it only shortens the verbatim text with a
 * "full criteria on the study page" hint. (§4.1 / §4.3)
 */
export function eligibilitySummary(criteria: string | undefined, maxLen = 320): string | undefined {
  if (!criteria) return undefined;
  const collapsed = criteria.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLen) return collapsed;
  return `${collapsed.slice(0, maxLen).trimEnd()}…`;
}

/**
 * Client-side country filter (§4.1). `countryName` is a CT.gov country NAME (from
 * {@link countryNameForLocale} / {@link LOCALE_COUNTRY_NAME}) — NEVER a raw ISO
 * code. `null`/`undefined` ⇒ all countries (no filter). This is purely a
 * where-is-it filter; it does NOT judge whether the user is eligible.
 */
export function filterTrialsByCountry(
  studies: readonly TrialStudy[],
  countryName: string | null | undefined,
): TrialStudy[] {
  if (!countryName) return [...studies];
  const want = countryName.toLowerCase();
  return studies.filter((s) => s.locations.some((l) => l.country?.toLowerCase() === want));
}

/**
 * Fetch ONE page of RECRUITING coeliac trials (§4.1). Uses the GENERIC condition
 * by default — no PII / health interest leaves the device. Returns raw studies +
 * the `nextPageToken`; the caller applies the client-side country filter.
 */
export async function fetchRecruitingTrials(
  knowledgeFetchFn: typeof globalThis.fetch,
  opts: { cond?: string; term?: string; pageSize?: number; pageToken?: string } = {},
): Promise<TrialsResult> {
  const url = buildCtgovSearchUrl(opts);
  // `simple: true` — CT.gov v2 preflight 403s any non-simple request (§1.1).
  const body = await knowledgeJson(knowledgeFetchFn, url, { simple: true });
  return parseCtgovResponse(body);
}

/**
 * Fetch RECRUITING coeliac trials across pages, following `nextPageToken` up to
 * `maxPages` (default 5 → up to ~200 studies), so the client-side country filter
 * has the FULL result set rather than only the first page (roborev: a partial page
 * could make a country wrongly appear to have no trials). Deduped by NCT id; stops
 * on the first failing page but keeps whatever it has already gathered.
 */
export async function fetchAllRecruitingTrials(
  knowledgeFetchFn: typeof globalThis.fetch,
  opts: { cond?: string; term?: string; pageSize?: number; maxPages?: number } = {},
): Promise<TrialStudy[]> {
  const maxPages = Math.min(Math.max(opts.maxPages ?? 5, 1), 10);
  const seen = new Set<string>();
  const out: TrialStudy[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    const { studies, nextPageToken } = await fetchRecruitingTrials(knowledgeFetchFn, { ...opts, pageToken });
    for (const s of studies) {
      if (!seen.has(s.nctId)) {
        seen.add(s.nctId);
        out.push(s);
      }
    }
    if (!nextPageToken) break;
    pageToken = nextPageToken;
  }
  return out;
}
