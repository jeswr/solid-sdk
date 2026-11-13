# Solid Browser Extension

## Overview

A Chrome browser extension that enables Solid authentication at the browser level. Injects `window.solid` into all pages providing `.fetch`, `.webId`, `.setClientId()`, `.login()`, and `.logout()`.

## Architecture

```
Page (MAIN world)  <--postMessage-->  Content Script (ISOLATED)  <--chrome.runtime-->  Service Worker
    inject.ts                          content-script.ts                               service-worker.ts
```

- **inject.ts**: MAIN world script defining `window.solid` (no credential; postMessage only)
- **content-script.ts**: ISOLATED world bridge — the trust boundary; stamps the real page origin
- **service-worker.ts**: Background session manager + message router + the SOLE token holder
- **core/**: the security-critical, unit-testable core —
  - `dpop.ts` (RFC 9449 DPoP proofs on Web Crypto + jose),
  - `origin-policy.ts` (the fail-closed per-origin credential boundary),
  - `authenticated-fetch.ts` (origin-gated resource fetch + §8 nonce retry),
  - `www-authenticate.ts` (the use_dpop_nonce classifier),
  - `webid.ts` (RDF issuer/profile resolution via N3.js)
- **auth-flow.ts**: Solid-OIDC auth-code + PKCE + DPoP via `chrome.identity.launchWebAuthFlow`
- **action-icon.ts**: the toolbar avatar (OffscreenCanvas render of photo/initials)
- **session-store.ts**: token/key/profile/recent-accounts persistence via `chrome.storage.local`
- **shared/messages.ts**: the JSON-serialisable 4-context message protocol

## Auth + suite packages

Solid-OIDC **authorization-code + PKCE + DPoP** via `chrome.identity.launchWebAuthFlow` (no
`window` in a service worker). DPoP proofs mirror `@jeswr/solid-dpop`'s RFC 9449 discipline but
are reimplemented on Web Crypto + jose because the service worker has no `node:crypto`. This app
lives in the solid-sdk monorepo (`apps/extension`) and takes `@jeswr/solid-elements` (the popup
web components) as a `workspace:*` dependency; `@jeswr/solid-dpop` is the proof-spec reference
only, not a dependency. **Never re-alias the components' own theme tokens; scope filled button
styles to `#login-form`** (the suite CSS-leak guards).

## Security invariants (do not weaken)

- The page NEVER receives a token; only the WebID + proxied fetch results.
- `core/origin-policy.ts` fails CLOSED: the token attaches only to the WebID/issuer/pod
  origins, never a foreign origin, never `/token`, never over cleartext (loopback dev excepted).
- Page-supplied `Authorization`/`DPoP` headers are stripped; the content script stamps the REAL
  page origin so a page can't impersonate another origin's client-id mapping.
- **Access management is OUT OF SCOPE** — `window.solid.requestAccess?` is a declared,
  throwing SEAM only. Do not implement it without the access-management design track.

## Agent sign-in capture boundary

`popup/agent-sign-in-view.ts` is a thin, long-lived-port view of the worker's single
capture state machine (`background/agent-capture.ts`). The worker owns the exclusive lease,
all tab/access checks, cookie reads, native requests and cleanup under one async mutex.
Review validates the CURRENT active tab against the lease's tab/origin and existing host
access before arming the popup's **Allow cookies and review** click. Only that click requests
optional `cookies`, synchronously inside its gesture.
Armed views are invalidated on tab activation, lease-tab URL updates, window focus changes
and permission additions/removals; the click checks the latest worker-pushed armed lease.
In a sub-second race Chrome may still show the cookies prompt after authorization changes,
but nothing is read or sent and the grant is removed. After the prompt the worker rechecks
tab/origin and host access before `beginLogin`; confirmation rechecks the cookie grant,
tab/origin and host access before reading a fresh snapshot and sending it. Tab activations,
lease-tab URL changes, window focus changes and all permission changes latch authorization
invalid throughout confirmation/sending, even if the previous tab/access is restored. Every
awaited step checks the latch before continuing, including immediately before native dispatch.
The preview shows site/count/persona; a changed cookie count refuses confirmation.
Never expose this action through window.solid or the content bridge.
`background/agent-vault.ts` admits only Chrome-attested popup ports, never a content-script
sender/tab. There is no generic popup-to-native request proxy. Its single native port is
retained for the vault's keep-alive owner. Native host replies contain display metadata,
a generation token or acknowledgements, never credentials. Use the browser-safe
`@jeswr/agent-vault/browser` schemas and PSL boundary; parent cookies require explicit
vetted host configuration. No cookie values in logs, errors, UI or storage.

Hostile processes running as the same OS user are explicitly outside the native vault's
threat model: they can read its store/key or forge the public extension-ID caller argument.
There are no code-signature checks or independent browser-process authentication, matching
other local credential tools without such checks. Native stdin/stdout TTY refusal prevents
accidental interactive launches; it does not establish caller identity. Each accepted
capture marks its vault session `origin: "browser-capture"` and records a pending
"New sign-in from browser" entry for the host's later agent approval UI.
Capture never requests or removes a host origin. Withheld site access refuses without a
permission request or native message; tell the person to allow the extension on this site
through Chrome's own extension menu first, then try again. Check optional `cookies` on every
popup load before tab/site validation, retaining its warning even when loading fails.
The extension uses `cookies` only for active capture: whenever no lease is acquiring cookies,
confirming or sending, remove any present grant and verify absence. Run this unconditionally
at every worker start, on `runtime.onStartup`, `runtime.onInstalled` and on
`permissions.onAdded` without a current armed acquisition. Cleanup never depends on grant
ownership or a marker. Popup load and Review also remove unexpected idle grants before sharing.
Keep only a display marker (`agentCaptureCleanup: true`) in `storage.local` while removal is
in progress or failed, and clear it after verified absence. No session-storage ownership record
is needed. Show "Cleaning up a previous sharing" during removal. If automatic cleanup fails,
keep the warning and **Remove cookie access** retry button, even on invalid or withheld sites;
failed removal blocks review, permission requests and native messages and directs the person to
Chrome's extension settings. Worker cleanup failure sets a toolbar `!` badge.
Request only optional `cookies` from the worker-armed popup click. The exclusive capture lease
(review -> acquiring -> confirming -> sending -> cleaning -> idle) expires after two minutes.
A second popup receives "Another sharing is in progress" without another request or native
message. Success, failure, Cancel, timeout and port disconnect all remove cookie access and
verify absence before releasing the lease. Cancellation invalidates in-flight work immediately
and terminal views never move backwards. An unresolved prompt fences new captures after the
lease ends until its result/onAdded grant has been cleaned; a missing outcome blocks sharing
for that worker lifetime. A delayed armed click after expiry may still request permission in
Chrome, but its grant is removed without a current acquiring lease. A replacement worker also
removes it at start, even with cleared session storage and no marker.
Required `<all_urls>` stays in place and host grants never change; temporary cookie access
is extension-wide, so exact-origin filtering and explicit confirmation still apply.

## Gate

`pnpm run gate` = lint (biome) + typecheck (tsc) + test (vitest, the core) + build (webpack).
e2e (`pnpm run test:e2e`) runs against a LOCAL Community Solid Server only, never the live box.

## Build & Test

```bash
pnpm install                                  # From the solid-sdk root
pnpm --filter @jeswr/app-extension run build     # Build extension to dist/
pnpm --filter @jeswr/app-extension run build:dev # Build in watch mode
pnpm --filter @jeswr/app-extension run test:e2e  # Build + run Playwright e2e tests
```

### E2E Testing

- Runs in headless Chromium (`channel: 'chromium'`, the new headless mode, loads extensions); no display server needed
- Uses Community Solid Server on localhost:3000 with in-memory storage
- Test site served on a separate port
- Extension loaded from `dist/` via `--load-extension`

## Skills

Solid-specific skill documents are in `.skills/`:
- `spec.md` — Solid Protocol, WebID, Solid-OIDC, ACP
- `servers.md` — Community Solid Server
- `style-guide.md` — Solid brand guidelines (use for popup UI)
- `data-modelling.md` — RDF vocabularies, SHACL
- `integration-guide.md` — Client libraries

## Documentation Lookups

Use the Context7 MCP server for up-to-date library documentation. Prefer Context7 over training data for API specifics of:
- `jose` (DPoP proof signing / JWK)
- `@jeswr/solid-elements`, `@jeswr/solid-dpop`
- Playwright extension testing
- Community Solid Server configuration
- Chrome Extension MV3 APIs

## Development Workflow

This project uses **roborev** for continuous automated code review. Every git commit triggers an asynchronous review via a post-commit hook. Reviews are performed by GitHub Copilot (OpenAI o3) — a different model from the code-writing agent — to provide independent oversight.

### Commit practices

- **Commit frequently** — small, focused commits. Each commit is reviewed independently by roborev, so smaller commits produce more actionable feedback.
- **One concern per commit** — don't mix feature code, test changes, and config changes in a single commit.
- **Build before committing** — run `pnpm run build` to catch TypeScript/webpack errors. The reviewer can't run the build itself.
- **Run tests before committing** — run `pnpm run test:e2e` for any changes that touch the extension source, message protocol, or auth flow.

### Reviewing and fixing

After committing, roborev reviews asynchronously in the background. To interact with reviews:

```bash
roborev tui            # Interactive terminal UI — view all reviews
roborev show           # Show review for current commit
roborev status         # Check daemon health and queue
roborev fix            # Auto-fix findings (runs in isolated worktree)
roborev refine         # Iteratively fix → re-review → repeat until clean
```

Review verdicts: **P** (pass), **W** (warning), **F** (fail).

### When roborev flags an issue

1. Read the finding in `roborev tui` or `roborev show`
2. Either fix manually and commit, or run `roborev fix` to auto-remediate
3. If the finding is a false positive for this project (e.g. extractable DPoP keys, localhost CLIENT_ID), it is already suppressed in `.roborev.toml` review guidelines — if new patterns need suppressing, update the `review_guidelines` field there.

### For AI agents (IMPORTANT — read before making any changes)

**You MUST commit after every completed set of changes.** This is not optional. The roborev post-commit hook triggers an automated review by a separate model (GitHub Copilot / OpenAI o3), providing independent oversight of your work. If you do not commit, your changes are not reviewed, and issues may go undetected.

Workflow:
1. Make your changes (code, config, docs, tests — whatever the task requires).
2. **Commit immediately** once the changes are complete and working. Do not wait for the user to ask you to commit.
3. After committing, run `roborev show` to check if the review has completed and whether there are findings.
4. If roborev flags issues, fix them and **commit again** (a new commit, not an amend).
5. For automated fix-review loops, use `roborev refine`.

Rules:
- **Small, focused commits.** One concern per commit. Do not batch unrelated changes.
- **Build and test before committing.** Run `pnpm run build` and `pnpm run test:e2e` for source changes.
- **Never skip commits.** Even config-only or docs-only changes must be committed so they are reviewed.
- The `.roborev.toml` file configures review guidelines — read it to understand what the reviewer focuses on and what it ignores.

## Key Conventions

- TypeScript throughout, strict mode; biome lint + format
- Webpack bundler, 4 entry points (service-worker, popup, content-script, inject)
- Manifest V3 with `world: "MAIN"` for the `window.solid` injection
- DPoP keys stored as extractable JWK (the MV3 worker is killed and would lose a
  non-extractable key, breaking the jkt-bound refresh) — kept in page-unreachable
  `chrome.storage.local`
- Per-origin client ID via `solid.setClientId()`; a published Client Identifier Document
  client_id with dynamic-registration dev fallback
- Popup themed via the app-shell OKLCH tokens (light/dark), consistent with Pod Manager
- WebID issuer + profile parsed with N3.js (proper RDF, never regex over Turtle)
- New source files carry an `AUTHORED-BY Claude Opus 4.8` marker; commits carry the Opus
  provenance trailers
