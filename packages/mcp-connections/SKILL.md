---
name: mcp-connections
description: Use when locating MCP connections or audit containers, implementing an AuditSource, or showing personal-data reads in the suite.
---
<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

Read README.md for the S1 contract. Keep this private securityCritical package browser-safe,
with injected reads, no network I/O, no writes, no cache and no third-party additions.
Use the three layout helpers only with a trusted canonical storage root ending in `/`.
Keep all locations below the protected `private/pkg/` personal-data root.

Use monthlyAuditSource through AuditSource.list(read, storage, limit). The read seam must use
the owner's scoped session, refuse redirects and cap transport bytes/time before returning text.
Only listing 404/410 means empty. Fail the entire view with fixed text for errors or budget
violations, without backend causes/URLs. Never treat unreadable data as a successful empty view.
Read membership with ldp-container, parse with fetch-rdf and project fields with @rdfjs/wrapper.
Accept the newest three direct monthly files, at most 256 KiB / 10,000 quads each and at most
500 activities in total. Drop invalid-date rows; keep rows with a missing, ambiguous or
unsafe client without `client` (never drop them, so the audit view cannot under-report). Return only PersonalDataRead's whitelist,
never values from unknown predicates or resource URLs. Keep newest-first ordering and row limits.

Connection records, generated record models and revoke are later S2 slices. Do not add them to
S1. PodChain implementation is MCP-A1c. Single-user revoke means rotating MCP_ACCESS_TOKEN.
Update this skill and README for public changes and maintain exhaustive 100% coverage.

Use the exported PERSONAL_DATA_CATEGORY_LABELS / personalDataCategoryLabel for category
copy. Their special-category inventory comes from pkg-memory's browser-safe /categories
entry, with Financial added separately. Never import pkg-memory's Node-dependent root
into browser source. Tool names must match ^[A-Za-z0-9_.-]{1,64}$ or be dropped.
Project only the four decisions permit, confirm-required, prohibited and refuse-all.
Keep the audit layout parity test against NanopubStore's sibling audit container.
