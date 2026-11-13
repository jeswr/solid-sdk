<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/agent-vault

Private, experimental, security-critical Node 24 host library. Keeps accounts, login route
facts, credentials and the sessions produced by login. No planner, model, browser launch,
implicit network in the library, publishing, or new third-party dependencies. The optional
native host explicitly composes the workspace's guarded network adapter. All times are Unix **milliseconds**
except executor cookie `expires`, which is Unix **seconds** (`-1` means a session cookie).

## Compose the host

```ts
import { CredentialStore } from '@jeswr/agent-credentials';
import {
  AgentVault, EncryptedRecords, LocalEncryptedBackend, PermissionPolicy, Profiles,
  SessionStore,
} from '@jeswr/agent-vault';
import { createExecutorFetch, loginWithPassword } from '@jeswr/agent-browser';

const store = new CredentialStore({ dir: '/absolute/private/agent-store' });
const profiles = new Profiles(store);
const sessions = new SessionStore(new EncryptedRecords(store));
const local = new LocalEncryptedBackend({ store, profile: 'personal' });
const permissions = new PermissionPolicy(store, permissionUI);
await profiles.putProfile({ id: 'personal', label: 'Personal' });
await profiles.putAccount({ id: 'alex', profile: 'personal', site: model.site,
  label: 'Alex Example', emailDomain: 'example.test' });
await profiles.putRoute({ ...model.login[0], site: model.site,
  account: 'alex', profile: 'personal' });
const vault = new AgentVault({ profiles, sessions, permissions, backends: [local],
  passwordLogin: async ({ credentials, account, sessions: loginSessions }) => {
    await credentials.use(value => loginWithPassword(model,
      createExecutorFetch({ model, sessions: loginSessions, persona: account.id }), value));
  },
  interactiveLogin: trustedPopupLogin,
  offerSave: chooseSaveBackendUI,
});
const result = await vault.ensureSession(model.site, { profileHint: 'personal' });
// An ask is safe for the host account-selection UI. A session is host-only.
// Use the host sessions store for later execution, with persona = result.account.id.
```

Provision initial credentials through the person's UI as `Secret<LoginItem>` in
`ensureSession(site, { credentials })`. After successful password login, `offerSave`
receives only backend ids eligible for this profile. Returning `undefined` declines.
A choice requires a separate `save` permission and a matching `profileFor(ref)` binding.
Optional saves report saved/declined/denied/failed without invalidating the successful session. Backend-supplied credentials never trigger
that offer. `PasswordLogin` may return a `Secret<SessionCapture>` or update its supplied
executor SessionProvider and return void. Before either login callback the vault explicitly resets
old session material and binds `LoginRequest.transaction` to a new login generation. A callback
receives a provider restricted to that transaction's site, account and generation, rather than
the host store's administrative methods. Always use `request.sessions` throughout password
login, including executor construction, probes and retries. Interactive login receives the
same restricted provider. A superseded or revoked provider returns no session from `get`
and `{ accepted: false }` from `update`, even when supplied a newer login's revision.
Reads and writes check the generation under the record lock after key acquisition; writes
also compare the revision there. A callback failure marks only its own generation stale;
it cannot revoke a newer login or leave its delayed cookies in that newer session. The OTP callback receives
a separately permitted backend code, or `askOtp` obtains it from the person. Standalone OTP
routes use the same seam through `InteractiveLogin`.

Profiles and routes are facts, serialized with `n3.Writer` and parsed with `n3.Parser`.
`account-graph.json` contains RDF text with `sab:` properties and `schema:label`;
structured route values use `rdf:JSON`. The graph contains no credential values. Labels,
route metadata, profile ids and backend item refs must be non-secret configuration.
SSO facts require the provider name to match `sso:<provider>` and a provider account in the
same profile. An existing account id cannot move between sites or profiles.

Persona rules, in order: normalize the site origin; sort candidates by account id; apply
`profileHint` and case-insensitive `emailDomain` as hard filters; choose an explicit
`lastUsed` account id only within those candidates; return the sole remaining account;
otherwise ask, including when no candidate exists. There is no implicit recency/default
fallback across profiles. Multiple site accounts in one profile need explicit backend item
bindings. Multiple matching credentials refuse with `ambiguous`; the host must bind an item.

## Secret backends and permission

