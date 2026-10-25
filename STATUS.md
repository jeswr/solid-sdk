<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-8xm.31 — T-010 lane report

Fix round 2 completed on `lane/sst-8xm.31`, resuming from `0de10647`.
Original implementation base: `219cdd5a1579a95a6408f272fe6344e72e2e8664`.

## Commits

Fix round 2:

- `41f07ef4` — `fix: bound and tokenize probe capability headers`: replace the media quoted-string
  regex with a single-pass scanner; enforce aggregate 8 KiB UTF-8 limits for Accept-Patch,
  Accept-Post, and Allow; lower-case WAC modes before recognition and deduplication; skip empty
  WAC list members; add regressions and document behavior.
- `docs: record probe header fix results` — this final STATUS.md update, edited last.

Earlier work retained:

- `0c61ebe6` — `fix: bound and tokenize Link header parsing`.
- `1050b824` — `fix: retain WAC permissions alongside extensions`.
- `0de10647` — `docs: record storage parser fix results`.
- `c4d49fb2` — `feat: define storage capability vocabulary and types`.
- `ae2c9249` — `feat: parse capability Link and probe headers`.
- `de23003c` — `docs: record storage capabilities lane results`.

## Gate results

The touched package's complete gate and root lint passed before the final report commit:

```sh
pnpm exec turbo run lint build typecheck test --filter=...@jeswr/storage-capabilities
pnpm run lint:root
```

- Scoped Turbo gate: 5 successful tasks (package lint/build/typecheck/test and root lint).
  This package has no workspace dependencies; the filter selects only storage-capabilities.
- Tests: 4 files, 103 tests passed (49 Link, 52 probe-header, 2 vocabulary/type-export tests).
- Coverage: 100% statements (193/193), branches (129/129), functions (13/13), lines (159/159).
  All four 100% thresholds remain enforced.
- The pathological-input regression passed its strict combined parsing-time assertion below
  50 ms. It exercises near-limit escaped quotes and backslashes with missing closing quotes,
  oversized fields, whitespace, and many empty WAC list members.
- Root lint passed, including lockfile transport, application workspace, and raw-fetch guards.
- Package lint passed again after adding provenance comments.
- Test-source TypeScript check passed, run from `packages/storage-capabilities`:

```sh
pnpm exec tsc --ignoreConfig --noEmit --strict --skipLibCheck --target ES2023 --module NodeNext --moduleResolution NodeNext --lib ES2023,DOM,DOM.Iterable src/*.test.ts
```

`pnpm run gate` was also attempted. Root lint and the 26 root tests passed, but the broader
run failed in untouched `@jeswr/unstorage-solid#build`: its dependency bootstrap invokes
`npm install`, which failed with EROFS while writing `/home/runner/.npm/_cacache`.
The run stopped at 13 successful tasks out of 115. The existing bootstrap also invoked an
external fetch-rdf clone before that failure; this indirect side effect was discovered in
the gate log afterward. No further broad gate was attempted: `gate:full` would include the
same failing bootstrap and repeat the external clone, outside this lane's authorized scope.
The gate log is `/tmp/sst-8xm.31-gate.log` (local, uncommitted).

`git diff --check` passed. Generated build and coverage outputs remain ignored.

## Regex audit

Audited the package's TypeScript sources and configuration. The removed media quoted-string
replacement in `src/probe-headers.ts` used repeated quoted-string alternatives and could retry
from successive quote positions on malformed input. Its replacement advances one cursor once,
tracking quoted strings and escaped characters without retrying earlier input.

Remaining regexes, none containing nested quantifiers:

- `src/probe-headers.ts`: sticky WAC group matching uses a sequence of single character-class
  repetitions with distinct delimiters; whitespace splitting uses one repeated class; mode
  validation is an anchored single repeated token class. Empty list members advance explicitly.
- `src/link.ts`: token validation checks one anchored character; target/control validation uses
  single character classes; relation whitespace splitting uses one repeated class. Link member
  parsing already uses a deterministic tokenizer from fix round 1.
- No other package regexes require conversion. Test/config glob strings are not regexes.

## Scope and conservative choices

- Limits apply to each combined Accept-Patch, Accept-Post, or Allow field, including commas
  inserted between repeated values. Exactly 8192 UTF-8 bytes is accepted; any greater total
  leaves the observation absent. Raw evidence remains intact, and other fields still parse.
- Huge strings are rejected by length before encoding, and repeated values are bounded before
  joining or parsing. The existing Link limits are unchanged.
- An unterminated media parameter quote discards that member and the remainder of its combined
  field, preserving earlier complete members. This conservative choice avoids inferring list
  boundaries inside an unfinished quote.
- WAC modes are validated as tokens before case normalization, then recognized and deduplicated
  in advertisement order. Unknown extensions remain ignored; malformed nonempty members still
  invalidate the complete WAC field. An empty-only WAC field remains unknown, preserving the
  previous behavior while accepting empty members around actual groups.
- No dependencies, manifests, lockfile, public exports, or tracker state changed. Discovery,
  network probing, feature derivation, caches, and fixtures remain outside this fix round.

## Unfinished work, blockers, and open questions

- All three supplied review findings are addressed. No implementation work or open questions
  remain within the brief.
- Automated commit review could not run: `command -v roborev` found no executable. The dispatcher
  must obtain the mandated review before merge; full-workspace verification is also incomplete
  because of the unrelated bootstrap failure above.
- The referenced `briefs/sst-8xm.31.md`, `.fix1.md`, and planning ADRs are not present in this
  checkout. Implementation used the supplied fix brief, package guidance, and prior lane report.
- No push, PR, branch switch, manual remote fetch/merge, dependency addition, or deployment occurred.
  Lane claim/merge/close tracking remains with the dispatcher.
