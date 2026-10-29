<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-u7l6 — SKL-03 lane status

Branch: `lane/sst-u7l6`. Base: `8811b8e28d6187950d0b2a363882338d2ad4e77b`.
Specification: the full `specs/skills/DESIGN.md` and `tasks.json`, read from the
local `solid-suite-planning` checkout; W9 secret categories from `specs/mcp/DESIGN.md` §6.

## Commits

- `2c448502` — `chore(skills): align metadata with validation rules`: fix nine
  description prefixes and the fetch-rdf skill name, distinguish the shared
  `solid-offline-patterns` guide from the package skill, update the recipe test,
  and record specification questions.
- `d519ec7c` — `feat(skills): validate skills and check generated index`: add the
  checker, 52 fixture tests, deterministic 57-skill index, root lint integration,
  parser dependencies, and README instructions.
- The final `docs:` commit records this status after validation and cleanup.

## Validation

| Exact command | Result |
| --- | --- |
| `pnpm run check:packages js-yaml marked` | PASS, full npm policy/existence/age checks for both packages. |
| `pnpm add -Dw js-yaml@4.3.0 marked@17.0.6 --ignore-scripts` | PASS. Root development declarations reuse versions already in the lockfile. Unrelated lockfile refreshes were discarded. |
| `pnpm install --frozen-lockfile --offline --ignore-scripts` | PASS; manifest and lockfile agree. Lifecycle scripts remain disabled. |
| `pnpm run check:skills --write` | PASS; generated `skills/INDEX.md` for 57 shared, internal, and package skills. |
| `pnpm run check:skills` | PASS; index is current. |
| `pnpm exec vitest run test/check-skills.test.mjs` | PASS, 52 tests. |
| `pnpm run lint:root` | PASS, including the new read-only skills/index check; repeated after artifact cleanup and all package checks. |
| `TURBO_SCM_BASE=8811b8e28d6187950d0b2a363882338d2ad4e77b pnpm run gate` | FAIL: 181 successful / 232 total tasks; unchanged `@jeswr/federation-trust#test` snapshot mismatch (JWK key ordering). |
| `pnpm run gate:full` | FAIL: 291 successful / 350 total tasks, 85 cached; the same unchanged `@jeswr/federation-trust#test` snapshot mismatch. |

The affected gate's root Vitest run passed all 797 tests across 10 files.
Both workspace gates stop at `packages/federation-trust/test/characterization.test.ts:196`:
the embedded public JWK has property order `kty,crv,x` rather than the snapshot's
`crv,x,kty`. `git diff --exit-code 8811b8e28d6187950d0b2a363882338d2ad4e77b -- packages/federation-trust packages/solid-vc`
passes: both packages are unchanged from the lane base. The lane leaves their code and
snapshots untouched; the workspace gate remains blocked by that existing failure.
An earlier root run found the offline recipe test's old path after the guide rename;
that path was fixed in `2c448502` and the test now passes.

The dependency-first build command passed all 12 tasks (10 cached):

```sh
pnpm exec turbo run build --filter @jeswr/agentic-legacy-bridge... --filter @jeswr/personal-agent... --filter @jeswr/pkg-memory... --filter @jeswr/rdf-engine... --filter @jeswr/fetch-rdf... --concurrency=4
```

All four direct checks passed for each of the ten packages whose skill metadata changed.
Exact ordered commands (executed from this checkout):

```sh
for sdk_skill_package in agentic-legacy-bridge fetch-rdf personal-agent pkg-memory pod-access pod-auth pod-notifications rdf-engine storage-capabilities storage-client; do
  pnpm --filter "@jeswr/$sdk_skill_package" run lint && pnpm --filter "@jeswr/$sdk_skill_package" run build && pnpm --filter "@jeswr/$sdk_skill_package" run typecheck && pnpm --filter "@jeswr/$sdk_skill_package" run test
done
```

