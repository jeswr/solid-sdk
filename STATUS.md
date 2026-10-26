<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# sst-hd1k / CON-00 lane report

Branch: `lane/sst-hd1k`. Base: `606c87b7edf73e83f118f95295b0eeda7abb6d92`.
Scope: pure contacts model under `apps/suite/src/apps/contacts/lib/model/`.

## Commits

- `be8b4293` — `feat: add contacts model and conditional operations`: reuse the shared
  SolidOS typed wrappers and serializers; add people/groups index readers, validation,
  alphabetical sections, injected and pod-scoped fetch, conditional contact/group CRUD,
  membership cleanup, explicit PM migration, Type Index registration/discovery, and vCard
  preview/import through the existing DAV bridge. Add model tests and fixtures, direct
  dependencies already used in the workspace, and 100% coverage thresholds.
- `88c6636f` — `fix: report completed contacts in interrupted imports`: expose successful
  contact IDs and the underlying failure when a vCard batch stops part-way; add a regression
  test and the `test:coverage` command.
- `6a178e30` — `fix: bound contact discovery results and duration`: cap results within
  individual documents and pass a shared cancellable ten-second deadline through index and
  resource reads; add cancellation/result-cap coverage.
- Final documentation commit — this report, including final verification and limitations.

## Verification

| Exact command | Result |
| --- | --- |
| `pnpm run check:packages @jeswr/fetch-rdf @rdfjs/wrapper @rdfjs/types @solid/object n3 @types/n3 @vitest/coverage-v8` | PASS, all 7 packages cleared in full npm mode, before adding these direct dependencies. |
| `pnpm run check:packages --scan apps/suite/package.json` | PASS, all 21 registry dependencies cleared; workspace dependencies are skipped by the guard. |
| `pnpm install --ignore-scripts` | PASS; existing peer warnings only. Unrelated lockfile snapshot churn was removed. |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS with the scoped lockfile changes. No lifecycle scripts enabled. |
| `pnpm --filter '@jeswr/app-suite^...' run build` | PASS; build workspace dependencies before app checks. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; production Next.js build; 5 test files, 36 tests. |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS; 100% statements (320/320), branches (145/145), functions (71/71), lines (281/281), across all 6 model modules. |
| `pnpm run lint:root` | PASS, including workspace/transport/fetch/token guards and 74 contrast pairs. |
| `TURBO_SCM_BASE=606c87b7edf73e83f118f95295b0eeda7abb6d92 pnpm run gate` | PASS on the final implementation: 11/11 tasks, 5 cached; all 36 app tests pass. |
| `pnpm run gate:full` | Environment failure: unrelated `@jeswr/unstorage-solid` build runs npm install and cannot write `/home/runner/.npm` (EROFS). |
| `npm_config_cache=/tmp/sst-hd1k-npm-cache pnpm run gate:full` | Same environment failure; Turbo strict environment mode strips the temporary cache override. |
| `npm_config_cache=/tmp/sst-hd1k-npm-cache pnpm run gate:full --env-mode=loose` | FAIL outside lane scope: 240 tasks succeeded before `@jeswr/federation-trust#test` failed on the existing delegation credential snapshot (`test/characterization.test.ts:196`). Expected JWK property order `crv,x,kty`; actual order `kty,crv,x`. No snapshots updated. |
| `pnpm --filter @jeswr/federation-trust exec vitest run test/characterization.test.ts` | Reproduces the unrelated snapshot failure in isolation: 19 tests pass, 1 fails. The package is unchanged by this lane. |
| `git diff --check` | PASS. |
| `roborev status` | Unavailable: `roborev: command not found`; no review verdict can be claimed. No tool installation or configuration changes made. |

Tests exercise canonical book/person/group serialization, SolidOS-shaped fixtures, PM flat
`#it` migration preserving name/emails/phones/note/organization/WebID, indexed sorting,
create/update/delete/group membership, field clearing, retention of UID/creation/foreign RDF,
Type Index idempotence and bounded discovery, imports, missing/weak/stale ETags, redirects,
foreign URL refusal, and partial multi-document failures. The test pod enforces HTTP
preconditions and parses every RDF write; the model and bridge are not mocked.

## Scope readings and integration boundaries

See `QUESTIONS.md` for numbered spec references and conservative choices. There is no blocking
model implementation question. The later integration supplies owner-private containers and an
existing linked Type Index, wraps these functions in hooks/outbox/cache, handles trash/undo,
and retrieves remote CardDAV exports through the existing guarded bridge. The bridge's ORG-to-note
mapping is preserved; PM migration preserves a separate organization field. Multi-document writes
report completed URLs and never delete a migration source until copying and indexing succeed.