`SecretBackend` supplies `id`, `find(siteOrigin)`, `read(ref, 'login')`, `save(Secret<LoginItem>)`
and optional `totp(ref)`. Save-capable adapters declare `profiles`. These are **trusted host
adapters**; direct calls are intended for explicit provisioning, and do not apply UI policy.
Normal browser access goes through `AgentVault`, which checks `PermissionPolicy` before every
backend secret read, TOTP read and save. Do not expose adapters, policy, sessions or callbacks
to a planner. `find` returns only opaque references, backend ids and profile ids.

`PermissionAsker.ask({ site, account, backend, purpose })` returns `once`, `always-for-site`
or `never`. Persistent decisions bind backend, item, exact site origin, account and purpose;
`never` also survives restart. `revoke(request, item)` removes that decision by recording a
revoked tombstone so the next request asks again. Decisions carry persisted revisions;
prompt responses are checked under the store's cross-process record lock. A `never` or
revocation invalidates every outstanding approval, including `once`. An old denial still
wins over an intervening grant; a fresh prompt after revocation can grant access again.
A save for a new item uses item `new`;
a known destination ref binds that exact ref. Different purposes never inherit a grant.

Local items use AES-256-GCM with independent random IVs. Additional authenticated data binds
each envelope to its namespace and record key, preventing ciphertext substitution. The
format requires exactly 12 IV bytes and a 16-byte (128-bit) authentication tag; neither
encryption nor decryption lets envelope metadata select a shorter tag. The
index and sessions are also encrypted. `KeyProvider.key()` returns `Secret<Uint8Array>`
containing exactly 32 bytes. Default `FileKeyProvider` initializes one random key under the
credential store's cross-process lock, in `vault/encryption-key.json`. Inject a key provider
for OS keychain integration. No automatic key rotation or recovery is provided.

## 1Password CLI

Install/configure `op` outside this package. The vault never installs it or signs in by
collecting an account password. Desktop integration requires the desktop app's CLI
integration and unlock approval (for example Touch ID). Configure both accounts independently:

```ts
const backend = new OnePasswordCliBackend({ accounts: [
  { account: 'family', profile: 'personal', vault: 'home', auth: { mode: 'desktop' } },
  { account: 'business', profile: 'work', vault: 'office', auth: { mode: 'desktop' } },
] });
```

Use the account's configured CLI shorthand or id and the intended vault id/name. Every
invocation supplies `--account`, `--vault`, and `--format json`. References contain the
account and item id (`family/<item-id>`), and cannot silently fall back to another account.
New saves require `ref: 'family/new'`. Saves targeting existing refs refuse with `denied`
before invoking the CLI: JSON-template edits cannot guarantee preservation of passkeys,
secondary URLs, notes or unknown fields. Select an explicit `'<account>/new'` destination
to create a separate item, or update the original through 1Password's own UI. The save
chooser must supply that reference. Creates send the Login template through stdin;
username/password never appear in argv. Reads parse stdout only; errors never retain stdout
or stderr. TOTP uses `op item get <id> --otp`, accepting its digit output or JSON string.

For service accounts, create a separate service account with access to **one vault only**
and inject its token from a trusted source:

```ts
{ account: 'business', profile: 'work', vault: 'office',
  auth: { mode: 'service', token: async () => trustedServiceTokenSecret } }
```

The token is a `Secret<string>`; it reaches only that invocation's child environment as
`OP_SERVICE_ACCOUNT_TOKEN`. It never modifies `process.env`, argv, the RDF graph or the
local store. CLI arguments restrict each command to the configured vault; the service
account's actual single-vault restriction must also be provisioned in 1Password. The
library cannot prove the scope of an opaque service token. Desktop processes inherit no
service token or `OP_SESSION` from the parent. The runner supplies PATH and HOME only,
plus the explicit service env. Inject `runner` for a custom installation/config directory.
The default runner uses spawn without a shell, a 60-second deadline and a 1 MiB stdout bound.

URL matching defaults to **exact origin**, including scheme and port. Item URLs may contain
paths. `domainGroups: ['shop.test']` explicitly permits that domain and its subdomains,
preserving scheme and port. It is an operator-vetted registrable-domain rule; this package
has no public-suffix list and never guesses a registrable domain from the last two labels.
Do not configure public suffixes or domains shared with untrusted tenants. `read` binds a
credential to the item's first URL origin. Automated login accepts a differing origin only
when the selected adapter's `allowsOrigin` confirms the explicit trusted domain group. A
matching secondary URL with an unrelated primary URL still refuses. Local matching is always
exact origin.