| Package | Lint | Build | Typecheck | Test |
| --- | --- | --- | --- | --- |
| `@jeswr/agentic-legacy-bridge` | PASS | PASS | PASS | PASS |
| `@jeswr/fetch-rdf` | PASS | PASS | PASS | PASS |
| `@jeswr/personal-agent` | PASS | PASS | PASS | PASS |
| `@jeswr/pkg-memory` | PASS | PASS | PASS | PASS |
| `@jeswr/pod-access` | PASS | PASS | PASS | PASS |
| `@jeswr/pod-auth` | PASS | PASS | PASS | PASS |
| `@jeswr/pod-notifications` | PASS | PASS | PASS | PASS |
| `@jeswr/rdf-engine` | PASS | PASS | PASS | PASS |
| `@jeswr/storage-capabilities` | PASS | PASS | PASS | PASS |
| `@jeswr/storage-client` | PASS | PASS | PASS | PASS |

Package skills additionally require coverage:

- `pnpm --filter @jeswr/agentic-legacy-bridge run test:coverage`: PASS, 650 tests.
- `pnpm --filter @jeswr/personal-agent run test:coverage`: PASS, 531 tests.

Generated untracked app `clientid.jsonld`/`callback.html` files were removed after the gates.
No generated distribution or coverage output is committed.
`git diff --check` passes; the final lane tree contains only committed task changes.

The checker uses full YAML and Markdown parsers to validate quoted/folded frontmatter,
reference-style links, nested destinations, images, and HTML links while ignoring fenced
examples. It scans companion references, scripts, and assets for forbidden paths and
W9-category secrets. Diagnostics never include YAML excerpts, link targets, or secret values.
Invalid skills cannot overwrite the generated index; default invocation never writes it.

## Scope, questions, and remaining work

`QUESTIONS.md` records the conservative interpretations of D1/D2/D4: retain both offline
guides with distinct names, align package metadata rather than add exceptions, and spell
out companion/secret scan boundaries. The shared guide's preferred name remains a
maintainer question; package APIs and implementation code are unchanged.

`roborev` is not installed in this sandbox, so per-commit review could not be queued or read.
No review configuration or hooks were installed. The dispatcher must obtain the mandated
review before merge. Tracker state was left to the dispatcher because this is a lane
checkout and the local beads skill forbids tracker writes from worktrees.

No pushes, PRs, publishing, remote git fetches/merges, real-home skill sync, or production
service calls were performed. Validation uses fixtures and the repository's own test suites.
The only added third-party declarations are the YAML/Markdown parsers required for D4;
both passed `check:packages`, and no new parser versions were introduced to the lockfile.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 2 — quoted HTML attributes

- `821b54af` — `fix(skills): tokenize HTML link attributes`: replace the HTML
  comment-removal and attribute-search pass with a tokenizer that consumes complete
  quoted values and distinguishes tags, comments, attribute names, and text. Only
  actual `href`/`src` attributes contribute links; quoted comment markers cannot hide
  later attributes.
- Add 12 regression cases for single/double quotes, apparent URLs inside other
  attributes or text, `data-href`, quoted `>`/comment markers, case-insensitive
  attribute names, and active broken URLs after quoted content. Ten cases fail on
  the previous implementation; all pass after the fix.
- The final `docs:` commit records these validation results. No dependencies added.

| Exact command | Result |
| --- | --- |
| `pnpm exec vitest run test/check-skills.test.mjs` | PASS, 96 tests. |
| `pnpm exec biome check scripts/check-skills.mjs test/check-skills.test.mjs` | PASS. |
| `pnpm run lint:root` | PASS; 57 skills and current generated index. |
| `TURBO_SCM_BASE=d4ac70cd5553de66b47e5db9abac9bcbafc6d1d2 pnpm run gate` | PASS on retry, all 841 root tests across 10 files. First attempt hit an unrelated 5000ms timeout in `test/agent-layers.test.mjs:509`. |
| `pnpm run gate:full` | FAIL, 327 successful / 373 total tasks; the previously recorded `@jeswr/federation-trust#test` JWK-order snapshot mismatch at `test/characterization.test.ts:196`. All 841 root tests pass here too. |
| `git diff --exit-code d4ac70cd5553de66b47e5db9abac9bcbafc6d1d2 -- packages/federation-trust packages/solid-vc` | PASS; the failing package and credential implementation are unchanged. |
| `git diff --check` | PASS. |

