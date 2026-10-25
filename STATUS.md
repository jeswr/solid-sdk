<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# sst-z1d — A-003 lane report

Branch: `lane/sst-z1d`. Base commit: `61048c43eb845a6d244fb90ec9b10ee0b0a7d1f4`.

Commits:

- `bb383552` — `feat: scaffold agent packages and daemon`: nine private ESM packages,
  the private `@jeswr/app-agent-daemon`, Node >=24, strict TypeScript, inherited root
  Biome configuration, colocated skills and experimental README banners. Every
  package has empty root/testing modules and a test resolving every built export
  and declaration file. Six packages have `securityCritical: true` and automatic
  per-file 100% branch/function/line/statement coverage thresholds. `suite.json`
  registers all ten projects; the lockfile changes only their importers.
- `cd58a63b` — `feat: enforce agent layer boundaries`: TypeScript-parser-based agent
  layer guard, root lint integration, the three required failing fixture workspaces,
  and regression tests for dependency direction, import forms, test exceptions,
  model SDK isolation, gateway/audit separation, UI restrictions and binding origins.
- `3d3639b` — `test: isolate scaffold export checks`: split export checks into
  individual cases and use Node's synchronous ESM loader, keeping ESM resolution
  and declaration assertions while avoiding Vitest's async transformation queue.
- `9c62a7f` — `fix: skip generated agent layer inputs`: exclude `.next` and `out`
  alongside `dist`, with regression coverage for the Turbo build output directories.
- The final `docs: record sst-z1d validation` commit contains this report.

Implementation notes:

- `scripts/check-sdk-layers.mjs` is absent on this base. The permitted fallback is
  `scripts/check-agent-layers.mjs`, invoked by `check:agent-layers` from `lint:root`.
  Fold these agent rules into the SDK-wide checker when sdk-core T-003 is merged.
- A-002 is absent as dispatched. Neither `packages/personal-agent` nor
  `packages/agentic-legacy-bridge` was created or changed.
- All 17 channel subpaths are reserved, with send modules for every listed entry
  except GitHub, including `./testing/send` under the dispatcher's “all except
  github” instruction. There is no executable channel or daemon behavior.
- Packages remain private at version `0.1.0` per ADR-001 D5. `./testing` is an empty
  reserved surface; the later implementation tasks supply the actual fakes.
- UI mandate values require `agent-mandate/issue` or `/verify`; root type-only imports
  are allowed. This conservatively implements §2.2's “issue/verify only” restriction.
- Direct binding fetches require a literal URL in a top-level static `ORIGINS` set,
  or that set imported from the binding module. Missing, mutable, nested and dynamic
  allowlists/URLs fail closed. Dynamic requests must use the guarded transport seam
  supplied by later tasks; runtime transport/redirect enforcement belongs to A-005.
- Package scripts explicitly invoke root tools through `pnpm -w exec`: this
  environment did not expose the root tool binaries to the new package scripts.

Supply-chain checks:

- `pnpm run check:packages @vitest/coverage-v8` — PASS (full npm policy check).
  Reused the workspace's existing `^4.1.10` coverage provider in the six SEC packages;
  no new third-party library or dependency version was introduced.
- `CI=true pnpm install --ignore-scripts --no-frozen-lockfile --prefer-offline` — PASS.
  Existing registry connection resets retried successfully; existing peer warnings
  were reported. No lifecycle scripts ran.
- `CI=true pnpm install --ignore-scripts --offline --frozen-lockfile` — PASS after
  restoring unrelated pnpm peer-snapshot churn; only ten new importers remain.
- Initial interactive/frozen install attempts were superseded by the successful
  commands above. `.npmrc` remains `ignore-scripts=true`.

Validation:

The following four commands passed for each of these packages (40 successful
checks): `@jeswr/agent-model`, `@jeswr/agent-channels`, `@jeswr/agent-mandate`,
`@jeswr/agent-executor`, `@jeswr/agent-audit`, `@jeswr/agent-model-gateway`,
`@jeswr/agent-credentials`, `@jeswr/agent-memory`, `@jeswr/agent-registry`, and
`@jeswr/app-agent-daemon`:

