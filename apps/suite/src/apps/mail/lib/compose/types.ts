// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
export interface MailAddress {
  email: string;
  name?: string;
}
export interface Attachment {
  filename: string;
  contentType: string;
  /** Optional MIME charset token for text/*; data must already use this encoding. */
  charset?: string;
  /** Preserved bytes. For text/*, CR and LF octets must occur only as CRLF pairs. */
  data: Uint8Array;
}
export interface ComposeInput {
  from: MailAddress;
  to?: readonly MailAddress[];
  cc?: readonly MailAddress[];
  bcc?: readonly MailAddress[];
  replyTo?: readonly MailAddress[];
  subject: string;
  text: string;
  html?: string;
  attachments?: readonly Attachment[];
  inReplyTo?: string;
  references?: readonly string[];
}
/** Both sources are required; use cryptographically random bytes in production. */
export interface ComposeSources {
  clock: () => Date;
  randomBytes: (length: number) => Uint8Array;
  messageIdDomain: string;
}
export interface ComposedMessage {
  /** ASCII RFC 5322 wire message, with CRLF line endings. Bcc is envelope-only. */
  raw: string;
  messageId: string;
  date: Date;
  envelope: { from: string; to: string[] };
}
/** Decoded, plain-text source message. HTML-only sources need a caller-provided text version. */
export interface OriginalMessage {
  from: MailAddress;
  to?: readonly MailAddress[];
  cc?: readonly MailAddress[];
  replyTo?: readonly MailAddress[];
  subject: string;
  text: string;
  date: Date;
  messageId?: string;
  references?: readonly string[];
  inReplyTo?: string;
}
export interface MessageDraft {
  to: MailAddress[];
  cc: MailAddress[];
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
}