Removed the 16 generated app `clientid.jsonld`/`callback.html` files after the full
gate. No distribution output is committed. `roborev` remains unavailable in this
sandbox, so the dispatcher must obtain the mandated per-commit review before merge.
The review finding is addressed; no new open questions or implementation work remain
for this fix round. The unrelated full-gate failure remains outside this brief.

## Fix round 3 — decoded metadata and HTML URL whitespace

- `922f2967` — `fix(skills): scan decoded metadata and trim HTML URLs`: apply
  the existing secret checks to decoded names and descriptions before generating
  the index, retaining value-free diagnostics and placeholder handling. Normalize
  surrounding ASCII whitespace in HTML URL attributes after character-reference
  decoding and before URL classification or filesystem resolution.
- Add 29 regression cases covering escaped secret categories, folded descriptions,
  decoded names, placeholders, index creation/replacement safety, padded HTML URLs,
  and intentional filename spaces. Before the fix, 26 cases failed; afterward all
  125 checker tests pass. No dependencies or package implementations changed.
- The final `docs:` commit updates this status last.

| Exact command | Result |
| --- | --- |
| `pnpm exec vitest run test/check-skills.test.mjs` | PASS, 125 tests. |
| `pnpm exec biome check scripts/check-skills.mjs test/check-skills.test.mjs` | PASS. |
| `pnpm run lint:root` | PASS; 57 skills and current generated index. |
| `TURBO_SCM_BASE=d4ac70cd5553de66b47e5db9abac9bcbafc6d1d2 pnpm run gate` | PASS; all 870 root tests across 10 files. |
| `pnpm run gate:full` | FAIL, 290 successful / 351 total tasks; the previously recorded `@jeswr/federation-trust#test` JWK-order snapshot mismatch at `test/characterization.test.ts:196`. All 870 root tests pass here too. |
| `git diff --exit-code a954e4e5ff155658407a82492feff8dccfb19653 -- packages/federation-trust packages/solid-vc` | PASS; the failing package and credential implementation are unchanged from the start of this round. |
| `git diff --check` | PASS. |

This round touches root tooling only, so no individual package gates apply.
Removed the 16 app `clientid.jsonld`/`callback.html` files generated by the full
gate. No generated distributions are committed. `roborev` remains unavailable
in this sandbox; per-commit review remains with the dispatcher. Both review
findings are addressed, with no new open questions or unfinished implementation.
The existing full-workspace snapshot failure remains outside this brief.

## Fix round 4 — HTML text-element boundaries

- `7c875fba` — `fix(skills): respect HTML text element boundaries`: skip
  raw-text and RCDATA contents through the matching closing tag before resuming
  HTML attribute parsing. Apparent quoted attributes inside text cannot consume
  active links after the element closes. Opening-element URLs remain checked.
- Add 29 regression cases for textarea, title, script, style, xmp, iframe,
  noembed, and noframes, including unclosed content, closing-name boundaries,
  mixed case, whitespace, self-closing syntax, apparent comments, encoded
  markup, and opening URL attributes. All 29 fail before the fix; all 154
  checker tests pass afterward. No dependencies or package code changed.
- The final `docs:` commit updates this status last.

| Exact command | Result |
| --- | --- |
| `pnpm exec vitest run test/check-skills.test.mjs` | PASS, 154 tests. |
| `pnpm exec biome check scripts/check-skills.mjs test/check-skills.test.mjs` | PASS. |
| `pnpm run lint:root` | PASS; 57 skills and current generated index. |
| `TURBO_SCM_BASE=d4ac70cd5553de66b47e5db9abac9bcbafc6d1d2 pnpm run gate` | PASS; all 899 root tests across 10 files. |
| `pnpm run gate:full` | FAIL, 295 successful / 354 total tasks; the previously recorded `@jeswr/federation-trust#test` JWK-order snapshot mismatch at `test/characterization.test.ts:196`. All 899 root tests pass here too. |
| `git diff --exit-code b07bb8a9ddfd4b90194709935638035b2e74c3a1 -- packages/federation-trust packages/solid-vc` | PASS; the failing package and credential implementation are unchanged in this round. |
| `git diff --check` | PASS. |