## Capture and keep-alive

Start a host login transaction **before the person signs in**, and retain its binding beside
the authenticated popup/tab. `sessionCapture(unknown)` validates and wraps its later message:

```ts
const transaction = await sessions.beginLogin(site, account);
// Open the login UI and authenticate its sender/tab against this transaction.
const bundle = await acceptCapture(sessions, sessionCapture(message), transaction, now);
```

`beginLogin` returns `{ site, account, generation }`; never take the generation from the
message or create the transaction when the capture arrives. `AgentVault` creates it before
calling `passwordLogin` or `interactiveLogin` and supplies it as `request.transaction`.
`acceptCapture` requires this binding, verifies the expected origin and account, allows at
most 30 seconds future skew and five minutes message age, and validates cookies/token endpoint.
Under the record lock, after key acquisition, it refuses a stale/revoked or different login
generation. Cookie updates and refreshes within the same generation can precede a valid capture.
A missing account is filled only from the explicit host binding. **The host authenticates
the extension sender, popup/tab and login transaction.** Origin metadata alone does not
authenticate a message; this core helper does not implement sender authentication or replay deduplication.
The optional native host below adds the Chrome sender pin and single-use transaction channel.

SessionProvider `get/update` uses site + **account id**, supplied as executor `persona`.
Missing account refuses. `get()` includes the record's current `revision`.
`update(site, persona, bundle)` returns `{ accepted: boolean; revision?: string }`.
After key acquisition and under the record lock, updates with missing or superseded
revisions, missing records or stale records return `{ accepted: false }` without writing.
Accepted updates return `{ accepted: true, revision }` with the new revision created by
that same atomic write. The executor must carry this returned revision into its next
update in the same execution. On rejection, never attach a freshly fetched revision to
the rejected cookie jar; it belongs to a superseded session. These additive provider types
are declared structurally in this package while the executor lane updates its implementation.
`sessions.forLogin(transaction)` creates the restricted provider used by both login callbacks;
it preserves its generation across accepted writes and revision rotation. `beginLogin` supplies an
empty bundle with a revision so the executor can persist the first login cookie; an empty
bundle alone is not an authenticated session. Expired cookies are filtered; expired bearer
sessions and stale sessions refuse, while encrypted refresh metadata remains available to keep-alive. Captures
accept only bearer Authorization headers derived from tokens. Cookie domains default to the
exact host; `cookieDomains` explicitly permits trusted parent domains for RFC domain matching.
Host-only cookies always require the exact host; IPs never suffix-match. No guessed
public-suffix acceptance. Cookie prefixes, control characters and unrelated headers refuse.
Every session write changes its persisted revision, including login reset, capture,
executor updates and marking stale. Legacy records without a revision remain readable;
their first host write assigns one; revisionless executor updates refuse. `store(state)` is
an immediate host replacement: it checks any supplied snapshot revision and compares the
record read at invocation under the lock before replacing it with a new login generation.
Delayed stores and login resets cannot undo intervening writes or revocation. Revoking a
missing record writes a stale tombstone so an initial pending write cannot revive it.
Use the pre-login transaction for asynchronous captures, and pass it to
`stale(site, account, transaction)` when cleaning up a failed login. Explicit host revocation
uses `stale(site, account)` and applies to the current record.
Scheduler `SessionStore.commit(snapshot, cancelled)` compares
the snapshot revision and checks cancellation under the record lock, after key acquisition,
then writes synchronously. Superseded snapshots are discarded, including delayed 401s.

