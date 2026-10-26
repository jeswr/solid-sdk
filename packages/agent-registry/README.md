<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Codex GPT-6 -->

# @jeswr/agent-registry

> Experimental — AI-agent-generated.

Imports a configured, private registry YAML file into `agent/accounts/<id>.ttl` as
`agent:Account` resources (agent DESIGN §2.4, A-036). The package remains private.
No provider, credential resolver, model, or pod transport is included.

`importRegistry(config, { reader, salt, storage })` takes an explicit `registryPath`,
HTTPS `storageRoot` ending in `/`, and `ownerWebId`. Use `FileRegistryReader` for a
bounded UTF-8 local file read, or inject a reader. It rejects symlinks and non-files.
The real registry and daemon salt must never be committed or printed.

The synthetic schema example is [test/fixtures/registry.synthetic.yaml](test/fixtures/registry.synthetic.yaml).
It follows the pilot inventory export: `version: 1`, `accounts[]` with `id`, `channel`,
`provider`, `organization`, `identifiers` (string or string-array values), and `connector`
(`target`, `setup_status`, optional `last_tested`, `last_test_result`, `available_in_mcp`).
Optional top-level fields are `source`, `observedAt`, `registryUpdated`/`last_updated`,
`notes`, `evidence`, and `communicationRules`. Unknown fields, duplicate ids/keys,
YAML aliases/tags, invalid dates and oversized inputs fail before storage writes.

Credential references may be supplied as `credential_ref` on the account or connector
(string or array). `op://vault/item/field` strings are kept verbatim; explicit daemon
profile references use `profile:name`. Opaque credential strings are refused. References
containing a known raw identifier are refused rather than rewritten. References are
never resolved. Labels, source paths and free-text notes are never copied into settings
or RDF; conflict notes become structured hash-only `agent:identityConflict` values.

`SaltProvider.getSalt()` supplies a stable, private salt of at least 32 bytes from the
daemon store. Handles use HMAC-SHA-256(salt, NFC/trim/lowercase(handle)), hexadecimal.
No provider-specific alias folding is applied. Resource ids hash the registry id with
an `account-id\0` domain prefix, preserving resources across handle/provider corrections.
Keep the salt stable across imports. Raw handles stay in the daemon's private input.

The importer corrects ODI email accounts to `google_workspace` (Teams stays Microsoft),
preserves explicit identity/provider conflicts, and adds a Telegram bot control account
when no Telegram account exists. Personal Telegram/MTProto remains deferred. Registry
`connected` claims map to `setup-required`; errors and disabled states remain visible.
Read, triage, draft and send restrictions start false. A changed import resets restrictions
to false; unchanged resources retain their existing representation. Removed registry rows
are not deleted automatically.

`StorageClient` in `src/ports.ts` is a local seam pending SDK storage-client integration.
Its ACL setter **replaces** grants with owner-only Read/Write/Control and must persist
the ACL even for an account that has no content yet. The accounts-container ACL is set
first, then each account ACL before content. Conditional creates/updates use `ifNoneMatch`
or the read ETag; read/ACL/write failures abort. A batch can be partially imported when a
later storage operation fails; re-running safely resumes it. Re-import uses stable URLs,
replaces RDF rather than appending, and skips identical Turtle content.

Use `@jeswr/agent-registry/settings` in the browser for `Settings`, `Account`,
`emptySettings`, `channelGroup`, `connectionStatus`, `effectiveCapability`, and
`capabilityMatrix`. This is the account portion of the pilot dashboard model/inventory/
assessment port, with identifiers replaced by hashes. Historical evidence matches only
an exact normalised handle on the same channel; unmatched evidence stays separate as
hashes. Inventory, owner restrictions and workflow policy never establish provider access
or a signed mandate. Assessment always denies provider-dependent actions, including send.
Scheduling and TypeSafe hosted triage are outside this package.

`@jeswr/agent-registry/testing` exports `MemoryStorageClient`, `MemoryRegistryReader`,
and `FixedSaltProvider`; all are offline and the storage fake enforces ACL ordering and
conditional writes. Run `pnpm run lint`, `pnpm run build`, `pnpm run typecheck`, and
`pnpm run test` here. The package is not securityCritical; no coverage threshold is configured.
