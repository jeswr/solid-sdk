// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * Public-API snapshot — the reviewability cornerstone.
 *
 * Emits a single, committed, diffable `etc/solid-offline.api.md` containing the
 * FULL emitted `.d.ts` of every published entry point (`.`, `./worker`,
 * `./react`) plus the shared type chunk they import. So "what is the public API?"
 * is a one-file diff, and a contract change (a new/removed/renamed export, a
 * changed signature, an overload, OR a changed shape of any referenced type) is a
 * reviewed diff in this file — never silent.
 *
 * Snapshotting the EMITTED `.d.ts` verbatim (rather than re-deriving the surface
 * with the compiler API) is deliberate — it is the exact as-published type
 * contract, so it captures overload sets, declaration merges, and the shapes of
 * non-exported-but-referenced types (e.g. `StatusChannel` reachable via
 * `StatusSurfaceOptions`) that a name-only walk would miss. It is also far less
 * code to audit than a bespoke AST serializer, and needs no dependency beyond the
 * Node stdlib.
 *
 *   node scripts/api-report.mjs           # regenerate etc/solid-offline.api.md (after build)
 *   node scripts/api-report.mjs --check    # FAIL if the committed report is stale (a gate)
 *
 * The report is generated from `dist/*.d.ts`, so it must be regenerated AFTER
 * `npm run build`.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * BELT-AND-BRACES: the report ALSO pins, per `package.json` `exports` subpath,
 * the explicit SET of public export NAMES that subpath emits (parsed from the
 * entry `.d.ts` `export { … }` statements — the right-hand identifier of each
 * spec, with `type` modifiers and `X as Y` aliases resolved to the imported
 * name). The full-`.d.ts` snapshot is the primary contract, but it is chunk
 * CONTENT; a removed/renamed PUBLIC export is a change to the SET OF NAMES a
 * consumer can import, and pinning that set as its own diffable section means a
 * dropped/renamed export FAILS `api:check` on a clean, unambiguous line — it can
 * never hide inside a chunk-body diff. Still stdlib-only (no api-extractor).
 * ────────────────────────────────────────────────────────────────────────────
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const REPORT_PATH = join(ROOT, 'etc', 'solid-offline.api.md');

/**
 * The published entry points, DERIVED from `package.json` `exports` (not
 * hardcoded) so a new entry point is automatically represented in the snapshot —
 * its `.d.ts` is reported in the most-read first section, and a removed/renamed
 * entry shows as a report diff. Returns `{ subpath, dts }` pairs, where `dts` is
 * the basename of the export's `types` (e.g. `./dist/index.d.ts` → `index.d.ts`)
 * and `subpath` is the `exports` key (`.`, `./worker`, `./react`) — kept so the
 * per-subpath export-NAME set can be labelled by the importable subpath.
 */
function entryPointsFromExports() {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const exportsField = pkg.exports ?? {};
  const out = [];
  for (const [subpath, entry] of Object.entries(exportsField)) {
    const types = typeof entry === 'object' && entry ? entry.types : undefined;
    if (typeof types === 'string' && types.endsWith('.d.ts')) {
      out.push({ subpath, dts: types.replace(/^.*[/\\]/, '') }); // basename
    }
  }
  return out;
}

/** Just the entry-point `.d.ts` basenames (for the snapshot ordering). */
function entryDtsFromExports() {
  return entryPointsFromExports().map((e) => e.dts);
}

/**
 * The SET of public export NAMES a `.d.ts` entry point emits, parsed from its
 * `export { … }` statements (the form tsup/rollup emit for a bundled entry).
 *
 * Handles both the value form `export { … }` and the block-level type-only form
 * `export type { … }` (a common emitter output) — the optional block `type`
 * keyword is accepted and ignored, since the name SET is the importable
 * identifiers regardless of value-vs-type. For each spec inside the braces we
 * resolve to the name the MODULE re-exports under — i.e. the right-hand
 * identifier:
 *   - `Foo`              → `Foo`
 *   - `type Foo`         → `Foo`         (the per-spec `type` modifier is dropped)
 *   - `x as Foo`         → `Foo`         (an alias: the public name is `Foo`)
 *   - `type x as Foo`    → `Foo`
 *   - `default as Foo`   → `Foo`
 * Defensively also handles `export default …` (→ `default`) and a direct
 * `export declare function/const/class/interface/type/enum/namespace Foo …`
 * (→ `Foo`), in case a future build emits those forms instead of the bundled
 * `export { … }`. Comments are stripped first so a `//`/`/* *​/` inside a body
 * cannot inject a false name.
 *
 * Returns a SORTED, de-duplicated array — order-independent, so a harmless
 * re-ordering of the emitted export list is NOT a diff, but a dropped/renamed
 * name IS.
 */