```sh
pnpm --filter "$pkg" run lint
pnpm --filter "$pkg" run build
pnpm --filter "$pkg" run typecheck
pnpm --filter "$pkg" run test --testTimeout=60000 --hookTimeout=60000
```

The initial ten batched export-resolution tests passed. The final tests separate
each entry, yielding 62 passing package/app cases with default timeouts. The six SEC coverage reports show 100%
in every metric, with zero executable statements/branches/functions in these empty
scaffolds. The thresholds are enabled automatically for future implementation.

- `pnpm run lint:root` — PASS, including Biome, lock transport, app workspace,
  existing fetch guard and the new agent layer guard.
- `pnpm run test:root --testTimeout=60000 --hookTimeout=60000` — PASS: 84 tests
  across four files, including 56 layer cases and two scaffold inventory cases.
  The three seeded fixture CLI invocations each exit 1 for the intended violation;
  ordinary lint skips the fixture directory.
- `TURBO_SCM_BASE=agent/integration pnpm run gate --cache=local:rw` — BLOCKED:
  root lint passes, then Turbo fails because this checkout has no local
  `agent/integration` ref. No refs were created or fetched.
- `TURBO_SCM_BASE=61048c43eb845a6d244fb90ec9b10ee0b0a7d1f4 pnpm run gate --cache=local:rw`
  — initial attempt reached 18 successful tasks, then failed on three 5000ms
  timeouts in unchanged root tests: two package-policy alias cases and
  mirror-publish's directory-comparison case. The same root suite passed with the
  CLI timeout above and again with default timeouts during the full gate.
- `pnpm run gate:full --cache=local:rw` — BLOCKED: 29 successful tasks, then
  `@jeswr/app-pod-manager#build` attempted a download from `fonts.googleapis.com`.
  The lane's temporary network guard refused the external connection. The root
  suite passed all 84 tests in this run. Pod Manager was not changed.

A further base-SHA retry encountered the same load-related 5000ms limit in the
old batched async checks for agent-mandate, agent-memory and agent-registry, plus
root mirror tests. Commit `3d3639b` replaces those package checks with synchronous
per-entry cases. The channel package's final 35 cases and typecheck passed with
default timeouts (the test cases themselves took 1.63 seconds).

Final gate results:

- `TURBO_SCM_BASE=61048c43eb845a6d244fb90ec9b10ee0b0a7d1f4 pnpm run gate --cache=local:rw`
  — PASS: **42 successful / 42 total**, no cached tasks, 7m23.978s. All 62 package/app
  test cases and all 84 root cases passed with default timeouts. This includes
  all ten projects' lint/build/typecheck/test tasks and the root lint/test tasks.
- After the generated-output exclusion, `pnpm run gate:full --cache=local:rw`
  — BLOCKED again by unchanged `@jeswr/app-pod-manager#build` requesting Google
  Fonts. **44 tasks succeeded**, 37 were cached, and all **84 root cases passed**,
  including the extended output-exclusion regression. The final agent layer guard
  passed. The prohibited connection was refused before transmission.

Verification processes used `NODE_OPTIONS=--require=/private/tmp/sst-z1d-network-guard.cjs`
to permit only loopback TCP/Unix sockets. Turbo also used
`TURBO_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1` and `--cache=local:rw` to disable
telemetry/remote caching. No live provider or pod calls ran. The full gate's
temporary generated tsup configuration was removed; no unrelated source changes
were retained. No test timeout configuration was raised.

Review and remaining constraints:

- Reviewed the change for correctness, readability, architecture, security and
  performance using the code-review skill. The import checker uses the existing
  TypeScript parser and never executes fixture/provider code.
- No roborev provider review was started: the lane expressly forbids calls to
  OpenAI/Anthropic endpoints. There is no post-commit review hook in this checkout.
  Automated review remains for the dispatcher under an allowed review environment.
- The implementation is scaffold-only as requested. Later agent tasks implement
  the reserved APIs. A-002 and sdk-core T-003 integration remain with the dispatcher.
- The full-workspace gate remains blocked by the unchanged Pod Manager's network
  font build under this lane's network rule. No unrelated workaround was added.
- Open questions: none. No pushes, fetches, PRs, branch switches or other checkout
  mutations were performed.

