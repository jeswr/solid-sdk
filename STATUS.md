<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# sst-bi8j — MAI-00 mail model lane

Implemented on `lane/sst-bi8j`, based on `87e46ebd2ce33de295357a9610b64d358021b460`.

## Commits

- `0bbdd933` — `feat: port typed mail model accessors`: port pod-mail's typed message,
  thread, collection, mailbox, Turtle and Type Index model and regression tests; add
  attachment/source accessors, account-aware paths and conservative interpretations in QUESTIONS.md.
- `393a5c31` — `feat: add mail reader operations and streaming import`: injected pod-scoped
  fetch store, conditional writes, reader/count/paging helpers, read/label/star/archive operations,
  streaming mboxrd/Takeout MIME importer, raw source and attachment persistence, 50-message fixture,
  coverage gate, dependency declarations and lockfile. Replacing a Type Index registration clears
  its previous instance/container alternative.
- This final documentation commit — `docs: record MAI-00 lane validation`.

Every commit uses the required identity, disabled signing and GPT-6.1-Sol co-author trailer.

## Verification

All commands ran inside this checkout. No lifecycle scripts were enabled.

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/guarded-fetch run build` | PASS; dependency output only, uncommitted |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; dependency output only, uncommitted |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; Next production build, strict tsc, 9 test files / 64 tests |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS; all model TypeScript included, 100% statements (432/432), branches (198/198), functions (146/146), lines (385/385) |
| `pnpm run lint:root` | PASS; workspace/transport/fetch/token checks and 74 contrast pairs |
| `TURBO_SCM_BASE=87e46ebd2ce33de295357a9610b64d358021b460 pnpm run gate` | PASS; final sequential run, 8/8 tasks, 4 cached |
| `pnpm run gate:full` | FAIL outside lane scope: `@jeswr/unstorage-solid#build` bootstrap attempts npm writes under read-only `/home/runner/.npm`; 20 successful / 74 scheduled tasks |
| `npm_config_cache=/tmp/sst-bi8j-npm-cache pnpm run gate:full` | FAIL at the same existing bootstrap/cache access; Turbo did not forward the cache override; 20 successful / 39 scheduled tasks |
| `git diff --check` | PASS |
| `command -v roborev` | Exit 1; executable unavailable, so no automated review verdict could be obtained |

The first affected-gate attempt overlapped the standalone Next build and failed its build lock;
this was corrected by the successful sequential run above. Initial implementation test/type errors
were fixed before the final passing checks. Final lint is clean.

Inspection after the full-gate attempts revealed that untouched
`packages/unstorage-solid/scripts/build-deps.mjs` also runs `git clone` for fetch-rdf in a temporary
directory before its npm install. Those gate attempts invoked this existing bootstrap before that
behavior was identified. Further full-gate retries were stopped because this conflicts with the
lane's no-network-Git / checkout boundary. No lane branch was fetched, merged, switched, pushed,
or published, and no other existing checkout was edited. The full-workspace gate remains incomplete.

## Dependency policy and installation

Before changing the manifest:

- `pnpm run check:packages @jeswr/fetch-rdf @rdfjs/wrapper @solid/object n3 @rdfjs/types @types/n3 postal-mime @vitest/coverage-v8 @jeswr/guarded-fetch`
  cleared all eight third-party packages; the overall command failed because guarded-fetch is a
  workspace-only package and does not exist in npm.
- `pnpm run check:packages @jeswr/fetch-rdf @rdfjs/wrapper @solid/object n3 @rdfjs/types @types/n3 postal-mime @vitest/coverage-v8`
  passed all eight in full registry mode.
- `pnpm run check:packages @jeswr/guarded-fetch --mode policy` passed. It is used through
  `workspace:*`, never installed from npm. No guarded-fetch source was changed.

All third-party versions reuse existing lockfile entries except the required browser MIME parser
`postal-mime` (resolved to 2.7.6). Coverage tooling was already present elsewhere in the lockfile.
An initial `pnpm install --ignore-scripts` failed because the shared pnpm cache is read-only.
After copying that cache into writable scratch storage, the successful command was:
`CI=true pnpm install --ignore-scripts --no-frozen-lockfile --store-dir /tmp/sst-bi8j-pnpm-store`.
Only this app's importer entries and postal-mime were added to the committed lockfile.

## Scope, limitations and questions

The 50-message fixture produces ten threads and the expected Inbox/Work/Starred membership and
unread counts. Tests cover typed RDF round trips, flag toggles, attachment bytes and metadata,
raw .eml persistence, streaming chunk boundaries, size limits, reply chains, Gmail labels,
conditional conflicts, missing/weak validators, access errors and pod/redirect boundaries.

