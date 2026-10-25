// AUTHORED-BY Codex GPT-6.1-Sol
import { findComponents, parseComponents, vcardToContact } from "@jeswr/solid-dav-bridge";
import type { AddressBookData } from "@jeswr/solid-task-model/contacts";
import type { ContactsModel } from "./book";
import { validateContact } from "./data";
import type { Snapshot } from "./transport";

/** Preview vCard files or already fetched CardDAV exports through the existing DAV mapper. */
export function parseVcards(text: string) {
  return findComponents(parseComponents(text), "VCARD").map((card) => vcardToContact(card).data);
}

/** Validate the whole batch first; each create updates the latest people index with If-Match. */
export async function importVcards(
  model: ContactsModel,
  book: Snapshot<AddressBookData>,
  text: string,
) {
  const contacts = parseVcards(text);
  for (const contact of contacts) validateContact(contact);
  const ids: string[] = [];
  for (const contact of contacts) ids.push(await model.createContact(book, contact));
  return ids;
}
