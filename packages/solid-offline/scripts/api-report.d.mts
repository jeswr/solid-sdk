// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * Type declarations for the (JS) `api-report.mjs` script's pure, importable
 * parsers, so a unit test can import them under `tsc` with `allowJs` off. The
 * CLI body of the script is guarded behind an is-entry-module check, so
 * importing it is side-effect-free.
 */

/** The published entry points derived from `package.json` `exports`. */
export function entryPointsFromExports(): Array<{ subpath: string; dts: string }>;

/** The sorted, de-duplicated set of public export names a `.d.ts` entry emits. */
export function exportNamesFromDts(text: string): string[];

/** Normalize the build-hashed chunk filename to a stable placeholder. */
export function normalizeChunkHashes(text: string): string;
