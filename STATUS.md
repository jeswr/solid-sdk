<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-9s2 — MCP-03 lane report

Branch: `lane/sst-9s2`. Base: `917d3be9c7967622829adc43c1aaabb0964ec993`.

## Commits

- `ee8fa8a8 docs: record MCP search and fetch interpretations` — records missing
  MCP-01 interfaces and conservative interpretations in `QUESTIONS.md`.
- `89691cc8 feat: add bounded ChatGPT search and fetch tools` — exact JSON tool
  shapes, shared discovery/scan resource and deadline budgets, bounded fetch
  representations, scope/redirect checks, safe inline JSON-LD, Turtle union views,
  fixture tests, README, and generated public API report.
- `c5d40b2c fix: release search bodies on caller cancellation` — releases bodies
  when an injected fetch ignores cancellation; adds cancellation/title fixtures.
- `docs: record MCP-03 lane status` — this final report commit.

## Validation

Final package commands (all exit 0):

```sh
pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run typecheck
pnpm --filter @jeswr/solid-mcp run test
pnpm run lint:root
```

Tests: **150 passed across 5 files**. All test data and fetches are fixtures.
Coverage command (exit 0):

```sh
pnpm --filter @jeswr/solid-mcp run test:coverage
```

The new `content.ts`, `fetch.ts`, and `search-budget.ts` each have 100% branch
coverage. Aggregate package coverage is 87.40% branches / 97.82% lines; legacy
branches remain uncovered, so the design's whole-package 100% branch target is
not met. The new search/fetch MCP handlers' success and error paths are covered.

Final affected gate (exit 0; **8/8 Turbo tasks successful**):

```sh
NODE_OPTIONS=--require=/tmp/sst-9s2-network-guard.cjs GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=917d3be9c7967622829adc43c1aaabb0964ec993 pnpm run gate
```

Final full-workspace gate (exit 1; 38 successful tasks, 25 cached):

```sh
NODE_OPTIONS=--require=/tmp/sst-9s2-network-guard.cjs GIT_ALLOW_PROTOCOL=file pnpm run gate:full
```

It fails in unchanged `@jeswr/app-pod-manager#build`: `next/font` tries to fetch
Inter from Google Fonts. The temporary verification guard rejects non-loopback
network connections and restricts Git transport to local files. It is outside
the checkout and is not part of the implementation. No production-service
requests or remote Git fetch/merge operations were allowed by this guard.

Additional checks:

- `pnpm --filter @jeswr/solid-mcp run api:report` and
  `pnpm --filter @jeswr/solid-mcp exec api-extractor run --local` passed; the
  generated API report is committed. API Extractor warns that its bundled
  TypeScript is older than the installed compiler.
- `git -c core.whitespace=cr-at-eol diff --check` passed (the existing API report
  uses CRLF). Generated build outputs are not committed.
- `roborev status` exits 127: the executable is unavailable. Automated per-commit
  review could not run in this sandbox. A manual security review found and fixed
  the ignored-cancellation cleanup case.

## Dependencies and environment

No dependencies or manifests changed. `check:packages`: not applicable; no
packages were added, and no install or lifecycle scripts were enabled.

The preinstalled pinned `@jeswr/fetch-rdf` lacked `dist/`. Restored its local
prebuilt output from `/tmp/sst-0e7-fetch-rdf.sQiWs6/dist` into this checkout's
ignored dependency directory. Its source matches the clean local source at the
manifest pin `a8359a3764cb6b3c763e09ea211542a5dc7edc33`; no network clone/fetch
was used. Node `v24.22.1`, pnpm `10.4.1`.

## Unfinished work and open questions

The scoped search/fetch implementation and acceptance fixtures are complete.
Full-workspace validation, the aggregate branch-coverage target, and roborev
review remain incomplete as described above. No unrelated source changes were
made to address these limitations.

`QUESTIONS.md` records the conservative choices: this base lacks MCP-01's
PodPort/registry, so tools use the existing guarded configuration; filenames
supply titles; capped RDF has empty text with a truncation flag; named RDF graphs
are presented as a Turtle union view; search defaults remain depth 4 / 500
resources with a new 5000 ms deadline. MCP-01 integration remains a dependency
gap for the program lead to resolve when combining lanes.

## Fix round 1 — review of `f23018734c15`

- `eb7d98dc fix: normalize JSON-LD and preserve RDF response bases` addresses
  all three review findings. JSON-LD is parsed only from the normalized object
  checked for remote contexts and `@import`; bounded search responses preserve
  the effective response URL; fetched RDF resolves against `response.url || target`.
  The conservative parser-boundary choice uses the existing parser API without
  adding dependencies or expanding its options.
- `docs: record review fix validation` records this round's results.

Eight new fixture regressions failed before the fix and passed afterward:
remote-context / `@import` values hidden by duplicate context keys in fetch and
search discovery, redirected Turtle / JSON-LD identifiers, redirected container
children, and relative Type Index discovery after a profile redirect. The full
package suite now has **158 passing tests across 5 files**.

Exact successful package gate commands (exit 0 each), run with
`NODE_OPTIONS=--require=/tmp/sst-9s2-network-guard.cjs` and
`GIT_ALLOW_PROTOCOL=file` exported:

```sh
pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run typecheck
pnpm --filter @jeswr/solid-mcp run test
```

Affected repository gate (exit 0; **7/7 Turbo tasks successful**, including root
lint):

```sh
NODE_OPTIONS=--require=/tmp/sst-9s2-network-guard.cjs GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=f23018734c15cc8c9aa824efdea078e8e884d93a pnpm run gate
```

Full-workspace gate (exit 1; 52 successful tasks out of 184 planned):

```sh
NODE_OPTIONS=--require=/tmp/sst-9s2-network-guard.cjs GIT_ALLOW_PROTOCOL=file pnpm run gate:full
```

The unchanged `@jeswr/app-pod-manager#build` fails because `next/font` attempts
an Inter download from Google Fonts, blocked by the existing temporary network
guard. No unrelated fixes were made. `roborev status` exits 127 because roborev
is unavailable, so automated review remains unavailable. `git diff --check`
passes. No dependencies or manifests changed; `check:packages` is not applicable.
The existing local prebuilt fetch-rdf artifact was restored into the checkout's
ignored dependency directory as in the original round; no remote Git fetch or
merge was performed.

All three requested findings are fixed. No open questions for this fix round;
full-workspace validation and automated review retain the environmental
limitations above.

## Fix round 2 — review of `1743fe2d9e03`

- `7b8f7bd3 fix: bound RDF expansion and search direct instances` fixes both
  requested findings. A package-local parser adapter enforces budgets before
  constructing/storing quads: 16,384 input quads (including duplicates), 1 MiB
  of created term values, and 1 MiB of expanded term bytes across quads. The
  adapter uses the already installed N3/JSON-LD libraries because the pinned
  `parseRdf` API exposes no factory or quad-budget hook. A bounded N3 Writer
  sink stops serialization on overflow without retaining oversized output.
  Fetch preserves empty text plus `truncated: true` on budget exhaustion.
  Search applies parsing budgets to profiles, indexes, listings, and literal
  reads, skipping exhausted documents. Direct Type Index instances negotiate
  RDF regardless of filename, including extensionless note URLs.
