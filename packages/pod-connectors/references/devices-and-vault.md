<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# WHOOP, Garmin, VeSync, activity files and the token vault


`./adapters/whoop` exposes the Tier A OAuth adapter/factory and streaming file adapter under the single `whoop`
catalogue id. Default token exchange uses a proxy; Node hosts may inject a secret for direct exchange. Do not
assume public secretless exchange. Read `src/whoop/{adapter,file-adapter,model,vocab}.ts`, the README's WHOOP
section and `../../solid-health/SKILL.md` before changing it. Reuse the Takeout ZIP reader; keep CSV normalized-header
collision checks, explicit-offset timestamps, native-id/CSV-start reconciliation and API-over-file precedence.
Source rows and normalized records are capped independently, including duplicate and malformed rows. Stage all
source parsing before writes. One RunBudget covers every API page. Item/request exhaustion commits a bounded batch
and returns a warning plus an opaque collection/page/offset cursor; only a completed traversal returns the ISO
start cursor, which replays seven days rather than an updated-since feed. A resumed page shorter than its saved
offset replays from row 0; a 400/404 on the resumed token restarts that collection once per run with no token
(never on fresh tokens). An empty completed traversal returns `COMPLETE_CURSOR`, never no cursor; file cursors and
`COMPLETE_CURSOR` start a fresh API traversal. Batch cursors keep `base` (the starting high-water cursor) for
Suite's partial-scope pinning via `pendingWhoopBatch`. No `offline` scope until refresh exists. Hosts print
warnings: keep them fixed strings. File batches use content-bound host-owned cursors and select newest-first with a
bounded heap; preserve the byte caps while scanning sort keys and the row/record caps while parsing selected rows,
including duplicates and malformed rows. A finished traversal returns the distinct `before: ""` completion cursor;
the next run of that export starts afresh (never return no cursor, or the session keeps an older partial one).
Scan-time malformed records are counted only in a traversal's first batch. The CLI keeps file and API cursors in
separate state slots (`fileCursor`/`cursor`), classifying a legacy shared cursor by shape. Physiological rows
remain atomic. Never invent a recovery time when its cycle is missing.

Workouts live in monthly `health/workouts/YYYY-MM.ttl` documents with stable id fragments; their container is
registered for ExerciseAction and (via `additionalClasses`) Observation. Shards must stay within solid-health's
exported `MAX_OBSERVATION_QUADS`/`MAX_OBSERVATIONS`, including session provenance. Generated wrappers validate
their whole store: never `mark()` one on a populated shard; build in a small store and merge, like
`buildObservation`. Health observations are built only through `@jeswr/solid-health`'s `buildObservation`;
`METRICS` holds the WHOOP mapping policy and `vocab.ts` only the schema:Dataset record marker. Never add a health
accessor class. A unit outside the profile's QUDT inventory carries UCUM only; a missing subtype or datatype is a
profile gap to report, not to hand-write around. HRV is RMSSD, not SDNN. Sleep stage totals are generic
observations so total sleep is counted once. Workouts retain ExerciseAction. Recovery score, strain and sleep
performance have no sector term: omit them and surface them through ImportOutcome/ImportReport.unsupported (now
supported for API adapters too). Keep journal entries unsupported. See the README for current Health UI, container
discovery and cross-month timestamp-correction limitations. Tests are synthetic only; never call WHOOP or add
dependencies. Preserve byte/row/record/quad caps and cancellation.

