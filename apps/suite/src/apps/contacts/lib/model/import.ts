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

/** Completed contact ids let callers reconcile an interrupted multi-card import. */
export class VcardImportError extends Error {
  constructor(
    readonly imported: readonly string[],
    cause: unknown,
  ) {
    super("Some vCards were imported; reload before retrying.", { cause });
    this.name = "VcardImportError";
  }
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
  try {
    for (const contact of contacts) ids.push(await model.createContact(book, contact));
  } catch (error) {
    if (ids.length) throw new VcardImportError(ids, error);
    throw error;
  }
  return ids;
}
