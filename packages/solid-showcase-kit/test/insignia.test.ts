// AUTHORED-BY Claude Fable 5
// The insignia scanner MECHANISM, pinned against runtime-generated fictional fixtures:
// content rules, file-path/directory-name detection, casing negatives, skipped dirs,
// cross-line evasion, and symlink rejection. The kit ships no banned-marks roster —
// every rule here is caller-supplied and fictional.
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import {
  type InsigniaOptions,
  insigniaFindings,
  insigniaPathFindings,
  insigniaRules,
  scanInsigniaTree,
} from "../src/testing/index.js";

/** A fictional consumer roster exercising both casing modes of the pattern compiler. */
const MARKS: InsigniaOptions = {
  bannedMarks: [
    { pattern: "\\bacme\\s+corp\\s+(?:seal|badge)\\b", reason: "fictional certification seal" },
    { pattern: "\\bXYZ\\b", reason: "fictional standalone product token" },
  ],
};

const VIOLATIONS = [
  "Rendered with the Acme Corp seal in the header",
  "an ACME CORP BADGE watermark",
  "Submit the file to XYZ for a decision",
].join("\n");

const CLEAN = [
  "Concept demo — this is a fictional walkthrough surface.",
  "The word xylophone contains x-y but not the standalone token.",
  "xyz in lowercase inside prose should not match the standalone-token rule.",
  "Acme Corp alone, without seal or badge wording, is fine.",
].join("\n");

const ROOT = mkdtempSync(join(tmpdir(), "showcase-kit-insignia-"));
const FIXTURES = join(ROOT, "fixtures");
mkdirSync(join(FIXTURES, "acme-corp-seal"), { recursive: true });
writeFileSync(join(FIXTURES, "violations.txt"), VIOLATIONS);
writeFileSync(join(FIXTURES, "clean.txt"), CLEAN);
writeFileSync(join(FIXTURES, "xyz-report.svg"), "<svg><!-- clean content --></svg>");
writeFileSync(join(FIXTURES, "acme-corp-seal", "asset.svg"), "<svg><!-- clean content --></svg>");
// Skipped directories are never scanned, even when their contents would match.
mkdirSync(join(FIXTURES, "node_modules"), { recursive: true });
writeFileSync(join(FIXTURES, "node_modules", "vendored.txt"), VIOLATIONS);

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

test("flags every caller-supplied banned mark in the violation fixture", () => {
  const findings = scanInsigniaTree([FIXTURES], { ...MARKS, rootDir: ROOT });
  const violationFindings = findings.filter((finding) => finding.file.endsWith("violations.txt"));
  expect(violationFindings.map((finding) => [finding.id, finding.line])).toEqual([
    ["banned-mark-1", 1],
    ["banned-mark-1", 2],
    ["banned-mark-2", 3],
  ]);
});

test("flags banned filenames even when the file content is clean (image assets)", () => {
  const findings = scanInsigniaTree([FIXTURES], { ...MARKS, rootDir: ROOT });
  const filenameFindings = findings.filter((finding) => finding.file.endsWith("xyz-report.svg"));
  expect(filenameFindings.map((finding) => finding.id)).toContain("banned-mark-2");
  expect(filenameFindings.every((finding) => finding.line === 0)).toBe(true);
});

test("flags prohibited directory names carrying the mark past a generic basename", () => {
  const findings = scanInsigniaTree([FIXTURES], { ...MARKS, rootDir: ROOT });
  const pathFindings = findings.filter((finding) =>
    finding.file.endsWith(join("acme-corp-seal", "asset.svg")),
  );
  expect(pathFindings.map((finding) => finding.id)).toContain("banned-mark-1");
  expect(pathFindings.every((finding) => finding.line === 0)).toBe(true);
});

