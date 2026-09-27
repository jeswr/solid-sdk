# Local servers (disposable containers)

`interop/local/compose.yml` defines one service per server, and `interop/local/stack.js` starts the services the
selected targets need:

- Each run uses its own Compose project, `ra-interop-<pid>-<random>`.
- Ports are published on 127.0.0.1 only, and nothing is persisted.
- On any outcome, including Ctrl-C, the harness removes only that project (`down --volumes --remove-orphans`).
- A failed removal fails the run and prints the command for removing the project by hand.
- Every Docker and provisioning step has a time limit.

The accounts are disposable local test accounts. Their passwords are in the repository and are valid only in these
containers.

HTTPS servers (Nextcloud, PHP) use a test CA that `interop/local/tls.js` generates with `openssl` into
`interop/.local-tls/` (git-ignored):

- The certificates are valid for 30 days and are regenerated within 7 days of expiry.
- Node trusts the CA through `NODE_EXTRA_CA_CERTS`; the runner re-executes itself once to set it. Nothing is
  installed system-wide.
- Browsers ignore certificate errors for these local targets only.

Some browsers resolve `localhost` to `::1`. The harness therefore forwards `[::1]:port` to `127.0.0.1:port` in its
own process instead of publishing Docker ports on IPv6. If `::1` is taken by something else, the run fails.

```sh
npm run interop:local                   # CSS + Keycloak, strict (CI-mandatory)
npm run interop:local:browser -- --browser chromium
npm run interop:local:incompatible      # NSS, Nextcloud, PHP, Manas (CI-mandatory)
node interop/local/stack.js up css keycloak   # keep a stack for development; Ctrl-C removes it
node interop/run.js --suite local --target css-local --no-stack
```

## Servers and outcomes (2026-09-27)

| Target | Server and provisioning | Outcome |
| --- | --- | --- |
| `css-local` | Community Solid Server 7.2.0 (Docker Hub image, pinned digest), memory backend, WAC. `alice`/`bob` accounts and pods seeded by `--seedConfig`. | 9/9 PASS |
| `css-local-browser` | Same server; the library runs in the browser page. | 5/5 PASS (Chromium, Firefox on Linux, WebKit) |
| `css-local-client-id` | Same server, with a Solid-OIDC Client Identifier Document (`ClientIdClientProvider`) instead of dynamic registration. The document is published on the CSS server root, which the disposable default configuration leaves publicly writable, outside the accounts' pods, because CSS must fetch it itself. | 5/5 PASS |
| `css-local-client-credentials` | Same server, with `ClientCredentialsTokenProvider` and no browser. A disposable credential for alice is created through the CSS account API (password login, then `controls.account.clientCredentials`) and deleted at the end. | 5/5 PASS |
| `keycloak-*` | Keycloak 26.7.4 (quay.io, pinned digest), `start-dev --import-realm` with `interop/local/keycloak/realm-interop.json`. | All supported scenarios PASS |
| `nss-local` | Node Solid Server 6.0.0: the repository's Dockerfile at the v6.0.0 commit (`node:lts` pinned by digest). Multi-user; pods on `*.localhost`. Accounts created through NSS's own registration endpoint. | Known incompatibility, reproduced each run |
| `nextcloud-local` | Solid Nextcloud: the repository's Dockerfile at `b074376` on Nextcloud 30 (`nextcloud:30` and `composer:latest` pinned by digest). Provisioned by the repository's `init.sh`, as in its CI. | Known incompatibility, reproduced each run |
| `php-local` | PHP Solid Server at its last commit `e8d265c` (2022), built from its Dockerfile steps with Debian 11 packages from archive.debian.org (the upstream build now fails with 404s). | Known incompatibility, reproduced each run |
| `manas-local` | Manas 0.1.2 `single_fs_wac` release binaries (sha256-verified); no official image exists. Manas has no identity provider, so the pod owner signs in at the local CSS. Manas shares CSS's network namespace, so both see it as `localhost`. | Known incompatibility, reproduced each run |

### Keycloak configurations