- `docs: record second review fix validation` records this round's results.

The conservative internal limits above bound both RDF expansion and object
overhead without changing public configuration or adding dependencies. Existing
lower-level read/list helpers retain their existing shared RDF reader.

Thirteen new fixture tests cover expansion in Turtle/JSON-LD, expanded prefix
declarations without quads, duplicate-quad limits at and above the boundary,
serialization stopping before later quads, every search parsing stage, and
extensionless instances with negotiated RDF and non-RDF responses. Six focused
integration regressions fail against the original implementation and pass with
the fix. The complete package suite has **171 passing tests across 6 files**.

Successful package gate commands (exit 0 each), run with
`NODE_OPTIONS=--require=/tmp/sst-9s2-network-guard.cjs` and
`GIT_ALLOW_PROTOCOL=file` exported:

```sh
pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run typecheck
pnpm --filter @jeswr/solid-mcp run test
pnpm run lint:root
```

Affected repository gate (exit 0; **7/7 Turbo tasks successful**):

```sh
NODE_OPTIONS=--require=/tmp/sst-9s2-network-guard.cjs GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=1743fe2d9e035a62944fc4fe27896982fa8f00e8 pnpm run gate
```

Full-workspace gate (exit 1; 34 successful tasks out of 159 planned):

```sh
NODE_OPTIONS=--require=/tmp/sst-9s2-network-guard.cjs GIT_ALLOW_PROTOCOL=file pnpm run gate:full
```

The unchanged `@jeswr/app-pod-manager#build` fails because `next/font` attempts
to fetch Inter from Google Fonts, blocked by the fixture-only network guard.
`roborev status` exits 127 because roborev is unavailable. `git diff --check`
passes. The existing local prebuilt fetch-rdf output was restored into this
checkout's ignored dependency directory as in prior rounds; no remote Git
fetch/merge or dependency lifecycle scripts were used. No dependencies or
manifests changed; `check:packages` is not applicable.

Both requested findings are fixed. No open questions or unfinished implementation
work remain for this round; full-workspace validation and automated review have
the environmental limitations above.

## Fix round 3 — review of `db37da5c40a2`

- `5b095636 fix: budget JSON-LD contexts before expansion` fixes both requested
  findings. Inline context normalization and RDF term creation share the existing
  1 MiB allocation budget. A parser-instance adapter charges context copies and
  inheritance, base/vocabulary resolution, and conservative UTF-8 upper bounds
  before each prefix expansion. It handles context arrays, scoped contexts, and
  chained prefixes, including contexts that emit no quads. Remote contexts remain
  refused by the normalized-input guard and an explicit refusing document loader.
  Scoped-context error wrapping preserves the allocation-limit classification,
  so fetch returns empty text with `truncated: true` and search skips the document.
  Search returns redirect responses to the scope guard before reading their
  bodies; JSON-LD normalization occurs only in the final-response RDF parser.
- `docs: record third review fix validation` records this round's results and is
  the final commit, touching only `STATUS.md`.

Fifteen new fixture tests cover unused prefix/vocabulary expansion, arrays,
scoped contexts, chained prefixes, valid scoped inheritance, the combined
context/RDF allocation limit, fetch truncation, and all four search parsing
stages. Redirect regressions cover container, Type Index, and literal reads,
checking all five redirect statuses with empty, malformed, oversized,
remote-context, and stalled bodies. They assert that redirect bodies are never
read and that the scope guard cancels the stalled stream. Thirteen targeted
regressions fail against the original source and pass with the fix. The complete
package suite has **186 passing tests across 6 files**.

Successful package gate commands (exit 0 each), run with
`NODE_OPTIONS=--require=/tmp/sst-9s2-network-guard.cjs` and
`GIT_ALLOW_PROTOCOL=file` exported:

```sh
pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run typecheck
pnpm --filter @jeswr/solid-mcp run test
pnpm run lint:root
```

Affected repository gate (exit 0; **8/8 Turbo tasks successful**):

```sh
NODE_OPTIONS=--require=/tmp/sst-9s2-network-guard.cjs GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=1743fe2d9e035a62944fc4fe27896982fa8f00e8 pnpm run gate
```

Full-workspace gate (exit 1; **31 successful tasks out of 156 planned**, 5 cached):

```sh
NODE_OPTIONS=--require=/tmp/sst-9s2-network-guard.cjs GIT_ALLOW_PROTOCOL=file pnpm run gate:full
```

The unchanged `@jeswr/app-pod-manager#build` fails because `next/font` attempts
to fetch Inter from Google Fonts, blocked by the fixture-only network guard.
`roborev status` exits 127 because roborev is unavailable, so automated per-commit
review remains unavailable. `git diff --check` passes. No dependencies or
manifests changed; `check:packages` is not applicable. The pinned fetch-rdf
prebuilt output was restored from the same local temporary artifact used in
earlier rounds, and the guarded-fetch/rdf-serialize workspace dependencies were
built locally. No remote Git fetch/merge or production-service requests occurred.

All requested findings are fixed. The conservative allocation reservations can
reject a document before its exact expanded size reaches 1 MiB. No open questions
or unfinished implementation work remain for this round; full-workspace
validation and automated review retain the environmental limitations above.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 4 — integrate with main

- `c1254ec6 fix(mcp): integrate bounded tools with main` merges the authoritative
  local `origin/main` at `809c3c12b59847444c2b83be757b4813c4865579` into this lane.
  Main's server/resource structure is retained exactly. Search and fetch register
  through its PodPort tool registry; `solid_search` retains its scoped ranked-array
  response while `search` keeps the exact ChatGPT envelope. Internal adapter
  metadata preserves the lane's streaming byte, RDF expansion, redirect and
  deadline limits for fetch-backed PodPorts. Portable pods share discovery/scan
  budgets and bounded parsing/output. Their byte-array interface requires the
  backend to bound its own reads. Main's other tools, aliases and write policy
  remain intact. README and the generated API report combine both surfaces.
- `05770cca fix(mcp): retain portable WebID discovery` preserves main's configured
  off-pod WebID exception when a portable backend returns the HTTP document URL
  without its fragment. A focused regression failed before this fix and passed
  afterward; another off-pod response document remains scope-checked.
- `docs: record main integration validation` is the final commit, touching only
  `STATUS.md`.

The search/fetch contract and representation fixtures now run against both the
legacy configuration and an injected fetch-backed PodPort. Portable fixtures
cover exact search/fetch results, the legacy search result, shared discovery
budgets, extensionless Type Index instances, output caps, remote JSON-LD refusal,
response bases, and URL scope checks. All prior lane fixtures are retained.

### Validation

Successful explicit commands (exit 0):

```sh
pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run typecheck
pnpm --filter @jeswr/solid-mcp run test
pnpm run lint:root
pnpm run test:root
pnpm --filter @jeswr/solid-mcp run api:report
```

The package has **343 passing tests across 8 files**; root has **745 passing tests
across 9 files**. API Extractor completed successfully with its existing warning
about a bundled TypeScript older than the installed compiler. Workspace build
prerequisites (`fetch-rdf`, `guarded-fetch`, `rdf-serialize`) were built locally;
the newly imported workspace fetch-rdf replaces the earlier pinned artifact.
Generated build and temporary API outputs are not committed.

