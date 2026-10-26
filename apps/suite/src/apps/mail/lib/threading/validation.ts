// AUTHORED-BY Codex GPT-6.1-Sol
import type { ThreadMessage } from "./types";

export type ThreadingErrorCode =
  | "invalid-message"
  | "duplicate-resource-id"
  | "invalid-timestamp"
  | "unsupported-message-id"
  | "unsupported-subject";

/** Error messages never echo mailbox content. */
export class ThreadingError extends Error {
  constructor(public readonly code: ThreadingErrorCode) {
    super(`Mail threading: ${code}`);
    this.name = "ThreadingError";
  }
}

function identity(value: string): void {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject NUL in input identities.
  if (typeof value !== "string" || value.trim() === "" || /[\r\n\u0000]/u.test(value)) {
    throw new ThreadingError("invalid-message");
  }
}

/** Deliberately bounded modern msg-id syntax; no guessing at raw/obsolete RFC syntax. */
function messageId(value: string): void {
  const atom = "[a-zA-Z0-9!#$%&'*+\\-/=?^_`{|}~]+";
  const dotAtom = `${atom}(?:\\.${atom})*`;
  if (typeof value !== "string" || !new RegExp(`^<${dotAtom}@${dotAtom}>$`, "u").test(value)) {
    throw new ThreadingError("unsupported-message-id");
  }
}

export function validateSubject(value: string): void {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Reject NUL in decoded headers.
  if (typeof value !== "string" || /[\r\n\u0000]|=\?/u.test(value)) {
    throw new ThreadingError("unsupported-subject");
  }
}

export function compareId(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareMessages(a: ThreadMessage, b: ThreadMessage): number {
  return a.timestamp - b.timestamp || compareId(a.id, b.id);
}

export function validateMessages<T extends ThreadMessage>(messages: readonly T[]): T[] {
  if (!Array.isArray(messages)) throw new ThreadingError("invalid-message");
  const ids = new Set<string>();
  for (const message of messages) {
    if (!message || typeof message !== "object") throw new ThreadingError("invalid-message");
    identity(message.id);
    if (ids.has(message.id)) throw new ThreadingError("duplicate-resource-id");
    ids.add(message.id);
    if (
      !Number.isSafeInteger(message.timestamp) ||
      message.timestamp < -62_135_596_800_000 ||
      message.timestamp > 253_402_300_799_999
    ) {
      throw new ThreadingError("invalid-timestamp");
    }
    validateSubject(message.subject);
    identity(message.from);
    if (!Array.isArray(message.to)) throw new ThreadingError("invalid-message");
    for (const recipient of message.to) identity(recipient);
    if (message.cc !== undefined) {
      if (!Array.isArray(message.cc)) throw new ThreadingError("invalid-message");
      for (const recipient of message.cc) identity(recipient);
    }
    if (typeof message.text !== "string" || typeof message.isRead !== "boolean") {
      throw new ThreadingError("invalid-message");
    }
    if (message.messageId !== undefined) messageId(message.messageId);
    if (message.inReplyTo !== undefined) messageId(message.inReplyTo);
    if (message.references !== undefined) {
      if (!Array.isArray(message.references)) throw new ThreadingError("unsupported-message-id");
      for (const reference of message.references) messageId(reference);
    }
  }
  return [...messages].sort(compareMessages);
}
