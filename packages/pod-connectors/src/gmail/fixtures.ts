// AUTHORED-BY Claude Opus 5.5
/**
 * Recorded Gmail API v1 shapes (gmail.googleapis.com/gmail/v1/users/me), trimmed to the
 * fields the adapter reads. All people, addresses and content are synthetic.
 */
import type { FixtureRoute } from "../core/types.js";

export const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailProfile {
  emailAddress: string;
  historyId: string;
}
export interface GmailLabel {
  id: string;
  name: string;
  type: "system" | "user";
}
export interface GmailLabelList {
  labels: GmailLabel[];
}
export interface GmailMessageRef {
  id: string;
  threadId: string;
}
export interface GmailMessageList {
  messages?: GmailMessageRef[];
  nextPageToken?: string;
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  internalDate?: string;
  raw?: string;
}
export interface GmailHistoryRecord {
  id: string;
  messagesAdded?: { message: GmailMessageRef }[];
  messagesDeleted?: { message: GmailMessageRef }[];
  labelsAdded?: { message: GmailMessageRef; labelIds: string[] }[];
  labelsRemoved?: { message: GmailMessageRef; labelIds: string[] }[];
}
export interface GmailHistoryList {
  history?: GmailHistoryRecord[];
  historyId: string;
  nextPageToken?: string;
}

/** base64url of an RFC 822 message, as `format=raw` returns it. */
export function rawMessage(lines: readonly string[]): string {
  const bytes = new TextEncoder().encode(lines.join("\r\n"));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const PROFILE: GmailProfile = { emailAddress: "alex@example.test", historyId: "1000" };

export const LABELS: GmailLabelList = {
  labels: [
    { id: "INBOX", name: "INBOX", type: "system" },
    { id: "SENT", name: "SENT", type: "system" },
    { id: "UNREAD", name: "UNREAD", type: "system" },
    { id: "STARRED", name: "STARRED", type: "system" },
    { id: "CATEGORY_UPDATES", name: "CATEGORY_UPDATES", type: "system" },
    { id: "Label_1", name: "Receipts", type: "user" },
  ],
};

export const MESSAGES: Record<string, GmailMessage> = {
  m1: {
    id: "m1",
    threadId: "t1",
    labelIds: ["INBOX", "UNREAD", "CATEGORY_UPDATES"],
    internalDate: "1781168400000",
    raw: rawMessage([
      "From: Sam Example <sam@example.test>",
      "To: Alex Example <alex@example.test>",
      "Subject: Lunch on Friday?",
      "Date: Thu, 11 Jun 2026 10:00:00 +0100",
      "Message-ID: <lunch-1@example.test>",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Shall we try the new place on the corner?",
    ]),
  },
  m2: {
    id: "m2",
    threadId: "t1",
    labelIds: ["SENT"],
    internalDate: "1781172000000",
    raw: rawMessage([
      "From: Alex Example <alex@example.test>",
      "To: Sam Example <sam@example.test>",
      "Cc: Kim Example <kim@example.test>",
      "Subject: Re: Lunch on Friday?",
      "Date: Thu, 11 Jun 2026 11:00:00 +0100",
      "Message-ID: <lunch-2@example.test>",
      "In-Reply-To: <lunch-1@example.test>",
      "References: <lunch-1@example.test>",
      "Content-Type: text/html; charset=utf-8",
      "",
      "<p>Yes &amp; let&#39;s invite Kim.</p>",
    ]),
  },
  m3: {
    id: "m3",
    threadId: "t3",
    labelIds: ["Label_1", "STARRED"],
    internalDate: "1781258400000",
    raw: rawMessage([
      "From: Shop <orders@shop.example.test>",
      "To: alex@example.test",
      "Subject: Your receipt",
      "Date: Fri, 12 Jun 2026 11:00:00 +0100",
      "Message-ID: <receipt-9@shop.example.test>",
      'Content-Type: multipart/mixed; boundary="b1"',
      "",
      "--b1",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Thanks for your order.",
      "--b1",
      'Content-Type: text/turtle; name="order.ttl"',
      'Content-Disposition: attachment; filename="order.ttl"',
      "Content-Transfer-Encoding: base64",
      "",
      btoa("<#order> a <#Order> ."),
      "--b1--",
    ]),
  },
};

export const GMAIL_FIXTURES: readonly FixtureRoute[] = [
  { url: `${GMAIL_API}/profile`, json: PROFILE },
  { url: `${GMAIL_API}/labels`, json: LABELS },
  { url: `${GMAIL_API}/messages`, json: { messages: [MESSAGES.m1, MESSAGES.m2, MESSAGES.m3] } },
  ...Object.values(MESSAGES).map((json) => ({ url: `${GMAIL_API}/messages/${json.id}`, json })),
];
