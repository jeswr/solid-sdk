<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/mcp-connections

Private, security-critical, browser-safe helpers for MCP pod layout and read-only personal-data
audit views and generated connection records. `MCP` exports the namespace
`https://jeswr.org/ns/mcp#`. This package performs no network I/O and holds no grant authority.

`connectionsContainer(storage)`, `auditContainer(storage)`, and `auditChainContainer(storage)`
return `private/pkg/clients/`, `private/pkg/audit/`, and `private/pkg/audit-chain/` below a canonical
HTTP(S) storage URL ending in `/`. Credentials, query, fragment and noncanonical storage URLs
throw `Invalid storage container`.

```ts
import { monthlyAuditSource } from "@jeswr/mcp-connections";
const rows = await monthlyAuditSource.list(read, storage, 100);
```

`AuditSource.list(read, storage, limit)` receives an injected `AuditRead` returning
`{ text, contentType }`. The package performs no network I/O or writes and keeps no cache.
The caller must use its owner session, refuse redirects, bound reads to 256 KiB, and enforce a
timeout. Missing reads throw an object with numeric `status`; only a missing listing (404/410)
is empty. Missing files, malformed RDF, failed reads and exceeded bounds reject the whole view
with the fixed, cause-free error `Personal data reads unavailable`.

The monthly source uses ldp-container for scoped membership, accepts only direct child names
matching `^\d{4}-\d{2}\.ttl$` without query/fragment, and reads the newest three names. Parsing
uses fetch-rdf with 256 KiB and 10,000-quad caps per document (including the listing); remote
JSON-LD contexts are refused. Conservatively, at most 500 activities **across all selected files**
are accepted, including invalid activities. `limit` is an integer from 0 to 500. Results are newest
first with canonical UTC `at` timestamps; malformed dates, ambiguous client/date fields, and
non-HTTP(S) or credential-bearing clients are dropped.

`PersonalDataRead` exposes `at`, `client`, optional `tool`, optional `purpose`, `categories`,
optional `decision` (`permit`, `prohibited`, `refuse-all`), optional `resourceCount`, and `source`
(`monthly` or `chain`). Monthly rows read only PROV Activity / wasAssociatedWith / startedAtTime,
DPV hasPurpose / hasPersonalData, optional mcp:tool / mcp:decision literals and prov:used IRIs.
Resource URLs become a count; unknown predicates and literal personal values are never projected.
The existing MCP writer currently emits client, date, purpose and categories only. Chain source
implementation is deferred to MCP-A1c.

In single-user MCP mode there are no connection records. Revoke access by rotating
`MCP_ACCESS_TOKEN` on the server.

Run `pnpm --filter @jeswr/mcp-connections run lint`, `build`, `typecheck`, and `test`.
Tests enforce 100% statement, branch, function and line coverage. MIT licensed.

## Connection records (MCP-A1 S2b)

`codegen/connections.ttl`, `codegen/connections.shacl.ttl` and `codegen.config.json` generate
`src/generated/` through `pnpm run codegen`. The generated model supplies all field accessors.
The facade additionally requires one exact document subject, the explicit ClientConnection type,
default graph, valid optional fields and strict cardinalities. Invalid optional fields reject the
whole record, especially revokedAt. The title limit is 256 Unicode code points; it is enforced by
the facade because generator admission currently refuses sh:maxLength. The codegen profile
explicitly records that omission. This package has no sector profile to narrow.

`ConnectionRecord` contains required resource/client IRIs, access (mcp:ReadOnly/ReadWrite),
personalDataMode (mcp:OwnerPolicy/Mandate/NoPersonalData), created/expiresAt Dates; optional title,
redirectOrigin (an HTTP(S) origin URL with `/`), scope, purpose IRIs (`purposes`), lastUsed Date
and revokedAt Date. Dates serialize as xsd:dateTime; lastUsed serializes as a UTC xsd:date.
Writes require safe canonical HTTP(S) resource/client/origin values; origins include `/`.
Resource/client identities match exactly without URL normalization on read.

- `await connectionRecordUrl(storage, resource, grantId)` uses browser crypto.subtle SHA-256 of
  `"mcp-connection\0" + resource + "\0" + grantId`; its first 32 hex digits name a `.ttl` file
  in `private/pkg/clients/`. Call only with a trusted storage root, configured resource and verified
  grant ID. The grant ID is never written into the record.
- `buildConnectionRecord(url, data): string` writes through the generated model and n3.Writer;
  invalid supplied fields throw instead of silently dropping. `parseConnectionRecord(text,
  contentType, url): Promise<ConnectionRecord>` rejects malformed, missing or ambiguous fields,
  another subject, named graphs, remote JSON-LD contexts, over 64 KiB or over 4096 quads.
- `revokeConnectionRecord(text, contentType, url, at)` returns Turtle keeping the earliest
  revokedAt; `touchLastUsed(..., at)` updates its UTC day. Both return Promises, preserve unknown
  metadata on the subject, and perform no I/O. Persist edits with a strong If-Match validator.
- `classifyConnection(status, recordOrParseError, {resource, client})` returns live only for an
  HTTP 200 parsed matching record without revokedAt; gone (404/410), malformed, revoked and
  mismatched records return revoked. All other statuses, including redirects/401/403/5xx and
  transport status 0, return unavailable. The caller must irrevocably retire a verified grant on
  revoked and respond with 503 / Retry-After: 5 on unavailable, preserving that grant.

Records can only deny. The vault remains authoritative, and restoring a record cannot revive a
retired grant. There is no positive cache or migration: a missing record denies the first request.
