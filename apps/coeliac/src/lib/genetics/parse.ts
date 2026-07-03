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
    // 23andMe: [rsid, chr, pos, genotype] → col 3.
    // AncestryDNA: [rsid, chr, pos, allele1, allele2] → cols 3+4.
    let genotype = "";
    if (cols.length >= 5) genotype = normaliseGenotype(cols[3] ?? "", cols[4] ?? "");
    else if (cols.length === 4) genotype = normaliseGenotype(cols[3] ?? "");
    else continue; // a header/short row for a tag rsid — skip (interpreted as no data)
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
  { re: /\bDQ2\b/i, haplotype: "DQ2.5" },
];

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
    out.push({ haplotype, rsid, genotype: (m[2] ?? "").toUpperCase() });
  }

  // (b) explicit "DQ… positive/negative/present/absent/detected/not detected".
  for (const line of text.split(/\r?\n/)) {
    for (const { re, haplotype } of HAPLOTYPE_PHRASE) {
      if (!re.test(line)) continue;
      const key = `phrase:${haplotype}`;
      if (seenHaplo.has(key) || seenHaplo.has(`rs-covered:${haplotype}`)) continue;
      const positive = /\b(positive|present|detected|carrier|heterozygous|homozygous)\b/i.test(line);
      const negative = /\b(negative|absent|not\s+detected|not\s+present|no\s+risk)\b/i.test(line);
      // Only record a phrase we can classify UNAMBIGUOUSLY (exactly one of pos/neg).
      if (positive === negative) continue;
      seenHaplo.add(key);
      out.push({ haplotype, statedPresent: positive });
      break; // one classification per line
    }
  }
  return out;
}
