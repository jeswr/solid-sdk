# Provider setup: the `awp-credentials` helper (Google, Microsoft)

`awp-credentials` is the separate credential helper that the calendar actions call through the
contract in [`PROVIDER-ACTIONS.md`](PROVIDER-ACTIONS.md) §3. It owns sign-in, token storage and
refresh. The actions and the dashboard never see a refresh token, a client secret or the
helper's files.

Code: `src/credentials/`. Built: `dist/credentials/cli.js` (package bin `awp-credentials`).

> **Status of this code.** Tested only against a local fake OAuth provider (injected transport,
> signed test ID tokens, real loopback callback). **No real consent, token exchange or provider
> call has been made with it.** The first real sign-in is the setup step below.

## 1. What is stored where

You choose ONE dedicated directory, outside the repository, for example
`$HOME/.config/awp-credentials`. Pass it as `--dir` (absolute) or set `AWP_CREDENTIALS_DIR`. Its
parent must exist; the helper creates the directory itself.

| Path | Contents | Secret? |
|---|---|---|
| `clients/google.json` | Google OAuth client id and the Desktop-app client secret | the secret (not confidential for installed apps, but kept private) |
| `clients/microsoft.json` | Microsoft application (client) id | no |
| `profiles/<name>.json` | provider, dashboard connection id, the exact chosen account, requested scopes | no |
| `grants/<name>.json` | profile, provider, the OAuth client id it was issued to (`clientId`), verified account (subject, and tenant for Microsoft), granted scopes, refresh token, cached access token | **yes** |
| `locks/<name>.lock` | short-lived lock while refreshing or logging in | no |

The rules:

- The directory must be `0700` and every file `0600`, owned by you. The helper refuses anything
  wider, symbolic links, and files of another owner. It never widens or silently changes
  permissions.
- Writes are atomic and complete. A record is validated first. Every byte of the new private
  file is written (short writes are continued) and fsynced, and only then is it renamed over the
  old one. A failed write leaves the previous record in place.
- Every record is validated when read: strict RFC 3339 times, known fields only. A corrupt
  record is reported as such and never used.
- A grant is used only if it belongs to its profile: the same profile name, provider and chosen
  account; for Microsoft, a tenant of the chosen account type; and the OAuth client currently
  registered. This is checked before a cached token is returned, and again under the lock
  before a refresh. A mismatched record is not used, and `status` shows `NOT USED` with the
  reason. A grant issued to another client needs a new `login` (the helper protocol reports
  exit 3, *needs setup*).
- Replacing a registered client with a different one, while grants issued to it exist, is
  refused unless you add `--force`. Those profiles must then log in again; grants never
  migrate to another client.
- Refresh and login run under a per-profile lock, so parallel actions refresh once. A rotated
  Microsoft refresh token replaces the old one atomically.
- Nothing is searched for or imported implicitly: no keychains, browser profiles, password
  managers or credential stores. The only input files are the ones you name.

## 2. The commands

Every command below is human-facing and safe to run in a terminal. None of them prints a token
or the client secret.

Define a shell function once. It works in zsh and in POSIX shells, and it is safe with spaces
in paths. Put the absolute path of *your* checkout in place of `/ABS/PATH/TO/personal-agent`:

```sh
awpc() { node "/ABS/PATH/TO/personal-agent/dist/credentials/cli.js" --dir "$HOME/.config/awp-credentials" "$@"; }

awpc help                                                 # usage (no directory needed)
awpc client google --client-file /ABS/PATH/client_secret_XXXX.json   # register the app (Google)
awpc client microsoft --client-id 00000000-0000-0000-0000-000000000000   # register the app (Microsoft)
awpc profile add --name NAME --provider google --connection CONNECTION_ID --account ADDRESS [--calendar-inventory]
awpc profile add --name NAME --provider microsoft --connection CONNECTION_ID --account ADDRESS \
   --account-type personal | --account-type work-or-school [--tenant organizations|TENANT_GUID]
awpc login --profile NAME [--open] [--timeout-seconds 300]  # the ONLY command that signs in
awpc status [--json]                                        # clients, profiles, grants (no secrets)
awpc calendars --profile NAME [--json]                      # explicit calendar inventory
awpc provider-config --out /ABS/PATH/providers.json [--force]   # configuration for the actions
awpc logout --profile NAME [--revoke]                       # explicit; see §6
```

`token --profile NAME` also exists. It is the **private helper protocol**, run by the actions
with its output captured. It refuses to run when its output is a terminal. Do not run it by hand,
and never paste its output anywhere.

## 3. Google (first)

### 3.1 App registration (Google Cloud console, once)

Registering the app is **not** consent by any account. `status` tracks the two separately.

