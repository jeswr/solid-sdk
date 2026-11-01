# External Solid-OIDC + UMA deployments

Targets in `interop/targets/uma.json`, run by `interop/adapters/uma.js` with the library's
`SolidUmaTokenProvider` (Solid-OIDC §9 with an UMA 2.0 authorization server). Status: **UNTESTED** — no test
account has been used; nothing here is a live result.

## What counts as Solid UMA evidence

`uma.login-read` passes only if every step of the Solid-OIDC §9 flow is observed on the wire:

1. an unauthenticated request to the configured resource is answered `401` with
   `WWW-Authenticate: UMA as_uri="…", ticket="…"` (the adapter's manager has only the UMA provider, so a
   `Bearer`/`DPoP` challenge alone fails with "an ordinary OAuth/DPoP challenge is not Solid UMA evidence");
2. the `as_uri` is trusted (configured `…_UMA_SERVER`, or the resource's own origin by default) **before**
   any metadata request, login or credential use;
3. `GET {as_uri}/.well-known/uma2-configuration` without credentials; the library requires `issuer` = `as_uri`,
   a `token_endpoint`, the ID token profile in `uma_profiles_supported` and (if listed) the `uma-ticket` grant;
4. a Solid-OIDC login in a real browser: WebID → `solid:oidcIssuer`, S256 PKCE, state, nonce, `openid webid`
   scopes, DPoP-bound code exchange; the ID token's `webid` equals the configured WebID (compared, never
   echoed), `aud` includes `solid`, `cnf.jkt` is present, and the WebID profile lists the issuer;
5. an `urn:ietf:params:oauth:grant-type:uma-ticket` grant at that server carrying the ticket, the ID token as
   `claim_token` with `claim_token_format` `http://openid.net/specs/openid-connect-core-1_0.html#IDToken`, and a
   DPoP proof made with the ID token's key; exactly one RPT issued (`token_type` `DPoP` or `Bearer`);
6. the replayed request presents the RPT with the matching scheme (and a fresh proof for DPoP).

Keycloak (the local stack's ordinary OAuth realm) or any plain Bearer/DPoP access token never satisfies these
checks, and no mock UMA server is listed as a target. `test/helpers/uma.js` is used only to self-test the
adapter offline (`test/interop-live-config.test.js`).

Other scenarios: `uma.private-read` (anonymous GET is 401/403; the RPT is reused for the same resource and
the Solid-OIDC session is not repeated), `uma.write` (scratch only; conditional `If-Match` update),
`uma.boundary` (a look-alike path and `OTHER_PROTECTED` get no credentials and no claim push; a local resource
whose UMA challenge names an untrusted `as_uri` causes no login, no metadata request and no claim push),
`uma.logout` (RPT and session forgotten: a new login and a new grant are needed), `uma.cleanup` (scratch only).

Data safety is that of the Solid adapter: writes only in an explicit scratch container, one resource created
with `If-None-Match: *` and recorded as run-owned **only on `201 Created`**; cleanup deletes only that;
tickets, ID tokens, RPTs and WebIDs never appear in logs or reports.

## Known deployments

| Target | Deployment | Public evidence (unauthenticated GETs, 2026-09-27) |
| --- | --- | --- |
| `inrupt-podspaces-uma` | Inrupt PodSpaces (ESS) storage `https://storage.inrupt.com/`, OP `https://login.inrupt.com`, UMA `https://uma.inrupt.com` | a private path answered `401` with `UMA as_uri="https://uma.inrupt.com", ticket="…"` (then `Bearer`, `DPoP algs="ES256 RS256"`); `uma2-configuration`: issuer `https://uma.inrupt.com`, `token_endpoint` `/token`, `grant_types_supported` `[uma-ticket]`, `uma_profiles_supported` includes the ID token profile (and a VC profile) |
| `solid-uma` | any configured deployment | — |

Whether PodSpaces issues an RPT for a pushed `login.inrupt.com` ID token (and whether that ID token carries
`cnf`) is unknown until a run. No other public Solid-OIDC-profile UMA deployment is known.

## Environment

`<P>` = `INRUPT_PODSPACES_UMA` or `SOLID_UMA`.

| Variable | Flag | Meaning |
| --- | --- | --- |
| `RA_INTEROP_<P>_WEBID` | pii, required | WebID of a dedicated test account |
| `RA_INTEROP_<P>_STORAGE` | pii, required | its storage (ends with `/`); the credential boundary |
| `RA_INTEROP_<P>_SCRATCH` | pii, optional | container for run-owned writes inside the storage |
| `RA_INTEROP_<P>_PRIVATE_RESOURCE` | pii, optional | existing private resource answering 401 + UMA (read-only mode) |
| `RA_INTEROP_<P>_OTHER_PROTECTED` | pii, optional | protected resource outside the storage (read-only probe) |
| `RA_INTEROP_<P>_ISSUER` | required for `solid-uma`; override for PodSpaces (default `https://login.inrupt.com`) | expected ID token issuer |
| `RA_INTEROP_<P>_UMA_SERVER` | optional (PodSpaces default `https://uma.inrupt.com`; `solid-uma` default: same origin as the resource) | trusted `as_uri` |
| `RA_INTEROP_<P>_CLIENT_ID` | optional | Client Identifier Document URL; default dynamic registration |
| `RA_INTEROP_<P>_STORAGE_STATE` | pii, optional | Playwright storage state of the test account's IdP session (session mode) |
| `RA_INTEROP_SOLID_REDIRECT_URI` | optional | loopback redirect URI (default `http://127.0.0.1:39398/callback`) |

One of `SCRATCH` or `PRIVATE_RESOURCE` is required (validated before any request). `writes` is
`"unverified"` on both targets: `uma.write` runs only with `--exercise-unverified`.

```sh
npm run build
node --test test/interop-live-config.test.js      # offline adapter self-test against the mock UMA fixture
node interop/run.js --suite live --target inrupt-podspaces-uma --require inrupt-podspaces-uma --headed
node interop/run.js --suite live --target inrupt-podspaces-uma --headed --exercise-unverified   # with SCRATCH
```

Unattended session mode (no `--headed`, `…_STORAGE_STATE` set) works only if the OP completes the
authorization from the stored session without a login form, consent page or MFA; otherwise it fails closed.
This is unverified for `login.inrupt.com`.

## Limits

- Interactive UMA claims gathering (`need_info` with `redirect_user`) is not automated by the library; such a
  deployment FAILs `uma.login-read` with the `UmaAuthorizationError` reason.
- PCTs and RPT upgrades are not used; RPTs are cached per UMA server and resource URL (exact URL unless the
  storage context is verified), so a new resource costs a new grant but no new login.
