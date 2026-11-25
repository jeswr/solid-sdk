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

Privacy is fail-closed and decided only by the shared `checkOwnerOnly` from
`@jeswr/pod-access` (there is no Journal-specific verifier): it reads the raw effective WAC
or ACP policy, own document then every ancestor, and refuses untyped WAC rules, non-canonical
targets, unrepresentable modes, a looser inherited parent ACL, and any transport or discovery
doubt. ACP pods work when the caller supplies a trusted `acpDialect` ("css" or "ess", from
deployment configuration; `openJournal(..., { acpDialect })` or the `createJournalStore`
options argument); without it an ACP pod fails closed. LWS is refused.

Only two situations write an access document: a folder `initialize()` just created, and the
user's explicit `makePrivate()` repair. Every other call (reopening, `list`, `read`, `save`,
`remove`, photos) only verifies, never seals, and never inherits what the verifier refused.
A folder that already exists and is shared surfaces `JournalPrivacyError.canMakePrivate`
(only when every finding is a non-owner grant); anything unverifiable is `canMakePrivate:
false`. Sealing uses `readGrants`/`setGrants` with `ownOnly` and the observed snapshot (no
pinned access model) and is never taken as proof: the result is verified again with
`checkOwnerOnly`. Do not edit ancestor ACLs or widen permissions. Known limitation: the role
writer can leave an inert principal-less authorisation after replacing a shared rule, which
the strict verifier refuses, so such a repair fails closed ("Couldn't verify private journal
access") until pod-access cleans it up. Differing folder/member scopes are refused with a
message directing the user to review both scopes in Drive.

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