1. Create or choose a project. Enable the **Google Calendar API**.
2. Configure the **OAuth consent screen**. While it is in *Testing*, add the chosen account as a
   test user. Google expires refresh tokens of Testing apps after 7 days; `status` then shows
   `needs-reconsent`, and you run `login` again.
3. Add these scopes:
   - `openid` and `…/auth/userinfo.email`;
   - `…/auth/calendar.freebusy`;
   - `…/auth/calendar.calendarlist.readonly`, only if you want the inventory command.
4. Create an **OAuth client ID** of type **Desktop app**. Download its JSON.

Then:

```sh
awpc client google --client-file /ABS/PATH/client_secret_XXXX.json
```

The command accepts only a Desktop-app client (`installed`) whose token endpoint is Google's.
Afterwards, delete or move the downloaded file.

### 3.2 The account grant

```sh
awpc profile add --name personal-google --provider google \
   --connection email-example-gmail --account owner@example.com --calendar-inventory
awpc login --profile personal-google --open
```

- `--connection` is the dashboard account (connection) id that the calendars belong to.
- `--account` is the **exact** account you chose. The helper checks it; it never guesses.
- `--calendar-inventory` is optional. It adds the calendar-list scope for §5.

`login` does the following:

- It prints the Google address to open. The address contains no secret. It also opens a browser
  with `--open`.
- It listens on `http://127.0.0.1:<random port>`, on loopback only, for at most
  `--timeout-seconds` (default 300).
- It uses PKCE (S256), a random single-use `state` and a `nonce`.
- It accepts one response carrying that state and ignores forged or stray ones. Then the listener
  closes.

After the code exchange, the helper verifies Google's signed **ID token**:

