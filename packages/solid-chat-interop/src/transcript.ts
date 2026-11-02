// AUTHORED-BY Claude Opus 5.5
import type { ChatConversation } from "./chat-writer.js";
import { sanitizeText } from "./iri.js";
import { redactSecrets } from "./redact.js";

/** A fence one backtick longer than any backtick run in `text`, so content cannot close it. */
function fence(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}
/** One line of plain text: no control characters, line breaks or Markdown heading/emphasis marks. */
function line(text: string): string {
  return sanitizeText(text)
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
  const title = line(redactSecrets(conversation.title)) || "Untitled conversation";
  const parts = [
    `# ${title}`,
    "",
    `Archived ${conversation.provider} conversation \`${conversation.conversationId}\`, exported from a Solid pod. Continue it from here.`,
  ];
  for (const message of conversation.messages) {
    const text = sanitizeText(redactSecrets(message.text)).replace(/\r\n?/g, "\n");
    const marks = fence(text);
    parts.push("", `## ${message.role} · ${line(message.createdAt)}`, "", marks, text, marks);
  }
  return `${parts.join("\n")}\n`;
}
