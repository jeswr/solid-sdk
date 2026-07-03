// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
/**
 * The **on-device** genetic-file parser (Phase 3c §5.2). PRIVACY-CRITICAL and by
 * design a **pure, side-effect-free** module: it takes an already-in-memory string
 * (the `FileReader` result, read in the browser) and returns only the interpreted
 * tag-SNP calls. It does **no** I/O — no `fetch`, no `localStorage`/IndexedDB, no
 * pod write — so by construction the raw genome text this function sees can never
 * leave the device from here. The caller (`useGenetics`) reads the file with
 * `FileReader`, passes the string in, keeps ONLY the returned {@link RawSnpCall}s,
 * and drops the raw string; nothing downstream ever receives the raw bytes.
 *
 * It scans ONLY for the verified coeliac tag SNPs (rs2187668 → DQ2.5, rs7454108 →
 * DQ8) plus documented, chip-dependent secondary tags where present — never the
 * whole genome — so even the in-memory footprint it retains is a handful of rows.
 *
 * Formats handled (consumer raw exports, tab/whitespace-separated):
 *   - **23andMe**: `rsid  chromosome  position  genotype`  (genotype e.g. `AG`, `--`)
 *   - **AncestryDNA**: `rsid  chromosome  position  allele1  allele2` (`0 0` = no-call)
 * plus a best-effort **clinical-report text** scan (rsid tokens + HLA-DQ phrases).
 */

/**
 * The verified primary coeliac tag SNPs and the risk haplotype each tags (§1.2,
 * PLOS One pone.0002270; 23andMe's own coeliac report uses these two). Documented
 * secondary DQ2.2/DQ7 tags are chip-dependent (coverage caveat) — scanned where
 * present but never required.
 */
export const PRIMARY_TAG_SNPS = {
  rs2187668: "DQ2.5",
  rs7454108: "DQ8",
} as const;

/**
 * Documented secondary tag SNPs (chip-dependent; RESEARCH §2.5 / design §5.2).
 * Scanned where present, always with the coverage caveat — a consumer chip may not
 * tag every risk allele, so their ABSENCE is never treated as reassurance.
 */
export const SECONDARY_TAG_SNPS = {
  rs2395182: "DQ2.2",
  rs7775228: "DQ2.2",
  rs4713586: "DQ7",
} as const;

/** Every tag SNP this parser recognises (primary + secondary). */
export const ALL_TAG_SNPS = { ...PRIMARY_TAG_SNPS, ...SECONDARY_TAG_SNPS } as const;

/** An rsid this parser looks for. */
export type TagRsid = keyof typeof ALL_TAG_SNPS;

/** Is `rsid` one of the tag SNPs we scan for? */
export function isTagRsid(rsid: string): rsid is TagRsid {
  return Object.hasOwn(ALL_TAG_SNPS, rsid);
}

/** One raw tag-SNP row extracted from a file — the rsid + the called genotype (as read). */
export interface RawSnpCall {
  /** The SNP id, e.g. `rs2187668`. Always a recognised {@link TagRsid}. */
  rsid: TagRsid;
  /**
   * The genotype string as read from the file, upper-cased and trimmed (e.g. `AG`,
   * `--`, `00`). Interpretation into present/absent/uncertain happens in
   * `interpret.ts` — this module does not decide risk, it only extracts.
   */
  genotype: string;
}

/** Hard cap on scanned characters — a defensive guard against a pathological file. */
const MAX_SCAN_CHARS = 256 * 1024 * 1024; // 256 MB (consumer raw exports are ~15–25 MB)

/**
 * Normalise a genotype token: upper-case + trim; join allele columns for the
 * AncestryDNA 2-column form. Returns `""` for an empty token.
 */
function normaliseGenotype(...alleleCols: string[]): string {
  return alleleCols
    .join("")
    .trim()
    .toUpperCase();
}

/** A consumer-array chromosome column: 1–22, X, Y, MT, or M. */
const CHROMOSOME_RE = /^(?:[1-9]|1\d|2[0-2]|X|Y|MT|M)$/i;
/** A genome position column: digits. */
const POSITION_RE = /^\d+$/;
/** A genotype/allele token: ACGT, a no-call (`-`/`0`/`N`), or an indel marker (I/D). */
const ALLELE_RE = /^[ACGT0\-NID]{1,2}$/i;

/**
 * Is a split row a REAL consumer-array data row (not clinical prose that happens to
 * start with an rsid, e.g. "rs2187668 was reported as CT…")? Requires the exact
 * genome-file shape: a chromosome column, a numeric position, and genotype-looking
 * allele column(s). If it does not match, the row is skipped so the clinical-text
 * parser can run instead (rather than fabricating a junk genotype).
 */
