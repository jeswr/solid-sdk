<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# @jeswr/agent-vault

Private, experimental, security-critical Node 24 host library. Keeps accounts, login route
facts, credentials and the sessions produced by login. No planner, model, browser launch,
implicit network, publishing, or new npm dependencies. All times are Unix **milliseconds**
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
  passwordLogin: async ({ credentials, account }) => {
    await credentials.use(value => loginWithPassword(model,
      createExecutorFetch({ model, sessions, persona: account.id }), value));
  },
  interactiveLogin: trustedPopupLogin,
  offerSave: chooseSaveBackendUI,
});
const result = await vault.ensureSession(model.site, { profileHint: 'personal' });
// An ask is safe for the host account-selection UI. A session is host-only.
// Use this SAME sessions provider with executor persona = result.account.id.
```

Provision initial credentials through the person's UI as `Secret<LoginItem>` in
`ensureSession(site, { credentials })`. After successful password login, `offerSave`
receives only backend ids eligible for this profile. Returning `undefined` declines.
A choice requires a separate `save` permission and a matching `profileFor(ref)` binding.
Optional saves report saved/declined/denied/failed without invalidating the successful session. Backend-supplied credentials never trigger
that offer. `PasswordLogin` may return a `Secret<SessionCapture>` or update the shared
executor SessionProvider and return void. Before password login the vault explicitly resets
old session material. A callback failure marks its session stale. The OTP callback receives
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
revoked tombstone so the next request asks again. A save for a new item uses item `new`;
a known destination ref binds that exact ref. Different purposes never inherit a grant.

Local items use AES-256-GCM with independent random IVs. Additional authenticated data binds
each envelope to its namespace and record key, preventing ciphertext substitution. The
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
New saves require `ref: 'family/new'`; updates use the existing ref. The save chooser must
supply that reference. Both create and update send the full Login template through stdin;
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

`sessionCapture(unknown)` validates and wraps the extension/popup's message.
`acceptCapture(sessions, capture, { site, account }, now)` verifies the expected origin and
account, allows at most 30 seconds future skew and five minutes message age, validates
cookies/token endpoint, encrypts the bundle, then returns a host session. A missing account
is filled only from the explicit host binding. **The host authenticates the extension
sender, popup/tab and login transaction.** Origin metadata alone does not authenticate a
message; the vault does not implement browser messaging or nonce/replay deduplication.

SessionProvider `get/update` uses site + **account id**, supplied as executor `persona`.
Missing account refuses. Expired cookies are filtered; expired bearer sessions and stale
sessions refuse, while encrypted refresh metadata remains available to keep-alive. Captures
accept only bearer Authorization headers derived from tokens. Cookie domains default to the
exact host; `cookieDomains` explicitly permits trusted parent domains for RFC domain matching.
Host-only cookies always require the exact host; IPs never suffix-match. No guessed
public-suffix acceptance. Cookie prefixes, control characters and unrelated headers refuse.

`KeepAlive({ sessions, clock, transport, floorMs, leadMs })` has no global timers or network.
`clock` provides `now`, `set`, `clear`; `transport` accepts manual-redirect GET/POST requests and
returns `{ status, text(), setCookies? }`. `start(site, account, route, { frequent, intervalMs })`
replaces that account's old job. `stop` prevents late in-flight updates and future timers.
Refresh POSTs use an OAuth refresh-token form, only on the exact site origin; a captured
`tokenEndpoint`, if present, must match the learned URL. JSON pointer extraction uses
`tokenPointer` and `expiresInPointer` (default `/expires_in`, numeric seconds). Missing or
invalid expiry never extends validity. Standard `/refresh_token` rotation is persisted when present. Nonstandard refresh-token
rotation needs a route-contract extension; an absent rotation field retains the current token. A frequent site's probe
receives only its valid cookies/bearer header; successful Set-Cookie headers update the jar.
401 marks stale, redirects refuse, failures back off exponentially up to one hour, and no
job runs faster than 30 seconds (default 60 seconds). Probes for sliding sessions are opt-in.

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
transports, session revocation, vault selection and trusted site models. Multiple processes
may share atomic records, but session refresh scheduling requires a single host owner;
there is no cross-process compare-and-swap between executor updates and refreshes.

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
