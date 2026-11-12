---
name: solid-journal
description: Use when reading or writing private journal entries through @jeswr/solid-journal, maintaining its generated model, privacy provisioning, photo storage or journal statistics.
---
<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->

# Solid journal model

`journal:Entry` (`https://jeswr.org/ns/journal#Entry`) is a schema:CreativeWork.
Its fields, requiredness and mood enum come from `codegen/journal.ontology.ttl`,
`codegen/journal.shapes.ttl` and `codegen.config.json`. `src/model.ts` is the thin
validation facade over `src/generated/model.js`; never edit generated output.
Change the inputs, run `pnpm run codegen --update-lock`, then run the byte drift test.
The README documents the health/social vocabulary comparison and profile narrowings.
`validateEntry` reports invalid moods and image links instead of silently dropping them.
`serializeEntry` adds `http://schema.org/CreativeWork` through the generated typed `types`
accessor because codegen has no extra-write-type configuration. Keep accepting legacy
entries typed only `journal:Entry`; `entryEntity` remains the unmodified generated API.

`openJournal` discovers Solid storage; `createJournalStore` accepts injected public SDK
interfaces. Entries are individual Turtle documents with a `#it` subject. Preserve
server-returned URLs and use the ETag the user edited from for save/delete. A tab may
advance that validator only through its own confirmed write chain. Surface 412 conflicts
and keep drafts until the user explicitly overwrites or discards them.
`read(url)` verifies privacy and returns one entry with its ETag, independently of other
entries. Use it for explicit overwrite and missing-validator recovery; a normal retry
with an observed ETag must retain that validator. A conflicted create may be explicitly
replaced with a fresh create by supplying a new input object.

Privacy is fail-closed and WAC-only. `protectJournal` checks the complete policy as well
as projected roles, because partial grants can disappear from role projections. Setup
seals absent own ACLs automatically only when effective inherited defaults are owner-only;
new folders and the explicit `makePrivate` action may seal broader inheritance. Every
seal uses `setGrants` with `ownOnly` and the observed snapshot, then verifies it. Do not
edit ancestor ACLs or widen permissions. Unsupported/unreadable policies remain errors.
Revoked WAC authorisations with no principals are inert and may remain in the ACL;
privacy checks still require active owner-only grants. Differing folder/member scopes
are refused with a message directing the user to review both scopes in Drive.

Listing verifies the folder once and loads at most six entries concurrently. Per-entry
HEAD/advertised ACL checks catch overrides before reading bodies. `onPrivacySkip` reports
excluded entries; without it listing throws rather than silently returning an incomplete
export. Photos use authenticated blob reads and the same privacy checks.

`src/statistics.ts` owns pure streak, calendar-day, anniversary, excerpt, word-count and
Markdown export logic. Calendar functions take an IANA time zone (UTC by default).

From the workspace root (Node 24):

```sh
pnpm exec turbo run lint build typecheck test --filter=@jeswr/solid-journal
node scripts/check-codegen.mjs
```
