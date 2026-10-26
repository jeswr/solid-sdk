<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-jhl3 — fix round 3

Branch: `lane/sst-jhl3`.
Base: `917d3be9c7967622829adc43c1aaabb0964ec993`.
Resumed at: `d29dc64101d205793c403429e21f107117c8d450`.
Review: `solid-sdk-lane-sst-jhl3-d29dc64101d2.md`, read in full alongside
the original brief and fix rounds 1–3.

## Changes by commit

- `057dd5a1` — `fix: validate assertion language tags`: reject malformed
  language tags before assertion canonicalization and serialization. Regressions
  cover malformed subtags, control characters, an injection payload, and valid
  language/plain-string literals through build → TriG → parse.
- `da0ffe86` — `fix: preserve local assertion dateTimes`: accept valid
  timezone-less assertion and template dateTimes without changing their lexical
  values, including fractional precision. Require timezones on evidence, worker,
  source and publication timestamps. Cover raw datasets, Turtle and TriG.
- `230f24e5` — `fix: discover nanopub heads from graph links`: discover
  candidates through component links in the nanopub's own named graph, then
  validate its local type and mandatory links. Allow ordinary nanopublication
  type statements in assertion and entity graphs, including blank subjects and
  self-named data graphs. Retain malformed structural-head rejection coverage.
- `29d4f0d4` — `fix: reject missing literal language tags`: also reject
  `rdf:langString` literals with empty language tags before hashing or building.
- `d414d528` — `fix: validate temporal calendar values`: check Gregorian month
  lengths, leap years, clock components and timezone ranges before emitting
  temporal literals. Cover impossible dates, century leap rules, invalid
  month/day bounds, offset boundaries, end-of-day values, valid precision
  preservation, evidence timestamps and parsed publication timestamps.
- `docs: record third review fixes` — this final STATUS-only commit.

Only the four reviewed findings and their regression tests were changed.
Both integrator design calls are implemented: timezone-less assertion dateTimes
remain unchanged, and ordinary nanopublication type statements are data.
Calendar validation retains the existing four-digit date/year template syntax.
Clock and offset constraints were checked against the
[XSD 1.1 dateTime lexical rules](https://www.w3.org/TR/xmlschema11-2/#dateTime).

## Validation

Node `v24.22.1`, pnpm `10.4.1`. Checks ran before the final commit:

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/rdf-serialize run build` | PASS; build workspace dependency declarations first. |
| `pnpm --filter @jeswr/pkg-memory run lint && pnpm --filter @jeswr/pkg-memory run build && pnpm --filter @jeswr/pkg-memory run typecheck && pnpm --filter @jeswr/pkg-memory run test` | PASS; 4 test files, 177 tests. Coverage: 100% statements (530), branches (402), functions (64), and lines (445). Test log: `/tmp/sst-jhl3-fix3-package-tests.log`. |
| `pnpm run lint:root` | PASS, exit 0; Biome and transport/workspace/fetch guards. Log: `/tmp/sst-jhl3-fix3-lint-root.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate` | PASS, exit 0; all 7 tasks, including 177 package tests and 26 root tests. Log: `/tmp/sst-jhl3-fix3-gate.log`. |
| `PATH=/tmp/sst-jhl3-bin:$PATH pnpm run gate:full` | FAIL, exit 1; existing `@jeswr/unstorage-solid#build` invokes a GitHub clone. The temporary git guard refuses it with exit 97 before any clone runs. 16 successful / 52 reported tasks. Log: `/tmp/sst-jhl3-fix3-gate-full.log`. |
| `git diff --check` | PASS. |
| `roborev status` | Unavailable, exit 127: `roborev: command not found`. No automated review verdict is claimed. |

Targeted regression runs exposed failures before fixes. In particular, six
timezone-less dateTime tests, four head-discovery tests, 27 calendar tests and
the empty-language-tag test failed before their respective fixes. Diagnostic
logs are `/tmp/sst-jhl3-fix3-datetime-red.log`,
`/tmp/sst-jhl3-fix3-head-red.log`, `/tmp/sst-jhl3-fix3-calendar-red.log`, and
`/tmp/sst-jhl3-fix3-empty-language-red.log`. All final tests pass.
Existing independent Python ID and complete-dataset parity fixtures still pass;
no fixture regeneration or private data was needed.

No dependencies or manifests changed; no dependency policy check or installation
was needed. Lifecycle scripts remained disabled. No push, PR, branch switch,
network git operation, publishing, or other checkout edit occurred. The temporary
git guard was reused from the preceding lane round; repository build helpers were
not modified.

## Unfinished work and open questions

All four review findings are fixed with regression coverage. Full-workspace gate
completion remains blocked by the unrelated clone helper, and per-commit roborev
review remains unavailable in this sandbox. No product work or open question
remains for this fix brief.
