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