- signature (Google's published keys), issuer, audience (your client) and nonce;
- the OIDC-mandatory claims present and sane: `iss`, `sub`, `aud`, `exp`, `iat`; `exp` after
  `iat`, a lifetime of at most 24 h, not expired, not issued in the future, and issued at most
  10 minutes ago (it comes from the code exchange that just happened). With several audiences,
  `azp` must be your client, and any `azp` must be your client;
- `email_verified`, and the email equal to `--account`.

It then pins the account's `sub`. Nothing is stored in any of these cases:

- a different account consented;
- the calendar scope was not granted;
- no refresh token was issued.

A grant already pinned to one account is never overwritten by another. `login_hint` is only a
hint to the sign-in page; it is never trusted.

**Scopes requested, and why:**

| Scope | Why |
|---|---|
| `openid`, `email` | Minimal identity, to prove which account consented (`sub` plus verified email). |
| `calendar.freebusy` | Availability: busy intervals only, no event details. |
| `calendar.calendarlist.readonly` | Only with `--calendar-inventory`: the list of calendar ids and names for §5. |

Earlier grants are not merged in (`include_granted_scopes` is not used). `status` shows every
granted scope. The helper never uses a scope it did not request.

## 4. Microsoft (personal, or work/school)

### 4.1 App registration (Microsoft Entra admin center, once)

1. **App registrations → New registration.** For supported account types, choose *Personal
   Microsoft accounts only*, or *Accounts in any organizational directory and personal Microsoft
   accounts*, or your organisation only.
2. **Authentication → Add a platform → Mobile and desktop applications**, with redirect URI
   `http://localhost`. Microsoft ignores the port for `localhost`, and the helper uses a random
   one. Do not create a client secret: this is a public client using PKCE.
3. **API permissions → Microsoft Graph → Delegated.** Add:
   - `Calendars.ReadBasic`;
   - `openid`, `profile`, `offline_access`.

   Add no application permissions.
4. Copy the **Application (client) ID**, then run:

```sh
awpc client microsoft --client-id 00000000-0000-0000-0000-000000000000
awpc profile add --name work-ms --provider microsoft --connection email-example-outlook \
   --account owner@example.com --account-type work-or-school --tenant organizations
#   personal account:  --account-type personal   (tenant: consumers)
awpc login --profile work-ms --open
```

The flow is the same as Google's, with these differences:

- the endpoints are `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/…`;
- the redirect is `http://localhost:<port>`;
- no client secret is used.

The ID token must be signed by Microsoft's published keys, with issuer
`https://login.microsoftonline.com/<tid>/v2.0`, audience your client, and our nonce. The same
claim checks as for Google apply (`sub`, `exp`, `iat`, freshness, `azp`). The tenant
must match the chosen account type:

- *personal*: the consumer tenant `9188040d-6c67-4c5b-b112-36a304b66dad`;
- *work-or-school*: not the consumer tenant, or exactly `--tenant`.

`preferred_username` must equal `--account`. Then `oid` and `tid` are pinned.

**Scopes:** `openid profile` (identity: `oid`, `tid`, `preferred_username`), `offline_access`
(a refresh token), and `Calendars.ReadBasic`. That scope covers availability (calendarView) and
the calendar list; it gives no bodies or attendees.

## 5. Calendar inventory and wiring the actions

```sh
awpc calendars --profile personal-google          # "* " marks the primary calendar
```

The listing prints each calendar's id, name and access role. It is the only command that
returns them, and runtime availability keeps busy intervals only. Google needs a profile created
with `--calendar-inventory`.

In the dashboard **Calendars** page, add an external calendar for each one that should count:

- provider `google` or `microsoft`;
- the connection id;
- `providerCalendarId` (the id above, or `primary`).

Mark it *may read availability* and *counts for availability*.

Then:

```sh
awpc provider-config --out /ABS/PATH/providers.json
node dist/dashboard/cli.js actions prepare --id calendar.availability --input request.json \
     --provider-config /ABS/PATH/providers.json
# or: node dist/dashboard/cli.js serve --provider-config /ABS/PATH/providers.json
```

`provider-config` writes a secret-free configuration (see `PROVIDER-ACTIONS.md` §2). For each
profile it contains:

- the dashboard connection id;
- `command`: the Node executable;
- `args`: this helper's path, `--dir`, `token` and `--profile`.

The action runs the helper, captures its answer privately, uses the token for one call, and
prints only the availability result.

## 6. Status, renewal, revocation

- **`status`** shows, per profile:
  - whether the app is registered;
  - the chosen account;
  - the verified, pinned account;
  - the granted scopes;
  - `active` or `needs-reconsent` (with the reason);
  - `NOT USED` with the reason, if the grant record does not belong to the profile (another
    account, profile, provider, tenant or OAuth client);
  - whether a refresh token is present, and until when the cached access token is valid.

  It never shows a token.
- **Renewal:**
  - Access tokens are refreshed automatically when fewer than 2 minutes remain.
  - If the provider refuses the refresh token (revoked, expired, password change), the grant is
    marked `needs-reconsent` and its tokens are deleted. The actions then report *needs setup*
    (helper exit code 3). Run `login` again.
  - If the provider is unreachable or answers badly, the grant is left unchanged and the actions
    report *blocked*.
- **`logout --profile NAME`** deletes the local grant only. **The consent remains at the
  provider** until you revoke it. Deleting a local file or flag removes no scope.
- **`logout --revoke`** (Google) revokes the refresh token at Google first. This is an explicit
  operator action only, and no test invokes it. Microsoft offers no token revocation for this kind
  of app: remove the app at `https://account.live.com/consent/Manage` (personal) or
  `https://myapps.microsoft.com` (work/school).
- To add or remove the inventory scope, remove the profile (after `logout`), add it again, and
  run `login`. A scope already granted stays on the grant at Google until revoked there.

## 7. What is and is not verified

Tested with the fake provider (`src/credentials/credentials.test.ts`) and in separate processes
(`scripts/credentials-integration.mjs`):

- **Login:**
  - PKCE and a single-use state; forged, stray and wrong-host callbacks are ignored;
  - replay after completion is refused;
  - timeout and denial store nothing, and the listener closes;
  - a wrong account, an unverified email, a foreign signature, a wrong audience or nonce, or a
    different pinned subject are all refused, and the existing grant is left byte-for-byte
    unchanged;
  - a missing refresh token or a missing calendar scope stores nothing;
  - a correctly signed ID token is refused when it lacks `exp`, `iat` or `sub`, is stale, is
    issued in the future, has `exp` before `iat` or an over-long lifetime, or has several
    audiences without `azp` or an `azp` naming another client.
- **Token mode:**
  - cached tokens are reused, and refreshed after expiry;
  - concurrent refresh happens once, including across processes;
  - Microsoft refresh-token rotation is kept;
  - on `invalid_grant`, the grant is marked for re-consent with its tokens removed;
  - on an outage or a malformed answer, the grant is kept;
  - requests for another connection, provider or scope are refused;
  - a terminal is refused.
- **Store:**
  - a wider directory or file, a symbolic link, or a corrupt grant is refused or reported, and
    never replaced;
  - an invalid stored time (`invalid-time`, 30 February, a bare year) is never used, through
    both the helper protocol and the inventory command, and is refused at write time;
  - a grant for another account, profile, provider, tenant or client is not used, whether
    cached or needing a refresh. That includes a record swapped in while a caller waits for
    the lock;
  - replacing the client needs `--force`;
  - short writes are completed, and a failed write keeps the previous record.
- **Output:** no secret appears in `client`, `login`, `status`, `calendars` or `provider-config`
  output.
- **Origins:** only allow-listed provider origins are called.

Not verified:

- any real Google or Microsoft consent, token, refresh, revocation or calendar call;
- that Google's and Microsoft's consoles accept exactly the registration steps above (they
  follow the providers' published documentation);
- browser behaviour when `localhost` resolves to IPv6 without a listener (the helper also
  listens on `[::1]` when available).