| Target | Configuration |
| --- | --- |
| `keycloak-public` | Public client with S256 PKCE, OpenID Connect, and rotating refresh tokens (`revokeRefreshToken`, `refreshTokenMaxReuse: 0`). Its tokens carry the local API's audience. |
| `keycloak-confidential` | The same flow as a server-side confidential client (`client_secret_basic` plus PKCE). |
| `keycloak-confidential-post` | The same confidential client with `client_secret_post` (Keycloak's client-secret authenticator accepts both). |
| `keycloak-plain-oauth` | The public client without `openid`: no nonce and no ID token; no identity is reported. |
| `keycloak-short-lived` | 5 s access tokens: expiry renewal and concurrent refresh. |
| `keycloak-no-audience` | Tokens without the API audience. The API refuses them, and the client stops after a bounded retry. |

The local API (`interop/lib/resourceServers.js`) validates Keycloak's tokens as a production API would:

- It checks the JWKS signature, the issuer, the audience and expiry.
- It also asks Keycloak's introspection endpoint, so revoked tokens are refused.

### What the scenarios check

- **Login.** A real authorization code flow with PKCE:
  - The provider's own login and consent pages are driven by a recipe in `interop/lib/browserLogin.js`.
  - The redirect lands on a real loopback listener.
  - Checks: the unauthenticated first attempt gets a 401, the reactive replay uses the DPoP (or Bearer) scheme,
    S256 PKCE, state and nonce are sent, the code is exchanged with a DPoP proof, and the WebID is verified
    against its profile.
- **Data.** Writes happen only in a new run-owned container under the configured scratch container:
  - It is created with `PUT` and `If-None-Match: *`, then the resource the same way.
  - Cleanup deletes exactly those two.
  - Outside the boundary, only read-only `GET` probes are sent (a look-alike path and another account's protected
    resource). They must remain challenged and must not receive credentials.
- **Sessions.**
  - Six concurrent challenged requests produce one code exchange.
  - Refresh-only persistence: new instances restore the session from the refresh token alone, with no browser.
  - Rotation is verified by comparing refresh tokens in memory, and single use by replaying a spent token. Replay
    is done on a separate local session only, never with live accounts.
  - Logout revokes the refresh token where the provider supports revocation, then requires a new authorization.
- **Session grouping.** The explicit-boundary client groups sessions by its configured storage, and the automatic
  client uses `AutomaticCredentialBoundary.contextKey`. The default `storageContextKey` (evidence-only) would give
  each distinct URL on CSS its own session, because CSS's 401 responses carry no storage Link headers.

## Findings

- **Library bug, fixed (Firefox).** Firefox does not implement `Request.prototype.body`, so it reads `undefined`.
  Replay buffering called `request.body.getReader()` and threw a `TypeError` for every challenged write.
  - Without request body streams, bodies are now read with the standard `blob()`. The size bound still applies
    (checked on the result), and abort and logout still settle immediately.
  - Regression tests in `test/core.test.js` remove the getter to reproduce this in Node.
  - Firefox 155 on Linux now passes the browser suite and `css-local-browser`.

- **Library bug, fixed.** The fixed 30 s expiry skew made access tokens shorter-lived than 30 s unusable on arrival.
  Against Keycloak's 5 s tokens, six concurrent requests spent six refresh grants. The skew is now
  `min(30 s, lifetime / 2)`. Deterministic regressions (mocked clock) are in `test/oauth.test.js`.
- **CSS 7.2.0** doesn't rotate refresh tokens (`refreshRotation: false`, observed). Its 401 responses carry no
  storage description or `pim:Storage` Link.
  - With a stable client (a Client Identifier Document), a second authorization in the same browser session
    succeeds silently (`prompt=none`) and returns no refresh token. oidc-provider grants `offline_access` only on
    an explicit consent. An application that re-authorizes silently therefore can't restore that session after a
    reload.
  - The refresh and logout scenarios start in a fresh browser, as a new user session would.
- **Keycloak 26.7.4** rotates refresh tokens and refuses a spent one with `invalid_grant`. After that, it revokes
  the whole token family.
- **NSS 6.0.0:**
  - ID tokens omit the `nonce` claim the client sent (OpenID Connect Core §3.1.3.7). The library validates the
    nonce strictly for every issuer except the two hosted NSS deployments in its upstream quirk list, so local
    login fails at the code exchange. This proves the login recipe got that far.
  - NSS also crashes once on a fresh data directory (`EEXIST`) and is restarted once.
  - It has no revocation endpoint.
- **Solid Nextcloud:**
  - Protected resources answer unauthenticated `GET`, `HEAD` and `PUT` with 403 and no `WWW-Authenticate`
    challenge, so a reactive client can't start.
  - Its storage description Link uses `http://www.w3.org/ns/solid#storageDescription`, where the Solid Protocol
    has `…/solid/terms#storageDescription`.
- **PHP Solid Server `e8d265c`:**
  - WAC is evaluated only for requests that carry an `Origin` header (`src/Controller/ResourceController.php`).
    Other requests are served without authorization: an owner-only resource was returned to an unauthenticated
    `GET`, and unauthenticated writes were stored.
  - Denied browser requests get 403 without a challenge.
  - Its pubsub companion is omitted: the current `main` crashes on its first connection, and the 2022 commits need
    Debian 10 packages. Every write therefore answers 500 after storing the data. The target is read-only, so this
    doesn't affect it.
- **Manas 0.1.2** answers anonymous `GET` and `PUT` on protected resources with 403 (problem+json) and no challenge.
  Only an anonymous `DELETE` gets `401 WWW-Authenticate: DPoP`.

For Nextcloud and Manas, the comparison is with the current [Solid Protocol](https://solidproject.org/TR/protocol)
(HTTP Server section). It requires 401 when a request lacks valid credentials for a resource that needs them, and
allows 404 for security reasons. RFC 9110 §15.5.4 itself does not reserve 403 for credential problems. The
observed incompatibility is with this library's 401-triggered flow; its behaviour is unchanged.

For the four incompatible servers, behaviour behind the incompatibility (refresh, rotation, discovery) is declared
`"unverified"`. It is reported `UNTESTED`, never `UNSUPPORTED`. Their login recipes for Nextcloud and PHP follow the
upstream templates but could not be exercised end to end.
