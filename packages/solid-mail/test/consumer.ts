// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { DatasetCore } from "@rdfjs/types";
import type { TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import {
  Attachment,
  Folder,
  MailboxDataset,
  Message,
  parseMailbox,
  serialiseToTurtle,
  Thread,
  type WellKnownFolder,
} from "../dist/index.js";

const mailbox = new MailboxDataset(new Store(), DataFactory);
const message = new Message("urn:mail:one", mailbox, DataFactory);
const originalBase: TermWrapper = message;
const date: Date | undefined = message.dateSent;
message.subjectLine = undefined;
message.body = undefined;
message.bodyHtml = undefined;
message.sender = undefined;
message.encoding = undefined;
message.identifier = undefined;
message.partOfThread = undefined;
message.inReplyTo = undefined;
message.dateSent = undefined;
message.dateReceived = undefined;
message.dateRead = undefined;
message.setRead(false);
const recipients: Set<string> = message.to;
const markMessage: () => void = message.markMessage.bind(message);
markMessage();
// @ts-expect-error recipient properties have no setter in the original API.
message.to = new Set<string>();
const thread = new Thread("urn:thread:one", mailbox, DataFactory);
thread.title = undefined;
thread.created = undefined;
thread.modified = undefined;
thread.addMessage(message.value);
const folder = new Folder("urn:folder:one", mailbox, DataFactory);
folder.title = undefined;
folder.modified = undefined;
const slug: WellKnownFolder = "inbox";
const attachment = new Attachment("urn:attachment:one", mailbox, DataFactory);
attachment.size = undefined;
attachment.name = undefined;
attachment.contentType = undefined;
const dataset: DatasetCore = mailbox;
const parsed: Promise<MailboxDataset> = parseMailbox("", "https://pod.example/mail.ttl");
const turtle: string = serialiseToTurtle(dataset);
void [originalBase, date, recipients, markMessage, slug, parsed, turtle];