Garmin's `garmin` file adapter accepts full account ZIPs. Read `src/garmin/archive.ts`, `health-vocab.ts` and
[README's Garmin contract and maintenance constraints](../README.md#garmin-account-export) before changing it;
preserve its shared Takeout/file-json readers, limits, staging, ETag merges and existing sector vocabulary.
`createGarminFileAdapter` may only lower `GARMIN_ARCHIVE_LIMITS`. Keep the README candid about connector
chart-discovery gaps.

<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
VeSync is a CLI-only Tier B account adapter (`src/vesync/`), not OAuth. Read the
README's "Connect your Levoit purifiers" section and `src/node/vesync-auth.ts` before
changing its protocol. The Node-only credential reader accepts only VESYNC_EMAIL /
VESYNC_PASSWORD, consumed once, deleted
from the process environment, password immediately MD5-hashed. Hidden prompts never
echo. No credentials, hashes, account IDs or tokens enter reports, errors, pod RDF or
state. Keep Node auth out of browser entry points and keep all source exceptions
sanitized. Only fixed HTTPS login/list/status routes are allowed; never forward
redirects, arbitrary methods, source URLs or caller headers with credentials.

Read status keys per pyvesync family (Core snake_case with `level`, Vital camelCase, LV-PUR131S top-level and
uuid-addressed; no Core 200S air readings) and treat only an explicit login rejection as an authentication failure;
transport faults stay retryable. Use solid-environment builders and path helpers. Derive sensor slugs as an
HMAC-SHA-256 of cid/uuid keyed by the connector's `environment/` container URL (stable per pod, unlinkable across
pods); never persist raw identifiers in IRIs. Preserve per-sensor UTC day appends, minute identities, room/purifier
feature distinctions, bounded numeric readings, and default model limits including malformed roots. VeSync
documents set `requirePrecondition`: the shared session must reject existing resources without strong ETags. Do not
advance checkpoints after source/Pod failures. Log and count capped-day skips. The adapter opts into a 32-activity
provenance history cap; other adapters retain their existing history semantics. Watch mode rereads protected state
each cycle, serializes imports, backs off with jitter, and classifies failures by cause with
`classifyVeSyncFailure` (`src/node/vesync-failure.ts`): transient source/network/Pod 5xx-408-412-429 and transient
`StateStoreError`s retry; VeSync login rejection, Pod 401/403 and other 4xx, `PreconditionUnsupportedError` (weak
ETags), structural state problems and config stop. Hidden prompts enter raw mode before the label and always pause
stdin afterwards. Any unexpected non-zero data code clears the VeSync session so the next cycle logs in again. Keep
catalogue `cliOnly` / `cli-only` visible without approval flags and show terminal instructions instead of an OAuth
flow. Test synthetic shapes only, with no provider traffic, including password safety, re-login bounds, source
budgets and aborts.

CON-A6 adds Tier C `activity-files` (`./adapters/activity-files`): content-detected GPX/TCX/FIT and mixed ZIPs
through the existing Takeout reader. Read `src/activity-files/{file-adapter,model,xml,fit,mapping,vocab}.ts` before
changing it. Keep the independent synthetic FIT encoder in `test/activity-fixtures.ts` test-only. Never add
provider calls or dependencies. XML uses bounded `mini-xml.xmlEvents`, not the legacy whole-string block extractor;
reject DTDs and structural errors. FIT checks header/file CRC and every definition/data boundary, handles
compressed 32-second rollover and skips developer fields by declared size. Unknown fields/messages must preserve
alignment. Decode every declared field in order for normal and compressed headers alike; never require field 253. A
compressed header's offset (against the previous timestamp) wins over any decoded field 253, which is not a base.
File bytes, archive inflation, activities, parser messages, records and total points all have hard caps; factory
options can only lower them. Return fixed diagnostic codes through FileImportOutcome/ImportReport `warnings`. XML
scanning charges one message per 512 characters; at most 200,000 track samples stay retained per file. finish()
drops durations outside 1 s to 7 days with the end time and marks out-of-range (1970 to 2100) start/end invalid;
durations use at most 3 fixed decimals. TCX elapsed time is the trackpoint span, else lap start times; never the
timer sum. One activity's mapping failure is a skip; Pod port failures and cancellation fail the run. Store each
file's original lazily (memoised once per file) after an activity's skip and cap checks, so nothing is stored
unlinked. Origin IRIs are hash-only; the file name is only the original's `schema:name` (256 characters) plus hash
`schema:identifier`, on the origin IRI when the bytes exceed the binary cap. TCX trackpoint times may be unordered:
start is the earliest point (or `<Id>` if earlier) and end is exactly the latest point. Keep tracks at most 2,000
samples, preserve the capped original, and never match a truncated activity against a complete one. Use elapsed
duration and normalized sport for the two-second cross-export dedup check; retain the original anchor to avoid
drift. Dedup lookup is five bounded second buckets, at most 32 entries each, with confined activity targets. Source
histories also cap at 32. Files are add/update imports with no deletion snapshot or cursor. Conditional writes,
cancellation, run provenance and failed-state retention remain shared runner responsibilities.

CON-A1 exposes `./vault`: ConnectorTokenVault, key helpers, MemoryVaultStore and IndexedDbVaultStore. Keep it
browser-safe and independent of mcp-oauth. Only `./node` exports FileVaultStore. Read the README's encrypted
refresh vault contract before changes. Use WebCrypto AES-256-GCM, fresh 96-bit IVs, canonical `[1, connectorId,
account]` AAD and strict version/base64url parsing. Never expose underlying errors/causes, tokens or key bytes.
Preserve record, metadata, depth, node, ciphertext and store/list caps. Validate before stringifying untrusted
input; project plain data without invoking custom getters/toJSON. Unknown record fields and credential-shaped
metadata are refused. Files require private owner-held directories/files, no symlinks/hardlinks, bounded descriptor
reads, exclusive temp + fsync + rename + directory fsync. IndexedDB elects/stores its non-extractable key
transactionally alongside ciphertexts; wait for commit. That key is usable by a copied profile or same-origin
script (non-extractable only blocks export); getOrCreateKey({ passphrase }) stores only a PBKDF2-SHA-256 (600,000
iterations, 16-byte salt) AES-GCM-wrapped key, never mixes modes, and fails generically on a wrong passphrase. The
vault constructor refuses extractable keys. Tests use a minimal structured-cloning IDB fake without dependencies.