<!-- AUTHORED-BY Codex GPT-6 -->

## Fix round 1 — wrapped and escaped fetch references

Resumed from `ea7efaf91a4c00c135a477560cc419169c83012b` on `lane/sst-z1d`.
Addressed the supplied medium-severity review finding without redoing the scaffold.

Commits:

- `6303ea2b` — `fix: reject escaped raw fetch references`: normalize parentheses,
  `as`, `satisfies`, angle-bracket type assertions and non-null expressions;
  replace alias tracking with rejection of raw fetch references outside direct,
  statically origin-checked calls. Reject storage, later reassignment, argument
  passing, binding/assignment/parameter destructuring, bound functions and exports.
  Apply this rule throughout agent source while preserving existing test exemptions
  and binding checks for injected transport calls.
- `2acf3b36` — `fix: check fetch references in runtime type expressions`: keep
  checks active in class bases and generic instantiations, which TypeScript also
  labels as type nodes. Preserve genuine type-only references.
- The final `docs: record sst-z1d fix validation` commit updates this report last.

The final root suite has 123 passing cases, including 95 layer-guard cases.
Regression coverage includes every requested wrapper form on bare/globalThis/window/self
fetch and static bracket access, nested wrappers, direct calls with allowed and hostile
origins, escapes despite valid declared origins, later assignments, callbacks,
destructuring, exports and runtime type expressions. Existing valid fixtures still pass.
The checker rejects the raw reference itself; it performs no alias data-flow tracking.

Conservative interpretation: this checkout has no sanctioned guarded-fetch adapter
file exception in `check-agent-layers.mjs`. No new exception or adapter path was invented;
the existing test exemptions remain. Static local origins are accepted for direct raw
calls in other agent source; channel send halves retain their existing imported-origin
support. No package or app source/manifests were changed, and no dependencies were added.
Package-specific gates and `check:packages` are therefore not applicable to this fix.

Validation (all commands executed inside this checkout):

- `pnpm exec biome check scripts/check-agent-layers.mjs test/agent-layers.test.mjs`
  — PASS on the final implementation.
- `pnpm run lint:root` — PASS. The final implementation also passes this exact
  root-lint command as the first step of the affected gate below.
- `pnpm run test:root --testTimeout=60000 --hookTimeout=60000` — PASS:
  123 tests across four files. No timeout configuration was changed.
- `TURBO_SCM_BASE=ea7efaf91a4c00c135a477560cc419169c83012b pnpm run gate --cache=local:rw`
  — PASS on the final implementation: root lint and 1/1 Turbo task, uncached;
  all 123 tests pass with default timeouts. Only the root project is affected by
  this fix relative to the reviewed lane head.
- `TURBO_SCM_BASE=agent/integration pnpm run gate --cache=local:rw` — BLOCKED:
  root lint passes, then Turbo cannot resolve the absent local branch ref.
- `TURBO_SCM_BASE=12643bf0bf1d66802271494c02b42964ac86eebe pnpm run gate --cache=local:rw`
  — BLOCKED by unchanged Pod Manager's network-dependent build after 74 successful
  tasks. The supplied SHA exists, but its merge base with this lane is `61048c43`,
  so this comparison includes changes beyond the fix. No branch refs were created.
- `pnpm run gate:full --cache=local:rw` — BLOCKED by the same Pod Manager build:
  87 tasks succeeded on the first full run; 56 succeeded on the retry after the
  runtime-type fix. Root lint and the root suite pass (123 cases on the retry).
- `pnpm run gate:full --cache=local:rw --env-mode=loose` — BLOCKED on the final,
  fully guarded run: unchanged `@jeswr/unstorage-solid#build` requires an external
  dependency clone, refused with `fatal: transport 'https' not allowed`.
  3 tasks succeeded before cancellation of the remaining work. No unrelated
  source workaround was added.
- `git diff --check` — PASS.

Verification environment and incident:

- Checks used a temporary `/tmp/sst-z1d-network-guard.cjs` preload to refuse Node
  TCP connections beyond loopback. Turbo telemetry and remote caching were disabled
  (`TURBO_TELEMETRY_DISABLED=1 DO_NOT_TRACK=1`, `--cache=local:rw`).
