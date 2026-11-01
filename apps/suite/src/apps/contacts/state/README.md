<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Contacts hooks

`ContactsProvider` belongs below `PodSessionProvider`; the Contacts layout already supplies both.

- `useAddressBook()` exposes `status`, `book`, `data`, `saving`, `retry()` and `createAddressBook()`.
  A ready state with `book === null` is first use; unreadable documents are errors.
- `useContacts()` adds projected `contacts`, alphabetical `sections` and `labels(contactId)`.
- `useContact(ref)` adds the person's `contact` snapshot. Invalid or missing references yield no contact.
- `useGroups()` returns group snapshots. Group IDs and contact IDs include `#this`.
- `useContactMutations()` returns the controller. `create(data)` resolves to the new contact ID;
  `update(id, patch)` preserves omitted fields and clears optional fields explicitly set to
  `undefined`. `delete(id)` removes the contact and memberships. `restore(snapshot, labelIds)`
  re-creates its original document and surviving memberships.
- Labels use `createLabel(name)`, `renameLabel(id, name)`, `deleteLabel(id)` and
  `setLabel(contactId, labelId, add)`. `migrate()` returns `{ moved, failed }`.
- `useStarred()` supplies the WebID-scoped `stars` set and `toggle(id)`.

Mutation promises reject on failure. The controller already reports errors and reconciles the
server's state, including partial writes and conflicts. Callers can catch a rejected promise
without displaying a duplicate error. Shared-index writes are queued in intent order; the
visible state applies every pending intention over the confirmed baseline.

Routes use `encodeContactRef(book.url, contactId)` and `decodeContactRef(book.url, ref)` from
`data.ts`. These references contain only canonical document paths inside the book container.

The default demo contains 40 contacts. Development builds with `NEXT_PUBLIC_DEV_FIXTURES=1`
can initialize a fresh demo pod at `/contacts?seed=contacts-200`, `contacts-empty`, or
`contacts-no-book`. Existing IndexedDB contents are preserved; fixtures apply only to a fresh pod.
