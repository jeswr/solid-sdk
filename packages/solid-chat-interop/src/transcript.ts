// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
import { CHAT_CHANNELS, CHAT_PROVIDERS, CHAT_ROLES, type ChatConversation } from "./chat-writer.js";
import { sanitizeText } from "./iri.js";
import { redactSecrets } from "./redact.js";

/** A fence one backtick longer than any backtick run in `text`, so content cannot close it. */
function fence(text: string): string {
  // Iterate rather than spread: a long text can hold more runs than a call accepts arguments.
  let longest = 0;
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  return "`".repeat(Math.max(3, longest + 1));
}
/** One line of plain text: no control characters, line breaks or Markdown heading/emphasis marks. */
function line(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[\\`*_[\]<>#|]/g, (c) => `\\${c}`)
    .trim();
}

/**
 * Render a stored conversation as a Markdown transcript to paste into another account.
 *
 * Titles and message text are redacted again, so conversations stored before writer-side
 * redaction do not hand credentials on. Each message body sits in its own code fence, so
 * stored text cannot inject headings or fake turns into the transcript.
 */
export function renderTranscript(conversation: ChatConversation): string {
  // Library callers may pass unvalidated values; these fields are inserted unescaped.
  if (
    !CHAT_PROVIDERS.includes(conversation.provider) ||
    !/^[a-zA-Z0-9_-]{1,200}$/.test(conversation.conversationId) ||
    (conversation.channel !== undefined && !CHAT_CHANNELS.includes(conversation.channel)) ||
    conversation.messages.some((m) => !CHAT_ROLES.includes(m.role))
  )
    throw new TypeError("Invalid chat conversation");
  // Sanitize before redacting, so a control character cannot split a credential.
  const title = line(redactSecrets(sanitizeText(conversation.title))) || "Untitled conversation";
  const parts = [
    `# ${title}`,
    "",
    `Archived ${conversation.provider} conversation \`${conversation.conversationId}\`, exported from a Solid pod. Continue it from here.`,
  ];
  if (conversation.account !== undefined)
    parts.push("", `Account: ${line(redactSecrets(sanitizeText(conversation.account)))}`);
  if (conversation.channel !== undefined)
    parts.push("", `Channel: ${line(sanitizeText(conversation.channel))}`);
  for (const message of conversation.messages) {
    const text = redactSecrets(sanitizeText(message.text)).replace(/\r\n?/g, "\n");
    const marks = fence(text);
    parts.push(
      "",
      `## ${message.role} · ${line(sanitizeText(message.createdAt))}`,
      "",
      marks,
      text,
      marks,
    );
  }
  return `${parts.join("\n")}\n`;
}
