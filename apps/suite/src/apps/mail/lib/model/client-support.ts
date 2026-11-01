// AUTHORED-BY Codex GPT-6.1-Sol
import { NamedNodeAs, OptionalFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { Attachment } from "./attachment";
import type { MailStore } from "./io";
import { documentOf } from "./operations";
import { SOLID } from "./vocab";

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
    const response = await store.fetch(url, { method: "HEAD" });
    if (!response.ok) throw new Error("Couldn't load an attachment");
    attachments.push({
      name: metadata.name ?? "attachment",
      contentType: metadata.contentType ?? "application/octet-stream",
      size: Number(response.headers.get("content-length") ?? 0),
      url,
    });
  }
  return attachments;
}
