<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-c871 — Unicode tokenization fix round 1

Implemented on `lane/sst-c871`, starting at
`ffc49f992332e732e50874875a7b7a077019b00a`. Addresses the single Unicode
tokenization finding in the supplied review.

## Commits

- `50e4e0e0` — original search index implementation (previous round).
- `ffc49f99` — original lane validation report (previous round).
- `2acfffa0` — `fix(suite): segment normalized search text`: fold source graphemes,
  map normalized UTF-16 units to original grapheme bounds, then segment normalized
  words. Supports compatibility expansions and mark removal that change word
  boundaries. Updates the earlier rejection policy in `QUESTIONS.md` and adds
  regression coverage for token offsets, matching, add/update/restore and snippets.
- `docs(suite): record Unicode fix validation` — this final report commit.

## Validation

All commands ran in this checkout. No manifest/lockfile changes or dependencies
were added, so `check:packages` is not applicable. This is a pure library fix; no
UI changes, Playwright runs or screenshots were required.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; build the existing workspace dependency first. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; lint, Next.js production build, strict typecheck, 350 tests across 11 files. |
| `pnpm run lint:root` | PASS; workspace/layer/transport guards, fetch check, tokens and all 74 contrast pairs. |
| `TURBO_SCM_BASE=ffc49f992332e732e50874875a7b7a077019b00a pnpm run gate` | PASS; 7/7 tasks, no cache hits. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full` | INTERRUPTED (exit 130); Turbo's strict environment filtered the protocol guard; see incident below. |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose` | FAIL; 176 successful tasks out of 251 before the unrelated `@jeswr/federation-codegen#test` failure. |
| `git diff --check` | PASS before both fix-round commits. |

The search directory retains **100% statements, branches, functions and lines**
for executable code, enforced by the existing per-file thresholds. The barrel
contains only re-exports. There are now 98 search tests (18 more than the previous
round). Regression fixtures include `Use ½ cup milk`, Thai `สำหรับ`, Japanese
`がっこう` / `かっこう`, Arabic phrase ligatures, square kilogram, expansions
inside words, combining marks and supplementary letters. Tests check equivalence
with normalized queries and exact UTF-16 offsets into original snippet text.

## Gate limitation and review

The full gate's two federation-codegen failures concern existing namespace drift:
the bookmarks shape and regenerated ontology use `https://jeswr.org/ns/...`,
while test expectations and committed generated fixtures use
`https://w3id.org/jeswr/...`. These paths are outside the requested fix and were
not changed. Remaining full-workspace tasks did not complete.

The first full-gate attempt unintentionally invoked the existing unstorage-solid
build script's remote clone before I noticed that Turbo had filtered
`GIT_ALLOW_PROTOCOL`. This violated the lane's remote-clone restriction. I stopped
that run and removed its temporary clone at `/tmp/fetch-rdf-build-SW4Ve2`.
The retry used `--env-mode=loose` to preserve the protocol guard for child tasks.

`roborev` remains unavailable (`command -v roborev` found no CLI), so automated
per-commit review must be run by the dispatcher. No review tooling was installed.

## Unfinished / open questions

The requested Unicode finding is fixed. No new open questions. The conservative
offset policy covers complete original graphemes; words expanded from one source
grapheme can share or overlap source ranges. Existing unrelated defaults remain
documented in `QUESTIONS.md`.