function isConsumerRow(cols: string[]): boolean {
  if (!CHROMOSOME_RE.test(cols[1] ?? "") || !POSITION_RE.test(cols[2] ?? "")) return false;
  if (cols.length >= 5) return ALLELE_RE.test(cols[3] ?? "") && ALLELE_RE.test(cols[4] ?? "");
  if (cols.length === 4) return ALLELE_RE.test(cols[3] ?? "");
  return false;
}

/**
 * Scan a consumer raw-array export (23andMe / AncestryDNA) for the coeliac tag
 * SNPs. Pure: no I/O. Only rows whose rsid is a recognised tag SNP are retained
 * (the rest of the genome is read past and never stored). A row's genotype is kept
 * verbatim (upper-cased); {@link import("./interpret.js").callPresence} decides the
 * presence. If the same rsid appears more than once, the FIRST occurrence wins
 * (raw files list each SNP once; a duplicate is treated as noise).
 */
export function parseConsumerArray(text: string): RawSnpCall[] {
  if (text.length > MAX_SCAN_CHARS) {
    throw new Error("genetic file is too large to parse on-device");
  }
  const out: RawSnpCall[] = [];
  const seen = new Set<string>();
  // Line-by-line; consumer exports are line-oriented. `\r\n`/`\n` both handled.
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    // Split on tab OR runs of whitespace (both formats seen in the wild).
    const cols = line.split(/\s+/);
    const rsid = cols[0];
    if (!rsid || !isTagRsid(rsid) || seen.has(rsid)) continue;
    // Reject clinical prose that merely starts with a tag rsid — require the exact
    // genome-row shape (chromosome + position + allele columns), else skip so the
    // clinical-text parser handles it instead of fabricating a junk genotype.
    if (!isConsumerRow(cols)) continue;
    // 23andMe: [rsid, chr, pos, genotype] → col 3.
    // AncestryDNA: [rsid, chr, pos, allele1, allele2] → cols 3+4.
    const genotype =
      cols.length >= 5
        ? normaliseGenotype(cols[3] ?? "", cols[4] ?? "")
        : normaliseGenotype(cols[3] ?? "");
    seen.add(rsid);
    out.push({ rsid, genotype });
  }
  return out;
}

/**
 * A best-effort observation lifted from a clinical HLA report's TEXT (§5.1 path 2).
 * A clinical report is prose, so this is heuristic — it recognises either an rsid +
 * adjacent genotype (same interpretation path as an array) OR an explicit
 * "HLA-DQ2 / DQ8 positive/negative" statement. It is deliberately conservative: a
 * statement it cannot classify with confidence is simply not returned, so a manual
 * review (the robust path) is never displaced by a wrong guess.
 */
export interface ClinicalObservation {
  /** Which risk haplotype the statement concerns (`DQ2.5`/`DQ2.2`/`DQ7`/`DQ8`). */
  haplotype: (typeof ALL_TAG_SNPS)[TagRsid];
  /** An rsid if the report cited one (drives a genotype-based call), else undefined. */
  rsid?: TagRsid;
  /** A genotype if one was adjacent to a cited rsid. */
  genotype?: string;
  /** An explicit positive/negative statement if the report used haplotype prose. */
  statedPresent?: boolean;
}

const HAPLOTYPE_PHRASE: { re: RegExp; haplotype: ClinicalObservation["haplotype"] }[] = [
  { re: /\bDQ2\.5\b/i, haplotype: "DQ2.5" },
  { re: /\bDQ2\.2\b/i, haplotype: "DQ2.2" },
  { re: /\bDQ7\b/i, haplotype: "DQ7" },
  { re: /\bDQ8\b/i, haplotype: "DQ8" },
  // Bare "DQ2" (no sub-type) most commonly means the DQ2.5 haplotype in coeliac
  // reporting; classify it as DQ2.5 but the caller still shows the coverage caveat.
  // The negative lookahead `(?!\.\d)` stops it ALSO matching a dotted subtype like
  // "DQ2.2"/"DQ2.5" (which would fabricate a spurious DQ2.5 marker on that line).
  { re: /\bDQ2(?!\.\d)\b/i, haplotype: "DQ2.5" },
];

/**
 * All sentiment cues, negated phrases FIRST so the regex consumes "not detected" as
 * one negative cue rather than matching "detected" as a positive one. Each cue's
 * polarity: negative for the negation/absence phrases, positive otherwise.
 */
const CUE_RE =
  /\b(not\s+detected|not\s+present|no\s+risk|negative|absent|positive|present|detected|carrier|heterozygous|homozygous)\b/gi;