`KeepAlive({ sessions, clock, transport, floorMs, leadMs })` has no global timers or network.
`clock` provides `now`, `set`, `clear`; `transport` accepts manual-redirect GET/POST requests and
returns `{ status, text(), setCookies? }`. `start(site, account, route, { frequent, intervalMs })`
replaces that account's old job. Synchronous `stop` prevents requests after delayed state
loading, late in-flight persistence (including pending key acquisition), and future timers.
Refresh POSTs use an OAuth refresh-token form, only on the exact site origin; a captured
`tokenEndpoint`, if present, must match the learned URL. JSON pointer extraction uses
`tokenPointer` and `expiresInPointer` (default `/expires_in`, numeric seconds). Missing or
invalid expiry never extends validity. Standard `/refresh_token` rotation is persisted when present. Nonstandard refresh-token
rotation needs a route-contract extension; an absent rotation field retains the current token. A frequent site's probe
receives only its valid cookies/bearer header; successful Set-Cookie headers update the jar.
401 marks stale, redirects refuse, failures back off exponentially up to one hour, and no
job runs faster than 30 seconds (default 60 seconds). Probes for sliding sessions are opt-in.

## Real-browser sign-in through Chrome native messaging

The extension popup can hand off a site's **existing cookies** after the person signs in
in their normal browser. Passkeys, SSO and 2FA run in that browser. No passkey private key,
password, identity-provider cookie jar, page script or localStorage token is exported.
The person selects the active site's vault profile and persona, reviews the site and
cookie count, then confirms **Share this sign-in with my agent**. The page and content
script have no capture capability and receive no credentials. Solid sign-in in the
extension is independent of this site's sign-in.

Provision the profile/account for the **exact site origin** in the same CredentialStore
used by the agent (see Compose the host). Account id is the executor persona. A learned
route is optional for capture and required for keep-alive, for example:

```ts
await profiles.putProfile({ id: 'personal', label: 'Personal' });
await profiles.putAccount({ id: 'alex-shop', profile: 'personal',
  site: 'https://shop.test', label: 'Alex Example' });
await profiles.putRoute({ account: 'alex-shop', profile: 'personal',
  site: 'https://shop.test', method: 'passkey', probeUrl: 'https://shop.test/session' });
```

Build with Node 24, load `apps/extension/dist` unpacked, and read its ID from
`chrome://extensions`. Generate a host pinned to that ID (the checked-in manifest key
currently gives `bicabcdahgfbkgmlidjpmiadmjlppikk`):

```sh
pnpm turbo run build --filter=@jeswr/agent-vault --filter=@jeswr/app-extension
node packages/agent-vault/scripts/native-manifest.mjs \
  --extension-id bicabcdahgfbkgmlidjpmiadmjlppikk \
  --store-dir /absolute/private/agent-store \
  --output-dir /absolute/private/agent-native
```

The store's parent must exist. Use a new private output directory; the generator refuses
existing files. It creates an owner-only config, a POSIX executable launcher with absolute
Node/package paths, and `org.jeswr.agent_vault.json` with one `allowed_origins` entry.
Copy that manifest into your browser's native-host directory:

| Browser / OS | User native-host directory |
|---|---|
| Chrome / macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` |
| Chrome / Linux | `~/.config/google-chrome/NativeMessagingHosts/` |
| Chromium / Linux | `~/.config/chromium/NativeMessagingHosts/` |

Keep the generated launcher/config and this checkout at their absolute paths. Restart the
extension after registration. Changing the extension ID requires regenerating registration.
The generator supports macOS/Linux; Windows needs a native executable launcher and registry
registration as described in [Chrome's native messaging documentation](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging).

Cookie scope defaults to the exact host. For a site that uses parent-domain cookies,
explicitly add e.g. `--cookie-domain example.co.uk` when generating the host, only after
vetting that domain's tenant boundary. Configure the agent's SessionStore with the same
`cookieDomains`. The shared boundary checks the bundled Public Suffix List (ICANN **and
PRIVATE**, wildcard and exception rules); public suffixes such as `co.uk` and `github.io`
refuse even in configuration. The data snapshot is redistributed from OpenJDK's PSL data
under [MPL 2.0](https://mozilla.org/MPL/2.0/); refresh it from the
[official PSL](https://publicsuffix.org/list/public_suffix_list.dat) when updating scope rules.
The extension queries cookies matching the active page URL, then checks each domain again.
Sibling host-only cookies, other sites, expired cookies and partitioned cookies are excluded.
Cookies scoped only to another path are not captured; navigate to the signed-in application
page before sharing. Secure, httpOnly, hostOnly, sameSite, path and expiry are preserved.
Incognito capture is refused. Only HTTPS and development loopback HTTP can be selected.

The worker holds one `connectNative` port after the popup closes. The executable validates
Chrome's caller against the pinned ID before opening the store, and owns one keep-alive
scheduler under a cross-process owner lock. It resumes configured account routes when the
port opens and calls the existing KeepAlive after each accepted capture. Refresh uses
existing encrypted refresh metadata when available; cookie-only captures have no OAuth
refresh token. Sliding-session probes require explicit `--frequent-site https://shop.test`
and a learned `probeUrl`. They use the workspace DNS-pinned guarded transport, bounded
bodies/timeouts and manual redirects. There is no probe when the route or opt-in is absent.
Do not run a second scheduler for this store. Closing the browser/disconnecting the native
port stops this owner; reopening the popup resumes it. An always-running trusted host may
instead compose `NativeVault({ profiles, sessions, beginning, captured })` from the `./native-host`
export and stop its existing job in `beginning(site, account)`, then restart it in
`captured(site, account)`. Old probes must not invalidate the empty review generation.