This round touches root tooling only, so no individual package gates apply.
Removed the 16 app `clientid.jsonld`/`callback.html` files generated by the full
gate. No generated distributions are committed. `roborev` remains unavailable
in this sandbox; per-commit review remains with the dispatcher. The review
finding is addressed, with no new open questions or unfinished implementation.
The existing full-workspace snapshot failure remains outside this brief.

## Review follow-up at 73e142b7 — namespaces, definitions, and decoding

Starting commit: `73e142b790f7596a30ab6d8c571db15d119a943e`.

- `d073d60e` — `fix(skills): track foreign element namespaces`: track SVG,
  MathML, self-closing tags, and HTML integration points so foreign text-element
  names cannot suppress later active links. Preserve HTML text-element behavior.
- `3e4f1ba5` — `fix(skills): retain reference definition context`: retain
  definitions in document order through inert renderer placeholders, collecting
  them only outside HTML text content, comments, and attributes. Apply the same
  decoding and ASCII whitespace normalization to definitions and URL attributes.
- `e5e5b459` — `fix(skills): decode semicolonless HTML references`: accept
  semicolonless numeric references and the 106 legacy named references, preserving
  HTML attribute ambiguity rules, numeric replacement rules, and single-pass
  decoding. Extend the existing character-reference table from Python's standard
  library; no dependencies or manifests changed.
- Add 80 regression cases across the three findings. All 270 checker tests pass.
- The final `docs:` commit records this follow-up's validation and cleanup.

All validation below used Node `v24.22.1` through the available `/opt/node24/bin`
runtime. Root tooling is the only implementation surface changed, so no individual
package gates or dependency-policy checks apply.

| Exact command | Result |
| --- | --- |
| `PATH=/opt/node24/bin:$PATH pnpm exec vitest run test/check-skills.test.mjs` | PASS, 270 tests. |
| `PATH=/opt/node24/bin:$PATH TURBO_SCM_BASE=73e142b790f7596a30ab6d8c571db15d119a943e pnpm run gate` | PASS; root lint, 57 skills with current index, and all 1,015 root tests across 10 files. |
| `PATH=/opt/node24/bin:$PATH pnpm run gate:full` | FAIL, 298 successful / 358 total tasks, 1 cached; the previously recorded `@jeswr/federation-trust#test` JWK-order snapshot mismatch at `test/characterization.test.ts:196`. All 1,015 root tests pass here too. |
| `git diff --exit-code 73e142b790f7596a30ab6d8c571db15d119a943e -- packages/federation-trust packages/solid-vc` | PASS; both packages are unchanged in this follow-up. |
| `git diff --check` | PASS. |

Removed the 16 app `clientid.jsonld`/`callback.html` files generated by the full
gate. No generated distributions are committed. All three supplied findings are
addressed; no implementation work or new open questions remain. The existing
full-workspace snapshot failure remains outside this brief. `roborev` is still
unavailable in the sandbox, so the dispatcher must obtain per-commit review before
merge. Tracker state remains with the dispatcher; no pushes, PRs, branch changes,
or remote git fetches/merges were performed.

## Fix round 7 — companion symlinks, instructions, and URL controls

Starting commit: `d9697dc9a68803236b2c52ad505b8376b9ae01bb`.

- `7cb0e675` — `fix(skills): reject symbolic-link companions`: reject file,
  directory, hidden, nested, and dangling companion symlinks, including a linked
  package `references/` directory. Conservative policy: reject links rather than
  traverse their targets. Diagnostics omit targets; validation preserves an existing
  index and cannot create an index when a companion is rejected.