test("does not flag the clean fixture (word-boundary and casing negatives)", () => {
  const findings = scanInsigniaTree([FIXTURES], { ...MARKS, rootDir: ROOT });
  expect(findings.filter((finding) => finding.file.endsWith("clean.txt"))).toEqual([]);
});

test("never descends into skipped directories (node_modules, dist, .next, .turbo)", () => {
  const findings = scanInsigniaTree([FIXTURES], { ...MARKS, rootDir: ROOT });
  expect(findings.filter((finding) => finding.file.includes("node_modules"))).toEqual([]);
});

test("insigniaFindings scans a text blob with 1-based lines and trimmed excerpts", () => {
  const findings = insigniaFindings("clean line\n  the Acme Corp seal  \n", MARKS);
  expect(findings).toEqual([
    {
      excerpt: "the Acme Corp seal",
      file: "",
      id: "banned-mark-1",
      line: 2,
      reason: "fictional certification seal",
    },
  ]);
});

test("FIX B: a mark split across a line break cannot evade a \\s+ rule", () => {
  // "Acme Corp\nseal" — no single line matches, but the whitespace-normalised text does.
  const findings = insigniaFindings("Shows the Acme Corp\nseal proudly.\n", MARKS);
  expect(findings).toHaveLength(1);
  expect(findings[0]?.id).toBe("banned-mark-1");
  // Attributed to the line where the match starts.
  expect(findings[0]?.line).toBe(1);
  // Single-line matches are not double-reported by the cross-line pass.
  expect(insigniaFindings("the Acme Corp seal\n", MARKS)).toHaveLength(1);
});

test("FIX C: a symlink anywhere in a scanned tree is rejected, not silently skipped", () => {
  const linkRoot = join(ROOT, "linked");
  mkdirSync(linkRoot, { recursive: true });
  writeFileSync(join(ROOT, "outside.txt"), VIOLATIONS); // outside the scanned tree
  symlinkSync(join(ROOT, "outside.txt"), join(linkRoot, "innocent-name.txt"));
  expect(() => scanInsigniaTree([linkRoot], { ...MARKS, rootDir: ROOT })).toThrow(
    /refuses symlink/,
  );
});

test("insigniaPathFindings checks path, normalised path, and uppercased normalised path", () => {
  expect(insigniaPathFindings("public/xyz-findings.svg", MARKS).map((f) => f.id)).toContain(
    "banned-mark-2",
  );
  expect(insigniaPathFindings("public/alpaca.svg", MARKS)).toEqual([]);
});

test("no built-in roster: empty options yield no rules and no findings", () => {
  expect(insigniaRules({})).toEqual([]);
  expect(insigniaFindings("the Acme Corp seal, XYZ, anything at all")).toEqual([]);
});

test("pattern casing heuristic: lowercase source is case-insensitive, uppercase exact", () => {
  // Lowercase pattern source → case-insensitive.
  expect(insigniaFindings("ACME CORP SEAL sheet", MARKS)).toHaveLength(1);
  // Uppercase pattern source → case-sensitive (prose "xyz" must not match).
  expect(insigniaFindings("xyz jour", MARKS)).toEqual([]);
  expect(insigniaFindings("Submit to XYZ today", MARKS).map((f) => f.id)).toEqual([
    "banned-mark-2",
  ]);
});

test("FIX F: a symlinked scan ROOT is rejected, not silently followed", () => {
  const realRoot = join(ROOT, "real-root");
  mkdirSync(realRoot, { recursive: true });
  writeFileSync(join(realRoot, "violations.txt"), VIOLATIONS);
  const linkedRoot = join(ROOT, "linked-root");
  symlinkSync(realRoot, linkedRoot);
  expect(() => scanInsigniaTree([linkedRoot], { ...MARKS, rootDir: ROOT })).toThrow(
    /refuses symlink/,
  );
  // The real directory itself still scans normally.
  expect(scanInsigniaTree([realRoot], { ...MARKS, rootDir: ROOT }).length).toBeGreaterThan(0);
});