No React, hooks, SDK facade, shell, routes or UI were added. Screenshots and Playwright/axe checks
are not applicable to this pure model lane; no browser was launched. No inventory changes were
needed because no project was added.

QUESTIONS.md records the conservative choices: preserve pod-mail's schema.org scheme, use a
starred collection, accept extracted Takeout mbox streams, surface partial multi-document writes,
and register into a caller-supplied existing Type Index. ZIP extraction and SDK-owned index
bootstrap remain for later connector/hook work. Imports are bounded to 25 MiB per message;
collisions fail rather than overwrite. References identifies out-of-order threads; In-Reply-To-only
chains use previously seen messages. Writes across documents are sequential, so callers reload
on conflict/partial completion. These are documented model boundaries, not hidden retries.

Unfinished verification: the unrelated full-workspace bootstrap failure and unavailable roborev.
No implementation work is left pending within the selected interpretations. The questions above
remain open to maintainer override; none blocks the supplied model API.

## Fix round 1 — review of 00fc55619f89

Implemented only the four supplied findings on `lane/sst-bi8j`:

- `93c8c4ea` — `fix: address mail model review findings`: reject remote JSON-LD contexts
  (including nested/scoped contexts, arrays and `@import`) before fetch-rdf can invoke its
  unscoped loader, for both document and container reads. Inline contexts remain supported.
  Generate collision-safe paths with reversible tilde escaping for account, message, thread,
  folder and attachment identifiers, retaining original Message-IDs and label titles as RDF
  metadata. Include the account in attachment keys. Preserve decoded HTML as inert `bodyHtml`
  (`schema:articleBody`), prefer original plain text for `body`, and derive a readable text
  fallback for HTML-only mail. Add regression tests and update the model documentation.
- This final documentation commit — `docs: record mail review fix validation`.

Verification before the final commit:

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/guarded-fetch run build && pnpm --filter @jeswr/suite-ui run build` | PASS; existing dependency output only, uncommitted |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; lint, Next production build, strict tsc, 9 test files / 73 tests |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS; 100% statements (456/456), branches (234/234), functions (153/153), lines (407/407) |
| `pnpm run lint:root` | PASS; workspace/transport/fetch/token checks and 74 contrast pairs |
| `TURBO_SCM_BASE=00fc55619f890b59e11c33f9d56eda2a22d2bf67 pnpm run gate` | PASS; 7/7 tasks, 0 cached |
| `git diff --check` | PASS |
| `command -v roborev` | Exit 1; executable still unavailable, so no automated review verdict obtained |
| `pnpm run gate:full` | Not run this round: the existing unstorage-solid bootstrap explicitly invokes a network `git clone`, prohibited by this fix lane; prior full-gate failures remain documented above |

An initial direct Vitest run could not resolve the unbuilt guarded-fetch dependency. Building
the existing workspace dependencies resolved it before the passing coverage and package gates.
No dependencies were added or changed, so no new dependency policy check was required. No UI
or screenshots apply. No network Git operations, branch switches, pushes, PRs or changes to
other checkouts were performed.

All four review findings are addressed. Conservative choices: refuse every remote JSON-LD
context, including in-pod references, since fetch-rdf cannot inject a scoped context loader;
keep HTML inert and use a small text reduction rather than introduce a dependency. The text
fallback is not an HTML sanitiser. No new open questions or unfinished implementation work.
Verification limitations remain the unavailable roborev executable and the unrelated full gate.

## Fix round 2 — review of 75079ec3e72e

Implemented exactly the five supplied findings on `lane/sst-bi8j`, based on
`75079ec3e72e8388d368cc17e6c4211764010467`:

- `c2f7dcb5` — `fix: bound mail import and complete thread paging`: replace retained
  per-line arrays with blocks of at most 64 KiB. Classify separator candidates before charging
  message bytes, discard envelope bytes as they stream, and scan complete leading quote runs
  for mboxrd unquoting, including unterminated final lines. Reserve literal `system:` folder
  keys for imports and archive/star operations while preserving custom label identifiers and
  case. Load the candidate threads' referenced message documents before sorting and paging.
  Add regression tests for allocation bounds with 262,144 short lines, separator chunk splits
  at the exact message limit, long quoted/unquoted prefixes, folder membership/title isolation,
  and complete cross-folder conversations with newest-reply ordering and page boundaries.
- This final documentation commit — `docs: record second mail fix validation`.

Verification before the final commit (all inside this checkout):

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/guarded-fetch run build && pnpm --filter @jeswr/suite-ui run build` | PASS; existing dependency output only, uncommitted |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; lint, Next production build, strict tsc, 9 test files / 78 tests |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS; 100% statements (488/488), branches (259/259), functions (156/156), lines (437/437) |
| `pnpm run lint:root` | PASS; workspace/transport/fetch/token checks and 74 contrast pairs |
| `TURBO_SCM_BASE=75079ec3e72e8388d368cc17e6c4211764010467 pnpm run gate` | PASS; 7/7 tasks, 0 cached |
| `git diff --check` | PASS |
| `command -v roborev` | Exit 1; executable unavailable, so no automated review verdict obtained |
| `pnpm run gate:full` | Not run: the existing unstorage-solid bootstrap invokes a network `git clone`, prohibited by this lane; prior full-gate failures remain documented above |

