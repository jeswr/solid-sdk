// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * Pod storage layout for the health diary (DESIGN §2.3). Pure URL helpers — no
 * I/O — so they are exhaustively unit-testable and cannot hide a path-traversal
 * bug. Every diary resource lives under `${storageRoot}health/diary/` and is
 * written with an owner-only, fail-closed ACL (see `pod-fs.ts`).
 *
 * ```
 * /health/diary/
 *   meals/{yyyy}/{mm}/{ulid}.ttl
 *   symptoms/{yyyy}/{mm}/{ulid}.ttl
 *   cache/off/{barcode}.ttl
 * ```
 */

/** Ensure a base URL ends with a single trailing slash (a container URL). */
export function asContainer(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

/**
 * The diary root container for a storage root, e.g.
 * `https://alice.example/` → `https://alice.example/health/diary/`.
 *
 * @throws if `storageRoot` is not an absolute http(s) URL.
 */
export function diaryRoot(storageRoot: string): string {
  const root = asContainer(storageRoot);
  const u = new URL(root); // throws on a non-absolute URL
  if (u.protocol !== "https:" && u.protocol !== "http:") {
    throw new Error(`storageRoot must be http(s): ${storageRoot}`);
  }
  return `${root}health/diary/`;
}

/** The meals container (`…/health/diary/meals/`). */
export function mealsContainer(storageRoot: string): string {
  return `${diaryRoot(storageRoot)}meals/`;
}

/** The symptoms container (`…/health/diary/symptoms/`). */
export function symptomsContainer(storageRoot: string): string {
  return `${diaryRoot(storageRoot)}symptoms/`;
}

/** The OFF product cache container (`…/health/diary/cache/off/`). */
export function offCacheContainer(storageRoot: string): string {
  return `${diaryRoot(storageRoot)}cache/off/`;
}

/**
 * The knowledge (literature / trials) cache container
 * (`…/health/diary/cache/knowledge/`, Phase 3a/3b §3.5). Holds ONLY public
 * result-list JSON (no health data); it lives under the diary root so the
 * owner-only `acl:default` written by `ensureDiaryReady` already protects it.
 */
export function knowledgeCacheContainer(storageRoot: string): string {
  return `${diaryRoot(storageRoot)}cache/knowledge/`;
}

const KNOWLEDGE_CACHE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * A knowledge cache resource URL: `…/cache/knowledge/{slug}.json`. The slug is a
 * fixed, code-supplied constant (e.g. `research-latest`, `trials-latest`,
 * `guidelines`) — validated lowercase-alnum-dash so it can never traverse out of
 * the cache container, exactly like a barcode.
 */
export function knowledgeCacheUrl(storageRoot: string, slug: string): string {
  return `${knowledgeCacheContainer(storageRoot)}${assertKnowledgeSlug(slug)}.json`;
}

/** Assert a knowledge cache slug is a safe lowercase-alnum-dash token. */
export function assertKnowledgeSlug(slug: string): string {
  if (!KNOWLEDGE_CACHE_SLUG_RE.test(slug)) throw new Error(`invalid knowledge slug: ${slug}`);
  return slug;
}

/** The elimination-protocols container (`…/health/diary/protocols/`). */
export function protocolsContainer(storageRoot: string): string {
  return `${diaryRoot(storageRoot)}protocols/`;
}

/**
 * The genetics container (`…/health/diary/genetics/`, Phase 3c §5.5). Holds the
 * single interpreted `summary.ttl` (never raw genotype data). It lives under the
 * diary root, so the owner-only `acl:default` written by `ensureDiaryReady` already
 * covers it — the most-sensitive record gets the same fail-closed owner-only ACL,
 * written first, as the rest of the diary.
 */
export function geneticsContainer(storageRoot: string): string {
  return `${diaryRoot(storageRoot)}genetics/`;
}

/**
 * The single genetic-summary resource URL (`…/genetics/summary.ttl`). There is
 * exactly one summary per pod (latest-state, overwritten in place) — a fixed,
 * code-supplied name (no user-derived path segment), so it can never traverse.
 */
export function geneticsSummaryUrl(storageRoot: string): string {
  return `${geneticsContainer(storageRoot)}summary.ttl`;
}

/** The tolerance-conclusions container (`…/health/diary/conclusions/`). */
export function conclusionsContainer(storageRoot: string): string {
  return `${diaryRoot(storageRoot)}conclusions/`;
}

/**
 * An elimination-protocol resource URL: `…/protocols/{ulid}.ttl`. Protocols are
 * few + long-lived (one active at a time), so they are NOT month-bucketed. The
 * `ulid` is validated (path-injection guard) exactly like a meal ULID.
 */
export function protocolUrl(storageRoot: string, ulid: string): string {
  return `${protocolsContainer(storageRoot)}${assertUlid(ulid)}.ttl`;
}

/** A tolerance-conclusion resource URL: `…/conclusions/{ulid}.ttl`. */
export function conclusionUrl(storageRoot: string, ulid: string): string {
  return `${conclusionsContainer(storageRoot)}${assertUlid(ulid)}.ttl`;
}

/** Two-digit UTC month (`01`–`12`) for a date. */
function utcMonth(date: Date): string {
  return String(date.getUTCMonth() + 1).padStart(2, "0");
}

/**
 * The month bucket (`{yyyy}/{mm}/`) a date falls in, UTC. Month-bucketing keeps
 * container listings small (the sharding convention, DESIGN §2.3).
 */
export function monthBucket(date: Date): string {
  return `${date.getUTCFullYear()}/${utcMonth(date)}/`;
}

/**
 * A meal resource URL: `…/meals/{yyyy}/{mm}/{ulid}.ttl`. `ulid` is validated
 * (Crockford base32, 26 chars) so it can never inject a path segment.
 */
export function mealUrl(storageRoot: string, at: Date, ulid: string): string {
  return `${mealsContainer(storageRoot)}${monthBucket(at)}${assertUlid(ulid)}.ttl`;
}

/** A symptom resource URL: `…/symptoms/{yyyy}/{mm}/{ulid}.ttl`. */
export function symptomUrl(storageRoot: string, at: Date, ulid: string): string {
  return `${symptomsContainer(storageRoot)}${monthBucket(at)}${assertUlid(ulid)}.ttl`;
}

/**
 * The cached OFF product resource URL for a barcode:
 * `…/cache/off/{barcode}.ttl`. The barcode is validated as digits-only, so a
 * hostile "barcode" can never traverse out of the cache container.
 */
export function offCacheUrl(storageRoot: string, barcode: string): string {
  return `${offCacheContainer(storageRoot)}${assertBarcode(barcode)}.ttl`;
}

/** The set of containers that must exist (each ACL-protected) before writes. */
export function diaryContainers(storageRoot: string): string[] {
  return [
    diaryRoot(storageRoot),
    mealsContainer(storageRoot),
    symptomsContainer(storageRoot),
    protocolsContainer(storageRoot),
    conclusionsContainer(storageRoot),
    geneticsContainer(storageRoot),
    `${diaryRoot(storageRoot)}cache/`,
    offCacheContainer(storageRoot),
    knowledgeCacheContainer(storageRoot),
  ];
}

/** The month-bucket sub-container of a resource URL, or undefined at top level. */
export function containerOf(resourceUrl: string): string {
  const u = new URL(resourceUrl);
  u.hash = "";
  u.search = "";
  const path = u.pathname;
  const idx = path.lastIndexOf("/");
  u.pathname = path.slice(0, idx + 1);
  return u.toString();
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;
/** GTIN/EAN/UPC barcodes are 6–14 digits. */
const BARCODE_RE = /^[0-9]{6,14}$/;

/** Assert a ULID is well-formed (path-injection guard). */
export function assertUlid(ulid: string): string {
  if (!ULID_RE.test(ulid)) throw new Error(`invalid ULID: ${ulid}`);
  return ulid;
}

/** Whether a string is a plausible GTIN/EAN/UPC barcode (6–14 digits). */
export function isBarcode(barcode: string): boolean {
  return BARCODE_RE.test(barcode);
}

/** Assert a barcode is digits-only (path-injection guard). */
export function assertBarcode(barcode: string): string {
  if (!isBarcode(barcode)) throw new Error(`invalid barcode: ${barcode}`);
  return barcode;
}
