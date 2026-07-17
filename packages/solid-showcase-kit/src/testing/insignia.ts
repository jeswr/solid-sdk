// AUTHORED-BY Claude Fable 5
/**
 * Bright-line insignia guard — the generic scanner MECHANISM behind per-repo
 * `check-insignia` scripts.
 *
 * Scans rendered-source text and file trees for marks that must never render on any demo
 * surface. There is deliberately no allowlist and no inline-suppression mechanism: banned
 * marks are bright lines.
 *
 * The kit ships NO built-in banned-marks roster — it is domain-generic. Consumers supply
 * their own {@link BannedMark} list (typically from their `BrandingConfig.bannedMarks`);
 * what is banned is domain knowledge that lives with the consumer.
 *
 * Node-only (fs walker) — this module lives under the `./testing` subpath and must never
 * be re-exported from the browser-safe root.
 */
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { BannedMark } from "../branding.js";

export interface InsigniaRule {
  id: string;
  pattern: RegExp;
  reason: string;
}

export interface InsigniaFinding {
  /** Path relative to `rootDir` for tree scans; the `file` option (or "") for text scans. */
  file: string;
  /** 1-based line for content findings; 0 for file-path findings. */
  line: number;
  id: string;
  reason: string;
  excerpt: string;
}

export interface InsigniaOptions {
  /** The consumer's never-render roster (see {@link BannedMark} for pattern casing). */
  bannedMarks?: BannedMark[] | undefined;
}

/**
 * Compile a {@link BannedMark} pattern source. Case-insensitive unless the source
 * contains an uppercase character — an uppercase source is a standalone-token rule
 * (e.g. `\bXYZ\b`) whose casing is deliberate.
 */
function compileMark(source: string): RegExp {
  return new RegExp(source, /[A-Z]/.test(source) ? "" : "i");
}

/** The effective rule list for the caller-supplied banned marks. */
export function insigniaRules(options: InsigniaOptions = {}): InsigniaRule[] {
  return (options.bannedMarks ?? []).map((mark, index) => ({
    id: `banned-mark-${index + 1}`,
    pattern: compileMark(mark.pattern),
    reason: mark.reason,
  }));
}

/**
 * Whitespace-normalise `text` (all runs of whitespace, INCLUDING newlines, collapse to a
 * single space) while tracking the original 1-based line of every kept character — so a
 * banned phrase split across a line break cannot evade a `\s+` rule.
 */
function normalizeWithLines(text: string): { normalized: string; lineOfChar: number[] } {
  const chars: string[] = [];
  const lineOfChar: number[] = [];
  let line = 1;
  let pendingSpace = false;
  for (const ch of text) {
    if (ch === "\n") {
      line += 1;
      pendingSpace = true;
      continue;
    }
    if (/\s/.test(ch)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && chars.length > 0) {
      chars.push(" ");
      lineOfChar.push(line);
    }
    pendingSpace = false;
    chars.push(ch);
    lineOfChar.push(line);
  }
  return { lineOfChar, normalized: chars.join("") };
}

/**
 * Scan a text blob; returns one finding per (rule, line) hit with 1-based line numbers
 * and a ≤120-character excerpt. Two passes: per line (precise excerpts), then over the
 * whitespace-normalised whole text so marks split across line breaks are still caught
 * (attributed to the line where the match starts).
 */
export function insigniaFindings(
  text: string,
  options: InsigniaOptions & { file?: string | undefined } = {},
): InsigniaFinding[] {
  const rules = insigniaRules(options);
  const file = options.file ?? "";
  const findings: InsigniaFinding[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string;
    for (const { id, pattern, reason } of rules) {
      if (!pattern.test(line)) continue;
      seen.add(`${id}@${index + 1}`);
      findings.push({
        excerpt: line.trim().slice(0, 120),
        file,
        id,
        line: index + 1,
        reason,
      });
    }
  }
  const { normalized, lineOfChar } = normalizeWithLines(text);
  for (const { id, pattern, reason } of rules) {
    const global = new RegExp(pattern.source, `${pattern.flags}g`);
    for (const match of normalized.matchAll(global)) {
      const startLine = lineOfChar[match.index] ?? 1;
      const key = `${id}@${startLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        excerpt: normalized
          .slice(match.index, match.index + 120)
          .trim()
          .slice(0, 120),
        file,
        id,
        line: startLine,
        reason,
      });
    }
  }
  return findings;
}

/**
 * Check a (relative) file PATH against the rules — catches prohibited imagery whose
 * binary content cannot be grepped (a revealing file name, or a generic basename under a
 * revealing directory). Path separators and `-_.` are normalised to spaces; the
 * uppercased form additionally lets case-sensitive standalone-token rules catch
 * conventionally lowercase path segments. Findings carry `line: 0`.
 */
export function insigniaPathFindings(
  relativePath: string,
  options: InsigniaOptions = {},
): InsigniaFinding[] {
  const rules = insigniaRules(options);
  const normalizedPath = relativePath.replace(/[\\/\-_.]/g, " ");
  const findings: InsigniaFinding[] = [];
  for (const { id, pattern, reason } of rules) {
    if (
      !pattern.test(relativePath) &&
      !pattern.test(normalizedPath) &&
      !pattern.test(normalizedPath.toUpperCase())
    )
      continue;
    findings.push({
      excerpt: `(file path) ${relativePath}`,
      file: relativePath,
      id,
      line: 0,
      reason,
    });
  }
  return findings;
}

/** Text-like extensions whose CONTENT is scanned (paths are checked for every file). */
export const SCANNED_EXTENSIONS: ReadonlySet<string> = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

/** Build/dependency directories never scanned. */
export const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  ".next",
  ".turbo",
  "dist",
  "node_modules",
]);

function* walkFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      // Fail closed: a symlink could smuggle content past the scan (its target lives
      // outside the walked tree) or hide a banned real path behind a clean link name.
      throw new Error(
        `insignia scan refuses symlink: ${path} — scanned trees must contain regular files only`,
      );
    }
    if (entry.isDirectory()) yield* walkFiles(path);
    else if (entry.isFile()) yield path;
  }
}

function fileExtension(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot).toLowerCase();
}

export interface InsigniaTreeOptions extends InsigniaOptions {
  /** Root that findings' `file` paths are made relative to; default `process.cwd()`. */
  rootDir?: string | undefined;
}

/**
 * Walk directories and scan every file: the NAME/path of every file is checked
 * regardless of extension; text files ({@link SCANNED_EXTENSIONS}) are additionally
 * content-scanned. Symlinks anywhere in a scanned tree are rejected (throw) — fail
 * closed rather than silently skipping or following them. Returns findings in walk
 * order — path findings before content findings per file.
 */
export function scanInsigniaTree(
  directories: string[],
  options: InsigniaTreeOptions = {},
): InsigniaFinding[] {
  const rootDir = options.rootDir ?? process.cwd();
  const findings: InsigniaFinding[] = [];
  for (const directory of directories) {
    // Fail closed at the ROOT too: readdirSync would silently follow a symlinked scan
    // root, bypassing the in-tree rejection below.
    if (lstatSync(directory).isSymbolicLink()) {
      throw new Error(
        `insignia scan refuses symlink: ${directory} — scanned trees must contain regular files only`,
      );
    }
    for (const file of walkFiles(directory)) {
      const relativePath = relative(rootDir, file);
      findings.push(...insigniaPathFindings(relativePath, options));
      if (!SCANNED_EXTENSIONS.has(fileExtension(file))) continue;
      findings.push(
        ...insigniaFindings(readFileSync(file, "utf8"), { ...options, file: relativePath }),
      );
    }
  }
  return findings;
}
