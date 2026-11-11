// AUTHORED-BY Codex (GPT-6.1 Sol)
/** Stored conversation metadata over the generated AS2 collection entity. */
import type { DatasetCore } from "@rdfjs/types";
import type { Store } from "n3";
import { entities } from "./generated/model.js";

export interface ConversationMetadata {
  identifier: string;
  title: string;
}

export function buildConversation(subject: string, metadata: ConversationMetadata): Store {
  return entities.Conversation.build(subject, metadata);
}

export function parseConversation(
  subject: string,
  dataset: DatasetCore,
): ConversationMetadata | undefined {
  return entities.Conversation.parse(subject, dataset);
}
