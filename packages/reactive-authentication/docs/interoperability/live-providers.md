# Live standard OAuth 2.0 / OpenID Connect providers

Targets in `interop/targets/live-oauth.json`, run by the `oauth-code` adapter (`interop/adapters/oauth.js`):
server-side Node.js with `OAuthCodeSource` + `OAuthBearerTokenProvider` + `ReactiveFetchManager`, and a real
browser (Playwright) as the login user agent. Nothing here has been run against a live provider yet: there are
no test credentials. Without configuration every scenario is **UNTESTED**, never PASS.

| Target | Provider | Client | API probe (read-only) |
| --- | --- | --- | --- |
| `github` | GitHub OAuth app | confidential (secret, `client_secret_post`) + S256 PKCE | `GET https://api.github.com/user` |
| `gitlab` | GitLab.com (or self-managed via `RA_INTEROP_GITLAB_ISSUER`) | public or confidential + S256 | `GET {issuer}/api/v4/user` |
| `auth0` | Auth0 tenant | public or confidential, optional `audience` | `GET {issuer}userinfo` |
| `okta` | Okta custom authorization server | public or confidential | `GET {issuer}/v1/userinfo` |
| `google-web-server` | Google web-server flow (no GIS) | confidential, `access_type=offline`, `prompt=consent` | `GET https://openidconnect.googleapis.com/v1/userinfo` |
| `entra-code` | Microsoft Entra ID v2.0 (no MSAL) | Web (secret) or Mobile/desktop (public) | `GET https://graph.microsoft.com/v1.0/me` |
| `oidc-generic` | any OpenID provider | from env | `RA_INTEROP_OIDC_API_URL` |

## What each scenario checks

- `oauth.login-api`: the first API request carries no credentials and gets 401; the library authorizes
  (S256 PKCE, `state`, a nonce exactly when `openid` is requested), exchanges the code once (client
  authentication as configured, no DPoP), retries with `Bearer`, and the API answers 200. With
  `identity.expected` set, the API's user field must equal the configured account; with `openid`, the
  validated ID token subject must too.
- `oauth.boundary`: a local decoy inside the manager's boundary but outside the provider's resources never
  receives credentials.
- `oauth.refresh-restore` (needs `refreshTokens`): fresh instances restore the session from a persisted
  refresh token alone (no authorization), rotated tokens differ when `refreshRotation` is declared. On live
  targets a spent refresh token is **never** replayed (reuse detection is only exercised on local fixtures).
- `oauth.concurrent-refresh` (needs rotation): six concurrent requests share one refresh grant.
- `oauth.logout`: logout forgets the session (a new authorization follows); with `revocation: true` the
  refresh token must be revoked (RFC 7009, HTTP 200).
- `oauth.expiry-renewal` and `oauth.audience-mismatch` are declared UNSUPPORTED for these targets: live access
  tokens live for an hour or more, and the negative-audience check needs the harness's local introspecting API.

## The API must answer 401 without credentials

The reactive flow starts only from a 401. Observed on 2026-09-27 with harmless unauthenticated GETs:

| Probe | Status | `WWW-Authenticate` |
| --- | --- | --- |
| `https://api.github.com/user` | 401 | none |
| `https://gitlab.com/api/v4/user` | 401 | none |
| `https://openidconnect.googleapis.com/v1/userinfo` | 401 | none |
| `https://graph.microsoft.com/v1.0/me` | 401 | `Bearer realm="", authorization_uri=…, client_id=…` |
| `https://samples.auth0.com/userinfo` (Auth0's public sample tenant) | 401 | `Bearer realm="Users", DPoP algs="ES256"` |
| Okta `/v1/userinfo` | not probed (tenant-specific) | — |

`OAuthBearerTokenProvider` answers challenge-less 401s and `Bearer` challenges from its configured resources,
so all of these start the flow.

## Provider facts relied on (primary sources, read 2026-09-27)

- **GitHub** — [Authorizing OAuth apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps):
  S256 is the only PKCE method; `client_secret` is required for the web flow; `Accept: application/json` for
  JSON token responses (the library sends it); scopes are space-delimited; loopback `http://127.0.0.1:<port>`
  redirect URIs are allowed; with expiring tokens or the `offline_access` scope the token response includes
  `refresh_token` (access token 8 h, refresh token 6 months). There is no discovery document
  (`https://github.com/.well-known/openid-configuration` → 404), so the target supplies trusted explicit
  metadata (`authorization_endpoint`, `token_endpoint`, `code_challenge_methods_supported: ["S256"]`).
  Rotation is documented for [GitHub Apps](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/refreshing-user-access-tokens)
  only, so `refreshRotation` is `"unverified"`. No RFC 7009 endpoint: `revocation: false`. API headers:
  `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2026-03-10`
  ([API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions); 2022-11-28 is the default).
- **GitLab** — [OAuth 2.0 API](https://docs.gitlab.com/api/oauth2/): PKCE S256; non-confidential apps need no
  secret; refreshing "invalidates the existing access_token and refresh_token"; `/oauth/revoke` returns 200;
  tokens expire after 7200 s. Discovery: issuer `https://gitlab.com`, `revocation_endpoint`.
- **Auth0** — [Refresh token rotation](https://auth0.com/docs/secure/tokens/refresh-tokens/refresh-token-rotation):
  enabled per application; a new refresh token on every exchange; reuse revokes the family; needs
  `offline_access`. The issuer has a trailing slash (`https://TENANT.auth0.com/`).
- **Okta** — [Refresh tokens](https://developer.okta.com/docs/guides/refresh-tokens/main/): `offline_access`
  required; enable "Rotate token after every use" (default only for SPAs). Revocation is `"unverified"` until a
  tenant's discovery document is read.
- **Google** — [Web server apps](https://developers.google.com/identity/protocols/oauth2/web-server):
  `access_type=offline` yields a refresh token only at consent (`prompt=consent`); refreshing returns no new
  refresh token (`refreshRotation: false`); revocation at `https://oauth2.googleapis.com/revoke`. Discovery:
  issuer `https://accounts.google.com`, PKCE S256. Google's OpenID documentation allows `iss` values without
  `https://`; the library validates the discovered issuer exactly and would FAIL such a token.
- **Microsoft Entra ID** — [Authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow):
  S256 PKCE; secret required for Web apps, forbidden for public clients; SPA redirect URIs cannot be redeemed
  server-side; each refresh returns a new refresh token (the old is not revoked); `offline_access` needed.
  [Redirect URIs](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url): `http` only for
  localhost, port ignored for localhost; the portal refuses `http://127.0.0.1`, hence the target's default
  `http://localhost:39398/callback`. The v2.0 discovery document of a tenant has no `revocation_endpoint`.

## Setup

For every provider: create a **dedicated test account** (no personal data, MFA allowed — sign-in is manual)
and a **test client registration** whose redirect URI is exactly the loopback URI below. Grant only read
scopes. Nothing is created by the harness.

| Target | Registration | Redirect URI | Required env | Optional env |
| --- | --- | --- | --- | --- |
| `github` | Settings → Developer settings → OAuth Apps (callback URL) | `http://127.0.0.1:39398/callback` | `RA_INTEROP_GITHUB_CLIENT_ID`, `RA_INTEROP_GITHUB_CLIENT_SECRET`, `RA_INTEROP_GITHUB_USER_ID` | — |
| `gitlab` | User settings → Applications, scopes `openid read_user` | same | `RA_INTEROP_GITLAB_CLIENT_ID`, `RA_INTEROP_GITLAB_USER_ID` | `…_CLIENT_SECRET`, `…_ISSUER` |
| `auth0` | Application (refresh token rotation on, grant types code + refresh) | same (Allowed Callback URLs) | `RA_INTEROP_AUTH0_ISSUER` (trailing `/`), `RA_INTEROP_AUTH0_CLIENT_ID`, `RA_INTEROP_AUTH0_SUBJECT` | `…_CLIENT_SECRET`, `…_AUDIENCE` |
| `okta` | App integration (OIDC, code + refresh, rotation on) on a custom authorization server | same | `RA_INTEROP_OKTA_ISSUER` (no trailing `/`), `RA_INTEROP_OKTA_CLIENT_ID`, `RA_INTEROP_OKTA_SUBJECT` | `…_CLIENT_SECRET` |
| `google-web-server` | Google Cloud console → OAuth client "Web application" | same (authorized redirect URI) | `RA_INTEROP_GOOGLE_WEB_CLIENT_ID`, `RA_INTEROP_GOOGLE_WEB_CLIENT_SECRET`, `RA_INTEROP_GOOGLE_WEB_SUBJECT` | — |
| `entra-code` | App registration, Web (secret) or Mobile/desktop platform, delegated `User.Read` | `http://localhost:39398/callback` | `RA_INTEROP_ENTRA_TENANT_ID` (GUID), `RA_INTEROP_ENTRA_CLIENT_ID`, `RA_INTEROP_ENTRA_USER_OBJECT_ID` | `…_CLIENT_SECRET` |
| `oidc-generic` | any | same | `RA_INTEROP_OIDC_ISSUER`, `RA_INTEROP_OIDC_CLIENT_ID`, `RA_INTEROP_OIDC_API_URL`, `RA_INTEROP_OIDC_SUBJECT` | `…_CLIENT_SECRET`, `…_IDENTITY_FIELD`, `…_AUDIENCE`, `…_RESOURCE`, `…_PROMPT` |

The expected identity (`…_USER_ID`, `…_SUBJECT`, `…_USER_OBJECT_ID`; pii) is **required** for every committed
target: `oauth.login-api` compares the API's identity field (and, with OpenID Connect, the ID token `sub`)
with it without echoing either value, so a strict result is always tied to the configured test account.

Every target also accepts `RA_INTEROP_<P>_REDIRECT_URI` (a different registered loopback URI) and
`RA_INTEROP_<P>_STORAGE_STATE` (pii, optional: a Playwright storage-state file of the dedicated test account's
signed-in IdP session; it contains cookies — keep it outside the repository, never a personal browser
profile). A configured file that does not exist is a configuration error. Secrets are marked `secret`, account identifiers `pii`: their values
are registered for redaction and never written to reports.

## Commands

```sh
npm run build
node interop/run.js --list                                     # configuration state of every target
export RA_INTEROP_GITHUB_CLIENT_ID=… RA_INTEROP_GITHUB_CLIENT_SECRET=…   # from a secret store, not a file in the repo
node interop/run.js --suite live --target github --require github --headed
node interop/run.js --suite live --target github,gitlab,auth0,okta,google-web-server,entra-code --headed
```

Without `--headed` a manual target is UNTESTED ("manual sign-in needs --headed") unless `…_STORAGE_STATE` is
set: then the runner's session mode signs in non-interactively from that stored session and fails closed on
any login form, consent page or MFA prompt. Whether that can work unattended (e.g. in GitHub Actions):

| Target | Unattended session mode |
| --- | --- |
| `github` | plausible, unverified: an already-authorized app with unchanged scopes is redirected without a click, but GitHub may demand device verification, 2FA or re-authentication |
| `gitlab` | likely fails closed on gitlab.com: the authorize page is shown unless an administrator marked the application trusted (self-managed only) |
| `auth0` | can work for a test user without MFA whose consent is granted (first-party apps skip consent); unverified |
| `okta` | can work when the sign-on policy accepts the stored session without MFA/re-authentication; unverified |
| `google-web-server` | not expected: the target sends `prompt=consent` (needed for a refresh token), so a consent page appears every time; Google may also block automated browsers — run headed |
| `entra-code` | only in a test tenant without MFA/Conditional Access prompts for the test user and with consent granted; security defaults require periodic MFA |
| `oidc-generic` | provider-specific; unverified |

No MFA workaround is used: a provider that asks for interaction needs a local headed run. `--require <id>` exits non-zero
unless that target has passing scenarios and nothing untested; run it for every target you intend to claim.

## Limits

- No live run has happened: all capability values rest on documentation and public discovery documents and
  must be confirmed (and corrected in the manifest) by the first real run.
- Revocation is asserted only where RFC 7009 is advertised; GitHub's and Entra's server-side revocation APIs
  are out of scope for the library.
- Spent refresh tokens are never replayed against live accounts, so reuse detection is not verified live.