- The initial full-workspace runs exposed a guard gap: unchanged dependency
  bootstrap scripts invoked GitHub clones in temporary directories. The Node socket
  guard did not cover native Git subprocesses, and Turbo's strict environment
  filtering removed the caller's subsequent `GIT_ALLOW_PROTOCOL=file` restriction.
  Those clone attempts violated the lane's network-fetch constraint. No live
  provider or pod request was made, and no secrets were printed or committed.
- Corrected the temporary preload to set `GIT_ALLOW_PROTOCOL=file` in every Node
  build process, verified inheritance in a child process, and used `--env-mode=loose`
  for the final full run. The dependency clone then failed before network access.
  These guard files are outside the checkout and are not committed.

Review/remaining work:

- The supplied finding is addressed, including wrapped direct-call origin checks
  and escapes that never reach a call. No implementation work remains for this fix.
- Read the repository's roborev-review guidance and the supplied review. `roborev`
  is unavailable here; no automated provider review was started under the lane's
  provider-call prohibition. Dispatcher review remains external to this lane.
- Full-workspace validation remains blocked by existing network-dependent builds.
  No push, PR, branch switch, merge or other checkout mutation was performed.
- Open questions: none.

<!-- AUTHORED-BY Codex GPT-6 -->

## Final fix round — literal ESM loads and agent identifier restrictions

Resumed on `lane/sst-z1d` from `63fbaa47055ee8aa93b90f306e17f40221acb494`.
This round supersedes the earlier raw-fetch/static-ORIGINS policy above.

Commits:

- `6b706fbf` — `fix: allow only literal ESM loads in agent code`: accept literal
  static ESM imports/re-exports and literal `import()` calls, preserving dependency
  direction checks. Reject CommonJS loader references, wrapped/aliased `require`
  and `createRequire`, `module.require`, bracket member/destructuring forms and
  import-equals. Reject non-literal dynamic imports, including template strings,
  concatenations, expression wrappers and URL objects.
- The final `docs: record sst-z1d allowlist validation` commit updates this report last.

Agent code now rejects identifiers `fetch`, `globalThis`, `global`, `window` and
`self`, including aliases, exports, destructuring, type references and wrapped
expressions. Ordinary property keys and member names on another object remain
allowed. Static ORIGINS declarations no longer authorize raw fetch. Removed the
origin discovery, raw-fetch escape analysis and associated wrapper helpers; no
alias data-flow tracking remains.

The policy applies to agent packages, the daemon and the existing agent UI paths,
including their tests/configuration. Converted all ten scaffold export test files
from `createRequire` to explicit static ESM namespace imports. Their assertions
still verify every manifest export, declaration file, resolved runtime path and
empty runtime namespace; the imported subpath inventory must match the manifest.
No production package API, manifests or dependencies changed.

Conservative interpretation / missing context:

- `briefs/sst-z1d.md` and the earlier fix briefs are absent from this checkout.
  Used the supplied final fix brief, existing checker/tests and earlier reports.
- No sanctioned guarded-fetch adapter file or exception exists in this checkout.
  No adapter path or exemption was invented. The existing `guarded-fetch` package
  remains outside the agent identifier policy. Asked for an exact adapter path;
  none was supplied during this round. A future exception needs that concrete path.
- Applied the brief's sole-exception wording to tests as well as implementation
  files, instead of retaining the previous test exemption for capability checks.

Validation on the final implementation:

- `pnpm exec biome check scripts/check-agent-layers.mjs test/agent-layers.test.mjs`
  and Biome checks of all ten updated export tests — PASS, no remaining warnings.
- `pnpm run lint:root` — PASS, also rerun successfully within the affected gate.
- `TURBO_SCM_BASE=63fbaa47055ee8aa93b90f306e17f40221acb494 pnpm run gate --cache=local:rw --env-mode=loose`
  — PASS: **42 successful / 42 total**, no cached tasks, 22.47 seconds. Covers
  lint/build/typecheck/test for all nine touched packages and the daemon, plus
  root lint/test. All **172 root tests** (144 layer cases) and **62 scaffold tests**
  pass with default timeouts. The first attempt exposed a strict TypeScript error
  in the migrated tests; corrected it before this successful run.
