<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-vr37 — CON-L3 lane report

Branch: `lane/sst-vr37`. Base: `8865b4b3e01bdb91ab0f102683e0833f786c65cf`.
Scope: pure contact-list library in `apps/suite/src/apps/contacts/lib/list/`.

## Commits

- `3a291079` — `docs: record contact list interpretations`: numbered spec questions
  and conservative policies in `QUESTIONS.md`.
- `d54f2893` — `feat: add contact list sections and ranked search`: typed projection
  and errors; locale-aware sections and name ordering; grapheme initials and stable
  15-hue indices; ranked multi-term search with original-field highlight offsets;
  public barrel/API documentation; synthetic unit tests; coverage glob.
- Final `docs: record contact list lane results` commit — this report.

## Validation

All commands ran inside this checkout; no network fetch, branch switch, push or PR.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; generated the workspace dependency's ignored declarations/assets. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/contacts-list.test.ts --coverage.include='src/apps/contacts/lib/list/**/*.ts'` | PASS; 15 tests, 100% statements (216/216), branches (158/158), functions (41/41), lines (183/183) across the directory. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS after the final implementation; 28 test files, 1,192 tests, 100% across all coverage includes. Lint emitted 21 existing money-library/test warnings; no new warnings. |
| `pnpm run lint:root` | PASS, including workspace/layer/fetch guards and 74 contrast pairs with zero failures. |
| `git -c commit.gpgsign=false -c user.name='Jesse Wright' -c user.email=63333554+jeswr@users.noreply.github.com merge --no-edit origin/main` | PASS before final gates: already up to date. The existing local `origin/main` equals the supplied base. No remote was contacted. |
| `TURBO_SCM_BASE=8865b4b3e01bdb91ab0f102683e0833f786c65cf pnpm run gate` | PASS; 7/7 Turbo tasks, including 686 root tests and the complete app gate. |
| `pnpm run gate:full` | FAIL (exit 1); 270 successful / 343 total Turbo tasks before termination. Only reported failing task: `@jeswr/federation-codegen#test`, with two pre-existing namespace/fixture mismatches described below. |
| `git diff --check` | PASS. |

An initial standalone app typecheck failed because this fresh checkout had no built
`@jeswr/suite-ui` declarations. Building that dependency resolved it; the complete
ordered app gate above then passed. The initial focused coverage run identified an
unnecessary section-comparator branch; the implementation was simplified and all
final focused/full-app coverage checks passed without coverage exclusions.

## Full-workspace gate limitation

`tools/federation-codegen/test/generator.test.ts` fails these two cases:

1. `projects the bookmarks node shape into typed cardinalities and RDF term kinds`:
   expects `https://w3id.org/jeswr/sectors/bookmarks#Bookmark`, receives
   `https://jeswr.org/ns/sectors/bookmarks#Bookmark`.
2. `uses only ontology and SHACL inputs and reproduces every committed output byte`:
   committed generated ontology still uses `w3id.org`; current ontology uses `jeswr.org/ns`.

Confirmed the same mismatch in the supplied base with `git show` for the test,
`packages/solid-federation-vocab/sectors/bookmarks/bookmarks.ttl` and
`tools/federation-codegen/generated/bookmarks-sector/ontology.ttl`.
`git diff 8865b4b3e01bdb91ab0f102683e0833f786c65cf -- tools/federation-codegen packages/solid-federation-vocab`
is empty. These unrelated files were left unchanged to respect lane scope. The
workspace gate therefore cannot be reported green; the app and affected gates pass.
Full-gate builds generated untracked callback/client-ID assets under eight pod web
apps; removed only those 16 newly generated files to restore the clean lane surface.
Logs are local only: `/tmp/sst-vr37-gate.log`, `/tmp/sst-vr37-gate-full.log`,
`/tmp/sst-vr37-lint-root.log`.

## Dependencies, UI and review

- No dependency or manifest/lockfile changes. `check:packages`: not applicable;
  no third-party package was added. Reused the existing contact-dedupe email/phone
  validators and Unicode case-folding table.
- Pure library only. No components, routes, React/hooks, RDF or I/O were added.
  Screenshots/Playwright/axe: not applicable; no UI was rendered or changed.
- `roborev status` could not run (exit 127: executable not installed). No automated
  roborev verdict is available in this lane; no review configuration was changed.
- Bead closure belongs to the dispatcher after integration; this lane made no tracker
  changes and touched no other checkout.

## Open questions and completion

The implementation is complete; full-workspace validation is limited by the
pre-existing federation-codegen failures above, and roborev is unavailable. The nonblocking spec choices are numbered in
`QUESTIONS.md`: structured-name projection and unnamed contacts, native-script
sections and tie handling, fuzzy policy/multi-term scoring, stable avatar hashing.
They are documented and tested, with no persisted-data or design changes.