- `20c43dda` — `fix(skills): consume processing instructions`: consume `<?`
  instruction data through the next `>` or EOF before scanning more tags. Apparent
  tags inside instructions cannot hide active links or produce false link errors.
  Quoted attributes, text elements, and foreign CDATA retain their existing behavior.
- `123dc612` — `fix(skills): trim URL boundary controls`: trim U+0000–U+0020
  after character-reference decoding, preserving percent escapes until filesystem
  resolution. Embedded tabs/newlines keep their existing normalization.
- Add 65 regression cases: nine symlink cases, 16 instruction cases, and 40 URL
  cases covering the C0 range, encoded filename boundaries, and unresolved links.
  All 491 checker tests pass. Each finding was reproduced before its fix.
- The final `docs:` commit records this round's validation. No dependencies,
  package implementations, skill content, or generated index changes were needed.

Validation used Node 24 through `/opt/node24/bin`. This round changes root tooling
only, so no individual package gates or dependency-policy checks apply.

| Exact command | Result |
| --- | --- |
| `PATH=/opt/node24/bin:$PATH pnpm exec vitest run test/check-skills.test.mjs` | PASS, 491 tests. |
| `PATH=/opt/node24/bin:$PATH pnpm exec biome check scripts/check-skills.mjs test/check-skills.test.mjs` | PASS. |
| `PATH=/opt/node24/bin:$PATH TURBO_SCM_BASE=d9697dc9a68803236b2c52ad505b8376b9ae01bb pnpm run gate` | PASS; root lint, 57 skills with current index, and all 1,236 root tests across 10 files. |
| `PATH=/opt/node24/bin:$PATH pnpm run gate:full` | FAIL, 289 successful / 351 total tasks, 1 cached; the previously recorded `@jeswr/federation-trust#test` JWK-order snapshot mismatch at `test/characterization.test.ts:196`. |
| `git diff --exit-code d9697dc9a68803236b2c52ad505b8376b9ae01bb -- packages/federation-trust packages/solid-vc` | PASS; both packages are unchanged in this round. |
| `git diff --check` | PASS. |

The full gate received JWK property order `kty,crv,x` where the snapshot expects
`crv,x,kty`; that existing failure remains outside this brief. Removed the 16
generated app `clientid.jsonld`/`callback.html` files after the gate. No generated
distributions are committed. All three supplied findings are addressed, with no
unfinished implementation or new open questions. `roborev` remains unavailable in
the sandbox, so the dispatcher must obtain per-commit review before merge.
No pushes, PRs, branch changes, remote git fetches/merges, or tracker writes occurred.

## Fix round 8 — quoted assignments, linked roots, and script escapes

Starting commit: `eec011b38355f8f26f03cf3538e6c02382e5d79a`.

- `90d77316` — `fix(skills): scan complete quoted secrets`: parse complete
  single- and double-quoted environment values, including whitespace, comment
  characters, escaped quotes, and newlines, before trimming and applying the
  existing placeholder exemptions. Keep diagnostics value-free and protect both
  missing and existing indexes. Add 13 regression and control cases, including
  decoded metadata and non-Markdown companions.
- `4e3b9d81` — `fix(skills): reject linked discovery roots`: enumerate shared
  and package roots directly before entry-point discovery, rejecting symbolic
  links without following their targets. Cover dangling links, file links,
  directories with and without entry points, and linked collection directories.
  Add 12 cases checking CLI diagnostics and index preservation.
- `4e4a6865` — `fix(skills): tokenize script escape states`: extend the HTML
  tokenizer with script data, escaped, double-escaped, dash, and escape-boundary
  states. An apparent end tag in double-escaped content only changes escape state;
  link scanning resumes at the actual closing tag. Add 29 cases for mixed case,
  delimiters, repeated escapes, unclosed content, inert URLs/definitions, and active
  Markdown, reference, and HTML links after scripts.
- The final `docs:` commit records this round's validation results.

