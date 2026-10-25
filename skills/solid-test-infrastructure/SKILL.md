---
name: solid-test-infrastructure
description: Use when creating Solid package or app tests, running Vitest against injected fetch seams, starting a local Community Solid Server for Playwright, seeding accounts and profiles, or preventing flaky/vacuous authenticated integration tests.
---

## Quick reference

<!-- AUTHORED-BY Codex GPT-6 -->

<!-- AUTHORED-BY Codex GPT-5 -->

**Test Solid code against real protocol behavior**

Use two layers:

- Vitest for pure logic and data layers with injected fetch, clock, storage, crypto, and network seams.
- Playwright or integration tests against one long-lived local Community Solid Server for actual HTTP, OIDC, DPoP, LDP, ETag, and browser behavior.

### Harness rules

- Start the server once per suite/worker, not once per test. Isolate writes with fresh accounts or pod roots.
- Give CSS and the app distinct fixed ports. Probe the CSS account API rather than treating any HTTP 200 as the right service.
- Seed fresh profiles with the WebID data tests require, including name and `pim:storage`; bare profiles make otherwise-correct application tests appear broken.
- Use client-credentials DPoP fixtures for data arrangement. Keep one focused browser test for the real interactive popup path.
- Before claiming an authenticated read worked, assert the resource is actually private with an anonymous 401/403.
- Pin the CSS version used in CI.
- Never skip a non-completing login implicitly. A login timeout is a test failure unless an explicit opt-in skip is part of the test contract.
- Avoid fixed sleeps. Wait on observable state, responses, or lifecycle seams.

### Non-vacuous security tests

- Drive real OAuth/DPoP code over a stub transport rather than mocking away the library under test.
- Verify signatures, `htm`/`htu`, `ath`, `jkt`, nonce retry, token rotation, and replay behavior.
- Exercise logout/account-switch races and delayed stale operations.
- For 401-budget tests, seed several private resources, count response statuses under the storage origin, and prove challenges do not scale per resource.
- Match exact RDF namespace schemes in fixtures so a successful empty query cannot pass the test accidentally.

In ESM packages, keep Playwright config/setup ESM-safe: use relative module paths, derive paths from `import.meta.url`, and avoid `require`/`__dirname`. Keep test helpers reviewable text—write escaped separators rather than literal NUL bytes.

### Agent persona

When this work is delegated to a sub-agent, spawn the `solid-test-engineer` persona from
[`.claude/agents/solid-test-engineer.md`](../../.claude/agents/solid-test-engineer.md) — it routes through this skill.
Orchestration: `.claude/agents/solid-app-orchestration.md`.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Solid test infrastructure — build it before the features

**The test infrastructure is part of the scaffold, not an afterthought.** Stand it up right
after `create-next-app`, before the first feature — then every feature lands with its tests,
and TDD is possible: write the failing test (unit or e2e), implement, go green, refactor.
(Install the `test-driven-development` skill from `obra/superpowers` for the discipline; this
skill is the Solid-specific machinery.)

Two layers, per [`AGENTS.md`](../../AGENTS.md) Part 2 §Testing:

| Layer | Tool | Scope |
|---|---|---|
| Unit / integration | **Vitest** | `src/lib/` — the data layer; `fetch` injected as an **optional** param, omitted in production paths |
| End-to-end | **Playwright** | Golden paths against a **real local CSS** — login popup included; no mocks |

## The bundled harness (execution-verified)

Two files, lifted verbatim from the clean-room verification build that validated this guide —
they powered full popup-login e2e runs (3/3 stable) and authenticated write-path tests:

1. **[`playwright.config.ts`](references/playwright.config.ts.md)** — the two-`webServer` pattern: one
   in-memory CSS@7 on `:3000` (it must own that port — the auth issuer map requires it) and the
   app on `:3200` (`next dev` would otherwise clash on 3000; **using another framework, swap
   that webServer command for your dev server on `:3200`** — the harness is framework-agnostic,
   as is `dev.mjs` via `APP_CMD`). One CSS instance per suite — startup is ~13s, so never
   per-test. `reuseExistingServer` keeps local iteration fast.