OAuth exchange/refresh accepts `{ vault, account, signal? }`; persist rotation before returning access tokens.
`getOAuthToken` restores on later runs; `createOAuthSourceAuth` shares refresh and retries a GET once. Token
requests never use the caller's signal: run them on a private controller with TOKEN_REQUEST_TIMEOUT_MS (30 s); a
pre-send abort prevents sending, a later one is honored with a generic AbortError only after the response is
validated and persisted (the CLI exempts token/revocation URLs from its signal merge). A code exchange without a
refresh token deletes the account's record. Disconnect best-effort revokes stored and session refresh tokens at an
RFC 7009 `revocationEndpoint` (Google declares one; others are manual), ignoring failures, before deleting locally.
Accept string scope or string-array scope normalized with join(" "); drop other scope types. Token
endpoints/proxies require HTTPS except HTTP on localhost, 127.0.0.1 or [::1] for development. Request JSON
(including GitHub); form token responses are unsupported. Spotify's legacy factory refuses a vault; vault hosts use
createOAuthSourceAuth.

Hold optional VaultStore/ConnectorTokenVault.withLock across reread + refresh + put/delete. Use the newest saved
credential; on invalid_grant compare before deletion and retry once with a newer credential, never loop. Current
invalid grants raise typed reauthorise; other failures retain records. Unreadable refresh records raise
UnreadableCredentialError (reason reauthorise), but fresh code exchange may replace them without decrypting the
previous ciphertext; the interactive CLI falls through to loopback login, interactiveLogin false exits 3. With a
vault a missing record means disconnected: an in-memory refresh token raises reauthorise; only vault-less sessions
fall back to it. Disconnect waits for its in-flight refresh then deletes under the account lock. Memory uses a
bounded per-key mutex; IndexedDB uses navigator.locks or a shared in-process fallback. Clear the IDB handle on
versionchange. Custom stores without locks require host serialization.

File stores canonicalize ancestor aliases once at construction, check the real path and refuse
final-directory/record symlinks. Windows construction throws the POSIX requirement. get/put refuse unsafe records;
list skips them; delete unlinks any current-uid regular record file regardless of mode, never a symlink or
foreign-owned file. Per-record O_EXCL 0600 locks break after 60 seconds by mtime, renew while active, wait at most
65 seconds and always release in finally. Stale takeover renames to `<lock>.<uuid>.stale`, unlinks only on a
dev+ino match, otherwise restores via link() (EEXIST: leave it to age out) and retries. Unlink a new lock failing
its safety check (dev+ino verified). Release failure never masks the callback outcome. Clean only own-pattern
regular current-uid temps and claimed `.stale` locks older than ten minutes at construction and before list/put
budgets; exclude them from the name budget and retain a separate bounded scan. CLI --vault without
CONNECTOR_VAULT_KEY exits 2 naming the variable; a key alone warns on stderr and continues in memory.
connectors[id].account defaults to default. Use fixtures for hostile/error paths and assert secret-free errors.
Deferred snapshot/contacts reconciliation shares one run budget: 1,000,000 retained
identifiers and 64 MiB of UTF-8 identifier text (also charge retained contact names).
Check each unique subject before retaining it, without first materializing all quad subjects.
On overflow, mark that product incomplete, report `reconciliation-state-cap-exceeded`,
release its manifests and continue adds/updates only; other products still reconcile.
Validate calendar BEGIN/END names with a stack (VCALENDAR > VEVENT, other components
balanced and skipped); reject nested vCards and missing/mismatched END markers as entry
parse failures. Charge actual inflater output before any size/CRC/boundary rejection,
including failed entries and mailbox-header sniffing, against one shared 16 GiB budget.
Exhaustion stops the archive with an error before deferred destructive reconciliation.
Any fflate decoder exception also aborts the archive, including during mailbox-header
sniffing: it may have produced internal bytes without invoking the accounting callback.
Size/CRC/boundary failures detected by our own checks still skip the entry.
Only an activitySegment object is a recognized non-visit location row; malformed
placeVisit values (including missing/invalid location or duration) and all other row
shapes count as skips and make location incomplete. Contacts use an independent
run-level row counter, including duplicate cards, across retained and capped paths;
manifest release never resets the counter. Excess rows skip before any Pod writes.
