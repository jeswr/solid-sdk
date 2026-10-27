<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-bwc.8 lane status

Branch: `lane/sst-bwc.8`.
Base: `e4aa7f60a40706703e8d304922c75e3e2d26a664`.

## Commits

- `d51ef9fd` — `feat: make login panel field label configurable`: add reflected
  `webid-label` / `webIdLabel`, retain the `Your WebID` default and wrapping label,
  add five regression/adversarial tests, document the contract in component JSDoc,
  README and SKILL.md, and regenerate the manifest and API reports. The report
  generator also normalizes the existing `TemplateResult` import in the main and
  React reports; the auth report is unchanged.
- `docs: record sst-bwc.8 lane status` — final commit containing this handoff.

## Security property and review

The login field label now accepts host-controlled strings through an attribute or
property. That string is interpolated into a Lit text binding inside the existing
native label; it cannot create HTML elements or executable markup. The input's
accessible name continues to come from that label.

The new tests prove default compatibility, initial and updated attributes, property
updates and reflection, preservation of typed input, and accessible naming using
Testing Library's role/name query plus the input's native `labels` association.
Both configuration paths receive an adversarial value containing image markup,
an event handler, script markup and an ampersand. Tests require the literal label
text and accessible name, no image/script elements, and only the original input
as the label's element child. All five new tests failed against the original
implementation before the change and passed afterward. Tests use only the existing
mock controller and local DOM; no accounts, credentials or production calls.

Manual adversarial inspection confirmed the plain text binding and native label
association. `roborev` is unavailable (`command -v roborev` found no executable),
and no post-commit review hook is installed, so automated per-commit verdicts could
not be obtained. Jesse must review and merge this security-critical change; it
must never be auto-merged. This lane did not push, open a PR or publish.

## Verification

Commands used Node `v24.22.1` and pnpm `10.4.1`, with
`export PATH=/opt/node24/bin:$PATH`. Lifecycle scripts remained disabled.

```sh
pnpm exec turbo run build --filter='@jeswr/solid-elements^...' --concurrency=4
pnpm --filter @jeswr/solid-elements run lint && pnpm --filter @jeswr/solid-elements run build && pnpm --filter @jeswr/solid-elements run typecheck && pnpm --filter @jeswr/solid-elements run test
pnpm run lint:root
TURBO_SCM_BASE=e4aa7f60a40706703e8d304922c75e3e2d26a664 pnpm run gate
pnpm run gate:full
pnpm run test:root
```

- Dependency build: PASS, both dependencies built. An initial package build had
  found their missing `dist` declarations in the fresh checkout; building them
  resolved those errors.
- Package gate: PASS, lint/manifest, build, typecheck, and all 329 tests in 15 files.
  An initial lint attempt identified test formatting, which was corrected before
  the passing run. Log: `/tmp/sst-bwc.8-package-gate.log`.
- Root lint: PASS, including all workspace guards. Log:
  `/tmp/sst-bwc.8-root-lint.log`.
- Affected gate: FAIL, 44 successful tasks out of 55 scheduled. Solid-elements
  passed, including all 329 tests and manifest verification. Coeliac's Next.js
  Turbopack build failed while processing `packages/app-shell/dist/styles.css`:
  creating a process required binding a port, denied by this sandbox with
  `Operation not permitted (os error 1)`. Log:
  `/tmp/sst-bwc.8-affected-gate.log`.
- Full gate: FAIL in `//#test:root`, with 54 successful tasks out of 219 scheduled.
  Root tests reported 163 failures and 737 passes across 12 files: CLI guard
  diagnostics were empty, and two agent-layer cases timed out at 5000 ms. The
  failing files are `agent-layers-reachability.test.mjs`, `agent-layers.test.mjs`,
  `check-packages-guard.test.mjs`, and `check-sdk-layers.test.mjs`, all outside this
  change. Log: `/tmp/sst-bwc.8-full-gate.log`.
- Standalone root tests: FAIL, reproducing 161 empty guard-diagnostic failures
  with 739 passes across the same 12 files. The two timeouts did not recur outside
  the concurrent full gate. No root test or guard files were changed. Log:
  `/tmp/sst-bwc.8-root-tests.log`.

The existing locally installed API Extractor was used without downloading tooling
or changing dependencies. From `packages/solid-elements`, the exact regeneration
command was:

```sh
for entry in main react auth; do
  node ../../node_modules/.pnpm/@microsoft+api-extractor@7.58.9_@types+node@22.19.21/node_modules/@microsoft/api-extractor/bin/api-extractor run --config "api-extractor.$entry.json" --local || exit
done
```

The same loop without `--local` checked all three reports: PASS. Generated
temporary reports were removed. The manifest was regenerated with
`pnpm --filter @jeswr/solid-elements run manifest` and passed the package checks.

`check:packages`: not applicable; no dependencies or package manifests were
added/changed. The lockfile is unchanged. Build output is not committed, and
untracked app callback/client-identity files generated by the gates were removed.

## Unfinished work and open questions

The implementation is complete. The workspace gates require follow-up outside this
lane for the sandbox build restriction and root guard-test failures; automated
roborev review is also outstanding. No design questions or scope ambiguities arose.
The browser-extension consumer change and mirror publishing remain out of scope.
