<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.21 fix round 1

Branch: `lane/sst-8xm.21`.
Fix-round base: `09b1cf6f57f81d60d0671a011458f782bc0dbf24`.
Review: `solid-sdk-lane-sst-8xm.21-09b1cf6f57f8.md`, finding 1 (high).

## Commits and security property

- `9f07d118` — `fix: preserve indeterminate ODRL prohibitions`: distinguish
  indeterminate membership from confirmed nonmembership internally. An otherwise
  applicable unresolved prohibition denies before conflict resolution, including
  with `conflict: "perm"`. Confirmed nonmembership, mismatched action/target/
  assignee, or another false conjunct still rules out the prohibition. The public
  boolean `constraintSatisfied` API and confirmed-match traces are preserved;
  the denial reason explains unresolved membership. Update the README, package
  skill, option documentation, and the original conservative interpretation.
- This final report commit — `docs: record sst-8xm.21 fix verification`.

The authorization property changed is that permission requires ruling out any
otherwise applicable prohibition whose recipient membership cannot be evaluated.
Missing resolvers, unknown collections, resolver/lookup exceptions, missing or
invalid recipients, and malformed membership operands can no longer disable such
prohibitions. Conservatively, an unresolved prohibition also denies when there is
no matching permission, and `perm` cannot override indeterminate evidence.

44 additional fixture tests cover unavailable evidence across all conflict
strategies, absence of a permission, malformed inputs, confirmed nonmembership,
rule scope, conjunction order, multiple prohibitions, delegated evaluation,
RDF round trips, and decision recording. Existing expectations for unresolved
prohibitions now require deny. The regression suite produced 38 failing cases
against the original evaluator; the fixed package passes 353 tests in 11 files.
No new public result status or dependency was introduced.

## Verification

Commands used Node `v24.22.1` and pnpm `10.4.1` with
`PATH=/opt/node24/bin:$PATH`. Dependency lifecycle scripts stayed disabled.

```sh
pnpm exec turbo run build --filter='@jeswr/solid-odrl^...'
pnpm --filter @jeswr/solid-odrl exec vitest run test/party-collection.test.ts
pnpm --filter @jeswr/solid-odrl run lint && pnpm --filter @jeswr/solid-odrl run build && pnpm --filter @jeswr/solid-odrl run typecheck && pnpm --filter @jeswr/solid-odrl run test
pnpm run lint:root
TURBO_SCM_BASE=09b1cf6f57f81d60d0671a011458f782bc0dbf24 pnpm run gate
pnpm run gate:full
```

- Dependency-first build: PASS (2 tasks).
- Targeted membership suite: PASS (96 tests).
- Package lint/build/typecheck/test gate: PASS (353 tests, 11 files).
  Lint retains the existing non-null-assertion warning in characterization.test.ts.
- Root lint: PASS; all workspace guards pass.
- Affected gate: FAIL (exit 1; 15 successful tasks out of 28 scheduled).
  The unchanged `@jeswr/app-issues#build` cannot download Geist and Geist Mono
  from Google Fonts in the sandbox. This reproduces the original lane blocker.
- Full-workspace gate: FAIL (exit 1; 50 successful tasks out of 223 scheduled),
  stopping at `//#test:root`: 164 failed / 736 passed tests in 4 failing and
  8 passing files. Failures are in unchanged root fixtures:
  `agent-layers-reachability.test.mjs` (1), `agent-layers.test.mjs` (6),
  `check-packages-guard.test.mjs` (2), and `check-sdk-layers.test.mjs` (155).
  Empty CLI output assertions and a timeout reproduce the original lane's
  failure categories. Root scripts, tests, guardrails, and the Issues app have
  no changes from the fix-round base; no unrelated fixes were attempted.
- `check:packages`: not applicable; no dependencies, manifests, or lockfiles changed.

## Review, unfinished work, and questions

The supplied high-severity finding is addressed. Adversarial self-review checked
unresolved evidence, confirmed nonmembership, conjunct ordering, rule scope,
conflict overrides, and truthful matched-rule traces. Automated per-commit review
remains unavailable: `roborev status` exits 127 (`roborev: command not found`).
No review tooling was installed. This security-critical change requires Jesse's
review before merge and must never be auto-merged.

No implementation work remains. Workspace verification and automated review
limitations are recorded above. No open questions remain; the conservative
choices for unresolved prohibitions are stated above and in QUESTIONS.md.

No pushes, PRs, branch changes, remote fetches/merges, publication, dependency
changes, secrets, or committed dist artifacts were involved. All new tests use
local fixtures and mocks. The existing Issues build attempted and failed to
access Google Fonts. Bead closure remains with the coordinating checkout.