SSO/site cookies expire according to the site. Keep-alive cannot extend an absolute expiry,
copy a device-bound session, or satisfy a fresh passkey/2FA challenge. When the vault reports
the session stale, the person signs in on that site and explicitly shares again. A successful
capture acknowledges storage, not a successful site authentication probe.

The protocol uses UTF-8 JSON preceded by a native-endian unsigned 32-bit byte length, with
a stricter **1 MiB per message in both directions**. Requests and responses are strict schemas
from `@jeswr/agent-vault/browser`; errors contain fixed codes and responses never contain
cookies/tokens. Request ids are positive integers:

| Request | Fields | Result |
|---|---|---|
| `list` | `id`, `site` | display-only `profiles`, site `personas`, vetted `cookieDomains` |
| `beginLogin` | `id`, `site`, `profile`, `persona` | opaque generation `token` |
| `capture` | `id`, `token`, `message` (exact `captureSchema`) | acknowledgement only |

Success is `{ id, ok: true, result: { type, ... } }`; refusal is
`{ id, ok: false, error: 'invalid' | 'denied' | 'unavailable' }`. Invalid framing closes the
connection without diagnostics. Tokens are port-bound, single use, expire after five minutes,
and are limited to eight pending accounts. `beginLogin` starts a replacement generation
before cookie collection, during review (after the person signs in to the site). Old probes
stop during review; cancelling does not restore an older session.
Capture cannot invent a transaction, cross site/account/profile, replay a token, or overwrite
a newer/revoked generation. No protocol payloads, raw errors or secrets are logged.

## Threat model and limits

Protects disk confidentiality from accidental disclosure/backups without the key, file
permissions against other OS users, and routine JSON/string/`util.inspect` diagnostics.
Reuses agent-credentials' owner-only 0700 directories, 0600 files, no-follow reads, exclusive
temporary writes, fsync and atomic rename. Raw filesystem paths and external exception
causes never enter vault errors. `Secret` uses a private field; recursively wrapped session
objects redact JSON/inspection/string conversion. Errors contain fixed codes only. Nothing
logs credentials, process diagnostics, response bodies, or session material.

Host adapters necessarily access plaintext to authenticate. Explicit property reads,
spreading/copying a cookie into another object, disabling custom inspection, a malicious
injected adapter, debugger, compromised same-user process or stolen key defeats this
boundary. This is not a sandbox or a guarantee against a hostile caller. The key is beside
the ciphertext by default, so stealing the whole store compromises confidentiality. Use an
external key provider for a stronger disk boundary. Never send vault return objects or
host adapters to the planner; only render account questions and executor RDF observations.
The host owns DNS/network policy, browser identity verification, timeouts for injected
transports, session revocation, vault selection and trusted site models. Session commits and
permission changes use cross-process record locks and persisted revisions. Session refresh
scheduling still requires a single host owner; locks do not coordinate timers across hosts.

## Validate offline

```sh
pnpm --filter @jeswr/agent-vault run lint
pnpm --filter @jeswr/agent-vault run build
pnpm --filter @jeswr/agent-vault run typecheck
pnpm --filter @jeswr/agent-vault run test
node scripts/check-skills.mjs --write
pnpm run lint:root
```

Tests use private temporary stores and fake processes, clocks, network and UI callbacks.
No real `op`, account, browser or external service is accessed.
