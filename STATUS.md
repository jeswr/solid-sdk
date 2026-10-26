<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-8xm.21 lane report

Branch: `lane/sst-8xm.21`.
Base: `93afe9d606533fc0b36ab314423d2f0b73e528e6`.

## Commits

- `ddffe298` — `feat: resolve ODRL recipient collection membership`: standard
  `ODRL_IS_PART_OF`/operator maps and public API report; synchronous injected
  membership resolution in evaluation, permission matching, duties, delegation,
  and decision-record attribution; typed RDF parsing and serialization guards;
  52 fixture tests.
- `3923b39f` — `docs: document ODRL party collection evaluation`: README, new
  package SKILL.md, and conservative interpretations in QUESTIONS.md.
- This final report commit — `docs: record sst-8xm.21 lane status`.

## Security property and evidence

The changed authorization property is that a `recipient isPartOf <collection>`
permission can match only when a caller-supplied resolver positively confirms
that one absolute recipient IRI belongs to one absolute PartyCollection IRI.
Membership uses exact lexical IRI equality. The evaluator performs no fetching.
Missing resolvers, unknown/empty collections, resolver exceptions, non-members,
non-IRI/array recipients, unsupported left operands, and malformed collection
operands cannot satisfy the constraint. Existing conflict and duty semantics
remain in force.

Typed RDF parsing retains malformed membership as an unsatisfied constraint;
it cannot silently drop the constraint and widen a permission. Both policy
serializers reject malformed membership forms, including one-element arrays and
literal datatypes that could otherwise become a satisfiable IRI after a round
trip. Decision records preserve the standard operator and collection IRI and use
the same stable resolver snapshot to identify the actual anonymous deciding rule.

The 52 new tests cover member permits, non-member/default denials, absent/unknown/
empty/throwing resolvers, exact recipient identity, non-HTTP IRIs, malformed RDF
term types/cardinality, serialization rejection, conjunction with other constraints,
member prohibitions (including a conflicting permission), required duties and
obligations, delegation authorization/scope/leaf checks, Turtle and JSON-LD round
trips, and RDF/JSON-LD decision-record attribution. The initial 34-test regression
suite failed 14 tests before implementation; the final package suite passes all
309 tests across 11 files, including the existing characterization snapshots.

## Verification

Commands used Node `v24.22.1` and pnpm `10.4.1`, with
`export PATH="/opt/node24/bin:$PATH"`. Dependency lifecycle scripts remained disabled.

```sh
pnpm exec turbo run build --filter='@jeswr/solid-odrl^...'
pnpm --filter @jeswr/solid-odrl run lint && pnpm --filter @jeswr/solid-odrl run build && pnpm --filter @jeswr/solid-odrl run typecheck && pnpm --filter @jeswr/solid-odrl run test
pnpm run lint:root
TURBO_SCM_BASE=93afe9d606533fc0b36ab314423d2f0b73e528e6 pnpm run gate
pnpm run gate:full
pnpm run test:root
pnpm --filter @jeswr/solid-odrl run api:report
pnpm --filter @jeswr/solid-odrl exec api-extractor run -c config/api-extractor.json
```

- Dependency-first build: PASS (2 tasks).
- Package lint/build/typecheck/test chain: PASS; 309 tests in 11 files.
  Lint retains one existing non-null-assertion warning in characterization.test.ts.
- Root lint: PASS; workspace/layer/transport/deployment/fetch/token/contrast guards pass.
- Affected gate: FAIL (exit 1; 17 successful tasks out of 28 scheduled).
  The unchanged `@jeswr/app-issues#build` cannot download Geist and Geist Mono
  from Google Fonts in this sandbox (`next/font` / Turbopack errors). The package's
  309 tests also passed inside this gate before it stopped.
- Full-workspace gate: FAIL (exit 1; 58 successful tasks out of 227 scheduled),
  stopping at `//#test:root`: 174 failed / 726 passed tests across 5 failing and
  7 passing files. Failures are in unchanged root CLI/guard fixtures (empty CLI
  output assertions and timeouts), outside this package. Root scripts, fixtures,
  guardrails, and the Issues app are unchanged from the supplied base commit.
- Isolated root test diagnostic: FAIL (exit 1; 162 failed / 738 passed tests,
  4 failing / 8 passing files). The CLI/guard output assertions reproduce without
  concurrent Turbo builds; this is an unresolved workspace verification blocker.
- API report generation and check: PASS. The existing report's CRLF format is preserved.
- `check:packages`: not applicable; no dependencies or manifests changed, so no
  dependency policy check or lockfile update was needed.

## Review, unfinished work, and questions

Adversarial self-review covered the new membership trust boundary, malformed RDF
constraint stripping, serializer round-trip widening, and anonymous audit-rule
selection. Automated per-commit review is unavailable in this sandbox:
`roborev status` exits 127 (`roborev: command not found`), so no roborev verdicts
were available to read. Jesse must review this security-critical change before
merge; it must never be auto-merged. No review tooling or dependencies were installed.

No implementation work remains. Workspace gate clearance and automated review
remain blocked as described above. The conservative choices are documented in
[QUESTIONS.md](QUESTIONS.md): preserve `notApplicable` when no rules match
(enforcement callers default deny), and let the injected resolver identify the
PartyCollection rather than require an in-policy RDF type declaration. No blocking
specification questions remain.

No pushes, PRs, git remote fetches/merges, publication, credentials, dependency
changes, or committed dist artifacts were involved. The new tests use fixtures
and mocks with no external API calls; the workspace gate's existing Issues build
attempted and failed to download Google Fonts as reported above. Bead closure
remains with the coordinating checkout after merge.