function exportNamesFromDts(text) {
  const src = stripComments(text);
  const names = new Set();

  // `export { … }`, `export type { … }`, and either with a `from '…';` clause
  // (possibly multi-line). The optional block-level `type` keyword is matched and
  // ignored — the export NAMES are what matter.
  const blockRe = /export(?:\s+type)?\s*\{([\s\S]*?)\}/g;
  for (const block of src.matchAll(blockRe)) {
    for (const rawSpec of block[1].split(',')) {
      // Drop a leading `type ` modifier (`type Foo`, `type x as Foo`).
      const spec = rawSpec.trim().replace(/^type\s+/, '');
      if (!spec) continue;
      // An alias (`x as Foo`) re-exports under the right-hand name.
      const asMatch = spec.match(/\bas\s+([A-Za-z_$][\w$]*)\s*$/);
      const name = asMatch ? asMatch[1] : spec;
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  // `export default …;` → the public name is `default`.
  if (/(^|[\s;])export\s+default\b/.test(src)) names.add('default');

  // Direct `export declare …` / `export <decl> Foo …` forms (defensive).
  const declRe =
    /export\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|const|let|var|class|interface|enum|namespace|type)\s+([A-Za-z_$][\w$]*)/g;
  for (const decl of src.matchAll(declRe)) names.add(decl[1]);

  return [...names].sort();
}

/**
 * Strip `//` line comments and `/* *​/` block comments so identifiers inside a
 * doc-comment body cannot be parsed as export names. Conservative: it does not
 * try to honour comment-like sequences inside string literals, which `.d.ts`
 * export statements do not contain.
 */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * The .d.ts files to snapshot: every published entry point (from `exports`), plus
 * every OTHER `.d.ts` in dist (the shared type chunks the entries import, e.g.
 * `status-*.d.ts`). A shared chunk carries part of the public surface, so a change
 * to it must show in the report too. The entry points come first (most-read), in
 * `exports` order; then any remaining chunks, sorted so the report is stable.
 */
function dtsFiles() {
  const all = new Set(readdirSync(DIST).filter((f) => f.endsWith('.d.ts')));
  const entries = entryDtsFromExports().filter((f) => all.has(f));
  const entrySet = new Set(entries);
  const chunks = [...all].filter((f) => !entrySet.has(f)).sort();
  return [...entries, ...chunks];
}

/**
 * The chunk-import hash in `dist/status-<hash>.{js,d.ts}` is build-deterministic
 * for a given source but is otherwise an implementation detail. Normalize it to a
 * stable placeholder — in BOTH the import specifiers inside the `.d.ts` bodies AND
 * the section-heading chunk filenames — so a harmless chunk re-hash does not show
 * as a spurious public-API diff (the SHAPES, not the chunk filename, are the
 * contract). Matches the hash before either extension.
 */
function normalizeChunkHashes(text) {
  return text.replace(/status-[A-Za-z0-9_-]+(?=\.(?:d\.ts|js))/g, 'status-<chunk>');
}

function buildReport() {
  const lines = [];
  lines.push('## API Report — `solid-offline`');
  lines.push('');
  lines.push(
    '> Generated by `scripts/api-report.mjs` — the full emitted `dist/*.d.ts` (the as-published',
  );
  lines.push(
    '> type contract). Do NOT edit by hand: run `npm run build && npm run api:report`. A diff here',
  );
  lines.push('> is a deliberate, reviewed PUBLIC-API change. Chunk-hash filenames are normalized.');
  lines.push('');

  // The explicit public export-NAME set per `exports` subpath (the belt-and-braces
  // half). A dropped/renamed export changes a list here on its own clean line, so it
  // cannot be masked by a chunk-body diff. Subpaths in `exports` order; names sorted.
  lines.push('### Public exports per `package.json` subpath');
  lines.push('');
  lines.push(
    '> Parsed from each entry `.d.ts` `export { … }` set (alias/`type`-modifier resolved). A',
  );
  lines.push(
    '> removed or renamed export shows as a diff here, independent of the chunk bodies below.',
  );
  lines.push('');
  for (const { subpath, dts } of entryPointsFromExports()) {
    const path = join(DIST, dts);
    const names = existsSync(path) ? exportNamesFromDts(readFileSync(path, 'utf8')) : [];
    lines.push(
      `- \`${subpath}\` (\`dist/${dts}\`): ${names.length ? names.map((n) => `\`${n}\``).join(', ') : '_(no named exports)_'}`,
    );
  }
  lines.push('');

  for (const file of dtsFiles()) {
    const raw = readFileSync(join(DIST, file), 'utf8');
    lines.push(`### \`dist/${normalizeChunkHashes(file)}\``);
    lines.push('');
    lines.push('```ts');
    lines.push(normalizeChunkHashes(raw).trimEnd());
    lines.push('```');
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

/**
 * The CLI body — generate or `--check` the report. Guarded behind an
 * is-this-the-entry-module check so importing this file (e.g. a unit test of the
 * pure parsers `exportNamesFromDts` / `normalizeChunkHashes`) does NOT touch the
 * filesystem or `process.exit`.
 */
function main() {
  if (!existsSync(DIST)) {
    console.error('dist/ not found — run `npm run build` before generating the API report.');
    process.exit(1);
  }

  const report = buildReport();
  const isCheck = process.argv.includes('--check');

  if (isCheck) {
    let committed = '';
    try {
      committed = readFileSync(REPORT_PATH, 'utf8');
    } catch {
      committed = '';
    }
    if (committed !== report) {
      console.error(
        'API report is stale. The public API changed (or dist was rebuilt).\n' +
          'Review the diff, then regenerate: npm run build && npm run api:report',
      );
      // Show the diff for convenience (best-effort).
      const tmp = join(ROOT, 'etc', '.solid-offline.api.expected.md');
      try {
        mkdirSync(dirname(tmp), { recursive: true });
        writeFileSync(tmp, report);
        const diff = spawnSync('git', ['--no-pager', 'diff', '--no-index', REPORT_PATH, tmp], {
          cwd: ROOT,
          encoding: 'utf8',
        });
        if (diff.stdout) console.error(diff.stdout);
      } catch {
        /* diff is best-effort */
      }
      process.exit(1);
    }
    console.log('API report matches the committed contract.');
  } else {
    mkdirSync(dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, report);
    console.log(`Wrote ${REPORT_PATH}`);
  }
}

// Run the CLI only when invoked directly (`node scripts/api-report.mjs`), not
// when imported by a test. `process.argv[1]` is the invoked script path.
const invokedAsScript =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) main();

export { entryPointsFromExports, exportNamesFromDts, normalizeChunkHashes };
