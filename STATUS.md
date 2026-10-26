<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-ljwe — MAI-L1 lane report

Base: `606c87b7edf73e83f118f95295b0eeda7abb6d92`; branch: `lane/sst-ljwe`.

## Commits

- `8ce2c686` — `feat: parse MIME mail into safe reading content`: pure TypeScript
  library and barrel under `apps/suite/src/apps/mail/lib/mime/`, decoded headers
  and addresses, multipart bodies, transfer/charset decoding, attachment metadata
  and bytes, inert CID references, HTML sanitization, synthetic `.eml` fixtures,
  unit tests, dependency manifests/lockfile and enforced per-file coverage.
- `e8c087a5` — `fix: decode escaped inline content identifiers`: RFC 2392 percent
  decoding, case preservation, malformed-escape handling and regression tests.
- This final report commit — `docs: record MAI-L1 lane validation`.

## Validation

Executed after the implementation commits, before the final report commit:

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; Next.js production build, TypeScript, Biome and 30 tests in 2 files |
| `pnpm --filter @jeswr/app-suite run test:mime` | PASS; 29 MIME tests |
| `pnpm run lint:root` | PASS; workspace/transport/fetch/token guards; 74 contrast pairs, zero failures |
| `TURBO_SCM_BASE=606c87b7edf73e83f118f95295b0eeda7abb6d92 pnpm run gate` | PASS; 7/7 Turbo tasks |
| `pnpm run gate:full` | FAIL (exit 1); existing `@jeswr/unstorage-solid#build` fails in `scripts/build-deps.mjs` because its child npm install writes to the read-only `/home/runner/.npm` cache (`EROFS`). 11 successful tasks, 59 scheduled before fail-fast. Package unchanged by this lane. |
| `pnpm install --filter @jeswr/app-suite... --frozen-lockfile --offline --ignore-scripts --store-dir /tmp/sst-ljwe-pnpm-store` | PASS; frozen scoped lockfile validation |
| `pnpm install --frozen-lockfile --offline --ignore-scripts --store-dir /tmp/sst-ljwe-pnpm-store` | PASS; full workspace dependency installation from the existing cache |
| `git diff --check` | PASS |

V8 coverage covers every `.ts` file in the MIME directory, including the barrel:
100% statements (13/13), branches (44/44), functions (6/6) and lines (12/12).
There are no coverage exclusions or mocked parser/sanitizer paths. Normal app tests
enable coverage with a 100% threshold for each file. Reports are git-ignored under
`apps/suite/coverage/`.

Tests cover folded/duplicate headers, encoded words and address groups; nested
alternative/mixed/related MIME; 7bit, 8bit, binary, base64 and quoted-printable;
UTF-8, Windows-1252, ISO-8859-1, Shift JIS and unknown charset fallback; RFC 2231
filenames, attachment content and sizes, CID resources and URL escapes;
HTML-only/plain-only/empty messages; malformed messages and nesting-limit errors;
safe markup, dangerous URL schemes, script/CSS/event removal and remote-load blocking.

The initial direct typecheck needed the suite-ui build output; after
`pnpm --filter @jeswr/suite-ui run build`, typecheck passed. The default package
store/cache is read-only, so installation used a writable `/tmp` store populated
from the existing cache, with lifecycle scripts disabled throughout. Dependency
resolution initially refreshed unrelated remote pins/peer metadata; those changes
were removed, preserving all pre-existing lockfile entries. Frozen installation
then passed. The full gate's existing build helper independently clones an external
dependency into `/tmp` before its failing npm install; no further full-gate retry
was made.

## Dependency policy

All checks ran before the corresponding manifest additions:

| Exact command | Result | Added version |
| --- | --- | --- |
| `pnpm run check:packages postal-mime` | PASS; age 2112 days | `4.1.4` |
| `pnpm run check:packages sanitize-html` | PASS; age 4793 days | `2.18.1` |
| `pnpm run check:packages @types/sanitize-html @vitest/coverage-v8` | PASS; ages 3813/1237 days | `2.16.2` / `4.1.10` |

Coverage uses the version already present in the lockfile. `sanitize-html` supplies
the HTML parser/sanitizer rather than a handwritten security-sensitive tokenizer.
No new workspace project was added; `suite.json` requires no change.

## Scope, interpretation and remaining limits

Implementation is complete for this lane. No React, hooks, network calls, UI,
screenshots or Playwright specs were added; this is the pure-library task defined
by `09-pure-libraries.md`. No browser was launched. Fixtures use fictional people
and `example.org` addresses.

Conservative choices are recorded in [QUESTIONS.md](QUESTIONS.md): automatic remote
loads are always stripped, CID images are inert references for a future reader,
and absent plain/HTML representations are not synthesized. No unanswered question
blocks this implementation. API and safety contracts are documented in the
[library README](apps/suite/src/apps/mail/lib/mime/README.md).

Full-workspace validation remains limited by the unrelated build failure above.
`roborev` is not installed and no post-commit review hook is configured in this
checkout, so automated per-commit review could not run. No review tooling or bead
database was installed; tracker lifecycle remains with the dispatcher because this
is a dedicated lane worktree. No push, PR, branch switch or merge was performed.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 1 — MIME selection review

Review baseline: `2c4150e91d0054cf803eba202161873c1fcae336`.

- `f802d180` — `fix: select MIME roots and preferred alternatives`: select related
  roots by immediate-child Content-ID (`start`, case-sensitive), preserving other
  text/HTML leaves as attachment resources with their decoded bytes and metadata.
  Select the last available plain and HTML alternatives independently, including
  nested alternatives and empty preferred bodies. Keep selected related resources
  once when both representations share them. Add two synthetic `.eml` fixtures,
  ten regression cases and documentation of the pinned parser-tree adapter.
