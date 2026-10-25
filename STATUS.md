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
