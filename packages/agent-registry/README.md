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
containing a known identifier or recognizable email, Matrix/social handle, identity URI or
international phone syntax, including in decoded URI components, are refused even when the
inventory has no handles. Malformed escapes and decoded control characters are refused. References are
never resolved. Labels, source paths and free-text notes are never copied into settings
or RDF; conflict notes become structured hash-only `agent:identityConflict` inventory values.

`SaltProvider.getSalt()` supplies a stable, private salt of at least 32 bytes from the
daemon store. Handles use HMAC-SHA-256(salt, normaliseHandle(handle, channel)), hexadecimal.
Normalization applies NFC and trim, preserves Matrix case, and lowercases URI schemes
while preserving all following URI components. Other identifiers are lowercased.
The exported `normaliseHandle(handle, channel?)` and `hashHandle(handle, salt, channel?)`
helpers accept `"matrix"` or `"matrix_bot"` to preserve case. URI recognition applies
with or without a channel; no URI component canonicalization beyond the scheme is applied.
No provider-specific alias folding is applied. Resource ids hash the registry id with
an `account-id\0` domain prefix, preserving resources across handle/provider corrections.
Keep the salt stable across imports. Raw handles stay in the daemon's private input.

The importer corrects ODI email accounts to `google_workspace` (Teams stays Microsoft),
preserves explicit identity/provider conflicts, and adds a Telegram bot control account
when no Telegram account exists. Personal Telegram/MTProto remains deferred. Conflict
notes match complete identifiers with the channel's normalization rules; an
identifier that only contains another account's handle does not mark that account conflicted.
Active notes use `Identity conflict: <identity> versus <identity>`, optionally followed
by `. Unresolved.`; the legacy `Main Gmail identity conflict:` prefix is also accepted.
Other prose, including negated or resolved notes, does not create a conflict. Each operand
must be one complete identifier, optionally enclosed in quotes, parentheses or angle brackets.
Operands are parsed before identity matching, preserving semicolons, commas and parentheses
inside bare URIs. Bare URI operands retain terminal punctuation; use quotes or angle brackets
when sentence punctuation follows a URI. Delimiters preserve the entire enclosed identity.
Every parsed conflict operand is private even when its channel cannot be inferred.
Explicit email, Matrix, international phone and HTTP(S)/DID/mailto/tel URI alternatives
are retained as hashes even when absent from accounts and evidence.
Registry `connected` claims map to `setup-required`; errors and disabled states remain visible.
Read, triage, draft and send restrictions start false. Re-import validates the stored account
through `@jeswr/agent-model`, refreshes registry-controlled inventory, and preserves the
owner's restrictions, label and binding state. Malformed stored accounts abort the import.
Unchanged inventory and owner settings retain their existing bytes and ETag, including
when Turtle formatting differs. Removed registry rows are not deleted automatically.

Account RDF is emitted through agent-model's mappings. The account's optional scalar
`channelHandleHash` and `credentialRef` use the first sorted hash/reference; unconfigured
accounts omit the primary handle. The shared `inventory` object retains all hashed handles,
credential references, setup status, observation/test dates, historic evidence and conflicts.
Lists use the shared RDF sequence mapping rather than multivalued scalar predicates.

`StorageClient` in `src/ports.ts` is a local seam pending SDK storage-client integration.
Its ACL setter **replaces** grants with owner-only Read/Write/Control and must persist
the ACL even for an account that has no content yet. The accounts-container ACL is set
first, then each account ACL before content. Conditional creates/updates use `ifNoneMatch`
or the read ETag; read/ACL/write failures abort. A batch can be partially imported when a
later storage operation fails; re-running safely resumes it. Re-import uses stable URLs,
replaces RDF rather than appending, and skips semantically unchanged accounts.

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
