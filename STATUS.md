<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# sst-tr79 — MAI-L3 message composition

Implementation complete on `lane/sst-tr79`, based on
`b0dace34d2bd0f787aef06cad2b735a72de6101d`. All changes are confined to this checkout.
No branch switch, remote fetch/merge, push, PR, dependency or lockfile change.

## Commits

- `de830ad1` — `feat(mail): compose MIME messages and reply drafts`: pure TypeScript API,
  RFC 2047 headers, quoted display names, deterministic injected Date/Message-ID generation,
  text/HTML alternatives, mixed attachments with 76-column base64, Unicode filename parameters,
  envelope-only Bcc, reply/reply-all/forward drafts, typed validation, API documentation and
  conservative interpretations in `QUESTIONS.md`.
- `ef781ede` — `test(mail): cover composition and fail-closed inputs`: synthetic wire fixtures,
  independent MIME/header decoding assertions, invalid-input cases and dedicated coverage glob.
- `e78c2ca7` — `fix(mail): retain reply ancestry without a parent ID`: retain known References
  without inventing In-Reply-To; validate generated IDs against the supported identifier subset;
  add regression tests and clarify documentation.
- Final `docs:` commit — this status report, after the required validation commands below.

## Validation

All commands run from the repository root unless their package filter changes directory.

1. `pnpm --filter @jeswr/suite-ui run build` — PASS. Built existing dependency declarations;
   the initial direct app typecheck lacked its ignored `dist/` output. No source changes needed.
2. `pnpm --filter @jeswr/app-suite exec vitest run test/mail-compose.test.ts --coverage.include='src/apps/mail/lib/compose/**/*.ts'`
   — PASS: 111 tests, 100% statements (191/191), branches (118/118), functions (46/46),
   lines (165/165), with per-file 100% thresholds and no coverage exclusions added.
3. `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test`
   — PASS on the final implementation: production Next.js build, strict typecheck, 28 test files,
   1,288 tests. App coverage remains 100% in every metric. Lint exits zero with 21 existing
   Money-package non-null-assertion warnings; no warnings in the new files.
   Log: `/tmp/sst-tr79-app-gate-final.log`.
4. `pnpm run lint:root` — PASS (including workspace, dependency-layer, token, contrast,
   transport and agent-layer checks). Log: `/tmp/sst-tr79-lint-root-final.log`.
5. `TURBO_SCM_BASE=b0dace34d2bd0f787aef06cad2b735a72de6101d pnpm run gate`
   — PASS on the final implementation: 7/7 tasks successful, 1 cached (20.949 s).
   Log: `/tmp/sst-tr79-gate-final.log`.
6. `pnpm run gate:full` — FAIL on the final implementation, reproducing the same two
   pre-existing federation-codegen failures below. Final run: 158 successful tasks / 316 total,
   121 cached, before Turbo stopped (42.668 s).
   Initial run failed in two unchanged `tools/federation-codegen/test/generator.test.ts` tests:
   `projects the bookmarks node shape into typed cardinalities and RDF term kinds`, and
   `uses only ontology and SHACL inputs and reproduces every committed output byte`.
   Their expected/generated bookmarks fixtures still use `https://w3id.org/jeswr/...`, while
   the source ontology uses `https://jeswr.org/ns/...`. The lane does not change these paths.
   Initial run: 215 successful tasks / 293 total before Turbo stopped.
   Build-generated, untracked `apps/pod-*/web/public/{callback.html,clientid.jsonld}` files
   were removed afterward; no generated files are committed.
   Logs: `/tmp/sst-tr79-gate-full.log`, `/tmp/sst-tr79-gate-full-final.log`.
7. `git diff --check b0dace34d2bd0f787aef06cad2b735a72de6101d` — PASS.

Additional interoperability check (no new dependency):

- `pnpm --filter @jeswr/app-suite exec esbuild src/apps/mail/lib/compose/index.ts --bundle --platform=node --format=esm --outfile=/tmp/sst-tr79-compose.mjs`
  — PASS. A temporary Node script generated `/tmp/sst-tr79-roundtrip.eml` containing long Unicode
  subject/display name, quoted ASCII recipient, text/HTML, a Unicode filename and all 256 byte values.