- `pnpm run gate:full --cache=local:rw --env-mode=loose` — BLOCKED by unchanged
  `@jeswr/unstorage-solid#build`: its external dependency clone was refused with
  `fatal: transport 'https' not allowed`. **30 tasks succeeded**, 19 cached, before
  cancellation. Unchanged Pod Manager also attempted a non-loopback connection,
  refused by the temporary network guard. The root suite passes in this run too.
- `git diff --check` — PASS.

All gates used the existing temporary `/tmp/sst-z1d-network-guard.cjs` preload,
`GIT_ALLOW_PROTOCOL=file`, `TURBO_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1`.
The preload reapplies Git's restriction in child Node processes; loose environment
mode preserves caller restrictions. Remote caching was disabled. No remote fetch
or clone completed, and no live provider/pod request or dependency installation ran.

Review / remaining constraints:

- Read and applied the colocated skills and `skills/solid-test-infrastructure` for
  the test migration, and `skills/roborev-review` for the review workflow. The
  `roborev` executable is unavailable; dispatcher automated review remains external.
- Implementation is complete under the conservative adapter interpretation above.
  Full-workspace validation remains blocked by pre-existing network-dependent builds.
- No pushes, PRs, branch switches, merges, other checkout changes or tracker changes
  were performed. Open question: the exact sanctioned adapter path, if an exception
  is required in this checkout.

<!-- AUTHORED-BY Codex GPT-6 -->

## Addendum fix round — whole-statement types and module specifiers

Resumed on `lane/sst-z1d` at `7d97690b7ef977b3cc00e772c56d7b77c0572094`.
The earlier loader/identifier allowlist remains in place; this round addresses
both findings in the supplied review addendum.

Commits:

- `6a1f7172` — `fix: restrict type-only exemptions to whole statements`: only
  `import type` and `export type ... from` declarations receive the runtime-layer
  exemption. Inline `type` specifiers, including lists containing only types,
  remain runtime edges under `verbatimModuleSyntax`. Regression cases cover both
  gateway channel imports/exports and agent UI mandate imports/exports, including
  mixed, empty, default and namespace forms.
- `fdce42dc` — `fix: restrict agent module specifiers to packages and paths`:
  validate decoded literal specifiers before path normalization; reject schemes,
  queries, fragments, absolute paths and backslashes. Cover static imports,
  re-exports, dynamic imports and type imports, including escaped literals and
  test/configuration files. Convert Node builtin imports in the ten scaffold
  export tests and the existing authorization verifier build script to bare
  names, with local Biome suppressions explaining the agent policy.
- The final `docs: record sst-z1d addendum validation` commit updates this report last.

Conservative interpretation:

- The addendum permits only bare package names (including package subpaths) and
  relative paths. Therefore all schemes, including `node:`, are rejected in agent
  code; bare builtin names such as `fs` and `url` remain permitted where layer
  rules allow them. No new exception was added.
- The referenced `briefs/sst-z1d.md` and earlier briefs remain absent. Used the
  supplied brief/addendum and existing implementation. The earlier interpretation
  of the absent sanctioned adapter path remains unchanged; `guarded-fetch` itself
  is outside the agent policy. No package API, manifests or dependencies changed.

Validation of the final implementation:

- `pnpm exec vitest run test/agent-layers.test.mjs` — PASS: **190 layer tests**.
- Biome checks of all changed scripts and tests — PASS, no remaining warnings.
- `pnpm run lint:root` — PASS as the first stage of the successful affected gate
  and again as its Turbo root task. An earlier attempt identified the verifier's
  remaining `node:` imports; converted those before the successful run.
- `TURBO_SCM_BASE=7d97690b7ef977b3cc00e772c56d7b77c0572094 pnpm run gate --cache=local:rw --env-mode=loose`
  — PASS: **46 successful / 46 total**, none cached, 21.696 seconds. Includes
  lint/build/typecheck/test for all eleven touched projects, root lint, all
  **218 root tests** and **109 package/app tests** (62 scaffold + 47 verifier).
