<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/agent-credentials

> Experimental — AI-agent-generated. Private; no publishing configured.

OAuth PKCE loopback login, a 0700/0600 private store, Google/Microsoft calendar adapters,
and purpose-separated `TokenProvider.read(account)` / `.send(account)` for channel bindings.
Ported from the personal-agent pilot; no model SDK, sends or implicit network access.

`new CredentialStore({ dir })` explicitly opens a store (the parent must already exist).
Without `dir`, the default is `~/Library/Application Support/jeswr-agent` on macOS, or
`${XDG_DATA_HOME:-~/.local/share}/jeswr-agent` elsewhere. `defaultStoreDir()` computes that
path without accessing it. Relative XDG paths are ignored. Directories and files must belong
to the current user and refuse group/world permissions and symbolic links. Writes use an
exclusive temporary file inside the store, fsync and atomic rename. The store creates
`clients`, `profiles`, `grants`, `providers`, `locks`, `ledger`, `matrix` and `vault`; the daemon owns `HALT`.
`privateRecord(name, schema)` and `putPrivateRecord(name, schema, value)` expose the same
validated atomic discipline for host-only records in `vault/` (maximum 64 KiB serialized).
Callers such as agent-vault encrypt secret-bearing records before supplying them here.

Register client records with `putClient`, then a profile with `putProfile`. Profiles require
`provider`, `account` (the exact address verified at consent), `connectionId` (registry id),
`purpose: read | send` and `resource: mail | calendar | teams`. Use `login(deps, name, { onUrl })`
for explicit consent. Supply `deps.transport`; without an injected transport, token refresh
refuses. Login validates the signed ID token, state, nonce, PKCE, account, tenant, scopes and
refresh token before persisting. Existing grants pin the account subject and client.
Microsoft profiles additionally require `microsoft.expectedIdentity: { tenantId, objectId }`:
trusted GUIDs the operator verifies independently, rather than values copied from the login
response or inferred from an address. CLI profile creation takes `--tenant-id GUID --object-id GUID`.
Both signed `tid` and `oid` must match this binding. A matching `preferred_username` alone never
authorizes consent. Existing Microsoft profiles without this binding must be configured before
login or token use.

`new StoreTokenProvider(provider, { store, transport, resource: 'mail' })` supplies strings to
channel bindings. `read('owner')` selects exactly one read profile for connection `owner`;
`send('owner')` selects a separate send profile. Missing/ambiguous credentials refuse. Grants
also bind purpose and resource, so copying a file or adding overlapping scopes cannot bypass
separation. Unmarked legacy grants require consent again.

Per-profile locks recover only confirmed dead local owners. A short exclusive `.lock.guard`
serializes acquisition, recovery and release; it is absent during provider calls. If a process
crashes while holding this guard, callers time out without removing it. An operator must stop
all helpers using that store before removing an abandoned guard; age alone cannot prove safety.

Google mail read requests `gmail.readonly`; send requests `gmail.send`. Calendar read requests
`calendar.readonly` on a separate profile (optional calendar-list inventory scope). Microsoft
mail read/send use `Mail.Read` / `Mail.Send`; Teams read uses `Chat.Read` and
`ChannelMessage.Read.All`, send uses `ChatMessage.Send`. Microsoft requests `offline_access`;
OIDC identity scopes are included for account verification. Pilot calendar profiles retain
`Calendars.ReadBasic`. Calendar sends are unsupported. Calendar adapters are available through
`./providers/google` and `./providers/microsoft`; `./providers/setup` defaults to no access.
The library CLI `main(argv, io)` is exposed at `./cli`; it defaults to calendar/read profiles
and takes explicit `--purpose` and `--resource` flags for other grants.

Token files support anthropic, openai, slack, matrix, discord, telegram, bluesky and mastodon.
Provision each purpose separately. The same token value is never automatically reused for
another purpose. Tokens with an expiry refuse after expiry; static API/bot tokens can omit it.
Telegram personal-account MTProto is deferred.

`./matrix` adds explicit provisioned-device import without reading the real registry or
logging tokens. `importMatrixDevice({ store, file, account, purpose, expected })` accepts
a private JSON file containing exactly `homeserver`, `user_id`, `device_id`, and
`access_token`. `expected` pins an HTTPS homeserver origin, `userId`, `deviceId`, and an
existing private `cryptoStorePath` compatible with matrix-sdk-crypto-nodejs. The registry's
device-file schema was unavailable during implementation; this conservative input schema
must be checked against its provisioning output before live composition. No conversion of
other crypto-store formats, login, SSO or device creation occurs. Source file and parent,
crypto directory and stored records must be owner-only; symlinks are refused.

Import read and send purposes explicitly, even when the provider uses a single token.
`createMatrixTokenProvider({ store, account, read, send? })` returns the channel grant
shape (`read({id})` / `send({id})`). It rechecks device, homeserver, account and purpose
pins on each call; missing send provisioning never falls back to read. The host initializes
its OlmMachine with the pinned device and crypto directory. Device records live separately
under the store's private `matrix/` directory and cannot be selected as generic token files.

From the workspace root, build first and provision with explicit references:

```sh
pnpm --filter @jeswr/agent-credentials run build
scripts/provision.zsh --dir /absolute/private/store --provider slack \
  --account fixture --purpose read --dry-run op://fixture/item/token
```

Remove `--dry-run` only for explicit provisioning. Supply a single reference with
`--provider google` for installed-app registration JSON, or `--provider microsoft` for its
client id (account/purpose flags are unnecessary for registrations). Other providers require
account and purpose. Each reference invokes `op read` once. Token-file records are keyed by
provider/account/purpose: provisioning another reference for that tuple atomically replaces the
previous value, and the last successful reference wins. Invalid values or failed reads leave the
previous value intact. Values flow through stdin directly
to the private store writer, never argv, shell variables, stdout, stderr or external temporary
files. An op failure, including partial output, refuses the write. JSON receipts contain only
`credentialRef`, suitable for the account registry; runtime never invokes op. Dry-run prints
only the references and does not create a store.

Run package lint, build, typecheck and test; tests enforce 100% coverage. `./testing` exports
synthetic provider fixtures. All tests use private temporary stores and injected transports.