- `python3` with standard-library `email.parser.BytesParser`, `email.policy.default`,
  `email.header.decode_header` and `email.header.make_header` — PASS: headers, MIME tree,
  canonical CRLF text, HTML, Unicode filename and attachment bytes round trip; no MIME defects.
  Python's high-level `Address.display_name` inserts extra spaces between some adjacent folded
  encoded-words; its RFC 2047 `decode_header`/`make_header` preserves the exact value. The emitted
  form follows RFC 2047 §6.2 (adjacent encoded-word folding whitespace is ignored), so no wire-format
  workaround was introduced for that decoder behavior. Unit tests independently enforce this rule.

## Scope, limitations and questions

- No new third-party dependencies: `check:packages` is not applicable. Lifecycle scripts stay disabled.
- No UI, hooks, network calls, routes or components: no Playwright specs/screenshots or visual
  fixtures are applicable; Chromium was not launched. Screenshot count: zero.
- MAI-L1's parser is absent from this base. The brief's permitted synthetic-fixture fallback is
  implemented, plus the independent standard-library decoding check above.
- Supported syntax and conservative reply/forward behavior are documented in `QUESTIONS.md` and
  `apps/suite/src/apps/mail/lib/compose/README.md`. No unresolved implementation-blocking questions.
  Unsupported address syntax, unsafe headers, invalid threading IDs, unsupported attachment
  metadata and malformed source values fail with `ComposeError`; no free-form address parser.
- `roborev` is not installed (`command -v roborev` returns no executable). The mandated review
  skill was read, but automated per-commit verdicts could not be run/read in this environment.
  Review remains for the integrator; no review tooling was installed or reconfigured.
- Full-workspace gate failures are outside the mail lane's authorized scope; they remain for
  integration. No unrelated source/test files were changed.

## Fix round 2 — attachment charset review

Base: `602e0141eb82fc3197ed01a8027b37db78c47707`; branch remains `lane/sst-tr79`.

- `4dd5f4a1` — `fix(mail): declare text attachment charsets`: add an optional structured
  `Attachment.charset` for text media types, validate it as a nonempty ASCII MIME token,
  and serialize it in Content-Type. Preserve supplied bytes and omitted-charset behavior.
  Document the option; test UTF-8 `café`, ISO-8859-1, malformed/injected values, non-text
  misuse and the existing MIME line-length limit. This takes the review's conservative
  structured-option alternative; free-form MIME parameters remain unsupported.
- Final `docs:` commit — record this round's validation results.

Commands/results, run before the final commit:

1. `pnpm --filter @jeswr/app-suite exec vitest run test/mail-compose.test.ts --coverage.include='src/apps/mail/lib/compose/**/*.ts'`
   — PASS: 134 tests; compose coverage 100% statements (204/204), branches (127/127),
   functions (46/46), lines (178/178).
2. `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test`
   — PASS: lint, dependency build, production app build, typecheck, 28 test files and
   1,311 tests; app coverage remains 100% in all metrics. Lint retains the same 21 existing
   Money warnings. Log: `/tmp/sst-tr79-round2-app-gate.log`.
3. `pnpm run lint:root` — PASS. Log: `/tmp/sst-tr79-round2-lint-root.log`.
4. `TURBO_SCM_BASE=602e0141eb82fc3197ed01a8027b37db78c47707 pnpm run gate`
   — PASS: 6/6 tasks successful, 0 cached. Log: `/tmp/sst-tr79-round2-gate.log`.
5. `pnpm run gate:full` — FAIL: 230 successful tasks / 295 total before stopping at
   the same two unchanged federation-codegen tests recorded above (bookmarks shape and
   generated-output reproducibility; `https://w3id.org/jeswr/...` versus
   `https://jeswr.org/ns/...`). No changes made to these files.
   Log: `/tmp/sst-tr79-round2-gate-full.log`.
6. `pnpm --filter @jeswr/app-suite exec esbuild src/apps/mail/lib/compose/index.ts --bundle --platform=node --format=esm --outfile=/tmp/sst-tr79-round2-compose.mjs`
   — PASS. A temporary Node script generated `/tmp/sst-tr79-round2.eml` using the new
   charset option; Python's standard-library `email.parser.BytesParser` independently
   confirmed `utf-8`, the exact attachment bytes, decoded text `café`, and no MIME defects.
