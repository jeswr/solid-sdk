<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/mcp-connections

Private, security-critical, browser-safe helpers for MCP pod layout and read-only personal-data
audit views. This S1 skeleton has no connection record, consent, revoke, or grant APIs.
The later record slice will generate its model with federation-codegen; `MCP` currently exports
only the namespace `https://jeswr.org/ns/mcp#`.

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
first with canonical UTC `at` timestamps. Rows with a malformed or ambiguous date are dropped.
A row whose client is missing, ambiguous, non-HTTP(S) (for example a URN) or credential-bearing is
kept without `client`, so the audit view never under-reports; show it as an unrecognised assistant.

`PersonalDataRead` exposes `at`, optional `client`, optional `tool`, optional `purpose`, `categories`,
optional `decision` (`permit`, `confirm-required`, `prohibited`, `refuse-all`), optional
`resourceCount`, and `source` (`monthly` or `chain`). Monthly rows read only PROV Activity / wasAssociatedWith / startedAtTime,
DPV hasPurpose / hasPersonalData, optional mcp:tool / mcp:decision literals and prov:used IRIs.
Resource URLs become a count; unknown predicates and literal personal values are never projected.
The existing MCP writer currently emits client, date, purpose and categories only. Chain source
implementation is deferred to MCP-A1c.

The MCP writer records only special-category and Financial reads, so this is a view of sensitive
reads, not of every personal read. Until S2's connection records and revoke land, an owner
disconnects an assistant in the assistant's own connector settings, and the server operator revokes
its grant. In single-user MCP mode the operator revokes access by rotating `MCP_ACCESS_TOKEN`.

Run `pnpm --filter @jeswr/mcp-connections run lint`, `build`, `typecheck`, and `test`.
Tests enforce 100% statement, branch, function and line coverage. MIT licensed.

`PERSONAL_DATA_CATEGORY_LABELS` and `personalDataCategoryLabel(iri)` provide readable labels
for every special category from `@jeswr/pkg-memory/categories`, Financial, and common
personal-data categories. Unknown IRIs return "Other personal data"; the special inventory
is imported rather than duplicated. This import remains browser-safe.
Tool metadata is projected only when it matches `^[A-Za-z0-9_.-]{1,64}$`; invalid,
ambiguous and non-literal values are omitted. `confirm-required` is also an accepted decision.
A parity test checks that the audit container is the `audit/` sibling of NanopubStore's
`mcp/` container, as used by the MCP writer.
