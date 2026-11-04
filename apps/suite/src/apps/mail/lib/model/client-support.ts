// AUTHORED-BY Codex GPT-6.1-Sol
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  OptionalAs,
  OptionalFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { Attachment } from "./attachment";
import type { MailStore } from "./io";
import type { Message } from "./message";
import { documentOf } from "./operations";
import { SCHEMA, SOLID } from "./vocab";

/** Profile pointers stay in the model, including preference-document discovery. */
class ProfilePointers extends TermWrapper {
  get privateIndex(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SOLID}privateTypeIndex`, NamedNodeAs.string);
  }
  get preferences(): string | undefined {
    return OptionalFrom.subjectPredicate(
      this,
      "http://www.w3.org/ns/pim/space#preferencesFile",
      NamedNodeAs.string,
    );
  }
}
export async function privateMailIndex(
  store: MailStore,
  webId: string,
): Promise<string | undefined> {
  const profile = await store.load(documentOf(webId), true);
  const pointers = new ProfilePointers(webId, profile.mailbox, DataFactory);
  if (pointers.privateIndex) return pointers.privateIndex;
  if (!pointers.preferences) return undefined;
  const preferences = await store.load(pointers.preferences);
  return new ProfilePointers(webId, preferences.mailbox, DataFactory).privateIndex;
}
export async function mailAttachments(store: MailStore, messageIri: string) {
  const loaded = await store.load(documentOf(messageIri));
  const message = loaded.mailbox.message(messageIri);
  const attachments = [];
  for (const url of message.attachments) {
    const metadata = new Attachment(url, loaded.mailbox, DataFactory);
    attachments.push({
      name: metadata.name ?? "attachment",
      contentType: metadata.contentType ?? "application/octet-stream",
      size: metadata.size ?? 0,
      url,
    });
  }
  return attachments;
}

/** Display names live on the address resource in each message document. */
export class MailContact extends TermWrapper {
  get name(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}name`, LiteralAs.string);
  }
  set name(value: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}name`, value, LiteralFrom.string);
  }
}
export function mailAddressName(message: Message, iri: string): string | undefined {
  return new MailContact(iri, message.dataset, DataFactory).name;
}