No React, hooks, SDK facade, shell, routes, components or UI states were introduced. Screenshots,
Playwright and axe are not applicable to this model-only lane; no browser was launched and no PNGs
were produced. No shared package source, suite inventory, access-control policy, or unrelated app
was changed. No push, PR, branch switch, or remote fetch/merge was performed.

The full gate's build scripts generated untracked callback/client-ID files under the existing
pod apps' `web/public/` directories. Those generated files were removed after the gate; none
were committed. The affected/application gates and model coverage are the lane's passing
checks. Full-workspace green and roborev review remain unverified for the reasons above.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 1

Review base: `fe2bcc8e4632b73c78807a3427b122389968b63f`.
All four supplied review findings are addressed, without changing shared packages or dependencies.

- `6af454a1` — `fix: bound contacts RDF transport reads`: request Turtle and refuse JSON-LD
  before the dependency can resolve remote contexts through global fetch. Cap every RDF
  response at 512 KiB while streaming, independently of absent or false Content-Length;
  reject datasets above 10,000 quads before application accessors run. Cancel response
  readers on abort, including injected streams that ignore the fetch signal.
- `d02f6996` — `fix: refuse lossy contact migrations and identifiers`: refuse migration
  before any writes when source quads cannot be represented by the mapped flat contact
  fields. Existing UID, photo, unrelated RDF, structured values, extra field values and
  language-tagged literals remain in the untouched source. Require canonical HTTP(S)
  identifiers for WebIDs and group members, matching the shared setters.
- `4604aca3` — `fix: collect discovered contacts within bounds`: iterate flat contacts
  lazily, materialize fields only for accepted results, stop further source/container
  traversal at the result/read caps, and check cancellation while traversing.
- Final documentation commit — this fix-round verification report.

Conservative choices explicitly permitted by the review: JSON-LD responses are refused
entirely because the current parser cannot accept a scoped/refusing document loader;
lossy source migrations are refused instead of deleting unsupported RDF; noncanonical
identifiers are rejected instead of normalized. Supported canonical identifiers round-trip
through create/update and membership operations.

Fix-round verification:

| Exact command | Result |
| --- | --- |
| `pnpm --filter '@jeswr/app-suite^...' run build` | PASS; workspace declarations built before checking the app. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; production Next.js build, 5 test files, 64 tests. |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS; 100% statements (389/389), branches (189/189), functions (78/78), lines (344/344). |
| `pnpm run lint:root` | PASS, including all 74 contrast pairs and repository guards. |
| `TURBO_SCM_BASE=fe2bcc8e4632b73c78807a3427b122389968b63f pnpm run gate` | PASS; 10/10 tasks, all 64 app tests. |
| `npm_config_cache=/tmp/sst-hd1k-npm-cache pnpm run gate:full --env-mode=loose` | FAIL outside lane scope: 239 tasks succeeded; `@jeswr/federation-codegen#test` fails two existing namespace/output assertions in `test/generator.test.ts:81` and `:126`. Expected `https://w3id.org/jeswr/…`; vocabulary inputs use `https://jeswr.org/ns/…`. Used the previously documented writable-cache workaround for this sandbox. |
| `pnpm --filter @jeswr/federation-codegen run test` | Reproduces both failures independently: 23 tests pass, 2 fail. |
| `git diff --exit-code fe2bcc8e4632b73c78807a3427b122389968b63f -- tools/federation-codegen packages/solid-federation-vocab` | PASS; the failing tool, generated expectations and vocabulary inputs are unchanged by this fix round. |
| `git diff fe2bcc8e4632b73c78807a3427b122389968b63f --check` | PASS. |
| `roborev status` | Unavailable: `roborev: command not found`. No installation or configuration changes made. |

No implementation work remains for the supplied four findings. Full-workspace green and
roborev review remain unavailable for the reasons above. No open questions, dependency
additions, UI changes or screenshots. The full gate's generated pod-app callback/client-ID
files were removed; only contacts model/tests and this report are committed. No push, PR,
branch switch, or remote fetch/merge was performed.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 2

Review base: `d1909525ae4395fd3e91a1502bc6913537772cdc`.
Both supplied findings are addressed. Changes are confined to the contacts model, its
regression tests, and this report; no dependencies or shared package sources changed.

