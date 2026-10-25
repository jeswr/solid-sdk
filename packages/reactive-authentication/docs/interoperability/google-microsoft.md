# Google Identity Services and Microsoft MSAL.js (in-browser live targets)

Two live targets run the library **inside a real browser page**, next to the provider's own browser SDK:

| Target | Adapter | SDK in the page | API probe (read-only) |
| --- | --- | --- | --- |
| `google-gis` | `google-gis` | Google Identity Services token model, loaded from `https://accounts.google.com/gsi/client` | `GET https://www.googleapis.com/oauth2/v3/userinfo` |
| `microsoft-msal` | `msal-browser` | `@azure/msal-browser` v5 (the installed devDependency, bundled), popup through the v5 redirect bridge | `GET https://graph.microsoft.com/v1.0/me` |

This differs from the Node adapters (Solid, standard OAuth), where the library runs in Node and the browser is only
the login user agent. Every scenario of these targets records `execution: "browser"` with the engine name and
version in the report.

How it works (`interop/browser/`):

- `server.js` bundles the page entries with esbuild into `interop/browser/.bundle/` (git-ignored) and serves only
  `google.html`, `msal.html`, `redirect.html` and their bundles on the configured loopback origin
  (`http://localhost:<port>`, on 127.0.0.1 and ::1). Responses are `Cache-Control: no-store` and carry no
  `Cross-Origin-Opener-Policy`.
- The pages construct `GoogleTokenSource` / `MsalTokenSource`, `OAuthBearerTokenProvider` (resources: the API's
  path prefix only) and `ReactiveFetchManager` exactly as `examples/google-api.html` and
  `examples/microsoft-graph.html` do. The manager's boundary additionally admits a local decoy API.
- Playwright clicks the page's button, which is a real user activation; the click handler calls `authorize()`
  synchronously, so the SDK opens its popup. A person completes the provider's sign-in and consent in that popup.
