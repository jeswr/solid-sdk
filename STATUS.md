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
