// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import {
  isTagRsid,
  parseClinicalText,
  parseConsumerArray,
} from "./parse.js";

const RAW_23ANDME = `# rsid\tchromosome\tposition\tgenotype
rs4477212\t1\t82154\tAA
rs2187668\t6\t32713862\tCT
rs7454108\t6\t32772074\tTT
rs99999999\t1\t1\tGG
`;

const RAW_ANCESTRY = `#AncestryDNA raw data download
rsid\tchromosome\tposition\tallele1\tallele2
rs4477212\t1\t82154\tA\tA
rs2187668\t6\t32713862\tC\tC
rs7454108\t6\t32772074\tT\tC
`;

describe("parseConsumerArray", () => {
  it("extracts ONLY the tag SNPs from a 23andMe file (genome rows read past)", () => {
    const calls = parseConsumerArray(RAW_23ANDME);
    expect(calls).toEqual([
      { rsid: "rs2187668", genotype: "CT" },
      { rsid: "rs7454108", genotype: "TT" },
    ]);
  });

  it("parses the 5-column AncestryDNA format (allele1+allele2 joined)", () => {
    const calls = parseConsumerArray(RAW_ANCESTRY);
    expect(calls).toEqual([
      { rsid: "rs2187668", genotype: "CC" },
      { rsid: "rs7454108", genotype: "TC" },
    ]);
  });

  it("keeps a no-call genotype verbatim (interpretation decides uncertain later)", () => {
    const calls = parseConsumerArray("rs2187668\t6\t1\t--\nrs7454108\t6\t2\t0\t0\n");
    expect(calls).toEqual([
      { rsid: "rs2187668", genotype: "--" },
      { rsid: "rs7454108", genotype: "00" },
    ]);
  });

  it("skips comments, blanks and the header row; first occurrence of an rsid wins", () => {
    const calls = parseConsumerArray("# comment\n\nrsid chromosome position genotype\nrs2187668 6 1 CT\nrs2187668 6 1 TT\n");
    expect(calls).toEqual([{ rsid: "rs2187668", genotype: "CT" }]);
  });

  it("returns nothing for a file with no tag SNPs", () => {
    expect(parseConsumerArray("rs1 1 1 AA\nrs2 2 2 GG\n")).toEqual([]);
  });
});

describe("parseClinicalText", () => {
  it("reads an rsid + adjacent genotype from prose", () => {
    const obs = parseClinicalText("HLA typing: rs2187668 (CT), rs7454108: TT.");
    expect(obs).toContainEqual({ haplotype: "DQ2.5", rsid: "rs2187668", genotype: "CT" });
    expect(obs).toContainEqual({ haplotype: "DQ8", rsid: "rs7454108", genotype: "TT" });
  });

  it("classifies an UNAMBIGUOUS positive/negative haplotype statement", () => {
    const obs = parseClinicalText("HLA-DQ2.5 positive.\nHLA-DQ8 negative.");
    expect(obs).toContainEqual({ haplotype: "DQ2.5", statedPresent: true });
    expect(obs).toContainEqual({ haplotype: "DQ8", statedPresent: false });
  });

  it("ignores an ambiguous line that is neither clearly positive nor negative", () => {
    // "DQ2 testing was inconclusive" — no positive/negative token → not classified.
    expect(parseClinicalText("DQ2 testing was inconclusive.")).toEqual([]);
  });

  it("classifies negated phrasing ('not detected' / 'not present') as NEGATIVE, not ambiguous", () => {
    expect(parseClinicalText("HLA-DQ8 not detected.")).toContainEqual({
      haplotype: "DQ8",
      statedPresent: false,
    });
    expect(parseClinicalText("HLA-DQ2.5 not present.")).toContainEqual({
      haplotype: "DQ2.5",
      statedPresent: false,
    });
  });

  it("does not emit a duplicate marker when both an rsid genotype and a phrase name the same haplotype", () => {
    const obs = parseClinicalText("rs7454108 (TC). HLA-DQ8 positive.");
    const dq8 = obs.filter((o) => o.haplotype === "DQ8");
    expect(dq8).toHaveLength(1);
    expect(dq8[0].rsid).toBe("rs7454108"); // the rsid observation wins; no contradictory phrase marker
  });
});

describe("isTagRsid", () => {
  it("recognises the verified primary tags and rejects unrelated rsids", () => {
    expect(isTagRsid("rs2187668")).toBe(true);
    expect(isTagRsid("rs7454108")).toBe(true);
    expect(isTagRsid("rs123")).toBe(false);
  });
});