- `b29e549e` — `fix: preserve contact value metadata on updates`: reconcile email,
  telephone and WebID values against existing nodes. Retain unchanged nodes, including
  duplicate nodes for a value, their types, preferences and other metadata. Use the
  shared typed setters for additions and remove obsolete nodes only when no remaining
  edge references them. Regression tests cover renaming parsed data, mixed additions
  and removals, direct values, formatted phones, shared nodes and clearing fields.
- `208d0f3e` — `fix: preflight contacts RDF write limits`: validate every outgoing
  dataset against the existing 10,000-quad and 512-KiB read limits, counting serialized
  UTF-8 bytes, before the first write. Tests cover oversized creates and replacements
  later in a batch, multibyte text, and successful write/read round trips at both limits.
- Final documentation commit — this fix-round verification report.

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite exec vitest run test/contacts-data.test.ts test/contacts-crud.test.ts` | Initial invocation could not resolve unbuilt workspace dependencies; no tests ran. Resolved by the dependency build below; the full app test and coverage runs subsequently passed. |
| `pnpm --filter '@jeswr/app-suite^...' run build` | PASS; build all five workspace dependencies before app checks. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; production Next.js build, 5 test files, 71 tests. |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS; 100% statements (417/417), branches (205/205), functions (81/81), lines (370/370). |
| `pnpm run lint:root` | PASS; repository guards and all 74 contrast pairs pass. |
| `TURBO_SCM_BASE=d1909525ae4395fd3e91a1502bc6913537772cdc pnpm run gate` | PASS; 10/10 tasks, all 71 app tests pass. |
| `npm_config_cache=/tmp/sst-hd1k-npm-cache pnpm run gate:full --env-mode=loose` | FAIL outside lane scope after 173 successful tasks: existing `@jeswr/federation-trust#test` delegation credential snapshot at `test/characterization.test.ts:196` expects JWK order `crv,x,kty`, while actual order is `kty,crv,x`. Used the previously documented writable-cache workaround. |
| `pnpm --filter @jeswr/federation-trust exec vitest run test/characterization.test.ts` | Reproduces the same unrelated snapshot mismatch in isolation: 19 tests pass, 1 fails. No snapshot updated. |
| `git diff --exit-code d1909525ae4395fd3e91a1502bc6913537772cdc -- packages/federation-trust` | PASS; the failing package is unchanged by this round. |
| `git diff d1909525ae4395fd3e91a1502bc6913537772cdc --check` | PASS. |
| `roborev status` | Unavailable: `roborev: command not found`. No tool installation or configuration changes made. |

No implementation work remains for the two supplied findings, and there are no open
questions. Full-workspace green and roborev review remain unavailable for the reasons
above. No UI changes, screenshots, push, PR, branch switch or lane fetch/merge. The full
gate left no untracked generated files in this checkout.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 3

Review: `solid-sdk-lane-sst-hd1k-d468d0bc792a.md`, read in full. The single finding
is addressed without dependency, shared-package, API or UI changes.

- `529f145e` — `fix: preserve additional contact URLs on updates`: leave all existing
  URL RDF untouched when the scalar WebID is unchanged. When it changes, reconcile
  only nodes matching the previously exposed WebID value, retaining other direct and
  structured URL nodes and their metadata. Preserve unreadable URL nodes when adding
  the first WebID. Regression tests cover rename round trips through injected fetch,
  direct and structured homepages, duplicate selected values, replacement, clearing,
  selecting an existing URL, and absent or unsupported URL values.
- Final documentation commit — this report, committed last.

Conservative scope reading: keep the existing scalar WebID reader and edit the value
it exposes; do not introduce a URL collection API or change shared reader semantics.

| Exact command | Result |
| --- | --- |
| `pnpm --filter '@jeswr/app-suite^...' run build` | PASS; build the five workspace dependencies before app checks. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/contacts-data.test.ts` | Before the fix: 6 new regression cases fail, 8 tests pass, confirming the URL-loss behavior. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/contacts-data.test.ts test/contacts-crud.test.ts` | PASS after the fix; 44 tests. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS on the final implementation; production Next.js build, 5 test files, 78 tests. An initial test-only exact-optional-property type error was corrected before this passing run. |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS; 100% statements (422/422), branches (214/214), functions (81/81), lines (373/373). |
| `pnpm run lint:root` | PASS; all repository guards and 74 contrast pairs. |
| `TURBO_SCM_BASE=d1909525ae4395fd3e91a1502bc6913537772cdc pnpm run gate` | PASS; 11/11 tasks, 78 app tests. |
| `npm_config_cache=/tmp/sst-hd1k-npm-cache pnpm run gate:full --env-mode=loose` | FAIL outside lane scope after 181 successful tasks: `@jeswr/federation-codegen#test` has two failures at `test/generator.test.ts:81` and `:126`. Expected bookmark/core namespaces use `https://w3id.org/jeswr/`; ontology inputs use `https://jeswr.org/ns/`, causing target-class and generated-ontology drift failures. Used the previously documented writable-cache workaround. |
| `pnpm --filter @jeswr/federation-codegen exec vitest run test/generator.test.ts` | Reproduces both failures in isolation; 20 tests pass, 2 fail. No generated outputs or expectations changed. |
| `git diff --exit-code d1909525ae4395fd3e91a1502bc6913537772cdc -- tools/federation-codegen` | PASS; the failing tool is unchanged by this lane. |
| `git diff d1909525ae4395fd3e91a1502bc6913537772cdc --check` | PASS. |
| `roborev status` | Unavailable: `roborev: command not found`. No installation or configuration changes made. |

