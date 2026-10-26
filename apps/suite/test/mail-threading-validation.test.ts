// AUTHORED-BY Codex GPT-6.1-Sol
/* biome-ignore-all lint/style/noNonNullAssertion: Successful fixtures must produce a thread. */
import { describe, expect, it } from "vitest";
import {
  buildThreads,
  normalizeSubject,
  ThreadingError,
  type ThreadingErrorCode,
  type ThreadMessage,
} from "../src/apps/mail/lib/threading";

const valid: ThreadMessage = {
  id: "https://example.org/mail/message-1",
  messageId: "<one@example.org>",
  subject: "Book club",
  timestamp: 0,
  from: "Mira <mira@example.org>",
  to: [],
  text: "Fictional reading plans",
  isRead: false,
};

function rejects(input: unknown, code: ThreadingErrorCode): void {
  let caught: unknown;
  try {
    buildThreads(input as ThreadMessage[]);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(ThreadingError);
  expect(caught).toMatchObject({
    name: "ThreadingError",
    code,
    message: `Mail threading: ${code}`,
  });
}

describe("subject normalization", () => {
  it.each([
    [" Re: Fwd: AW: SV: [club]  Plans\t for   Friday ", "plans for friday"],
    ["[club] RE[2]: [news] fw: Topic", "topic"],
    ["fWd: re : Résumé", "résumé"],
    ["Re: Re: [list]", ""],
    ["", ""],
    ["[list]", ""],
    ["Report: Re: figures", "report: re: figures"],
    ["[unfinished topic", "[unfinished topic"],
    ["Project [club]", "project [club]"],
    ["Preview: meeting", "preview: meeting"],
  ])("normalizes %j as %j", (input, expected) => {
    expect(normalizeSubject(input)).toBe(expected);
  });

  it.each([
    null,
    3,
    "bad\r\nsubject",
    "bad\u0000subject",
    "=?UTF-8?B?UGxhbnM=?=",
  ])("rejects undecoded/unsupported subjects %j", (subject) => {
    expect(() => normalizeSubject(subject as string)).toThrow(ThreadingError);
    rejects([{ ...valid, subject }], "unsupported-subject");
  });
});

describe("fail-closed input validation", () => {
  it.each([null, {}, "mail"])("rejects a non-array mailbox %j", (input) => {
    rejects(input, "invalid-message");
  });

  it.each([null, false, "message", undefined])("rejects a non-message %j", (input) => {
    rejects([input], "invalid-message");
  });

  it.each([
    { id: "" },
    { id: "  " },
    { id: 3 },
    { from: null },
    { from: "\nMira" },
    { to: null },
    { to: [""] },
    { cc: "sage@example.org" },
    { cc: [null] },
    { text: 3 },
    { isRead: undefined },
    { isRead: "false" },
  ])("rejects invalid message fields %j", (fields) => {
    rejects([{ ...valid, ...fields }], "invalid-message");
  });

  it("rejects repeated resource IDs rather than losing a message", () => {
    rejects([valid, { ...valid, text: "Second payload" }], "duplicate-resource-id");
  });

  it.each([
    NaN,
    Infinity,
    -Infinity,
    0.1,
    "2026-10-26",
    null,
    -62_135_596_800_001,
    253_402_300_800_000,
  ])("rejects unsupported timestamps %j", (timestamp) =>
    rejects([{ ...valid, timestamp }], "invalid-timestamp"));

  it.each([
    -62_135_596_800_000, 253_402_300_799_999,
  ])("accepts timestamp boundary %j", (timestamp) => {
    expect(buildThreads([{ ...valid, timestamp }])[0]!.latestTimestamp).toBe(timestamp);
  });

  it.each([
    "one@example.org",
    "<one@example.org> <two@example.org>",
    '<"one"@example.org>',
    "<one@[127.0.0.1]>",
    "<one@example.org> (comment)",
    " <one@example.org>",
    "<one@example.org>\n",
    "<a..b@example.org>",
    "<one@.example.org>",
    "<one@éxample.org>",
    "",
    null,
    3,
  ])("rejects unsupported Message-ID syntax %j in every header", (value) => {
    rejects([{ ...valid, messageId: value }], "unsupported-message-id");
    rejects([{ ...valid, inReplyTo: value }], "unsupported-message-id");
    rejects([{ ...valid, references: [value] }], "unsupported-message-id");
  });

  it.each([null, "<one@example.org>"])("rejects non-array References %j", (references) => {
    rejects([{ ...valid, references }], "unsupported-message-id");
  });

  it("validates In-Reply-To even when References takes precedence", () => {
    rejects(
      [{ ...valid, references: [valid.messageId], inReplyTo: "malformed" }],
      "unsupported-message-id",
    );
  });

  it("accepts dot-atom punctuation without folding Message-ID case", () => {
    expect(
      buildThreads([{ ...valid, messageId: "<a.!#$%&'*+-/=?^_`{|}~@example.org>" }]),
    ).toHaveLength(1);
  });
});
