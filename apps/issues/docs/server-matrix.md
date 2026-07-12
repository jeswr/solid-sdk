# Server matrix — testing across Solid implementations

Per `AGENTS.md` §Servers, the app should be verified against more than one server
implementation as it nears release.

| Stage | Server(s) | Auth | ACL language | Status |
|---|---|---|---|---|
| Development | local CSS (in-memory) | dynamic registration (localhost) | **WAC** | ✅ automated — 8 Playwright e2e + 33 unit |
| Initial testing | [solidcommunity.net](https://solidcommunity.net) | dynamic reg from localhost; static client-id once deployed | WAC | ⏳ manual (needs a real account) |
| Initial testing | [Inrupt PodSpaces](https://start.inrupt.com) (ESS) | static client-id (deployed) | **ACP** | ⏳ manual (needs a real account) |

## What's verified

- **WAC** end-to-end against local CSS: login (popup), CRUD, comments, priority/
  labels, per-issue + container sharing, cross-pod open, type-index discovery.
- **ACP** is handled in code via `@solid/object`'s `wacToAcp`/`acpToWac` converters
  (`src/lib/sharing.ts`) and unit-tested at the translation layer, but has **not**
  been run against a live ESS pod.

## Manual procedure (needs your accounts)

The auth provider is issuer-from-profile, so no app config is needed — just sign in
with a WebID from each provider:

1. **solidcommunity.net** — create/login to an account, then in the app paste your
   `https://<you>.solidcommunity.net/profile/card#me`. From **localhost** this uses
   dynamic registration (a remote IdP can't dereference a localhost client-id).
   Exercise: create issues, comment, share with a second account, open across pods.
2. **PodSpaces (ESS)** — same, with your `https://…/profile/card#me`. ESS uses
   **ACP**, so sharing here exercises the `wacToAcp` path. Best done from the
   **deployed** app (static client-id) — see `DEPLOY.md`.
3. Note any provider-specific failures (e.g. `Unknown issuer` means the host is
   outside the published provider's built-in map — the custom
   `WebIdDPoPTokenProvider` resolves the issuer from the profile, so this should not
   occur, but record it if it does).

Report results back here as the matrix is exercised.