No implementation work remains for the supplied finding; no open questions or new
dependencies. Full-workspace green and roborev review remain unavailable as recorded
above. No screenshots apply to this model-only fix. No push, PR, branch switch, remote
fetch/merge, or changes outside this checkout. The full gate left no untracked generated
files in the checkout.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 4

Review: `solid-sdk-lane-sst-hd1k-72fd5a06322d.md`, read in full alongside the
original and earlier fix briefs. The single WebID save/load finding is addressed.

- `35b0592b` — `fix: persist explicit contact WebID selections`: make model reads
  prefer structured `vcard:WebId` nodes over generic URLs, and use the same reader
  when reconciling updates. Persist an empty typed WebID node when explicitly
  clearing the field, so a retained homepage cannot become the selected WebID.
  Selecting an existing homepage or direct URL writes a separate typed selection;
  subsequent replacement/clearing preserves those original URLs and their metadata.
  Route `loadContact` through the model reader. Add regression tests for direct and
  structured legacy selections, replacement, clearing, selecting existing URLs,
  repeated saves, restoring a cleared field, URL ordering, and invalid explicit values.
- Final documentation commit — this report, committed last.

Conservative scope reading: keep selection handling local to the contacts model and
retain the shared reader's legacy fallback only when no explicit WebID node exists.
The empty typed node distinguishes an explicit clear from untouched legacy data.
No shared package sources, dependencies, public field types, or UI were changed.

| Exact command | Result |
| --- | --- |
| `pnpm --filter '@jeswr/app-suite^...' run build` | PASS; build all five workspace dependencies before app checks. |
| `pnpm --filter @jeswr/app-suite exec vitest run test/contacts-crud.test.ts` | Before the fix: 3 new round-trip cases fail, 31 tests pass; reproduces homepage promotion on replacement, clearing, and selecting another direct URL. |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS on the final implementation; production Next.js build, 5 test files, 90 tests. |
| `pnpm --filter @jeswr/app-suite run test:coverage` | PASS; 100% statements (444/444), branches (235/235), functions (85/85), lines (393/393). |
| `pnpm run lint:root` | PASS; repository guards and all 74 contrast pairs. |
| `TURBO_SCM_BASE=d1909525ae4395fd3e91a1502bc6913537772cdc pnpm run gate` | PASS; 11/11 tasks, all 90 app tests. |
| `npm_config_cache=/tmp/sst-hd1k-npm-cache pnpm run gate:full --env-mode=loose` | FAIL outside lane scope after 184 successful tasks: the two existing `@jeswr/federation-codegen#test` failures at `test/generator.test.ts:81` and `:126` compare `https://w3id.org/jeswr/` expectations against `https://jeswr.org/ns/` ontology inputs. Used the previously documented writable-cache workaround. |
| `pnpm --filter @jeswr/federation-codegen exec vitest run test/generator.test.ts` | Reproduces both failures in isolation; 20 tests pass, 2 fail. No outputs or expectations updated. |
| `git diff --exit-code d1909525ae4395fd3e91a1502bc6913537772cdc -- tools/federation-codegen packages/solid-federation-vocab` | PASS; the failing tool and vocabulary inputs are unchanged by this lane. |
| `git diff d1909525ae4395fd3e91a1502bc6913537772cdc --check` | PASS. |
| `roborev status` | Unavailable: `roborev: command not found`. No installation or configuration changes made. |

No implementation work remains for the supplied finding; no open questions or new
dependencies. Full-workspace green and roborev review remain unavailable as recorded
above. No screenshots apply to this model-only fix. No push, PR, branch switch, remote
fetch/merge, or changes outside this checkout. The full gate left no untracked generated
files in the checkout.
