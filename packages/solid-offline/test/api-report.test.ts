// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate; see docs/MODEL-PROVENANCE.md
/**
 * The `api:check` export-NAME parser (`scripts/api-report.mjs#exportNamesFromDts`).
 *
 * `api:check` snapshots the full `dist/*.d.ts` chunk content AND — the
 * belt-and-braces half — pins the SET of public export NAMES per `exports`
 * subpath, so a dropped/renamed PUBLIC export FAILS the gate on a clean,
 * unambiguous line. These tests pin the PARSER that derives that set, across the
 * emitted `.d.ts` export forms — most importantly the block-level type-only
 * `export type { … }` form, which a `.d.ts` emitter may use and which the parser
 * must NOT silently miss (else type-only public exports vanish from the gate's
 * name set without failing it).
 */
import { describe, expect, it } from 'vitest';
// The script is ESM with its CLI body guarded behind an is-entry-module check,
// so importing it here is side-effect-free (no fs / process.exit).
import { exportNamesFromDts } from '../scripts/api-report.mjs';

describe('exportNamesFromDts — public export-name parsing', () => {
  it('parses the inline value/type form `export { A, type B, c as C }`', () => {
    const dts = `export { Foo, type Bar, baz as Qux } from './chunk.js';`;
    expect(exportNamesFromDts(dts)).toEqual(['Bar', 'Foo', 'Qux']);
  });

  it('parses the BLOCK-LEVEL type-only form `export type { Foo, Bar as Baz }`', () => {
    // This is the regression roborev flagged: a `.d.ts` emitter can switch to
    // `export type { … }` (the `type` keyword BEFORE the brace). The parser must
    // still capture these names — else they silently drop out of the gate.
    const dts = `export type { Foo, Bar as Baz } from './chunk.js';`;
    expect(exportNamesFromDts(dts)).toEqual(['Baz', 'Foo']);
  });

  it('resolves aliases to the re-exported (right-hand) name', () => {
    const dts = 'export { a as OfflineStatusSnapshot, c as createStatusSurface };';
    expect(exportNamesFromDts(dts)).toEqual(['OfflineStatusSnapshot', 'createStatusSurface']);
  });

  it('returns no names for an empty export block', () => {
    expect(exportNamesFromDts('export {  }')).toEqual([]);
  });

  it('does NOT pick up names from an `import { … }` statement', () => {
    const dts = `import { O as Secret } from './chunk.js';\nexport { Public };`;
    const names = exportNamesFromDts(dts);
    expect(names).toContain('Public');
    expect(names).not.toContain('Secret');
  });

  it('handles a multi-line export block', () => {
    const dts = 'export {\n  Alpha,\n  type Beta,\n  gamma as Gamma,\n};';
    expect(exportNamesFromDts(dts)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('handles direct declaration forms (defensive)', () => {
    const dts = [
      'export declare function doThing(): void;',
      'export interface Shape { x: number }',
      'export type Alias = string;',
      'export declare const VALUE: number;',
    ].join('\n');
    expect(exportNamesFromDts(dts)).toEqual(['Alias', 'Shape', 'VALUE', 'doThing']);
  });

  it('records a default export as `default` (defensive)', () => {
    expect(exportNamesFromDts('declare const x: number;\nexport default x;')).toEqual(['default']);
  });

  it('does not treat identifiers inside comments as exports', () => {
    const dts = '// export { NotReal }\n/* export { AlsoNotReal } */\nexport { Real };';
    const names = exportNamesFromDts(dts);
    expect(names).toEqual(['Real']);
  });

  it('de-duplicates a name re-exported under the same identifier twice', () => {
    const dts = `export { Foo } from './a.js';\nexport { Foo } from './b.js';`;
    expect(exportNamesFromDts(dts)).toEqual(['Foo']);
  });
});