- This report commit — `docs: record MIME selection fix validation`.

Both review findings are addressed. Selection reuses the decoded tree and
attachment collector of the existing, exact-pinned `postal-mime` 4.1.4 dependency;
this internal interface is isolated in `select.ts` and covered through real parser
calls. No dependencies, public API, UI or unrelated implementation changed.

Validation after the fix and before this final report commit:

| Exact command | Result |
| --- | --- |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; build the app's existing workspace dependency |
| `pnpm --filter @jeswr/app-suite run test:mime` | PASS; 39 MIME tests, 100% statements/branches/functions/lines across the directory |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; lint, production build, typecheck, 40 tests in 2 files; MIME coverage 100% (51 statements, 76 branches, 17 functions, 43 lines) |
| `pnpm run lint:root` | PASS; workspace/transport/fetch/token guards and 74 contrast pairs |
| `TURBO_SCM_BASE=2c4150e91d0054cf803eba202161873c1fcae336 pnpm run gate` | PASS; 6/6 Turbo tasks |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose` | FAIL (exit 1); 19 successful tasks, 145 scheduled. Unchanged `@jeswr/unstorage-solid#build` tries to clone `https://github.com/jeswr/fetch-rdf.git`; Git rejects HTTPS transport under the lane's no-remote-fetch guard. Loose environment mode passes the guard to child tasks. No remote clone/fetch occurred. |
| `git diff --check` | PASS |

The ten new cases were also run with only `parse.ts` temporarily restored to the
review baseline: all ten failed, while the original 29 tests passed. The fixed
adapter was restored immediately afterward. An initial direct typecheck required
building suite-ui first, as in the original lane; all subsequent checks passed.

No policy checks or screenshots were needed because no dependencies or UI were
added. The conservative fallback for an unresolved related `start` is the first
child, documented and tested. No open questions or unfinished implementation
remain. Full-workspace validation is limited by the unrelated dependency bootstrap
above. `roborev` is still unavailable in this checkout, so no automated commit
review ran. Tracker lifecycle remains with the dispatcher. No push, PR, branch
switch, merge or other checkout change was performed.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 2 — attachment disposition and byte preservation

Review baseline: `4cf4b27fa3aced37aa3c8b9af1474d26340124a4`.

- `afe85bdb` — `fix: preserve MIME attachment groups and bytes`: retain attached
  multipart groups as single downloads with their filename, metadata and original
  body bytes, including nested delimiters, preamble and epilogue. Record body spans
  through the pinned parser's existing header/boundary callbacks before selection;
  do not reconstruct the wire body. Select supported related roots independently
  of attachment disposition. Reuse attachment metadata collection while restoring
  transfer-decoded content, preserving calendar CRLF and legacy charset octets.
  Add 16 regression/guard cases and document these behaviors.
- This report commit — `docs: record MIME attachment fix validation`.

All three review findings are addressed. No dependencies, public API, UI or
unrelated implementation changed. No ambiguity required a new interpretation.

Validation after the fix and before this final report commit:

| Exact command | Result |
| --- | --- |
| `CI=true GIT_ALLOW_PROTOCOL=file pnpm install --frozen-lockfile --offline --ignore-scripts --store-dir /tmp/sst-ljwe-pnpm-store` | PASS; existing offline cache, unchanged manifests and lockfile, lifecycle scripts disabled |
| `pnpm --filter @jeswr/suite-ui run build` | PASS; build the app's existing workspace dependency |
| `pnpm --filter @jeswr/app-suite run test:mime` | PASS; 55 MIME tests, 100% statements/branches/functions/lines across the directory |
| `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test` | PASS; lint, production build, typecheck, 56 tests in 2 files; MIME coverage 100% (87 statements, 99 branches, 22 functions, 78 lines) |
| `pnpm run lint:root` | PASS; workspace/transport/fetch/token guards and 74 contrast pairs |
| `TURBO_SCM_BASE=4cf4b27fa3aced37aa3c8b9af1474d26340124a4 pnpm run gate` | PASS; 6/6 Turbo tasks |
| `GIT_ALLOW_PROTOCOL=file pnpm run gate:full --env-mode=loose` | FAIL (exit 1); 16 successful tasks, 62 scheduled before fail-fast. Unchanged `@jeswr/unstorage-solid#build` requires a clone of `https://github.com/jeswr/fetch-rdf.git`; the no-remote-fetch guard rejects HTTPS transport. No remote clone/fetch occurred. |
| `git diff --check` | PASS |

Regression verification temporarily restored only `parse.ts` and `select.ts` to
the review baseline and ran `pnpm --filter @jeswr/app-suite exec vitest run
test/mime.test.ts --coverage.enabled=false`: 15 new cases failed, while all 39
previous tests and the new related multipart/unsupported-root guard passed.
The fixed sources were restored immediately, before the passing affected gate.

The added cases cover LF/CRLF multipart downloads, sliced input, nested parts,
group metadata, preamble/epilogue, EOF and missing header separators; implicit and
explicit related roots with HTML/plain bodies; and both calendar media types with
UTF-8/Windows-1252 and base64/quoted-printable bytes. Coverage remains enforced at
100% per file with no exclusions or parser mocks.

The only validation limits are the unrelated full-workspace build failure above
and the existing absence of `roborev`. No review tooling, dependencies, tracker
database or hooks were installed. No screenshots were needed for this pure-library
fix. No implementation work or open questions remain. Tracker lifecycle remains
with the dispatcher. No push, PR, branch switch, merge or other-checkout edit occurred.