const NEGATIVE_CUES = new Set(["not detected", "not present", "no risk", "negative", "absent"]);

interface Cue {
  index: number;
  present: boolean;
}
/** Every sentiment cue in a line, with its position + polarity, in order. */
function cuesIn(line: string): Cue[] {
  const cues: Cue[] = [];
  for (const m of line.matchAll(CUE_RE)) {
    const text = (m[1] ?? "").toLowerCase().replace(/\s+/g, " ");
    cues.push({ index: m.index ?? 0, present: !NEGATIVE_CUES.has(text) });
  }
  return cues;
}

/** Every risk haplotype named in a line, with its first position (deduped, ordered by position). */
function haplotypeMentions(line: string): { index: number; haplotype: ClinicalObservation["haplotype"] }[] {
  const seen = new Set<string>();
  const found: { index: number; haplotype: ClinicalObservation["haplotype"] }[] = [];
  for (const { re, haplotype } of HAPLOTYPE_PHRASE) {
    const m = re.exec(line);
    if (m && !seen.has(haplotype)) {
      seen.add(haplotype);
      found.push({ index: m.index, haplotype });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * The sentiment cue that GOVERNS a haplotype mention: the nearest cue at/after the
 * haplotype's position (clinical wording states the cue AFTER the haplotype(s), e.g.
 * "DQ2.5 and DQ8 negative"); if none follows, the nearest preceding cue. `undefined`
 * when the line has no cue at all. This nearest-cue association is robust to `and`
 * both GROUPING a shared cue ("DQ2.5 and DQ8 positive") and SEPARATING two cued
 * clauses ("DQ2.5 negative and DQ8 positive"), which no split heuristic handles.
 */
function governingSentiment(cues: Cue[], at: number): boolean | undefined {
  const following = cues.filter((c) => c.index >= at).sort((a, b) => a.index - b.index)[0];
  if (following) return following.present;
  const preceding = cues.filter((c) => c.index < at).sort((a, b) => b.index - a.index)[0];
  return preceding?.present;
}

/**
 * Best-effort scan of clinical-report text. Returns any confidently-classifiable
 * observations; ambiguous text yields nothing (the manual-entry path stays the
 * robust route). Pure — no I/O.
 */
export function parseClinicalText(text: string): ClinicalObservation[] {
  if (text.length > MAX_SCAN_CHARS) {
    throw new Error("clinical report is too large to parse on-device");
  }
  const out: ClinicalObservation[] = [];
  const seenHaplo = new Set<string>();

  // (a) rsid + adjacent genotype, e.g. "rs2187668 (AG)" or "rs7454108: CC".
  const rsidRe = /(rs\d+)\D{0,12}?([ACGT]{2}|--|00)/gi;
  for (const m of text.matchAll(rsidRe)) {
    const rsid = (m[1] ?? "").toLowerCase();
    if (!isTagRsid(rsid)) continue;
    const haplotype = ALL_TAG_SNPS[rsid];
    if (seenHaplo.has(`rs:${rsid}`)) continue;
    seenHaplo.add(`rs:${rsid}`);
    // Mark this haplotype covered by an rsid call so the phrase scan (b) does not
    // ALSO emit a duplicate/contradictory marker for the same haplotype.
    seenHaplo.add(`rs-covered:${haplotype}`);
    out.push({ haplotype, rsid, genotype: (m[2] ?? "").toUpperCase() });
  }

  // (b) explicit "DQ… positive/negative/present/absent/detected/not detected".
  const recordPhrase = (haplotype: ClinicalObservation["haplotype"], statedPresent: boolean) => {
    if (seenHaplo.has(`phrase:${haplotype}`) || seenHaplo.has(`rs-covered:${haplotype}`)) return;
    seenHaplo.add(`phrase:${haplotype}`);
    out.push({ haplotype, statedPresent });
  };
  for (const line of text.split(/\r?\n/)) {
    const cues = cuesIn(line);
    if (cues.length === 0) continue; // no sentiment cue on the line → skip
    // Associate each haplotype with the cue that GOVERNS it (nearest at/after it,
    // else nearest before). This correctly handles "DQ2.5 and DQ8 negative" (shared
    // cue → both absent), "DQ2.5 negative, DQ8 positive" and "DQ2.5 negative and
    // DQ8 positive" (each governed by its own nearer cue), and
    // "DQ2.5 and DQ8 positive, DQ7 negative" (group shares positive, DQ7 negative).
    for (const { index, haplotype } of haplotypeMentions(line)) {
      const present = governingSentiment(cues, index);
      if (present === undefined) continue; // no governing cue → skip (never guess)
      recordPhrase(haplotype, present);
    }
  }
  return out;
}
