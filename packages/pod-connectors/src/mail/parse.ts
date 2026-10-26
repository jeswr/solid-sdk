// AUTHORED-BY Claude Opus 5.5
import PostalMime, { type Address } from "postal-mime";

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
  readonly attachments: readonly {
    readonly name: string;
    readonly contentType: string;
    readonly content: Uint8Array;
  }[];
}

/** mailto IRIs for every address, flattening groups (MAI-01 `addresses`). */
function mailtos(values: readonly Address[] | undefined): string[] {
  return (values ?? []).flatMap((value) =>
    value.group
      ? mailtos(value.group)
      : value.address
        ? [`mailto:${encodeURIComponent(value.address)}`]
        : [],
  );
}

/** Message-ID values are only usable as keys when they are a single `<…>` token. */
function messageIdToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && /^<[^<>\s]+>$/.test(trimmed) ? trimmed : undefined;
}

/** MIME decoding is delegated to postal-mime; HTML stays inert data. */
export async function parseMail(raw: Uint8Array): Promise<ParsedMail> {
  const email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });
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
    attachments: email.attachments.map((a) => ({
      name: a.filename || "attachment",
      contentType: a.mimeType,
      content: new Uint8Array(a.content as ArrayBuffer),
    })),
  };
}