All three findings were reproduced before their fixes. All 545 checker tests pass
(54 added in this round). No dependencies, package implementations, skill content,
or generated index changes were needed. Root tooling is the only implementation
surface changed, so no individual package gates or dependency-policy checks apply.
Validation used Node `v24.22.1` via `/opt/node24/bin`.

| Exact command | Result |
| --- | --- |
| `PATH=/opt/node24/bin:$PATH pnpm exec vitest run test/check-skills.test.mjs` | PASS, 545 tests. The checker suite also passes in the affected-gate retry and full gate. |
| `PATH=/opt/node24/bin:$PATH pnpm exec biome check --write scripts/check-skills.mjs test/check-skills.test.mjs` | PASS; formatting applied before the implementation commit. Subsequent gate lint checks pass without writes. |
| `PATH=/opt/node24/bin:$PATH TURBO_SCM_BASE=eec011b38355f8f26f03cf3538e6c02382e5d79a pnpm run gate` | FAIL on both attempts: root lint passes (57 skills, current index). First attempt: 1,288 passed / 2 timed out, in an existing index CLI test and agent-layer test. Retry: 1,286 passed / 4 timed out, all in unchanged agent-layer tests. |
| `PATH=/opt/node24/bin:$PATH pnpm run gate:full` | FAIL, 52 successful / 219 total tasks. Root lint and all 545 checker tests pass. Root tests: 1,284 passed / 6 failed, comprising five unchanged agent-layer test timeouts and one unchanged SDK-layer timing assertion (61.6 ms versus a 50 ms limit). |
| `PATH=/opt/node24/bin:$PATH pnpm exec vitest run test/agent-layers.test.mjs test/check-sdk-layers.test.mjs --maxWorkers=1` | PASS, all 643 tests across both previously failing guard files. |
| `git diff --exit-code eec011b38355f8f26f03cf3538e6c02382e5d79a -- test/agent-layers.test.mjs test/check-sdk-layers.test.mjs scripts/check-agent-layers.mjs scripts/check-sdk-layers.mjs` | PASS; both guard implementations and test files are unchanged. |
| `git diff --check` | PASS. |

The successful isolated guard run supports concurrency-related timing failures;
the repository gates remain reported as failed. Their test limits and unrelated
implementations were left unchanged. The full gate stopped at root tests before
reaching the historical federation-trust snapshot failure recorded above.

No generated app files remained to clean up, and no distribution output is committed.
All three supplied findings are addressed; no unfinished implementation or new open
questions remain. The conservative symlink policy rejects linked roots rather than
traversing them. `roborev` remains unavailable in the sandbox, so the dispatcher must
obtain per-commit review before merge. No pushes, PRs, branch changes, remote git
fetches/merges, or tracker writes occurred.

## Fix round 9 — index destinations and duplicate URL attributes

Starting commit: `33cd5a5ce7fd4384d708590ce62416cec50678af`.

- `e71a3e2f` — `fix(skills): refuse symbolic-link index writes`: check the
  destination immediately before index handling and write with `O_NOFOLLOW` so a
  link substituted after the check cannot overwrite its target. Add seven cases
  covering internal, external, dangling, and deterministically substituted links.
- `2249ef4f` — `fix(skills): ignore duplicate URL attributes`: apply the existing
  `firstAttribute` guard to URL collection. Add 18 cases covering `href`, `src`,
  `srcset`, foreign `xlink:href`, mixed case, empty/valueless first attributes,
  quoted markup, and active broken URLs beside duplicates.
- The final `docs:` commit records this round's validation results.

Both findings were reproduced before their fixes: four new symlink cases and 14
new duplicate-attribute cases failed. All 570 checker tests pass afterward, with
25 cases added in this round. No dependencies, package implementations, skill
content, or generated index changes were needed. Root tooling is the only changed
implementation surface, so individual package gates and dependency-policy checks
do not apply. Validation used Node `v24.22.1` via `/opt/node24/bin`.