2. **[`global-setup.ts`](references/global-setup.ts.md)** — runs once after the servers are up:
   - creates a unique account and pod per run via the CSS account API (`POST /.account/account/` with `{}` — with a
     JSON content-type an empty body 500s), registers a password, creates the pod;
   - mints **client-credentials**, then exchanges them for a **DPoP-bound token** (jose-built
     proofs — note the `ath` claim on resource requests);
   - **seeds the profile** — a fresh CSS pod profile has no `foaf:name` and no `pim:storage`
     (so no display name and no write path); the setup PUTs them plus a photo;
   - passes `{ webId, email, password, podRoot }` to test workers through
     `process.env.SOLID_E2E_ACCOUNT`, without logging credentials.

3. **[`css-account.ts`](references/css-account.ts.md)** — the per-test account fixture:
   `createCssAccount({ pod })` returns `{ webId, email, password, podRoot, token, proof }` with
   the bare profile seeded — fresh-account-per-write-test isolation without restarting CSS
   (compile-verified; same recipe as global-setup, packaged per call).

Copy what you need; keep the unique per-run account names and consume the setup credentials
in tests rather than hardcoding Alice. `jose` is the only
extra dev-dependency. Alternative to run-time profile seeding: start CSS with the **custom pod
templates** from this repo's `config/pod-templates/` (+ `config/css-memory-wac-templates.json`)
and every pod is born with `pim:storage` — see `docs/local-ops.md` for the verified mechanics
and the `--seedConfig` boot-time account seeding.

## The dev environment — seeded and ready to log in

`npm run dev` must give the developer a **testable** environment, not just a compiling app:
CSS running, accounts already seeded, and the **credentials printed where they can't be
missed**. The bundled [`dev.mjs`](references/dev.mjs.md) (execution-verified) does exactly that — starts
in-memory CSS on `:3000`, seeds two accounts (alice/bob, profile names + `pim:storage`
included), prints a credentials banner (WebID / email / password / pod root per account), then
starts the app on `:3200`. Wire it as the dev script:

```json
{ "scripts": { "dev": "node scripts/dev.mjs" } }
```

`node scripts/dev.mjs --no-app` gives CSS + seeded accounts only — run it once in its own
terminal and leave it up: **CSS takes ~15 s to boot, so avoid restarting it**. The script
reuses a CSS already on `:3000` (tolerating existing accounts), so app restarts never pay the
CSS boot cost. It detects that reuse by probing the CSS-specific account API
(`GET /.account/` → JSON), **not** a bare `200` on `/` — so a stray `next dev` (whose default
port is also `3000`) won't be mistaken for CSS; if something non-CSS owns `:3000` the script
fails fast with an `lsof -i :3000` hint instead of seeding against the wrong server. For clean
state, prefer a fresh account (`createCssAccount`) over a restart.

## Patterns the harness enables

- **Authenticated fixtures without the popup**: the client-credentials DPoP token from
  global-setup reads/writes the pod directly — use it to arrange test data and to test the
  data layer against live CSS (fast, no browser). Interactive popup login stays in exactly one
  or two e2e specs.
- **401-gated assertions**: before asserting authenticated content, confirm the resource
  returns `401` unauthenticated — then a passing test *proves* the auth upgrade ran; a false
  pass is impossible.
- **Write isolation**: in-memory CSS resets on restart; for a pristine pod per suite, restart
  CSS. For write-heavy suites, `createCssAccount` (bundled) gives a fresh account + seeded
  profile + DPoP token per test — no shared-pod interference, no restart.
- **Popup flows**: capture the OIDC popup with `context.waitForEvent("page")`; CSS login is
  `#email` / `#password` → "Log in" → "Authorize". Ignore the transient `prompt=none` popup
  that closes itself before the interactive one opens.

## Per-feature loop (the actual instruction)