Final affected repository gate on `05770cca` (exit 0; **18/18 Turbo tasks
successful**, 8 cached):

```sh
NODE_OPTIONS=--require=/tmp/sst-9s2-network-guard.cjs GIT_ALLOW_PROTOCOL=file TURBO_SCM_BASE=origin/main pnpm run gate
```

This includes the dependent personal-agent package: **531 tests passed across
56 files**, alongside package and root checks. An earlier run timed out in two
unchanged personal-agent fixtures (`policy-config` and `protected-disclosure`);
both passed on the final run without changes to that package.

Full-workspace gate (exit 1; **57 successful tasks out of 212 planned**, 15 cached):

```sh
NODE_OPTIONS=--require=/tmp/sst-9s2-network-guard.cjs GIT_ALLOW_PROTOCOL=file pnpm run gate:full
```

The unchanged `@jeswr/app-suite#build` fails when `next/font` tries to download
Onest, Source Code Pro and Source Serif 4 from Google Fonts. The pre-existing
verification guard refuses non-loopback connections and restricts Git transport
to local files. No unrelated source was changed to address this failure.

`roborev status` exits 127 because roborev is unavailable. Automated per-commit
review remains unavailable. Lane changes pass whitespace checks with the API
report's existing CRLF convention. Comparing against `origin/main` confirms that
changes outside `packages/solid-mcp` consist only of this lane's existing
`QUESTIONS.md` and `STATUS.md`.

### Lockfile and source limitations

`git fetch origin` used the prescribed local source clone
(`/home/runner/work/solid-sdk`), followed by the merge. No network remote was
fetched or merged, no branch was switched, and nothing was pushed or published.
Main is authoritative outside the lane scope.

Unfrozen lockfile regeneration was attempted with:

```sh
GIT_ALLOW_PROTOCOL=file pnpm install --lockfile-only --offline --ignore-scripts
```

It exits 1 because pnpm still attempts `git ls-remote` for federation-trust's
existing `github:jeswr/solid-vc#main` dependency. HTTPS Git transport was refused
before connecting. `--prefer-frozen-lockfile` also requires that resolution.
No lockfile was hand-merged: the authoritative main lockfile is retained exactly.
The following validation/install commands both succeeded without network access:

```sh
GIT_ALLOW_PROTOCOL=file pnpm install --lockfile-only --offline --ignore-scripts --frozen-lockfile
GIT_ALLOW_PROTOCOL=file pnpm install --offline --frozen-lockfile --ignore-scripts
```

Full unfrozen regeneration remains blocked by the lane's prohibition on remote
Git access. No dependencies were added or manifests changed beyond main's merge;
no lifecycle scripts were enabled.