| Exact command | Result |
| --- | --- |
| `PATH=/opt/node24/bin:$PATH pnpm exec vitest run test/check-skills.test.mjs` | PASS, 570 tests. |
| `PATH=/opt/node24/bin:$PATH pnpm exec biome check scripts/check-skills.mjs test/check-skills.test.mjs` | PASS. |
| `PATH=/opt/node24/bin:$PATH TURBO_SCM_BASE=33cd5a5ce7fd4384d708590ce62416cec50678af pnpm run gate` | PASS; root lint, 57 skills with current index, and all 1,315 root tests across 10 files. |
| `PATH=/opt/node24/bin:$PATH pnpm run gate:full` | FAIL, 289 successful / 351 total tasks, 1 cached; the previously recorded `@jeswr/federation-trust#test` JWK-order snapshot mismatch at `test/characterization.test.ts:196`. Root lint passes; all 1,315 root tests are replayed from the successful affected-gate cache. |
| `git diff --exit-code 33cd5a5ce7fd4384d708590ce62416cec50678af -- packages/federation-trust packages/solid-vc` | PASS; both packages are unchanged in this round. |
| `git diff --check` | PASS. |

The full gate received JWK property order `kty,crv,x` where the snapshot expects
`crv,x,kty`; that existing failure remains outside this brief. Removed the 16
generated app `clientid.jsonld`/`callback.html` files after the gate. No generated
distributions are committed. Both supplied findings are addressed, with no
unfinished implementation or open questions. `roborev` remains unavailable in the
sandbox, so per-commit review remains with the dispatcher. No pushes, PRs, branch
changes, remote git fetches/merges, or tracker writes occurred.

## Fix round 10 — entry-point symlinks and HTML resource attributes

Starting commit: `098931c0da112100057d10dd24a6ab012d7949c3`.

- `d9959b79` — `fix(skills): reject linked skill entry points`: inspect each
  shared and package `SKILL.md` with `lstatSync` during discovery, rejecting
  resolvable and dangling symlinks before reading. Add ten cases covering internal,
  external, invalid, directory, and dangling targets; verify CLI diagnostics and
  preservation of absent and existing indexes in check and write modes.
- `a2a3b944` — `fix(skills): validate HTML resource attributes`: select HTML
  URL attributes by element and namespace, including `object[data]`, `video[poster]`,
  form actions, citations, ping URL lists, and link image candidates. Reuse existing
  decoding, candidate parsing, URL preprocessing, and resolution checks. Preserve
  first-attribute handling and foreign-content URL handling. Add 72 regression and
  control cases for encoded/missing/resolved URLs, duplicate attributes, inert
  content, namespace integration points, companion Markdown, and index preservation.
- The final `docs:` commit records this round's validation results.

Both findings were reproduced before their fixes: all ten entry-point cases and
33 HTML-resource cases failed. All 652 checker tests pass afterward (82 added in
this round). No dependencies, package implementations, skill content, or generated
index changes were needed. Only root tooling changed, so individual package gates
and dependency-policy checks do not apply. Validation used Node `v24.22.1` via
`/opt/node24/bin`.

| Exact command | Result |
| --- | --- |
| `PATH=/opt/node24/bin:$PATH pnpm exec vitest run test/check-skills.test.mjs` | PASS, 652 tests. |
| `PATH=/opt/node24/bin:$PATH pnpm exec biome check --write scripts/check-skills.mjs test/check-skills.test.mjs` | PASS; formatting applied before implementation commits. Subsequent checks pass without writes. |
| `PATH=/opt/node24/bin:$PATH pnpm exec biome check scripts/check-skills.mjs test/check-skills.test.mjs` | PASS. |
| `PATH=/opt/node24/bin:$PATH TURBO_SCM_BASE=098931c0da112100057d10dd24a6ab012d7949c3 pnpm run gate` | PASS; root lint, 57 skills with current index, and all 1,397 root tests across ten files. |
| `PATH=/opt/node24/bin:$PATH pnpm run gate:full` | FAIL, 288 successful / 351 total tasks, one cached; the previously recorded `@jeswr/federation-trust#test` JWK-order snapshot mismatch at `test/characterization.test.ts:196`. Root lint passes; all 1,397 root tests replayed from the successful affected-gate cache. |
| `git diff --exit-code 098931c0da112100057d10dd24a6ab012d7949c3 -- packages/federation-trust packages/solid-vc` | PASS; both packages are unchanged in this round. |
| `git diff --check` | PASS. |