The first new paging assertion compared internal RDF store representations; it was corrected
before the passing coverage run to compare returned thread/message values and dates. The first
package gate found a missing `this` type annotation in allocation-test instrumentation; this
was corrected before the successful full package and affected-workspace gates.

All five findings are addressed; no implementation work or new questions remain. The conservative
namespace choice keeps system folders and custom labels in the same existing folder container,
so discovery still lists them directly. A custom `system:inbox` label escapes its colon and cannot
collide with the reserved system document. No migration of previously imported data was requested.
No dependencies, UI, screenshots, or other packages were changed. No network Git operations,
branch switches, pushes, PRs, or changes to other checkouts were performed. Remaining verification
limitations are the unavailable roborev executable and the prohibited full-workspace bootstrap.

## Fix round 3 — review of 25097c501461

Implemented exactly the three findings in
`solid-sdk-lane-sst-bi8j-25097c501461.md` on `lane/sst-bi8j`:

- `6457147f` — `fix: enforce mail RDF and thread consistency`: parse JSON-LD from the
  validated canonical JSON representation so duplicate keys cannot expose discarded remote
  contexts to the streaming parser. Preserve the final document URL and ETag for relative
  identifiers and conditional writes. Honor explicit References roots before cached parent
  ancestry, reconcile provisional cache mappings for future descendants and missing ancestors,
  and carry thread-merge metadata to persistence. Conditional writes move previously saved
  members to the resolved thread and clear their old thread memberships without retaining
  prior message bodies. Reject named graphs before Turtle serialization or any PUT.
- This final documentation commit — `docs: record third mail fix validation`.

Regression tests exercise duplicate context keys at the document and nested graph-node levels
through both load and list, verifying that global fetch is never called. They cover named
graphs loaded from TriG, N-Quads and JSON-LD, plus late References, cached descendants, missing
ancestors, independent conversations and reconciliation of already persisted provisional
members. Missing provisional thread documents are left absent.

Verification before the final commit (all inside this checkout):

| Command | Result |
| --- | --- |
| `pnpm --filter @jeswr/guarded-fetch run build && pnpm --filter @jeswr/suite-ui run build` | PASS; existing dependency output only, uncommitted |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; lint, Next production build, strict tsc, 9 test files / 85 tests |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS; 100% statements (528/528), branches (281/281), functions (157/157), lines (469/469) |
| `pnpm run lint:root` | PASS; workspace/transport/fetch/token checks and 74 contrast pairs |
| `TURBO_SCM_BASE=75079ec3e72e8388d368cc17e6c4211764010467 pnpm run gate` | PASS; 8/8 tasks, 0 cached |
| `pnpm --filter @jeswr/app-suite exec vitest run test/mail/io.test.ts test/mail/importer.test.ts -t 'validated representation\|rejects named graphs\|honors References\|conditionally reconciles' --reporter=json --outputFile=/tmp/sst-bi8j-regression-baseline.json` | Expected FAIL against the three original source files at `25097c50`: all seven regression cases fail; fixed source restored immediately afterward |
| `git diff --check` | PASS |
| `command -v roborev` | Exit 1; executable unavailable, so no automated review verdict obtained |
| `pnpm run gate:full` | Not run: the existing unstorage-solid bootstrap invokes a network `git clone`, prohibited by this lane; prior full-gate failures remain documented above |

The first duplicate-key regression draft did not trigger the loader at its nested location;
it was strengthened to a graph-node context and verified to fail against the original code.
A coverage run exposed a missing independent-cache branch case; that case was added before
the final passing coverage, package and affected-workspace gates.

All three findings are addressed. The conservative dataset choice rejects named-graph writes
rather than change the store's Turtle media type or discard graph data. Streaming items carry
merge information for consumers; `persistImportedMail` applies it with the existing sequential,
conditional-write semantics. Conflicts and partial completion still require callers to reload.
No dependencies, UI, screenshots or other packages changed. No network Git operations, branch
switches, pushes, PRs or edits to other checkouts occurred. No new open questions or unfinished
implementation work remain. Verification limitations are the unavailable roborev executable
and the prohibited full-workspace bootstrap.
