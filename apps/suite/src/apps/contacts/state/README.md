<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# Contacts hooks

`ContactsProvider` belongs below `PodSessionProvider`; the Contacts layout already supplies both.

- `useAddressBook()` exposes `status`, `book`, `data`, `saving`, `retry()` and `createAddressBook()`.
  A ready state with `book === null` is first use; unreadable documents are errors.
- `useContacts()` adds projected `contacts`, alphabetical `sections` and `labels(contactId)`.
- `useContact(ref)` adds the person's `contact` snapshot. Invalid or missing references yield no contact.
- `useGroups()` returns group snapshots. Group IDs and contact IDs include `#this`.
- `useContactMutations()` returns the controller. `create(data)` resolves to the new contact ID;
  `update(id, patch)` preserves omitted fields and clears optional fields explicitly set to
  `undefined`. `delete(id)` removes the contact and memberships and returns a serialized
  `DeleteToken` captured inside the write queue, after earlier edits settle. `undo(token)`
  restores that confirmed RDF and its memberships. `restore(snapshot, labelIds)`
  re-creates its original document and surviving memberships.
- Labels use `createLabel(name)`, `renameLabel(id, name)`, `deleteLabel(id)` and
  `setLabel(contactId, labelId, add)`. `migrate()` returns `{ moved, failed }`.
- `useStarred()` supplies the WebID-scoped `stars` set and `toggle(id)`.
- `useDuplicates()` returns likely duplicate `groups` (from `merge.ts`: the dedupe library's
  email/phone/WebID clusters, split at pairs the user dismissed) and `dismiss(contactIds)`, which
  remembers every pair of that group per WebID in localStorage, like stars.
- `merge(primaryId, duplicateIds, selection)` keeps the primary document and UID. `selection`
  names the kept name, organisation, note and WebID; an omitted field keeps the primary's value,
  else a copy's. Emails and phones are unioned by normalised value and labels are unioned.

Mutation promises reject on failure. The controller already reports errors and reconciles the
server's state, including partial writes and conflicts. Callers can catch a rejected promise
without displaying a duplicate error. Shared-index writes are queued in intent order; the
visible state applies every pending intention over the confirmed baseline.

Contact creation, deletion, Undo, migration, merge and book creation use the same intent journal.
Before writing, it stores an operation in localStorage under the WebID, normalized book document
URL and operation ID. Each record retains its destinations, confirmed steps and any attempted
step, full serialized person RDF and delete memberships, or original migration source and ETag.
Every mount and refresh recovers pending operations before publishing ready. Web Locks serialize
cooperating tabs, while conditional writes protect against other clients. Storage exceptions fall
back to memory across provider remounts and display a persistent warning about reload durability.

Recovery adopts the expected destination UID (or identical RDF for older contacts without one),
merges fresh indexes and memberships, and
treats a missing DELETE target as success. Failed deletes repair completed or uncertain link
removals if the person survives; confirmed absence offers Undo using the actual pre-delete RDF.
Undo uses `If-None-Match: *`, preserving UID, extra properties and contact-point metadata.
Pending migration records keep the destination and original source ETag across reloads, so
retries create no duplicate and cannot delete a concurrently edited source. Records are removed
only after completion or rollback; an unfinished recovery exposes the normal Retry error state.

A merge journals the merged primary RDF (with the primary's reviewed ETag) and each duplicate's
RDF, ETag and labels. Replay writes the primary, its index name and added labels, then removes each
duplicate's labels, index entry and document (`If-Match`). A conflict releases the intent before
any later step: a concurrently edited primary leaves everything unchanged, and a surviving
duplicate gets back the links already removed, so no contact data is lost. There is no Undo; the
review asks for confirmation instead.

Book creation resumes completed empty indexes. A missing private Type Index is created and linked
through preferences using conditional writes; unreadable documents are never treated as missing.

The list projection flattens control characters in display text and omits unsupported email/phone
values. Supported phone extensions contribute their base number to list search; details keep the
original values. Phone display uses the same formatter in the list and detail.

Routes use `encodeContactRef(book.url, contactId)` and `decodeContactRef(book.url, ref)` from
`data.ts`. These references contain only canonical document paths inside the book container.

The default demo contains 40 contacts, including three deliberate duplicate pairs. Development
builds with `NEXT_PUBLIC_DEV_FIXTURES=1` can initialize a fresh demo pod at `/contacts?seed=contacts-200`, `contacts-empty`, or
`contacts-no-book`. Existing IndexedDB contents are preserved; fixtures apply only to a fresh pod.
