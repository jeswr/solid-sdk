# Hosted Solid pod providers

Targets in `interop/targets/solid-hosted.json` (with the `census` object), run by the shared `solid-oidc`
adapter (`interop/adapters/solid.js`): WebID → issuer discovery, dynamic client registration, authorization code
+ PKCE in a real browser, DPoP-bound requests and reactive 401 upgrades. No hosted provider has been run yet
(no test accounts); every target is UNTESTED until configured.

## Census

Source: [solidproject.org/get_a_pod](https://solidproject.org/get_a_pod), file
[`get_a_pod.html` at 1b5ab98](https://github.com/solid/solidproject.org/blob/1b5ab98c57f7818b56fa8b329b236da6e67616c5/get_a_pod.html)
(commit 2026-08-05, "Add missing Pod providers to Get a Pod (#979)"; identical to `main` when read on
2026-09-27). `for_developers/getting_started.html` (34d62cc, 2026-05-01) only links to that page. Observations
are read-only GETs of each provider's `/.well-known/openid-configuration` on 2026-09-27; software is inferred
from response headers (`X-Powered-By`), never stated by the providers.

| Target | Listed as | Issuer (exact) | Software (inferred) | Revocation | `offline_access` | Observation |
| --- | --- | --- | --- | --- | --- | --- |
| `brolly-id` | brolly.id | `https://brolly.id` | unidentified | no | yes | discovery OK; `www.brolly.id` has none |
| `datapod-igrant-io` | Data Pod | `https://datapod.igrant.io` | NSS 5.7.4 | no | yes | in the library's NSS nonce-quirk list |
| `inrupt-podspaces` | Inrupt Pod Spaces | `https://login.inrupt.com` | Inrupt ESS | yes | yes | storage at `storage.inrupt.com` |
| `privatedatapod-com` | privatedatapod.com | `https://privatedatapod.com/` | CSS | yes | yes | |
| `redpencil-io` | redpencil.io | `https://solid.redpencil.io/` | CSS | yes | yes | |
| `solid-openlinksw-com` | solid.openlinksw.com | `https://solid.openlinksw.com:8445` | "OpenLink Solid Server" | no | not listed | port 443 reset the connection; NSS-like endpoints |
| `solidcommunity-net` | solidcommunity.net | `https://solidcommunity.net/` | CSS | yes | yes | behind Cloudflare |
| `solidcommunity-au` | solidcommunity.au | `https://pods.solidcommunity.au/` | CSS | yes | yes | |
| `solidweb-me` | solidweb.me | `https://solidweb.me/` | CSS | yes | yes | |
| `solidweb-org` | solidweb.org | `https://solidweb.org` | NSS 6.0.0 | no | yes | in the NSS nonce-quirk list |
| `teamid-live` | teamid.live | `https://teamid.live/` | CSS | yes | yes | |
| `trinpod-eu` | trinpod.eu | `https://trinpod.eu` | TrinPod 3.6.986 | no | not listed | answered once, then TLS resets (intermittent) |
| `trinpod-us` | trinpod.us | `https://trinpod.us` | TrinPod 3.6.986 | no | not listed | |
| `use-id` | use.id | — | unidentified | — | — | `use.id`, `get.use.id`, `idp.use.id`: TLS reset (unreachable) |
| `solidweb-app` | solidweb.app (experimental) | `https://solidweb.app/` | unidentified (`/idp/` endpoints) | yes | yes | |

Also configurable (closed source, not in the hosted list): `ess-live` (Inrupt Enterprise Solid Server) and
`trinpod-server-live` (a TrinPod server), both requiring the issuer from the environment.

## Capability declarations

- `revocation`: `true` exactly when the discovery document advertises `revocation_endpoint`, `false` when it
  does not (the note says so); `"unverified"` for unreachable or unconfigured deployments.
- `refreshTokens`: `true` where discovery advertises both the `refresh_token` grant and `offline_access`
  (the scenario then verifies issuance); `"unverified"` otherwise (TrinPod lists no `offline_access`,
  OpenLink lists no scopes, use.id was unreachable).
- `refreshRotation`, `storageDiscovery`: `"unverified"` everywhere — observable only with an account.
  Scenarios needing an unverified capability are UNTESTED with that reason, never UNSUPPORTED — unless the run
  passes `--exercise-unverified`, which runs them and reports what the run observes (PASS/FAIL, marked as
  exercised, not proven beforehand). The Solid Protocol's normative expectations (e.g. storages identifying
  themselves, §4.1) are the reason to exercise them; only a run's result is evidence.

Update a capability only from an actual run's evidence, and record the date in its note.

## Setup (per provider)

1. Create a **dedicated test account** at the provider's registration page (see `links.registration`), with
   no personal data. Never use a personal pod.
2. Either create a container used only for tests (e.g. `…/ra-interop-scratch/`, writable by the test WebID)
   for write scenarios, or pick an existing private resource for read-only runs. Optionally note a protected
   resource in another account/storage for the read-only boundary probe.
3. Set the environment (`<P>` is the target id in upper case with `_`, e.g. `SOLIDCOMMUNITY_NET`):

| Variable | Flag | Meaning |
| --- | --- | --- |
| `RA_INTEROP_<P>_WEBID` | pii, required | the test WebID |
| `RA_INTEROP_<P>_STORAGE` | pii, required | its storage root (ends with `/`) |
| `RA_INTEROP_<P>_SCRATCH` | pii, optional | scratch container inside the storage (enables writes) |
| `RA_INTEROP_<P>_PRIVATE_RESOURCE` | pii, optional | existing private resource (read-only mode) |
| `RA_INTEROP_<P>_OTHER_PROTECTED` | pii, optional | protected resource outside the storage |
| `RA_INTEROP_<P>_ISSUER` | optional (required for `use-id`, `ess-live`, `trinpod-server-live`) | expected issuer, exactly as discovered |
| `RA_INTEROP_<P>_CLIENT_ID` | optional | Solid-OIDC Client Identifier Document URL (maps to `config.clientId`); omit for dynamic registration |
| `RA_INTEROP_<P>_STORAGE_STATE` | pii, optional | Playwright storage state of the dedicated test account's signed-in IdP session (session mode, below); a configured missing file is a configuration error |
| `RA_INTEROP_<P>_LOGIN` | optional, CSS hosts only | `manual` (default) or `css-password` |
| `RA_INTEROP_<P>_EMAIL` / `RA_INTEROP_<P>_PASSWORD` | pii / secret, CSS hosts only | test-only account for `css-password` |
| `RA_INTEROP_SOLID_REDIRECT_URI` | optional | loopback redirect URI (default `http://127.0.0.1:39398/callback`) |

One of `SCRATCH` or `PRIVATE_RESOURCE` is needed; the adapter refuses a configuration with neither before any
request. Dynamic registration registers the loopback redirect URI itself; nothing needs registering.

### Client registration: dynamic registration or a Client Identifier Document

Every reachable provider's discovery document (re-read 2026-09-27, unauthenticated GETs) advertises a
`registration_endpoint`, so **none requires a hosted Client Identifier Document**; dynamic registration is the
default. No provider advertises Client Identifier Document support in its metadata (Solid-OIDC defines no
such field; `brolly.id` and `solidweb.app` advertise `solid_oidc_supported`). To exercise the Client ID path,
host a public JSON-LD document (`client_id` = its own https URL, `redirect_uris` containing the redirect URI,
`grant_types` `authorization_code refresh_token`, `scope` `openid webid offline_access`,
`token_endpoint_auth_method` `none`) and set `RA_INTEROP_<P>_CLIENT_ID`. Expected support:

| Provider(s) | Client ID document |
| --- | --- |
| CSS hosts (`privatedatapod-com`, `redpencil-io`, `solidcommunity-net`, `solidcommunity-au`, `solidweb-me`, `teamid-live`) | documented by Community Solid Server; unverified on each host |
| `inrupt-podspaces`, `ess-live` | documented by Inrupt for ESS; unverified here |
| NSS-style (`datapod-igrant-io`, `solidweb-org`, `solid-openlinksw-com`), `brolly-id`, `solidweb-app`, TrinPod | unknown; dynamic registration only is verified by discovery |
| `use-id` | unknown (discovery unreachable) |

### Unattended runs (session mode)

Without `--headed`, a manual target with `…_STORAGE_STATE` runs in the runner's session mode: the stored IdP
session must complete the authorization with no login form, consent page or MFA prompt, or the login fails
closed. For hosted Solid this is unverified everywhere: CSS shows a consent page for each newly registered
client (dynamic registration creates one per run), so CSS hosts are expected to fail closed — use the
`css-password` recipe with a test-only account there; NSS-style servers show a consent page for new client
origins; others are unknown. A local headed run is the dependable path.

```sh
npm run build
node interop/run.js --suite live --target solidcommunity-net --require solidcommunity-net --headed
node interop/run.js --suite live --target solidcommunity-net,inrupt-podspaces,solidweb-org --headed
node interop/run.js --suite live --target solidcommunity-net --headed --exercise-unverified   # also storageDiscovery/refreshRotation
```

`css-password` automation types a password into the provider's own CSS 7 account pages; use it only for a
test-only account, and only if the host's pages match CSS 7 (unverified for every hosted CSS).

## Scenarios and data safety

`solid.login`, `solid.private-read`, `solid.write`, `solid.concurrency`, `solid.boundary-explicit`,
`solid.boundary-automatic`, `solid.refresh-restore`, `solid.logout`, `solid.cleanup` — see the adapter header.
Writes happen only in a new run-owned container below the scratch container, created with
`If-None-Match: *`; cleanup deletes exactly what the run created; probes outside the boundary are GETs.

## Limits

- Inrupt PodSpaces storage answers unauthenticated requests with an `UMA` challenge first (then `Bearer`,
  `DPoP`); `inrupt-podspaces` exercises the DPoP path only. The Solid-OIDC + UMA path is the separate target
  `inrupt-podspaces-uma` (see `uma.md`).

- Census observations are from one network on one day; use.id and trinpod.eu reset TLS connections from here,
  which may be network-specific. The observation is recorded, not a verdict on the provider.
- OpenLink's NSS-like server is not in the library's nonce-quirk list; if it omits the nonce claim as NSS 6
  does, `solid.login` fails — record it as `knownIncompatible` only after observing the exact failure.