The full gate received JWK property order `kty,crv,x` where the snapshot expects
`crv,x,kty`; that existing failure remains outside this brief. Removed the 16
generated app `clientid.jsonld`/`callback.html` files after the gate. No generated
distributions are committed. Both supplied findings are addressed, with no
unfinished implementation or open questions. `roborev` remains unavailable in the
sandbox, so per-commit review remains with the dispatcher. No pushes, PRs, branch
changes, remote git fetches/merges, or tracker writes occurred.

## Fix round 11 — HTML image aliases and plaintext

Starting commit: `8242886c307609ca88d3862c07fbe942e1f09b90`.

- `246820cd` — `fix(skills): validate HTML image aliases`: normalize HTML
  `image` start tags to `img` before selecting URL attributes and applying
  void-element handling. Add 20 cases covering missing and resolved `src`/`srcset`
  resources, mixed case, duplicate attributes, inert examples, foreign images,
  HTML integration points, and index preservation.
- `6731e9e3` — `fix(skills): consume plaintext content to EOF`: consume all
  remaining HTML plaintext content, including apparent end tags and Markdown
  blocks. Add 23 cases covering literal links, images, reference definitions,
  self-closing syntax, HTML integration points, active links before plaintext,
  inert openers, and foreign plaintext elements.
- The final `docs:` commit records this round's validation results.

Both supplied findings were reproduced before their fixes. All 695 checker tests
pass afterward (43 added in this round). No dependencies, package implementations,
skill content, or generated index changes were needed. Only root tooling changed,
so individual package gates and dependency-policy checks do not apply. Validation
used Node `v24.22.1` via `/opt/node24/bin`.

| Exact command | Result |
| --- | --- |
| `PATH=/opt/node24/bin:$PATH pnpm exec vitest run test/check-skills.test.mjs` | PASS, 695 tests. |
| `PATH=/opt/node24/bin:$PATH pnpm exec biome check --write scripts/check-skills.mjs test/check-skills.test.mjs` | PASS; formatted one test string before its implementation commit. |
| `PATH=/opt/node24/bin:$PATH pnpm exec biome check scripts/check-skills.mjs test/check-skills.test.mjs` | PASS, including after the full gate. |
| `PATH=/opt/node24/bin:$PATH TURBO_SCM_BASE=8242886c307609ca88d3862c07fbe942e1f09b90 pnpm run gate` | PASS; root lint, 57 skills with current index, and all 1,440 root tests across ten files. |
| `PATH=/opt/node24/bin:$PATH pnpm run gate:full` | FAIL, 318 successful / 372 total tasks, one cached; the previously recorded `@jeswr/federation-trust#test` JWK-order snapshot mismatch at `test/characterization.test.ts:196`. Root lint passes; all 1,440 root tests replayed from the successful affected-gate cache. |
| `git diff --exit-code 8242886c307609ca88d3862c07fbe942e1f09b90 -- packages/federation-trust packages/solid-vc` | PASS; both packages are unchanged in this round. |
| `git diff --check` | PASS. |

The full gate received JWK property order `kty,crv,x` where the snapshot expects
`crv,x,kty`; that existing failure remains outside this brief. Removed the 16
generated app `clientid.jsonld`/`callback.html` files after the gate. No generated
distributions are committed. Both supplied findings are addressed, with no
unfinished implementation or open questions. `roborev` remains unavailable in the
sandbox, so per-commit review remains with the dispatcher. No pushes, PRs, branch
changes, remote git fetches/merges, or tracker writes occurred.