7. `git diff --check 602e0141eb82fc3197ed01a8027b37db78c47707` — PASS.

No dependencies, lockfile changes, UI changes or screenshots. No pushes, PRs, branch switches,
remote operations or changes outside this checkout. `roborev` is still unavailable, so automated
per-commit review remains for integration. The requested finding is fixed; only the pre-existing
full-workspace failures and unavailable review tooling remain. No open implementation questions.

## Fix round 3 — text attachment newline review

Reviewed the complete `solid-sdk-lane-sst-tr79-8c354294b66d.md` finding. Branch remains
`lane/sst-tr79`; validation base is `602e0141eb82fc3197ed01a8027b37db78c47707`.

- `a0626f2c` — `fix(mail): reject noncanonical text attachment newlines`: preserve the
  byte-oriented attachment contract and require CR/LF octets in text attachment data to occur
  only as CRLF pairs before base64 serialization. Bare CR or LF throws `ComposeError`
  (`invalid-input`, field `attachment.data`). This is the review's conservative rejection
  alternative; no charset decoding or newline rewriting is introduced. Document the requirement,
  adjust the existing text fixture, and add 33 regression cases for canonical/empty data,
  bare/mixed line endings, UTF-8, ISO-8859-1, omitted charset, case-insensitive text subtypes,
  byte preservation and input immutability. Existing all-256-byte binary coverage stays green.
- `6d1de79f` — `test(mail): omit unset attachment charset in fixtures`: correct the regression
  fixtures for `exactOptionalPropertyTypes` after the initial app typecheck identified an
  explicitly undefined optional charset. The final app gate passes.
- Final `docs:` commit — this status update, committed after validation.

Commands/results, run before the final commit:

1. `pnpm --filter @jeswr/app-suite exec vitest run test/mail-compose.test.ts --coverage.include='src/apps/mail/lib/compose/**/*.ts'`
   — PASS: 167 tests; compose coverage 100% statements (207/207), branches (133/133),
   functions (47/47), lines (181/181). Log: `/tmp/sst-tr79-round3-compose-test.log`.
2. `pnpm --filter @jeswr/app-suite run lint && pnpm --filter @jeswr/suite-ui run build && pnpm --filter @jeswr/app-suite run build && pnpm --filter @jeswr/app-suite run typecheck && pnpm --filter @jeswr/app-suite run test`
   — PASS on the final implementation: lint, dependency build, production app build,
   strict typecheck, 28 test files and 1,344 tests. App coverage remains 100% in all metrics.
   Lint retains the same 21 existing Money warnings; no warnings in the touched files.
   Log: `/tmp/sst-tr79-round3-app-gate-final.log`.
3. `pnpm run lint:root` — PASS. Log: `/tmp/sst-tr79-round3-lint-root.log`.
4. `TURBO_SCM_BASE=602e0141eb82fc3197ed01a8027b37db78c47707 pnpm run gate`
   — PASS: 7/7 tasks successful, 0 cached (40.717 s).
   Log: `/tmp/sst-tr79-round3-gate.log`.
5. `pnpm run gate:full` — FAIL: 234 successful tasks / 297 total, 6 cached, before stopping
   at the same two unchanged `tools/federation-codegen/test/generator.test.ts` failures:
   `projects the bookmarks node shape into typed cardinalities and RDF term kinds`, and
   `uses only ontology and SHACL inputs and reproduces every committed output byte`.
   Fixtures use `https://w3id.org/jeswr/...` while source ontology uses `https://jeswr.org/ns/...`.
   These paths remain outside this fix's scope. Log: `/tmp/sst-tr79-round3-gate-full.log`.
6. `git diff --check 602e0141eb82fc3197ed01a8027b37db78c47707` — PASS.

No dependencies, lockfile changes, UI changes or screenshots. No pushes, PRs, branch switches,
remote operations or edits in other checkouts. `roborev` remains unavailable, so automated
per-commit review remains for integration. The requested finding is fixed. No unfinished lane
implementation or open questions; the existing full-workspace failures remain for integration.
