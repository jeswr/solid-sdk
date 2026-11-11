// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { DatasetCore } from "@rdfjs/types";
import type { TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store } from "n3";
import {
  As2MessageDoc,
  buildAs2Message,
  type CanonicalMessage,
  parseAs2Message,
} from "../dist/index.js";

const subject = "https://example.org/chat#message";
const message: CanonicalMessage = { content: "Body", mediaType: "text/plain" };
const store: DatasetCore = buildAs2Message(subject, message);
const doc = new As2MessageDoc(subject, store, DataFactory);
const named = new As2MessageDoc(DataFactory.namedNode(subject), new Store(), DataFactory);
const wrapper: TermWrapper = doc;
const marked: As2MessageDoc = doc.markNote();
doc.content = undefined;
doc.mediaType = undefined;
doc.author = undefined;
doc.published = undefined;
doc.room = undefined;
doc.inReplyTo = undefined;
doc.replacedBy = undefined;
doc.deletedAt = undefined;
doc.provAttributedTo = undefined;
doc.provGeneratedBy = undefined;
doc.provDerivedFrom = undefined;
doc.taskTitle = undefined;
doc.assignee = undefined;
const types: Set<string> = doc.types;
const parsed: CanonicalMessage | undefined = parseAs2Message(subject, store);
void [named, wrapper, marked, types, parsed];