- `pnpm run gate:full --cache=local:rw --env-mode=loose` — BLOCKED by the unchanged
  `@jeswr/unstorage-solid#build`, whose dependency clone failed with
  `fatal: transport 'https' not allowed`. **26 tasks succeeded**, 19 cached,
  before cancellation. Root tests pass through cached results in this run.
- `git diff --check` — PASS.

Validation retained `/tmp/sst-z1d-network-guard.cjs`, `GIT_ALLOW_PROTOCOL=file`,
`TURBO_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1`. Remote caching was disabled.
No remote fetch/clone completed; no live provider or pod request was made.
Logs: `/tmp/sst-z1d-addendum-gate.log` and `/tmp/sst-z1d-addendum-full.log`.

Implementation is complete. Full-workspace validation remains blocked by the
existing remote-dependent build. Read the local review/test guidance and addressed
the supplied review; `roborev` remains unavailable, so dispatcher automated review
is external. No push, PR, branch switch, merge, other checkout mutation or tracker
change was performed. No new open questions; the prior adapter-path caveat remains.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Fix round 3 — URL targets and suite-wide loader checks

Resumed on `lane/sst-z1d` at `fc46a5ba870790d56ed19c18050d5e881bd5c783`.
Read the original and all fix briefs and the complete supplied review at
`lanes/reviews/solid-sdk-lane-sst-z1d-fc46a5ba8707.md` in the tracker checkout.
Addressed only its two findings; no packages, APIs, manifests or dependencies changed.

Commits:

- `89dafe07` — `fix: close agent layer import bypasses`: reject percent-encoded
  module targets before filesystem normalization, including relative send/audit
  references and encoded dot segments/separators. Reject whitespace and control
  characters in agent specifiers that URL resolution could reinterpret. Normalize
  parentheses, TypeScript wrappers and literal member keys for suite-wide
  `require` target checks. Keep the prefilter conservative for escaped loader names
  and calls after template expressions; comments and string examples remain inert.
  Add 25 regression cases, including valid controls and continued CommonJS rejection
  in agent code.
- The final `docs: record sst-z1d fix3 validation` commit updates this report last.

Conservative interpretation: reject encoded URL targets outright rather than
canonicalizing them. The agent allowlist still permits only the existing literal
ESM forms. Normalizing CommonJS targets in other projects does not admit those
loaders in agent code or extend the agent allowlist. Other projects retain their
existing policy for dynamic targets; their literal targets receive the suite-wide
send-subpath and model-SDK restrictions requested by the review.

Validation:

- `pnpm exec vitest run test/agent-layers.test.mjs` — PASS: **215 layer tests**.
  The initial regression run failed on the supplied gaps before implementation.
- `pnpm exec biome check scripts/check-agent-layers.mjs test/agent-layers.test.mjs`
  — PASS; also covered by the successful root gate below.
- `pnpm run lint:root` — PASS within the affected gate, including the real-workspace
  layer scan. No package-specific gates apply because only root scripts/tests changed.
- `TURBO_SCM_BASE=fc46a5ba870790d56ed19c18050d5e881bd5c783 pnpm run gate --cache=local:rw --env-mode=loose`
  — PASS: root lint and **243 root tests** across four files; **1 successful / 1
  total** Turbo task, uncached, 2.899 seconds.
- `pnpm run gate:full --cache=local:rw --env-mode=loose` — BLOCKED by unchanged
  `@jeswr/unstorage-solid#build`: its dependency clone was refused with
  `fatal: transport 'https' not allowed`. **8 tasks succeeded** before failure.
- `git diff --check` — PASS. No dependency additions; `check:packages` not applicable.

Verification used the existing `/tmp/sst-z1d-network-guard.cjs` preload,
`GIT_ALLOW_PROTOCOL=file`, `TURBO_TELEMETRY_DISABLED=1` and `DO_NOT_TRACK=1`.
Remote caching was disabled. No remote fetch/clone completed and no provider/pod
calls ran. Logs: `/tmp/sst-z1d-fix3-gate.log`, `/tmp/sst-z1d-fix3-full.log`.

Implementation is complete. The full gate remains blocked by the existing
network-dependent build. `roborev` is unavailable and no post-commit hook is
installed; dispatcher automated review remains external. No push, PR, branch
switch, merge, other checkout mutation or tracker change was performed.
Open questions: none for this fix round.
