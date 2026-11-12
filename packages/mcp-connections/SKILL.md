---
name: mcp-connections
description: Use when locating MCP connections or audit containers, implementing an AuditSource, or showing personal-data reads in the suite.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Read README.md for the record and audit contracts. Keep this private securityCritical package browser-safe,
with injected reads, no network I/O, no cache and no third-party additions.
Use the three layout helpers only with a trusted canonical storage root ending in `/`.
Keep all locations below the protected `private/pkg/` personal-data root.

Use monthlyAuditSource through AuditSource.list(read, storage, limit). The read seam must use
the owner's scoped session, refuse redirects and cap transport bytes/time before returning text.
Only listing 404/410 means empty. Fail the entire view with fixed text for errors or budget
violations, without backend causes/URLs. Never treat unreadable data as a successful empty view.
Read membership with ldp-container, parse with fetch-rdf and project fields with @rdfjs/wrapper.
Accept the newest three direct monthly files, at most 256 KiB / 10,000 quads each and at most
500 activities in total. Drop invalid date/client rows. Return only PersonalDataRead's whitelist,
never values from unknown predicates or resource URLs. Keep newest-first ordering and row limits.

For S2b, regenerate records from codegen/ + codegen.config.json, never edit src/generated.
Use buildConnectionRecord/parseConnectionRecord/revokeConnectionRecord/touchLastUsed; RDF fields
come from the generated wrapper. Strictly reject invalid optional fields, wrong subjects, missing
type, ambiguous cardinalities and over 64 KiB. Enforce title <=256 in the facade: sh:maxLength
is not admitted by this generator, explicitly documented in the profile and README. Preserve
unknown metadata during edits and keep the earliest revokedAt. Use only trusted inputs to mint
the hashed record URL. classifyConnection never grants authority: only a parsed matching 200
without revokedAt is live. Only verified token/grant identities may select irreversible vault
revocation; transport failures are unavailable, never proof of revocation. PodChain implementation is MCP-A1c. Single-user revoke means rotating MCP_ACCESS_TOKEN.
Update this skill and README for public changes and maintain exhaustive 100% coverage.

Use the exported PERSONAL_DATA_CATEGORY_LABELS / personalDataCategoryLabel for category
copy. Their special-category inventory comes from pkg-memory's browser-safe /categories
entry, with Financial added separately. Never import pkg-memory's Node-dependent root
into browser source. Tool names must match ^[A-Za-z0-9_.-]{1,64}$ or be dropped.
Project only the four decisions permit, confirm-required, prohibited and refuse-all.
Keep the audit layout parity test against NanopubStore's sibling audit container.
