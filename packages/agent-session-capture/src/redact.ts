// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
import { type ChatConversation, redactSecretFields } from "@jeswr/solid-chat-interop";

/** Redaction now lives with the chat writer, so every chat persistence path shares it. */
export { redactSecrets } from "@jeswr/solid-chat-interop";

/** Redact all adjacent fields before queueing, filtering or splitting into save batches. */
export function redactConversation(chat: ChatConversation): ChatConversation {
  const fields = redactSecretFields([chat.title, ...chat.messages.map((message) => message.text)]);
  return {
    ...chat,
    title: fields[0] as string,
    messages: chat.messages.map((message, index) => ({
      ...message,
      text: fields[index + 1] as string,
    })),
  };
}