For every feature: **(1)** write the failing Vitest case against the data-layer contract
(mock `fetch` via the optional param), **(2)** implement until green, **(3)** extend — or
confirm coverage by — an e2e golden path. A feature without tests is not done. Don't
snapshot-test UI, don't test shadcn primitives, don't `sleep()` — auto-waits only.

[`feature.spec.example.ts`](references/feature.spec.example.ts.md) is the per-feature e2e template —
distilled from a real Bob-built TODO app developed against this guide: login error-states
first (they're the executable form of the `solid-reactive-authentication` UX spec), a
shared popup-login helper in `beforeEach` (email/password and consent), role/placeholder locators, empty-state → create → persist-across-reload.

## PGlite-backed services — boot once per worker, reset between tests

When testing a Postgres-backed Solid service with
[`@electric-sql/pglite`](https://github.com/electric-sql/pglite) (in-process WASM Postgres) under
vitest, **do NOT `new PGlite()` per test or per suite** — the WASM boot takes ~1 s each and
parallel boots thrash CPU, forcing long test timeouts and slow suites. Instead **boot one engine
per vitest worker and reset the schema (~80 ms) between tests** (drop + recreate or truncate).

In `jeswr/solid-webid-index` this cut the suite from ~683 s cumulative / ~123 s wall-clock to
~90 s / ~16 s (≈7.5×) and removed the need for inflated per-test timeouts.

**Pattern:**

```ts
// test/helpers/db.ts  (imported by every test file)
import { PGlite } from "@electric-sql/pglite";

// Kick off the WASM boot immediately at module load so it overlaps vitest's import phase.
const enginePromise = PGlite.create();

export async function freshDb(): Promise<PGlite> {
  const db = await enginePromise;
  // Drop and recreate the schema — ~80 ms vs ~1 s for a new engine.
  await db.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await runMigrations(db);   // your app's migration function
  return db;
}
```

```ts
// my-feature.test.ts
import { freshDb } from "./helpers/db.js";

let db: PGlite;
beforeEach(async () => { db = await freshDb(); });
// No afterAll close — the shared engine lives for the whole worker lifetime.
```

Rules:
- **Never `close()` the shared engine** mid-suite; it cannot be reopened.
- Route every test through one shared `freshDb()` / `freshTestStore()` helper — never call
  `PGlite.create()` directly in a test file.
- Each vitest worker gets its own engine (vitest isolates workers) so tests in different files
  run truly in parallel without contention.

## ESM project (`"type": "module"`) — Playwright loads the config + setup files as ESM

In a package with `"type": "module"` in `package.json`, **Playwright loads its `.ts` config AND
the imported `globalSetup`/`globalTeardown`/fixture files as ESM** — regardless of a nested
`e2e/tsconfig.json` set to `module: commonjs`. So a CJS-only construct in any of those files
throws at config-parse time (in CI, before a single test runs) — both `require` and `__dirname`
are simply not defined in an ES module:

- `require` / `require.resolve(...)` → `ReferenceError: require is not defined in ES module scope`;
- `__dirname` → `ReferenceError: __dirname is not defined in ES module scope`.

Fix:

- in the Playwright config, pass `globalSetup`/`globalTeardown` as plain **relative path strings**
  (Playwright resolves them against the config dir) — not `require.resolve(...)`;
- in the setup files, derive `__dirname` from `import.meta.url`:
  ```ts
  import { fileURLToPath } from "node:url";
  import { dirname } from "node:path";
  const __dirname = dirname(fileURLToPath(import.meta.url));
  ```
- set the e2e `tsconfig.json` to `module: ESNext` + `moduleResolution: bundler` so `import.meta`
  is type-correct.

(Learned fixing the `jeswr/solid-browser-extension` e2e CI — the ESM-config fix. This is the
ESM-default mirror of the CJS-default `globalSetup` transpiler gotcha below.)

## Node version — 25.1 breaks SSR/prerender via `localStorage`

Node 25.1 ships `globalThis.localStorage` as a **truthy object whose methods are
non-functional** unless `--localstorage-file` is set. That silently breaks the standard
browser-detection guard used to keep Solid client code (and any `localStorage`-touching code)
out of the server render path:

```ts
// Passes on Node 25.1 even though localStorage.getItem() then throws —
// the object exists, so `typeof` sees "object", not "undefined".
if (typeof localStorage !== "undefined") {
  const cached = localStorage.getItem(key); // throws server-side
}
```

Under Next.js (or any SSR/prerender framework) this makes a page that only touches
`localStorage` behind a `typeof` guard 500 at build/prerender time — on Node ≤24 the same guard
correctly evaluates `false` server-side and skips the branch. This bit the `jeswr/elk` fork's `/`
prerender.

Fix, in order of preference:
- **Build/prerender on Node ≤24** — pin it (`.nvmrc` / `package.json` `engines.node`) so CI and
  every contributor's local build use a version where the guard behaves.
- **Feature-detect by calling, not by `typeof`** — wrap the actual access in try/catch instead of
  trusting existence:
  ```ts
  function hasWorkingLocalStorage(): boolean {
    try {
      localStorage.setItem("__probe__", "1");
      localStorage.removeItem("__probe__");
      return true;
    } catch {
      return false;
    }
  }
  ```
- Do both — the `.nvmrc`/`engines` pin keeps the whole toolchain (not just this one guard)
  behaving consistently; the call-based probe is the defensive fallback for code you don't
  control.

(Learned in the `jeswr/elk` fork upstream-sync, 2026-07-02 — verified by reproduction: the
`typeof` guard passed and `/` prerendered fine on Node 24, then 500'd on Node 25.1 with the exact
same source.)

## jsdom + Radix UI — `fireEvent.pointerDown` never opens a dropdown

Radix UI menu triggers (DropdownMenu and friends — the menus shadcn wraps) open from a
`pointerdown` event whose `button === 0`. jsdom **before v27** has no `PointerEvent`
constructor (check `typeof window.PointerEvent`), so there Testing Library's
`fireEvent.pointerDown` falls back to constructing a generic `Event` and the `MouseEvent`-init
fields (`button`, `ctrlKey`, …) are silently dropped — `event.button` is `undefined`, Radix's
`button === 0` trigger check fails, and the menu never opens. No error, no warning: the same
component works in a real browser, but under vitest/jsdom the menu content simply never appears
in the document. (jsdom ≥27 implements `PointerEvent`, so upgrading removes the fallback path —
the workaround below is for environments pinned to an older jsdom.)

Fix: construct the `MouseEvent` yourself with `type: "pointerdown"` — jsdom implements
`MouseEvent` fully and it carries `button: 0` by default — and dispatch it **through
`fireEvent(element, event)`** so Testing Library still wraps the dispatch in React's `act()`
(a raw `element.dispatchEvent(...)` skips that and can leave you asserting before the
resulting state updates settle, with act warnings):

```ts
// fireEvent.pointerDown(trigger);  // ✗ generic Event in jsdom — button undefined, no open
fireEvent(trigger, new MouseEvent("pointerdown", { bubbles: true })); // ✓ button: 0 — opens
```

Verified on dropdown menus. Radix **Select** triggers additionally check
`event.pointerType === "mouse"`, which a bare `MouseEvent` also lacks — if a Select still won't
open, attach the field to the constructed event first:

```ts
fireEvent(
  trigger,
  Object.assign(new MouseEvent("pointerdown", { bubbles: true }), { pointerType: "mouse" }),
);
```

Select also calls the element pointer-capture APIs, which pre-27 jsdom doesn't implement
either — stub them once in the vitest setup file or the Select tests still throw / stay shut:

```ts
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
```

(Learned writing component tests for the suite apps' shadcn/Radix dropdown menus, 2026-07 —
bead suite-tracker-z7cc. The tell: a dropdown that opens fine in the browser but whose items
are unreachable in jsdom tests.)

## Clearing a Dependabot backlog in a fork — range-scoped pnpm overrides

When syncing an OSS app fork with its upstream, **merging upstream does not clear your
Dependabot alerts** — upstream usually carries the same vulnerable transitive dependencies, so
the alerts survive the merge unchanged. To clear a backlog without waiting on upstream:

- Use `pnpm-workspace.yaml` `overrides` in **range-selector form**, scoped to only the vulnerable
  major (e.g. `"vulnerable-pkg@^3": "^3.2.1"`), not a blanket pin — a blanket override can drag in
  an incompatible major and silently break every parallel-major dependent left untouched by the
  advisory.
- **Verify the patched version actually exists on npm before writing the override** — an override
  pointing at a version that was never published leaves `pnpm install` unresolvable.
- **Regenerate and re-verify the lockfile per alert** — check each Dependabot alert against the
  regenerated lockfile individually rather than assuming one override run clears all of them.
- **pnpm ≥11 footgun**: a git-hosted dependency with install/build scripts must be allowlisted by
  its **exact tarball URL** in `pnpm.allowedDeprecatedVersions`/`onlyBuiltDependencies`-style
  config. If that dependency is pinned to a moving ref (e.g. `#main`), the allowlist entry breaks
  every time the upstream ref advances — pin the git dependency by commit SHA, not a branch name,
  so the allowlist entry stays valid.

(Learned in the `jeswr/elk` fork upstream-sync, 2026-07-02 — each fix verified per-alert against
the regenerated lockfile.)

## Gotchas

| Gotcha | Detail |
|---|---|
| ESM project (`"type": "module"`) | Playwright loads the `.ts` config + `globalSetup`/`globalTeardown`/fixtures as ESM — a nested `tsconfig.json` `module: commonjs` does NOT change that. Both `require`/`require.resolve` and `__dirname` → `ReferenceError: … is not defined in ES module scope` at config-parse. Pass setup as path strings, derive `__dirname` from `import.meta.url`, set the e2e tsconfig to `module: ESNext` + `moduleResolution: bundler` (see section above; from `jeswr/solid-browser-extension`) |
| `globalSetup` must be self-contained | Importing a sibling `.ts`/`.mjs` from it trips Playwright's config transpiler in a CJS-default project — inline everything |
| `node x.ts` strip-only mode | Rejects TS parameter properties — plain field assignments in files run directly with node |
| Port clash | CSS owns `:3000`; the app runs on `:3200` (see config comments) |
| Bare fresh profiles | Without the profile seed, `Agent.name` is `undefined` and `storageUrls` is empty — apps appear broken when it's just an unseeded pod |
| ETag from CSS | Present and stable — exercise the conditional-PUT (`If-Match`/`412`) path in tests; legacy NSS lacks it (see `solid-server-matrix`) |
| PGlite boot cost | `new PGlite()` per test is ~1 s × N tests; boot once per vitest worker + reset schema between tests instead (see section above) |
| Node 25.1 `localStorage` | `globalThis.localStorage` exists but throws on call unless `--localstorage-file` is set — a `typeof localStorage !== "undefined"` guard passes and then fails at call time, breaking SSR/prerender. Build on Node ≤24 or feature-detect by calling (see section above) |
| Radix dropdowns won't open in jsdom | jsdom <27 lacks `PointerEvent` (upgrade if you can), so `fireEvent.pointerDown` falls back to a generic `Event` whose `button` init is dropped — Radix triggers require `button === 0`, so the menu silently never opens. Use `fireEvent(trigger, new MouseEvent("pointerdown", { bubbles: true }))` — the `MouseEvent` carries `button: 0`, and the `fireEvent(el, event)` form keeps the `act()` wrapping. Radix Select additionally checks `pointerType === "mouse"` (`Object.assign` it onto the event) and calls the pointer-capture APIs — stub `Element.prototype.{has,set,release}PointerCapture` in the test setup (see section above) |
| Dependabot survives an upstream merge | Merging a fork's upstream does NOT clear Dependabot alerts (upstream ships the same vulnerable transitives) — clear them with range-scoped `pnpm-workspace.yaml` overrides, verified per alert (see section above) |