- The page returns only safe facts to the runner: HTTP statuses, allowlisted `Authorization` scheme names,
  booleans, counts, error facts and a SHA-256 digest of the identity field. Error facts are an **allowlisted** class
  name and an **allowlisted** code (`interop/browser/errors.js`: registered OAuth codes, GIS `error_callback` types,
  the MSAL error codes the adapters can meet, the library's own codes); any other name or code — however
  plausible it looks — becomes a bare `Error` without a code, in the page and again in the runner. Tokens,
  authorization responses and identity values never leave the page; the identity digest is compared with the
  configured account in memory and never written to a report. No traces, HAR files or screenshots are recorded.
- Cancellation: every page operation (harness calls, the authorize click and wait, MSAL's reload) runs under the
  scenario's abort signal. If a scenario times out while an operation is outstanding, the page and every popup it
  opened are closed *before* the scenario settles (this destroys the in-page SDK work, timers and fetches), and
  the next scenario gets a fresh page and harness. Completed operations remove their listener, so the runner's
  routine end-of-scenario abort leaves the reusable page alone.

## Google: test OAuth client

In the [Google Cloud console](https://console.cloud.google.com/) of a project dedicated to testing:

1. **Google Auth Platform → Branding / Audience**: configure the consent screen; keep the app in *Testing* and
   add the dedicated test account as a *test user*.
2. **Google Auth Platform → Clients → Create client**, application type **Web application**.
3. **Authorized JavaScript origins**: `http://localhost:39440` (or your `RA_INTEROP_GOOGLE_PORT`). Google accepts
   plain `http` only for `localhost`. No redirect URI is needed: the token model returns tokens to the page via
   the GIS popup.
4. **Data access**: the target requests `https://www.googleapis.com/auth/userinfo.email` (a non-sensitive scope);
   `userinfo` then returns the account's `sub` and `email`.

References: [Use the token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model),
[GIS JavaScript reference](https://developers.google.com/identity/oauth2/web/reference/js-reference).

## Microsoft: test Entra app registration

In the [Microsoft Entra admin center](https://entra.microsoft.com/) of a test tenant:

1. **App registrations → New registration**. Supported account types: *this organizational directory only*
   (recommended for a test tenant).
2. **Authentication → Add a platform → Single-page application**, redirect URI
   `http://localhost:39441/redirect.html` (or your `RA_INTEROP_MSAL_PORT`). The *SPA* platform matters: it enables
   the authorization code flow with PKCE and CORS for the token endpoint. `redirect.html` runs MSAL v5's
   `broadcastResponseToMainFrame()` from `@azure/msal-browser/redirect-bridge` and nothing else.
3. **API permissions**: Microsoft Graph, delegated `User.Read` (present by default).
4. Note the *Application (client) ID* and the *Directory (tenant) ID*; set the authority to
   `https://login.microsoftonline.com/<tenant-id>`.

References: [MSAL.js v5 redirect URI and the redirect bridge](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/login-user#redirecturi-considerations),
[Register an SPA](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-spa-app-registration).

## Environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `RA_INTEROP_GOOGLE_CLIENT_ID` | yes (google-gis) | Web application client ID |
| `RA_INTEROP_GOOGLE_EXPECTED_EMAIL` | yes (google-gis), `pii` | the dedicated test account: `userinfo` `email` must equal it (compared in memory, never printed); also sent as `login_hint` |
| `RA_INTEROP_GOOGLE_PORT` | no | page origin port, default `39440`; must match the authorized JavaScript origin |
| `RA_INTEROP_GOOGLE_STORAGE_STATE` | no, `pii` | Playwright storageState of the test account; without `--headed` it selects session mode |
| `RA_INTEROP_MSAL_CLIENT_ID` | yes (microsoft-msal) | application (client) ID |
| `RA_INTEROP_MSAL_EXPECTED_UPN` | yes (microsoft-msal), `pii` | the dedicated test account: Graph `/me` `userPrincipalName` must equal it (in memory); also sent as `loginHint` |
| `RA_INTEROP_MSAL_AUTHORITY` | no, `pii` | default `https://login.microsoftonline.com/organizations`; set your test tenant |
| `RA_INTEROP_MSAL_PORT` | no | page origin port, default `39441`; must match the SPA redirect URI |
| `RA_INTEROP_MSAL_STORAGE_STATE` | no, `pii` | Playwright storageState of the test account; without `--headed` it selects session mode |

The expected account is required for the committed targets: a PASS means *the configured test account* was
authorized, not merely "some signed-in account" (it also keeps Google's revoking `gis.forget` from ever running
against an account someone picked by mistake — it is blocked when the identity check fails). For ad-hoc
exploration a target configuration may instead set `api.identity.exploratory: true` (no committed target does);
the report then notes `identityCheck: "exploratory: not compared with a configured test account"`. To compare the
Graph object id instead of the UPN, a target sets `api.identity.field: "id"` (no `loginHint` is sent then).

Values of `pii` variables are registered for redaction. A storageState file contains session cookies, i.e.
credentials of the test account: keep it outside the repository or under the git-ignored `interop/.auth/`, never
commit it, and delete it when done. One way to create it is `npx playwright codegen --save-storage=interop/.auth/google.json https://accounts.google.com`
(a person signs in to the dedicated test account, then closes the window). A configured storageState path that does
not exist is a configuration error (FAIL), never silently ignored.

## Login modes: manual (headed) and session (unattended)

- **manual** (`--headed`): Playwright clicks the button; a person completes the provider's popup (5-minute wait).
- **session** (no `--headed`, storageState configured; chosen by the runner): nobody is at the browser. The
  adapters then force `prompt: "none"` (GIS `requestAccessToken`, MSAL `acquireTokenPopup`) with the expected
  account as login hint, so the provider must either complete the popup from the dedicated account's saved session
  or answer with an error. It fails closed, as `CheckError: <provider>: dedicated session expired or needs
  interaction`, when the SDK reports `interaction_required`/`login_required`/`consent_required`/
  `account_selection_required` (or MSAL's equivalents), when any popup shows a password, email, `loginfmt` or
  one-time-code input, or when the popup has not finished within 60 s; the page and popup are closed at once.
  Nothing is ever typed. The Playwright click is still the user activation that lets the SDK open its popup.
- In session mode `gis.forget` is UNTESTED when `revocation` is declared: Google's revoke withdraws the app's whole
  grant, i.e. the prior consent that every later unattended run depends on. Run it headed.

What each provider can do in GitHub Actions (none of this has been run; no account exists):

| Target | Unattended (session) feasibility | Needs a local headed person for |
| --- | --- | --- |
| `google-gis` | **Uncertain, possibly blocked.** Requires a storageState created by a person *after* granting consent once, and Google accepting replayed session cookies from a runner (different IP, headless Chromium user agent). Google may challenge or invalidate such sessions (device-bound sessions, "suspicious sign-in"); every such case fails closed. Testing-mode consent may expire. | first consent and creating/refreshing the storageState; `gis.forget` with revocation (always); any run where Google refuses the replayed session |
| `microsoft-msal` | **Plausible** for a test tenant whose policies allow it: a "stay signed in" Entra session (persistent cookie) with consent already granted, and no Conditional Access requiring a compliant device, a fixed location, or per-session MFA/sign-in frequency. `msal.silent-renewal` then runs normally (refresh through MSAL). | creating/refreshing the storageState (sign-in incl. MFA), and any tenant whose Conditional Access blocks session reuse |

Adding secrets alone does not make these targets pass in CI: without `--headed` and without a storageState they
are UNTESTED ("manual sign-in needs --headed"), and a stale session is a FAIL, not a silent skip.

## Commands

```sh
npm run build

# Offline wiring check (no provider involved; NOT provider validation): runs both adapters' interaction-required
# scenarios in a real browser with every non-loopback request intercepted (GIS script stubbed, MSAL real,
# API answered locally), and checks the redirect page's headers.
node interop/browser/wiring.js --browser chromium

# Live, with a person completing the popups:
RA_INTEROP_GOOGLE_CLIENT_ID=… RA_INTEROP_GOOGLE_EXPECTED_EMAIL=… \
  node interop/run.js --suite live --target google-gis --require google-gis --headed
RA_INTEROP_MSAL_CLIENT_ID=… RA_INTEROP_MSAL_EXPECTED_UPN=… RA_INTEROP_MSAL_AUTHORITY=https://login.microsoftonline.com/<tenant-id> \
  node interop/run.js --suite live --target microsoft-msal --require microsoft-msal --headed

# Unattended session mode (no --headed): the dedicated account's saved session must complete the popup.
RA_INTEROP_MSAL_CLIENT_ID=… RA_INTEROP_MSAL_EXPECTED_UPN=… RA_INTEROP_MSAL_STORAGE_STATE=interop/.auth/msal.json \
  node interop/run.js --suite live --target microsoft-msal --require microsoft-msal
```

Without the client ID or expected-account variable every scenario is reported UNTESTED naming the missing
variables; without `--headed` and without a storageState they are UNTESTED ("manual sign-in needs --headed"). With `--require <id>` (or `--strict`) either case
fails the run (exit code 1). The popup wait is five minutes.

## Scenarios

| Scenario | What it checks |
| --- | --- |
| `gis.interaction-required` / `msal.interaction-required` | Before any click, a reactive `fetch` to the API sends exactly one unauthenticated request, gets a readable 401 and fails with `InteractionRequiredError`; `onInteractionRequired` is called once; no popup opens; no GIS token client / no MSAL popup or silent call is made. |
| `gis.authorize-api` / `msal.authorize-api` | A Playwright click starts `authorize()` within user activation; the SDK's popup opens; after the person completes it, a reactive `fetch` is challenged, retried with `Authorization: Bearer` (never DPoP) and answered 200; the identity field is present and matches the configured test account. |
| `msal.silent-renewal` (needs `silentRenewal`) | After a page reload (a new application instance) MSAL restores the account and active-account choice from its cache and the API is reached with no popup. Then the renewal the provider performs after a rejected token (`getAccessToken({rejectedToken})`) makes exactly one `acquireTokenSilent({forceRefresh: true})` whose result is not from MSAL's cache, and the API still answers 200; the identity is unchanged across the reload. |
| `gis.boundary` / `msal.boundary` | With a token available (the API answers 200), a request to a cross-origin decoy that is inside the manager's boundary but not a provider resource gets the decoy's 401; no credential is attached, and the decoy (whose CORS policy would accept `Authorization`) never receives one nor a preflight announcing one. |
| `gis.forget` | `manager.logout()` succeeds; with `revocation: true`, `revokeOnForget` calls `google.accounts.oauth2.revoke` once and Google then refuses the previous token at `userinfo` (401, polled up to 15 s); the next reactive request needs interaction again, without a popup. |
| `msal.forget` | The application clears its account choice and calls `manager.logout()`; the next reactive request needs interaction again with no MSAL call and no popup. The MSAL account cache and the Microsoft session are left alone, as documented for `MsalTokenSource.forget` (the report notes the number of cached accounts). |

## Limits (honest status)

- **No live run has been performed**: no test client or account was available. Both targets are UNTESTED until
  someone runs them with credentials and `--headed`; do not read this document as evidence of compatibility.
- The reactive pattern needs the API's unauthenticated 401 to be **readable cross-origin** (CORS headers on the
  error response). The interaction-required scenarios check exactly this; if `userinfo` or Graph ever omit them,
  the request fails with a `TypeError` and the scenario fails — a real finding, not a harness fault.
- `msal.silent-renewal` exercises forced renewal at the source (`rejectedToken`), because a valid Graph token
  cannot be made to fail on demand; the provider's own 401 → `invalidate` → `rejectedToken` → `forceRefresh` path
  is covered with a mock MSAL in `test/oauth-sdk.test.js`, not against Microsoft.
- Google's token model has no refresh token or silent renewal: new tokens always need a click, so there is no
  Google renewal scenario. Access tokens do not prove identity; the identity check is on the API's response.
- The GIS script is unversioned (served by Google); the report records its URL, not a version. The MSAL version is
  the bundled `@azure/msal-browser` (recorded per run).
- Google may refuse sign-in in automation-controlled browsers ("This browser or app may not be secure"); a
  storageState captured by a person, or `--browser firefox`, may help. This is a provider policy, not a library
  behaviour.
- `navigator.userActivation` is not available in every engine; where it is missing the activation check relies on
  the popup having opened from the click. The offline wiring check passed in Chromium and WebKit here; Firefox
  could not be launched in this environment (Playwright's Firefox build exited with "Could not find profile
  folder"), so Firefox is unverified.
- Unattended CI needs session mode (above); whether Google or a given Entra tenant accepts replayed sessions from
  a CI runner is unverified. Without a usable session the targets FAIL (stale session) or are UNTESTED (none
  configured), and fail the run when required.
- Session-mode interaction detection is a fixed selector list plus the SDK's error codes plus a 60 s deadline; a
  provider page this list does not recognize still fails, only later (at the deadline).
