<!-- AUTHORED-BY Codex (GPT-6.1 Sol) -->
# @jeswr/solid-journal

Generated journal entries, private pod persistence and pure journal statistics. The browser-safe root exports `EntryData`, `JournalEntry`, `MOODS`, `ENTRY_CLASS`, `entryEntity`, `validateEntry`, `serializeEntry`, `openJournal`, `createJournalStore`, `validatePhoto`, `JournalPrivacyError`, `dayKey`, `daysWritten`, `calculateStreak`, `onThisDay`, `wordCount`, `markdownToPlainText`, `excerpt` and `exportMarkdown`.

`codegen/journal.ontology.ttl` and `codegen/journal.shapes.ttl` plus `codegen.config.json` are the model inputs. `pnpm run codegen` produces the committed `src/generated/` artifacts. The drift test regenerates every artifact and compares its bytes. Do not edit generated files.

The generated `Entry` class is `https://jeswr.org/ns/journal#Entry`, a subclass of `http://schema.org/CreativeWork`. Its subject is the resource URL plus `#it`. Fields are:

| Field | Property | Contract |
| --- | --- | --- |
| created | schema:dateCreated | Required xsd:dateTime |
| modified | schema:dateModified | Optional xsd:dateTime |
| title | schema:headline | Optional string |
| text | schema:articleBody | Required nonblank Markdown string |
| tags | schema:keywords | String set, trimmed, deduplicated and sorted |
| mood | journal:mood | awful, bad, okay, good or great |
| location | schema:locationCreated | Optional location-name literal |
| weather | journal:weather | Optional string |
| images | schema:image | HTTP(S) IRI set |

The health and social federation sectors do not define a personal-journal entry. `diet:mood` in the health-diary nutrition vocabulary denotes a clinical symptom concept, so it does not substitute for a journal mood rating. This package defines only Entry, mood and weather. Profile narrowings are documented in the SHACL header: the location is a literal, photos are HTTP(S) links and body text is required. All datatype, cardinality and enum accessors are generated; `src/model.ts` is a small facade that rejects invalid required data before publishing.

```ts
import { openJournal } from '@jeswr/solid-journal';
const journal = await openJournal(authenticatedFetch, storageRoot, ownerWebId);
await journal.initialize();
const entry = await journal.save({ created: new Date(), text: 'A little time to think.', mood: 'good' });
const entries = await journal.list();
await journal.save({ ...entry, text: 'A little more time to think.' }, entry);
```

`createJournalStore(storage, typeIndex, ownerWebId, authenticatedFetch)` accepts public SDK interfaces for tests. The returned store has `initialize`, `makePrivate`, `list`, `save`, `remove`, `attach` and `photo`, with its authoritative `container` URL. Real sessions use `createPodClient` discovery. An explicit `solidFixture: true` option on `openJournal` supports injected LDP fixtures that lack storage-discovery metadata; it does not bypass access checks. It must come from trusted application configuration.

The repository creates an empty `journal/` container, installs owner-only resource and member WAC permissions through `@jeswr/pod-access/roles`, verifies the complete SDK policy and registers Entry in the **private** Type Index. An existing container without its own ACL is sealed automatically when complete inherited defaults are owner-only, allowing interrupted setup to recover. Shared containers surface `JournalPrivacyError.canMakePrivate`; an explicit `makePrivate()` choice seals only this folder using a conditional owner-only snapshot. Unreadable policies are refused. Listing verifies the container once, then loads at most six entries concurrently, checking each advertised per-entry ACL override before reading its body. A shared/unverifiable entry is skipped only when `list({ onPrivacySkip })` can report it; otherwise listing throws to avoid incomplete exports. Editing, deleting and photo reads also check privacy. No sharing API is exposed. ACP and LWS provisioning are refused until the shared SDK supplies a complete effective privacy proof. Access checks and content writes are separate HTTP operations; they cannot prevent another authorised client from changing access between them. The browser demo records ACLs but does not enforce authentication.

The Type Index SDK owns profile/preferences/index updates. As in its contract, those private index destinations must inherit owner-only access from pod provisioning. Registration never grants access to journal content. The journal's own access checks fail closed independently of discovery hints.

Each entry is one Turtle resource. Empty placeholders from interrupted creations are ignored; nonempty malformed entries fail the listing so exports never silently omit them. Edits/deletes require observed ETags and propagate conflicts. Retrying a failed new save with the same input object recovers a committed write whose response was lost, using its retained server-returned URL. Listing follows every storage page and returns newest-first data; Suite's timeline renders it incrementally. Search, statistics and export use the whole successfully loaded collection. Edits replace the entry document's generated fields; preservation of unrelated annotations is deferred.

Photos use the existing storage client and stay inside journal storage. JPG, PNG, GIF and WebP are accepted up to 10 MiB each; SVG is refused. Reads return authenticated blobs for local object URLs. Removing a reference or deleting an entry does not delete photo binaries, since another entry may refer to them. Export is a single Markdown document with entry dates, optional metadata and pod photo links; it does not embed binaries.

Statistics use explicit IANA time zones (UTC by default). Streaks count unique written days, ignore future dates and allow a current streak to end yesterday. On-this-day matches exact month/day in earlier years, including leap day. Excerpts are plain text and never executable HTML. Word counts count Unicode words, contractions and hyphenated words.

Suite's pending writes and failed drafts remain in the current tab for retry/download. They are not a durable offline outbox. Daily reminders, ZIP export, durable drafts, network pagination for large journals, photo cleanup, other access-control protocols and document-annotation preservation are follow-up work.

Agent maintenance guidance: keep complete policy checks alongside role checks, since role projections omit partial grants. Keep all access verification when adding another storage protocol. Generated files remain byte-reproducible through the drift test. See [SKILL.md](SKILL.md) for package maintenance guidance.