The fetched main contains MCP-01 (`3a6ca88f`, #70), but no MCP-02 Streamable HTTP
implementation. Conservatively, this round integrates with the actual fetched
server/registry structure without inventing HTTP transport code. The original
PodPort/registry dependency gap is resolved. The remaining source question for
the program lead is which main revision contains the MCP-02 work referenced by
this brief. Full-workspace validation, unfrozen lockfile regeneration and roborev
retain the limitations above; scoped implementation and final affected validation
are complete.

## Fix round 5 — guard MCP search profile redirects

- `bac5c207 fix(mcp): guard search profile redirects` addresses only finding 2
  in the review of `ec9ba67c4a2a`. Fetch-backed search now applies the adapter's
  discovery policy: the configured off-pod WebID is requested with manual
  redirects, and every redirect from that profile is refused, including one
  pointing into the pod. In-pod profiles use the existing pod-scoped redirect
  loop over the budget-wrapped transport, validating and charging each permitted
  hop before making its request. Streaming body, RDF and deadline limits remain
  in force.
- `docs: record redirect guard validation` is the final commit, touching only
  `STATUS.md`.

Added 44 regression cases across legacy configuration and injected fetch-backed
PodPorts. They cover all five redirect statuses; off-pod identity redirects to
internal services, other origins, the identity origin and the pod; in-pod
profile redirects escaping the pod; successful relative redirects and effective
RDF bases; cancellation without reading redirect bodies; shared resource caps
across two profile hops, index discovery and scanning; and deadline cancellation
of a stalled redirected profile. Forty cases failed against the unfixed source;
all new cases pass with the fix. The complete MCP suite has **387 passing tests
across 8 files**.

### Validation

All verification used the existing temporary network guard and local-only Git
transport restriction:

```sh
export NODE_OPTIONS=--require=/tmp/sst-9s2-network-guard.cjs
export GIT_ALLOW_PROTOCOL=file
```

Successful explicit package/root commands (exit 0 each):

```sh
pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run typecheck
pnpm --filter @jeswr/solid-mcp run test
pnpm run lint:root
```

Workspace dependency builds were absent initially; they were built locally with
`pnpm exec turbo run build --filter=@jeswr/solid-mcp...` (exit 0) before regression
verification. The focused search-limit file passes **82 tests**.

Gate against the supplied lane base (exit 1; **74 successful tasks out of 248**,
3 cached):

```sh
TURBO_SCM_BASE=1743fe2d9e035a62944fc4fe27896982fa8f00e8 pnpm run gate
```

Full-workspace gate (exit 1; **92 successful tasks out of 274**, 73 cached):

```sh
pnpm run gate:full
```

Both stop at the unchanged `@jeswr/app-suite#build`: `next/font` attempts to
download Onest, Source Code Pro and Source Serif 4 from Google Fonts, refused by
the fixture-only network guard. Root tests pass **745 tests across 9 files**.

Gate scoped against the existing local main reference (exit 0; **18/18 tasks
successful**, 8 cached):

```sh
TURBO_SCM_BASE=origin/main pnpm run gate
```

This includes the dependent personal-agent checks (**531 tests across 56 files**)
without modifying that package. `roborev status` exits 127 because roborev remains
unavailable. `git diff --check` passes. No dependencies, manifests or lockfile
changed; `check:packages` is not applicable. No remote Git fetch/merge, push,
publication or production-service access occurred.

The requested MCP finding is fixed. The personal-agent RDF-loader finding is
excluded as instructed and remains tracked separately as A-002F. Broad workspace
validation and automated review retain the environmental limitations above.
No implementation work or open questions remain for this fix round.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 6 — integrate with main

- `6f8f0de7 chore(mcp): merge main and retain search/fetch coverage` merges
  local `origin/main` at `67abf7f1d67285756c2e31e6b2ab801d93cea95a` into
  `lane/sst-9s2`. The only conflicts were the expected README and server test.
  Both resolutions start from main: its complete chat/HTTP documentation and
  server tests are preserved, with the existing MCP-03 search/fetch section and
  `fetch` registration assertion restored on top. The registration expectation
  retains main's conditional fetch-backed chat tools. All existing MCP-03
  contract, representation, budget and redirect regression files are unchanged.
- `docs: record round six integration validation` is the final commit, touching
  only `STATUS.md`.

No runtime behavior was changed for this integration. Main's server, chat tools
and HTTP transport are retained exactly, as are the lane's search/fetch sources.
Everything outside `packages/solid-mcp`, `QUESTIONS.md` and `STATUS.md` matches
main, including the lockfile. The conservative resolution combines the existing
surfaces without introducing new transport or tool behavior.

### Validation

Successful requested gates (exit 0 each):

```sh
pnpm --filter ./packages/solid-mcp run lint
pnpm --filter ./packages/solid-mcp run typecheck
pnpm --filter ./packages/solid-mcp run test
pnpm run lint:root
```

The combined MCP suite passes **495 tests across 10 files**. Dependency-first
build verification also passes all **7/7 tasks**:

```sh
pnpm exec turbo run build --filter=@jeswr/solid-mcp...
```

Repository affected gate (exit 0; **23/23 tasks successful**, 7 cached):

```sh
TURBO_SCM_BASE=origin/main pnpm run gate
```

This includes **745 root tests across 9 files**, **531 personal-agent tests
across 56 files** and **121 agent-model tests across 7 files**.

Full-workspace gate (exit 1; **86 successful tasks out of 255**, 12 cached):

```sh
pnpm run gate:full
```

The unchanged `@jeswr/app-suite#build` fails when `next/font` tries to download
Onest, Source Code Pro and Source Serif 4 from Google Fonts. The existing
temporary network guard refuses non-loopback connections. No unrelated source
was changed to address this environmental failure.

All validation used the following environment; the root tool directory is
needed for packages such as suite-vocab that use the root TypeScript compiler:

```sh
export PATH="$PWD/node_modules/.bin:$PATH"
export NODE_OPTIONS=--require=/tmp/sst-9s2-network-guard.cjs
export GIT_ALLOW_PROTOCOL=file
```

The initial dependency build without the explicit root tool path failed with
`tsc: not found`; it passed after setting that path. The frozen offline install
(`pnpm install --offline --frozen-lockfile --ignore-scripts`) succeeded using
cached packages, without downloads or lifecycle scripts. No dependencies were
added beyond main's incoming manifest changes, and no lockfile was regenerated.

`roborev status` exits 127 because roborev is unavailable; automated per-commit
review remains unavailable. Whitespace and scope checks pass. Git ancestry
confirms that local main is merged. The fetch used only the prescribed local
source clone at `/home/runner/work/solid-sdk`; no network remote was fetched or
merged, no branch was switched, and nothing was pushed or published.

The requested integration is complete. Full-workspace validation and automated
review retain the environmental limitations above. No open questions or
unfinished implementation work remain for this round.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Review fixes — `adbad7509fc8`

- `21ece678 fix(mcp): inline private OAuth metadata helper` bundles the existing
  `@jeswr/mcp-oauth/metadata` helper and declares `@jeswr/mcp-oauth` in
  `mirrorPublish.inlined`. Mirror rewriting requires only the existing public
  dependency SHAs. Tests check rewritten pins, absence of private-package imports
  in emitted JavaScript and declarations, and the built HTTP handler's metadata
  challenges for root, nested and trailing-slash resource URLs.
- `9de376da fix(mcp): default headerless portable RDF to Turtle` restores the
  Turtle fallback only when a portable search read returns an empty content type.
  Fixtures cover profiles, indexes, direct instance literals and scanned literals,
  preserve relative URL bases, and confirm explicit binary media types stay refused.
- `docs: record MCP review fix validation` records this review round's validation.

The changes address exactly the two supplied findings. Eleven new fixture cases
were added. Seven regressions fail against the original implementation; all 21
cases in the two focused files pass after the fixes. No dependencies were added,
so `check:packages` is not applicable. Frozen offline lockfile verification passes
and the lockfile is unchanged.

Validation used Node 24 with the following environment:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
export NODE_OPTIONS=--require=/tmp/sst-9s2-round2-network-guard.cjs
export GIT_ALLOW_PROTOCOL=file
```

The temporary guard permits loopback fixtures and refuses external connections.
All package gate commands pass (exit 0):

```sh
pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run typecheck
pnpm --filter @jeswr/solid-mcp run test
```

The package suite passes **509 tests across 11 files**. The affected repository
gate passes (exit 0; **23/23 tasks successful**, 7 cached), including root lint
and dependent agent-model/personal-agent checks:

```sh
TURBO_SCM_BASE=adbad7509fc885de5a007adf20512fb478c86b40 pnpm run gate
```

The required full-workspace gate was run before the final documentation commit:

```sh
pnpm run gate:full
```

It exits 1 after **132 successful tasks out of 274**, 12 cached, at the unchanged
`@jeswr/app-suite#build`. `next/font` tries to download Onest, Source Code Pro and
Source Serif 4 from Google Fonts, which the fixture-only network guard refuses.
The root suite passes **745 tests across 9 files** during this run. No unrelated
source was changed to address this environmental limitation.

```sh
pnpm install --offline --frozen-lockfile --ignore-scripts --lockfile-only
```

The frozen offline check passes (exit 0). `git diff --check` passes.
`roborev status` exits 127 because roborev is not installed, so automated
per-commit review is unavailable. No remote Git fetch/merge, push, publication,
new dependency or lifecycle script was used. Both requested fixes are complete;
no open questions or unfinished implementation work remain.

## Review fixes — `547f8f970ba8` (round 3)

- `565a1466 fix(mcp): meter N3 base directive work` reserves work before N3
  processes the initial base or a base directive. The existing shared parser
  budget now accounts for the quadratic worst case of base-path normalization
  and conservative expanded-base lengths, including declarations emitting no
  quads. Fixtures cover relative chains, repeated Turtle/SPARQL directives,
  mixed-case `BASE`, expensive single bases, shared term budgets and normal
  base/prefix resolution. This conservative work limit can reject a base even
  when its term bytes alone would fit the allocation limit.
- `5716117f fix(bridge): reject legacy ACL inheritance scopes` takes the
  conservative option explicitly allowed by the review: discovered ACLs with
  any `acl:defaultForNew` statement are refused before replacement. Same-container,
  foreign, mixed, literal and blank-node targets all abort before any PUT.
- `aaa20c5c fix(mcp): normalize portable search media types` normalizes case,
  whitespace and parameters before bounded RDF parsing, retaining the empty-header
  Turtle fallback. Fixtures cover profile/index discovery, direct instance
  literals, scanned literals and the Turtle alias; explicit binary types remain
  refused.
- `docs: record MCP round-three validation` records the final gate results.

All three supplied findings are addressed. There are **21 additional fixture
cases**; **19 regressions fail against the reviewed implementation**, while all
**80 cases in the three focused files pass** with the fixes. No dependency or
manifest changed, so `check:packages` is not applicable.

Validation used Node 24 and the existing temporary network guard:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
export NODE_OPTIONS=--require=/tmp/sst-9s2-round2-network-guard.cjs
export GIT_ALLOW_PROTOCOL=file
```

Both package gates pass (exit 0):

```sh
pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run typecheck
pnpm --filter @jeswr/solid-mcp run test
pnpm --filter @jeswr/agentic-legacy-bridge run lint
pnpm --filter @jeswr/agentic-legacy-bridge run build
pnpm --filter @jeswr/agentic-legacy-bridge run typecheck
pnpm --filter @jeswr/agentic-legacy-bridge run test
pnpm --filter @jeswr/agentic-legacy-bridge run test:coverage
```

Solid MCP passes **525 tests across 11 files**. The bridge passes **680 tests
across 37 files**, including its coverage run (94.01% statements, 86.65% branches,
97.34% functions and 96.32% lines).

The affected repository gate passes (exit 0; **26/26 tasks successful**, 7 cached),
including `pnpm run lint:root` and the agent-model/personal-agent dependent checks:

```sh
TURBO_SCM_BASE=547f8f970ba85ca080ebe9a61326d2093e0f6758 pnpm run gate
```

The full-workspace gate ran before the final documentation commit:

```sh
pnpm run gate:full
```

It exits 1 after **129 successful tasks out of 278**, 13 cached, at the unchanged
`@jeswr/app-suite#build`. Its `next/font` build attempts to download Onest, Source
Code Pro and Source Serif 4 from Google Fonts; the fixture-only network guard
refuses those connections. The root suite passes **745 tests across 9 files**.
This is the same environmental limitation recorded in the previous review round;
no unrelated source was changed to address it.

`git diff --check` passes. `roborev status` exits 127 because roborev is not
installed, so automated per-commit review remains unavailable. No remote Git
fetch/merge, push, publication, new dependency or lifecycle script was used.
No implementation work or open questions remain; the outstanding validation
limitations are the full-workspace font download and unavailable roborev.

## Codex fix round 4 — review of `08506c4d36cc`

- `90c96bd4 fix(mcp): preserve opaque JSON literal values` removes the recursive
  context/import scan while retaining JSON parse/stringify normalization. The
  existing bounded parser's refusing document loader rejects actual remote
  contexts and imports, leaving opaque JSON literal contents intact. This is the
  existing-loader option explicitly allowed by the review; no API or dependency
  changes were needed.
- `docs: record MCP round-four validation` records this round's gate results.

Ten new regression cases fail against the reviewed source and pass with the fix.
Fetch fixtures preserve the JSON value and RDF JSON datatype with explicit,
context-coerced and aliased typing. Search fixtures cover profile, Type Index,
container and literal reads through both fetch-backed interfaces. Four additional
security cases confirm scoped imports and actual remote contexts alongside JSON
literals remain refused without parser network requests. The existing nested
context fixture now maps its property so the parser actually processes it.
The two focused files pass **206 tests**; the full package passes **539 tests
across 11 files**.

Validation used Node 24 and the existing temporary fixture network guard:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
export NODE_OPTIONS=--require=/tmp/sst-9s2-round2-network-guard.cjs
export GIT_ALLOW_PROTOCOL=file
```

Local workspace prerequisites were built without remote Git operations:

```sh
pnpm exec turbo run build --filter '@jeswr/solid-mcp^...' --concurrency=4
```

The package gate passes (exit 0 for each command):

```sh
pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run typecheck
pnpm --filter @jeswr/solid-mcp run test
```

The affected repository gate passes (exit 0; **23/23 tasks successful**, 7 cached),
including root lint and checks for the dependent agent packages:

```sh
TURBO_SCM_BASE=08506c4d36cc796d1f80fe4a5062fea403ceadac pnpm run gate
```

The full-workspace gate ran before the final documentation commit:

```sh
pnpm run gate:full
```

It exits 1 after **121 successful tasks out of 270**, 12 cached, at the unchanged
`@jeswr/app-suite#build`. Its `next/font` build attempts to download Onest, Source
Code Pro and Source Serif 4 from Google Fonts; the fixture-only network guard
refuses those connections. Root tests pass **745 tests across 9 files**. No
unrelated changes were made to address this existing environment limitation.

`git diff --check` passes. `roborev status` exits 127 because roborev is unavailable,
so automated per-commit review remains unavailable. No dependencies or manifests
changed; `check:packages` is not applicable. No push, publication, remote Git
fetch/merge or dependency lifecycle script was used. The requested finding is
fixed; no implementation work or open questions remain. The outstanding
validation limitations are the full-workspace font download and unavailable
roborev.

## Codex fix round 5 — review of `9db763ba4cc8`

- `91a046e6 fix: normalize ACL discovery relations` lowercases received Link
  relations and the ACP comparison constant before ACL uniqueness, anchored-link
  and unsupported-model checks. Target URL casing is preserved.
- `docs: record ACL relation validation` records this round's gate results.

Added eleven fixture regression cases for quoted/unquoted and multiple
relations, mixed-case ACL discovery, duplicate ACLs in either order, anchored
ACLs, and canonical/lowercase/mixed-case ACP relations. Unsafe cases assert
discovery stops after HEAD, before any ACL read or write. Nine cases fail against
the reviewed source; all **47 focused tests** pass with the fix.

Validation used Node 24 and the existing fixture-only network guard:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
export NODE_OPTIONS=--require=/tmp/sst-9s2-round2-network-guard.cjs
export GIT_ALLOW_PROTOCOL=file
pnpm exec turbo run build --filter '@jeswr/agentic-legacy-bridge^...' --concurrency=4
pnpm --filter @jeswr/agentic-legacy-bridge run gate
pnpm --filter @jeswr/agentic-legacy-bridge run test:coverage
TURBO_SCM_BASE=9db763ba4cc877f86b0293f5d0077c7e7b7975e7 pnpm run gate
```

All commands pass (exit 0). The package gate runs lint, build, typecheck and
**691 tests across 37 files**; coverage repeats those tests successfully.
Coverage is 94.01% statements, 86.68% branches, 97.34% functions and 96.32% lines.
The affected repository gate, including root lint, passes **23/23 tasks**,
6 cached.

The session-close full-workspace gate ran before the final documentation commit:

```sh
pnpm run gate:full
```

It exits 1 after **109 successful tasks out of 282**, 12 cached, at the unchanged
`@jeswr/app-suite#build`. Its `next/font` build cannot download Onest, Source Code
Pro and Source Serif 4 from Google Fonts because the fixture-only guard refuses
external connections. This is the same environment limitation recorded in the
previous round; no unrelated changes were made.

`git diff --check` passes. `roborev status` exits 127 because roborev is unavailable,
so automated per-commit review could not run. No dependencies or manifests
changed; `check:packages` is not applicable. No push, publication, remote Git
fetch/merge or dependency lifecycle script was used. The requested finding is
fixed, with no implementation work or open questions remaining. Validation
limitations are the full-workspace font download and unavailable roborev.

## Codex fix round 6 — review of `3a58d89d055d`

- `fde161a2 fix: bound JSON-LD structural buffering` validates the parsed JSON
  before normalization or streaming. Value depth is capped at 64; every value,
  including empty containers, ignored properties and JSON literals, reserves job
  overhead and depth-weighted key-path work against the existing shared budget.
  Excess throws `RdfLimitError`; fetch returns empty text with `truncated: true`.
- `89adeedd fix: accept valid ACL Link attributes` supports the full parameter
  token alphabet, optional extension values, extended attributes such as `title*`,
  and repeated `hreflang` and extension attributes. Singular descriptive attributes
  keep their first occurrence. Conservatively retains duplicate `rel` rejection,
  unique ACL association, anchor refusal, ACP rejection and ACL URL checks.
- `docs: record round-six validation` records this round's results.

Added 31 fixture regression cases covering excessive object/array/mixed/literal
depth, wide and depth-weighted job buffering, accepted depth and string contents,
fetch truncation through both adapters, valid descriptive/extension attributes on
ACL and unrelated links, and preserved association/grammar rejection. Before the
fix, all three initial depth cases and ten valid attribute cases failed. With the
fix, the focused suites pass 29 RDF budget tests and 67 bridge import tests.

Validation used Node 24 and the existing fixture-only network guard:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
export NODE_OPTIONS=--require=/tmp/sst-9s2-round2-network-guard.cjs
export GIT_ALLOW_PROTOCOL=file
pnpm exec turbo run build --filter '@jeswr/solid-mcp^...' --filter '@jeswr/agentic-legacy-bridge^...' --concurrency=4
pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run typecheck
pnpm --filter @jeswr/solid-mcp run test
pnpm --filter @jeswr/agentic-legacy-bridge run gate
pnpm --filter @jeswr/solid-mcp run test:coverage
pnpm --filter @jeswr/agentic-legacy-bridge run test:coverage
TURBO_SCM_BASE=3a58d89d055d848b281dea9842286defcb2cb7ec pnpm run gate
```

All commands pass (exit 0). Package gates run lint, build, typecheck and tests:
solid-mcp passes **550 tests across 11 files**; agentic-legacy-bridge passes
**711 tests across 37 files**. Coverage runs pass, including configured thresholds.
The affected repository gate, including root lint and dependent packages, passes
**26/26 tasks**, 7 cached.

The session-close `pnpm run gate:full` ran before the final documentation commit.
It exits 1 after **130 successful tasks out of 265**, 13 cached, at the unchanged
`@jeswr/app-suite#build`. Its `next/font` build cannot download Onest, Source Code
Pro and Source Serif 4 from Google Fonts because the fixture-only guard refuses
external connections. Root tests pass **745 tests across 9 files**. This is the
same environment limitation recorded in earlier rounds; no unrelated changes
were made.

`git diff --check` passes. `roborev status` exits 127 because roborev is unavailable,
so automated per-commit review could not run. No dependencies or manifests changed;
`check:packages` is not applicable. No push, publication, remote Git fetch/merge or
dependency lifecycle script was used. Both requested findings are fixed; no
implementation work or open questions remain. Validation limitations are the
full-workspace font download and unavailable roborev.

## Codex fix round 7 — review of `defaef2d4e86`

- `1eed84f2 fix: flush pending RDF bytes at EOF` appends a newline to the
  N3-family parser stream so its lexer consumes buffered UTF-8 bytes before EOF.
  JSON-LD input is unchanged. Valid statements preceding a final Unicode comment
  now reach fetch and search; malformed Unicode-ending input is rejected.
- `e8ad3d66 fix: disable N3 lexer extensions` explicitly sets `n3: false` on the
  budgeted lexer, preserving the supported formats' syntax restrictions.
- `docs: record round-seven validation` records this round's results.

Added **64 fixture regression cases**: Unicode EOF comments with two-, three-
and four-byte characters, including splits at the 4096-byte chunk boundary;
malformed Unicode-ending input; variables in subject, predicate and object
positions; and N3 equality/implication abbreviations (`=`, `=>`, `<=`). Parser
cases cover Turtle, its alias, TriG, N-Triples and N-Quads. Tool cases verify
preserved fetch/search content and rejection/skipping of invalid documents
through both adapters. Before the corresponding fixes, all 22 EOF cases and
30 of the 42 syntax cases failed; N-Triples/N-Quads already rejected extensions.

Validation used Node 24 and the existing fixture-only network guard:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
export NODE_OPTIONS=--require=/tmp/sst-9s2-round2-network-guard.cjs
export GIT_ALLOW_PROTOCOL=file
pnpm exec turbo run build --filter '@jeswr/solid-mcp^...' --concurrency=4
pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run typecheck
pnpm --filter @jeswr/solid-mcp run test
pnpm --filter @jeswr/solid-mcp run test:coverage
TURBO_SCM_BASE=defaef2d4e865b47ea108b760b6bbdf1f683a64e pnpm run gate
pnpm run gate:full
```

All commands except `gate:full` pass (exit 0). The package gate and coverage run
each pass **614 tests across 11 files**, including configured coverage thresholds.
The affected repository gate passes **23/23 tasks**, 7 cached, including root
lint and dependent-package checks.

The session-close full gate exits 1 after **150 successful tasks out of 282**,
12 cached. The unchanged `@jeswr/app-suite#build` cannot download Onest, Source
Code Pro and Source Serif 4 from Google Fonts because the fixture-only guard
refuses external connections. Root tests pass **745 tests across 9 files**.
This is the same validation limitation recorded in earlier rounds; unrelated
code was left untouched.

`git diff --check` passes. `roborev status` exits 127 because roborev is
unavailable, so automated per-commit review could not run. No dependencies or
manifests changed; `check:packages` is not applicable. No push, publication,
remote Git fetch/merge or dependency lifecycle script was used. Both requested
findings are fixed, with no implementation work or open questions remaining.
Validation limitations are the full-workspace font download and unavailable
roborev.

## Codex fix round 8 — review of `9359717525f0`

- `54c80fa5 fix: bound N3 structural allocations` limits N3-family structural
  nesting to 64 levels and charges pending contexts before forwarding opening
  lexer tokens. Context reservations accumulate even for empty scopes that emit
  no quads. Generated blank nodes consume the shared allocation budget before
  factory construction, including nodes that never reach an emitted quad.
  README documents the limits.
- `docs: record round-eight validation` records this round's results.

The conservative choices are a 64-level nesting limit matching JSON-LD, a
128-byte context reservation, and a 64-byte reservation for each generated blank
node. Graph and annotation scopes count alongside blank-node, collection,
reified-triple and triple-term contexts. These reservations share the existing
1 MiB allocation budget with directives and expanded terms.

Added **42 fixture cases** covering every structural token pair, boundary and
excessive nesting, sibling contexts, empty TriG graphs without quads, generated
list nodes sharing directive budgets, structural characters inside data, and
fetch truncation/search skipping through both adapters. Against the previous
parser, **36 regression cases fail**; with the fix, all cases pass. Spies on N3's
actual context and node allocation paths verify that deep input stops before
retaining a 65th context and before emitting any quad.

Validation used Node 24 and the existing fixture-only network guard:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
export NODE_OPTIONS=--require=/tmp/sst-9s2-round2-network-guard.cjs
export GIT_ALLOW_PROTOCOL=file
pnpm exec turbo run build --filter '@jeswr/solid-mcp^...' --concurrency=4
pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run typecheck
pnpm --filter @jeswr/solid-mcp run test
pnpm --filter @jeswr/solid-mcp run test:coverage
TURBO_SCM_BASE=9359717525f01afb16e1fae2ccf876a987508bd3 pnpm run gate
pnpm run gate:full
```

All commands except `gate:full` pass (exit 0). The package gate and coverage run
each pass **656 tests across 11 files**, including configured coverage thresholds.
The affected repository gate passes **23/23 tasks**, 7 cached, including root
lint and dependent-package checks. Root tests pass **745 tests across 9 files**.

The initial full gate exits 1 after **199 successful tasks out of 284**, 12 cached:
the temporary guard intercepts seven guarded-fetch DNS fixtures before their
injected lookup can run. The app-suite font build also reports refused external
connections. A temporary guard revision permits injected lookup callbacks but
refuses every non-loopback resolved address before socket connection; a separate
probe confirms that refusal. No repository harness or package code was changed
for this validation adjustment. Then:

```sh
export NODE_OPTIONS=--require=/tmp/sst-9s2-round8-network-guard.cjs
pnpm --filter @jeswr/guarded-fetch run test
pnpm run gate:full
```

The guarded-fetch fixture suite passes **335 tests across 6 files** (exit 0).
The full-gate retry exits 1 after **211 successful tasks out of 286**, 198 cached,
at the unchanged `@jeswr/app-suite#build`: `next/font` cannot download Onest,
Source Code Pro and Source Serif 4 from Google Fonts through the fixture-only
network guard. This is the same font-download limitation recorded in prior
rounds. Unrelated code was left untouched.

`git diff --check` passes. `roborev status` exits 127 because roborev is
unavailable, so automated per-commit review could not run. No dependencies or
manifests changed; `check:packages` is not applicable. No push, publication,
remote Git fetch/merge or dependency lifecycle script was used. The requested
finding is fixed, with no implementation work or open questions remaining.
Validation limitations are the full-workspace font download and unavailable
roborev.

## Codex fix round 9 — review of `049227c5466b`

- `ee2698f8 fix: bound legacy ACL validation` replaces the unbounded ACL `text()`
  read with incremental streaming and budgeted Turtle parsing before validation.
  Byte, parser, and stream failures abort before any ACL write or inbound pull;
  budget exhaustion cancels the body, releases its reader, and destroys the
  parser. Cancellation errors or stalled cancellation hooks cannot delay refusal.
- `docs: record round-nine validation` records this round's results.

The conservative internal limits match this branch's existing RDF adapter:
1 MiB of response bytes, 16,384 input quads including duplicates, 1 MiB of
expanded quad terms, 64 nesting levels, and a shared 1 MiB allocation/work
budget. Work reservations include tokens, pending contexts, generated blank
nodes, unused declarations, and the quadratic cost of base normalization.
Reservations can reject a document before its exact output reaches 1 MiB.
The installed `parseRdf` exposes no factory or budget hooks, so the local
adapter uses its existing N3 parser directly without adding dependencies.

Added **29 fixture cases** covering absent/false Content-Length, early declared
size rejection, exact byte/quad/depth boundaries, UTF-8 chunk splits and EOF,
expanded prefixes and duplicate terms, unused declarations, base work,
generated nodes, stalled tails/cancellation, nonstream shims, incomplete RDF,
and stream failures. Four complete-document regressions fail against the
original implementation and pass with the fix. The complete package suite has
**740 passing tests across 38 files**.

Validation used Node 24 and the existing fixture-only network guard:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
export NODE_OPTIONS=--require=/tmp/sst-9s2-round8-network-guard.cjs
export GIT_ALLOW_PROTOCOL=file
pnpm exec turbo run build --filter '@jeswr/agentic-legacy-bridge^...' --concurrency=4
pnpm --filter @jeswr/agentic-legacy-bridge run gate
pnpm --filter @jeswr/agentic-legacy-bridge run test:coverage
TURBO_SCM_BASE=049227c5466b2875c1923706171f19e663fac765 pnpm run gate
pnpm run gate:full
```

The dependency build, package gate, coverage run, and affected repository gate
pass (exit 0). Package gate and coverage each pass all 740 tests. Aggregate
coverage is 96.32% lines / 86.88% branches; the ACL parser helper has 96.42%
lines / 92.30% branches. The affected gate passes **23/23 tasks**, 6 cached,
including root lint and dependent agent-model/personal-agent checks.

The first full gate exits 1 after **84 successful tasks out of 265**, 12 cached:
seven unchanged root layer-guard tests exceed their 5000 ms timeout under
concurrent build load. An isolated root run and full-gate retry then use:

```sh
pnpm exec turbo run test:root --concurrency=1
pnpm run gate:full
```

The isolated root suite passes **745 tests across 9 files** (exit 0), caching
its result without changing any test or configuration. The full-gate retry
exits 1 after **106 successful tasks out of 284**, 84 cached, at the unchanged
`@jeswr/app-suite#build`: `next/font` cannot download Onest, Source Code Pro,
or Source Serif 4 from Google Fonts through the fixture-only network guard.
This is the font-download limitation already recorded in earlier rounds.

`git diff --check` passes. `roborev status` exits 127 because roborev is
unavailable, so automated per-commit review could not run. No dependencies or
manifests changed; `check:packages` is not applicable. No push, publication,
remote Git fetch/merge or dependency lifecycle script was used. The requested
finding is fixed, with no implementation work or open questions remaining.
Validation limitations are the full-workspace font download and unavailable
roborev.

## Codex fix round 10 — review of `7677e4f4e47e`

- `badc90fe fix: normalize JSON-LD scalar literals` converts native scalar
  values to lexical strings before byte accounting and literal construction,
  preserving the supplied datatype and existing string lexical values.
- `docs: record round-ten validation` records this round's results.

Added **19 fixture cases**: nine parser cases for typed booleans, zero,
positive/negative integers, fractional/exponential numbers and preserved strings;
ten MCP cases exercising fetch serialization and search matching through both
adapters. Before the fix, 17 cases fail and the two string cases pass. After the
fix, all 19 cases pass. No API, dependency, manifest or design changes were needed.

Validation used Node 24 and the existing fixture-only network guard:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
export NODE_OPTIONS=--require=/tmp/sst-9s2-round8-network-guard.cjs
export GIT_ALLOW_PROTOCOL=file
pnpm exec turbo run build --filter '@jeswr/solid-mcp^...' --concurrency=4
pnpm --filter @jeswr/solid-mcp exec vitest run test/bounded-rdf.test.ts test/chatgpt-tools.test.ts -t 'JSON-LD scalar'
pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run typecheck
pnpm --filter @jeswr/solid-mcp run test
pnpm --filter @jeswr/solid-mcp run test:coverage
TURBO_SCM_BASE=7677e4f4e47ee1a8c4b477daf926b0aeb9740f5e pnpm run gate
pnpm run gate:full
```

All commands except `gate:full` pass (exit 0). The package gate and coverage run
each pass **675 tests across 11 files**. Aggregate coverage is 98.13% lines /
90.65% branches; configured thresholds pass. The affected repository gate passes
**23/23 tasks**, 7 cached, including root lint and dependent-package checks.

The full gate exits 1 after **87 successful tasks out of 267**, 12 cached, at the
unchanged `@jeswr/app-suite#build`: `next/font` cannot download Onest, Source Code
Pro or Source Serif 4 from Google Fonts through the fixture-only network guard.
The root suite passes **745 tests across 9 files**. This is the font-download
limitation already recorded in prior rounds; unrelated code remains untouched.

`git diff --check` passes. `roborev status` exits 127 because roborev is
unavailable, so automated per-commit review could not run. `check:packages` is
not applicable because no dependencies were added. No push, publication,
remote Git fetch/merge or dependency lifecycle script was used. The requested
finding is fixed, with no implementation work or open questions remaining.
Validation limitations are the full-workspace font download and unavailable
roborev.

## Codex fix round 11 — review of `407947965b5c`

- `87d51978 fix: canonicalize typed JSON-LD numbers` applies numeric lexical
  conversion before byte accounting and literal construction, retaining supplied
  datatypes and string values. Fractional numbers, numbers of magnitude at least
  1e21, and numbers explicitly typed as xsd:double use canonical double forms;
  other native numbers use canonical integer forms, following
  [JSON-LD object-to-RDF conversion](https://www.w3.org/TR/json-ld11-api/#object-to-rdf-conversion).
- `docs: record round-eleven validation` records this round's results.

Added **23 fixture cases** and corrected existing scalar expectations. Cases cover
negative and exponential numbers, double-typed zero and integers, precision,
preserved strings, implicit/explicit RDF-term equivalence, and fetch/search through
both adapters. Before the fix, the focused suite has **22 failures and 20 passes**;
afterward, all **42 selected cases pass**. No API, dependency, manifest or design
changes were needed.

Validation used Node 24.22.1 and the existing fixture-only network guard:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
export NODE_OPTIONS=--require=/tmp/sst-9s2-round8-network-guard.cjs
export GIT_ALLOW_PROTOCOL=file
pnpm exec turbo run build --filter '@jeswr/solid-mcp^...' --concurrency=4
pnpm --filter @jeswr/solid-mcp exec vitest run test/bounded-rdf.test.ts test/chatgpt-tools.test.ts -t 'JSON-LD scalar'
pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run typecheck
pnpm --filter @jeswr/solid-mcp run test
pnpm --filter @jeswr/solid-mcp run test:coverage
TURBO_SCM_BASE=407947965b5cef614665095fd5e69f6aaf1553a4 pnpm run gate
pnpm run gate:full
```

The dependency build, focused regressions after the fix, package gate, coverage,
and affected repository gate pass (exit 0). Package tests and coverage each pass
**698 tests across 11 files**. Aggregate coverage is **98.13% lines / 90.83%
branches**; configured thresholds pass. The affected gate passes **23/23 tasks**,
7 cached, including root lint and dependent-package checks.

The first full gate exits 1 after **58 successful tasks out of 222**, 12 cached:
three unchanged root layer-guard fixtures exceed their 5000 ms timeout under
concurrent build load. An isolated root run and full-gate retry use:

```sh
pnpm exec turbo run test:root --concurrency=1
pnpm run gate:full
```

The isolated root run exits 1 with **744/745 tests passing**: the earlier timeout
cases pass, but an unchanged SDK-layer performance assertion takes 154.55 ms
against a 50 ms limit. The full-gate retry passes all **745 root tests across
9 files**, then exits 1 after **97 successful tasks out of 273**, 57 cached, at
the unchanged `@jeswr/app-suite#build`: `next/font` cannot download Onest,
Source Code Pro or Source Serif 4 from Google Fonts through the fixture-only
network guard. This is the font-download limitation recorded in earlier rounds.
No unrelated test, timeout or build configuration was changed.

`git diff --check` passes. `roborev status` exits 127 because roborev is
unavailable, so automated per-commit review could not run. `check:packages` is
not applicable because no dependencies were added. No push, publication,
remote Git fetch/merge or dependency lifecycle script was used. The requested
finding is fixed, with no implementation work or open questions remaining.
Validation limitations are the full-workspace font download and unavailable
roborev.

## Codex fix round 12 — review of `32d16199b2c3`

- `37b4174d fix: normalize implicit JSON-LD numbers` shares native numeric
  lexical conversion between the budgeted factory and the streaming parser's
  scalar conversion seam. Implicit numbers use magnitude when choosing their
  default datatype; context coercion retains precedence. Supplied lexical strings
  and opaque JSON data retain their values. The adapter is instance-local.
- `698aa8c8 fix: reject overflowing JSON-LD numbers` rejects non-finite parsed
  numbers before JSON reserialization can substitute null, including inside
  opaque JSON literals. Fetch returns a tool error and search skips that document.
  Rejection is the conservative option explicitly permitted by the review.
- `docs: record round-twelve validation` records this round's results.

Added **53 fixture regression cases**: 24 for numeric conversion and 29 for
non-finite values and finite opaque data. Coverage includes positive/negative
integer precision, negative magnitudes at/above 1e21, explicit/implicit term
equivalence, context coercion, arrays, lists, aliases, scoped contexts, preserved
strings, finite numeric boundaries, and fetch/search through both adapters.
Against the prior implementations, **17 numeric cases** and **28 overflow cases**
fail; the remaining new cases verify preserved behavior. After both fixes, all
**354 tests in the two focused suites pass**.

Validation used Node 24.22.1 and the existing fixture-only network guard:

```sh
export PATH="/opt/node24/bin:$PWD/node_modules/.bin:$PATH"
export NODE_OPTIONS=--require=/tmp/sst-9s2-round8-network-guard.cjs
export GIT_ALLOW_PROTOCOL=file
pnpm exec turbo run build --filter '@jeswr/solid-mcp^...' --concurrency=4
pnpm --filter @jeswr/solid-mcp exec vitest run test/bounded-rdf.test.ts test/chatgpt-tools.test.ts
pnpm --filter @jeswr/solid-mcp run lint
pnpm --filter @jeswr/solid-mcp run build
pnpm --filter @jeswr/solid-mcp run typecheck
pnpm --filter @jeswr/solid-mcp run test
pnpm --filter @jeswr/solid-mcp run test:coverage
TURBO_SCM_BASE=32d16199b2c32a8e69d40590a7210593641c8e98 pnpm run gate
pnpm run gate:full
pnpm exec turbo run test:root --concurrency=1
pnpm run gate:full
```

Dependency build, focused suites, package lint/build/typecheck/tests, coverage,
and the affected repository gate pass (exit 0). Package tests and coverage each
pass **751 tests across 11 files**. Aggregate coverage is **98.16% lines / 90.84%
branches**; configured thresholds pass. The affected gate passes **23/23 tasks**,
7 cached, including root lint and dependent-package checks.

The first full gate exits 1 after **74 successful tasks out of 242**, 12 cached:
an unchanged SDK-layer timing assertion takes 73.19 ms against its 50 ms limit
under concurrent build load; the other 744 root tests pass. The isolated root
retry passes all **745 tests across 9 files** (exit 0), caching that result without
changing code or configuration. The full-gate retry exits 1 after **116 successful
tasks out of 285**, 74 cached, at the unchanged `@jeswr/app-suite#build`:
`next/font` cannot download Onest, Source Code Pro or Source Serif 4 from Google
Fonts through the fixture-only network guard. This is the font-download limitation
recorded in earlier rounds. No unrelated changes were made.

`git diff --check` passes. `roborev status` exits 127 because roborev is unavailable,
so automated per-commit review could not run. No dependencies or manifests changed;
`check:packages` is not applicable. No push, publication, remote Git fetch/merge or
dependency lifecycle script was used. Both findings are fixed; no implementation
work or open questions remain. Validation limitations are the full-workspace font
download and unavailable roborev.
