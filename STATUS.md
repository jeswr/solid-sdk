<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-kfx.3 — fix round 1

Commit `03509d63` fixes the single punctuation regression reported against
`0b6c79ac`. The parser normalizes one leading punctuation separator supported by
Chrono before validating the complete merged week suffix. Both `this week, at 5pm`
and `this week, 9am on Saturday` now produce timed due values. Unsupported merged
qualifiers still throw `RangeError`; the existing Sunday-based week is retained.

Fourteen added regression cases cover supported punctuation, whitespace, both
English locales, preserved date text, original spans, and rejected comma-prefixed
qualifiers. Eight of the new positive cases reproduced the failure before the fix.

Validation used Node 24 and the existing dependencies. The brief's `@jeswr/suite`
filter matches no project; the actual package name is `@jeswr/app-suite`. Workspace
dependencies were built before the successful typecheck and package test run.

- `pnpm --filter @jeswr/app-suite run lint`: passed (existing warnings).
- `pnpm --filter @jeswr/app-suite run typecheck`: passed.
- `pnpm --filter @jeswr/app-suite run test`: passed, 173 files / 9,181 tests,
  with 100% statements, branches, functions, and lines reported by coverage.
- `pnpm run lint:root`: passed.
- Focused quick-add tests: 300 passed.
- `pnpm run gate:full`: failed after 308 successful tasks. The suite application
  build stopped in unchanged shared font handling (`packages/suite-ui/dist/fonts.js`):
  `next/font`'s Google font loader threw
  `TypeError: Cannot read properties of null (reading '1')`. The full-workspace
  gate therefore remains unsuccessful. Root tests passed within this run.

The requested parsing fix is complete. Roborev is unavailable in this environment,
so automated per-commit review remains unperformed. Open questions: none.
