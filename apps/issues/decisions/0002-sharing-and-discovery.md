# 0002 — Milestone 2: sharing & cross-pod discovery

**Status:** accepted · **Date:** 2026-06-09

## Decisions

### Sharing via Web Access Control, ACP at the edge
Collaborator access is managed through `@solid/object`'s `AclResource` /
`Authorization` (`src/lib/sharing.ts`). On every change we **rebuild a canonical
ACL** — owner authorization (Read/Write/Control) plus one authorization per
collaborator — rather than mutating an unknown existing structure. This is
fail-closed: the owner can never be locked out (AGENTS.md §Access control).

Servers using **ACP** (`.acr`, e.g. Inrupt ESS) are supported by translating at
the edge: read via `acpToWac`, write by building WAC then `wacToAcp`. The server
language is detected from the ACL document (`acp:AccessControlResource`). Verified
end-to-end on **WAC** (local CSS); the ACP branch is compile-checked and uses the
published converters.

### Whole-tracker sharing (not per-issue)
The single-document model (decision 0001) means sharing grants access to the
whole `issues.ttl`. Per-issue sharing would require the per-issue-document layout
(solid-scale-and-sharding); deferred. The app shares the tracker as a unit — a
"team tracker", which matches the `wf:Tracker` model.

### Discovery via the public type index, with a conventional fallback
On login the app registers the tracker in the user's **public type index**
(`solid:publicTypeIndex` → `wf:Tracker` → issues doc), creating and linking the
index when absent, and **granting it public read** (CSS makes new resources
owner-only, which would otherwise make the "public" index undiscoverable).
`resolveTracker(webId)` tries the type index first, then falls back to the
conventional path under `pim:storage` — so opening another person's tracker works
even if their index is missing or unreadable.

### Read-only detection
`IssuesDocument` reads the `WAC-Allow` header to expose `canWrite`; the UI hides
create/edit/close/delete and shows a "Read-only" badge when the signed-in user
only has read access (e.g. a tracker shared view-only).

## Still deferred (future)
Priority/labels (`wf:issueCategory`), comments (`wf:message`), per-issue ACLs,
assignee **groups** (`vcard:Group`), and a published SHACL shape.
