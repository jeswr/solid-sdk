// AUTHORED-BY Claude Opus 5.5
import PostalMime from "postal-mime";
import { mailtos } from "./addresses.js";

export interface ParsedMail {
  readonly messageId?: string;
  readonly subject?: string;
  readonly text?: string;
  readonly html?: string;
  readonly from?: string;
  readonly to: readonly string[];
  readonly cc: readonly string[];
  readonly bcc: readonly string[];
  readonly date?: Date;
  readonly inReplyTo?: string;
  /** `References` Message-IDs, oldest first. */
  readonly references: readonly string[];
  readonly attachments: readonly {
    readonly name: string;
    readonly contentType: string;
    readonly content: Uint8Array;
  }[];
}

/** Message-ID values are only usable as keys when they are a single `<…>` token. */
function messageIdToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && /^<[^<>\s]+>$/.test(trimmed) ? trimmed : undefined;
}

/** A message postal-mime could not parse; the caller skips it instead of failing the run. */
export class MailParseError extends Error {
  constructor(options?: { cause?: unknown }) {
    super("The message could not be parsed.", options);
    this.name = "MailParseError";
  }
}

/** MIME decoding is delegated to postal-mime; HTML stays inert data. */
export async function parseMail(raw: Uint8Array): Promise<ParsedMail> {
  let email: Awaited<ReturnType<typeof PostalMime.parse>>;
  try {
    email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
  } catch (cause) {
    throw new MailParseError({ cause });
  }
  const references =
    (email.headers.find((h) => h.key === "references")?.value ?? "")
      .slice(0, 64 * 1024)
      .match(/<[^<>\s]+>/g) ?? [];
  const date = email.date ? new Date(email.date) : undefined;
  return {
    messageId: messageIdToken(email.messageId),
    subject: email.subject,
    text: email.text,
    html: email.html,
    from: mailtos(email.from ? [email.from] : [])[0],
    to: mailtos(email.to),
    cc: mailtos(email.cc),
    bcc: mailtos(email.bcc),
    date: date && Number.isFinite(date.getTime()) ? date : undefined,
    inReplyTo: messageIdToken(email.inReplyTo),
    references,
    attachments: email.attachments.map((a) => ({
      name: a.filename || "attachment",
      contentType: a.mimeType,
      content: new Uint8Array(a.content as ArrayBuffer),
    })),
  };
}
