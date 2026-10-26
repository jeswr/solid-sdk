// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  ComposeError,
  type ComposeInput,
  type ComposeSources,
  composeMessage,
  forward,
  type OriginalMessage,
  reply,
  replyAll,
} from "../src/apps/mail/lib/compose";

const alice = { email: "alice@example.org", name: "Alice Example" };
const bob = { email: "bob@example.org", name: "Bob Example" };
const cara = { email: "cara@example.org", name: "Cara Example" };
const time = new Date("2026-10-26T12:34:56Z");
const sources: ComposeSources = {
  clock: () => time,
  randomBytes: (length) => new Uint8Array(length).fill(1),
  messageIdDomain: "example.org",
};
const input: ComposeInput = {
  from: alice,
  to: [bob],
  subject: "A synthetic note",
  text: "Hello Bob!",
};
const original: OriginalMessage = {
  from: alice,
  to: [bob],
  subject: "A synthetic note",
  text: "Hello Bob!\n\nRegards,\rAlice\r\n> previous line",
  date: time,
  messageId: "<parent@example.org>",
};
const build = (changes: Partial<ComposeInput> = {}, overrides: Partial<ComposeSources> = {}) =>
  composeMessage({ ...input, ...changes }, { ...sources, ...overrides });
function rejects(fn: () => unknown, code = "invalid-input") {
  expect(fn).toThrow(ComposeError);
  try {
    fn();
  } catch (error) {
    expect(error).toMatchObject({ code });
    expect(String(error)).not.toContain("secret");
  }
}
/** Independent fixture decoder: only consumes emitted MIME, never production encoding helpers. */
function headers(raw: string) {
  const end = raw.indexOf("\r\n\r\n");
  expect(end).toBeGreaterThan(0);
  const block = raw.slice(0, end).replace(/\r\n[ \t]+/g, " ");
  const values = new Map(
    block.split("\r\n").map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
    }),
  );
  return { values, body: raw.slice(end + 4) };
}
function decodedWords(value: string): string {
  return value
    .replace(/(\?=)[ \r\n]+(?==\?UTF-8\?B\?)/g, "$1")
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, encoded: string) =>
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(encoded, "base64")),
    );
}
function mime(raw: string): {
  contentType: string;
  bytes?: Buffer;
  parts?: ReturnType<typeof mime>[];
} {
  const { values, body } = headers(raw);
  const contentType = values.get("content-type") as string;
  if (contentType.startsWith("multipart/")) {
    const boundary = /boundary="([^"]+)"/.exec(contentType)?.[1] as string;
    const sections = body.split(`--${boundary}`);
    expect(sections[0]).toBe("");
    expect(sections.at(-1)?.trim()).toBe("--");
    return { contentType, parts: sections.slice(1, -1).map((part) => mime(part.slice(2, -2))) };
  }
  expect(values.get("content-transfer-encoding")).toBe("base64");
  const encoded = body.replace(/\r\n$/, "");
  for (const line of encoded.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
  expect(encoded.replaceAll("\r\n", "")).toMatch(/^[A-Za-z0-9+/]*={0,2}$/);
  return { contentType, bytes: Buffer.from(encoded, "base64") };
}

describe("RFC 5322 composition", () => {
  it("matches the complete deterministic ASCII wire fixture", () => {
    const result = build();
    expect(result.raw).toBe(
      [
        "Date: Mon, 26 Oct 2026 12:34:56 +0000",
        "Message-ID: <mvp8oha8.01010101010101010101010101010101@example.org>",
        'From: "Alice Example" <alice@example.org>',
        'To: "Bob Example" <bob@example.org>',
        "Subject: A synthetic note",
        "MIME-Version: 1.0",
        "Content-Type: text/plain; charset=utf-8",
        "Content-Transfer-Encoding: base64",
        "",
        "SGVsbG8gQm9iIQ==",
        "",
      ].join("\r\n"),
    );
    expect(result.envelope).toEqual({ from: alice.email, to: [bob.email] });
    expect(result.date).toEqual(time);
    expect(result.date).not.toBe(time);
    expect(result.raw).toContain(`Message-ID: ${result.messageId}\r\n`);
    expect(build()).toEqual(result);
    expect(build({}, { randomBytes: (size) => new Uint8Array(size).fill(2) }).messageId).not.toBe(
      result.messageId,
    );
    expect(build({}, { clock: () => new Date(time.getTime() + 1000) }).messageId).not.toBe(
      result.messageId,
    );
  });

  it("quotes and escapes ASCII display names and formats structured address lists", () => {
    const result = build({
      from: { email: alice.email, name: 'Alice "A", \\ Example' },
      to: [bob, { email: cara.email }],
      cc: [{ email: "observer@example.org", name: "Observer; (Example)" }],
      replyTo: [cara, bob],
      bcc: [
        { email: "hidden@example.org", name: "Secret Recipient" },
        { email: "bob@EXAMPLE.ORG" },
      ],
      references: ["<root@example.org>", "<parent@example.org>"],
      inReplyTo: "<parent@example.org>",
    });
    const parsed = headers(result.raw).values;
    expect(parsed.get("from")).toBe('"Alice \\"A\\", \\\\ Example" <alice@example.org>');
    expect(parsed.get("to")).toBe('"Bob Example" <bob@example.org>, cara@example.org');
    expect(parsed.get("cc")).toBe('"Observer; (Example)" <observer@example.org>');
    expect(parsed.get("reply-to")).toBe(
      '"Cara Example" <cara@example.org>, "Bob Example" <bob@example.org>',
    );
    expect(parsed.get("references")).toBe("<root@example.org> <parent@example.org>");
    expect(parsed.get("in-reply-to")).toBe("<parent@example.org>");
    expect(result.raw).not.toMatch(/hidden|Secret Recipient|Bcc:/);
    expect(result.envelope.to).toEqual([
      bob.email,
      cara.email,
      "observer@example.org",
      "hidden@example.org",
    ]);
  });

  it.each([
    "",
    "é",
    "José 🦊 東京 ".repeat(30),
    "x".repeat(150),
    " leading and trailing ",
    "=?UTF-8?B?c2VjcmV0?=",
    "hello  world",
  ])("round trips subject text without splitting UTF-8 code points: %j", (subject) => {
    const result = build({ subject });
    expect(decodedWords(headers(result.raw).values.get("subject") as string)).toBe(subject);
    const words = result.raw.match(/=\?UTF-8\?B\?[^?]+\?=/g) ?? [];
    for (const word of words) expect(word.length).toBeLessThanOrEqual(75);
    for (const line of result.raw.split("\r\n")) expect(line.length).toBeLessThanOrEqual(78);
  });

  it("encodes Unicode names outside quotes, including multiword and literal encoded-word names", () => {
    for (const name of ["Zoë Example", "東京 🐬".repeat(25), "=?UTF-8?B?YWxpY2U=?="]) {
      const raw = build({ from: { email: alice.email, name } }).raw;
      const from = headers(raw).values.get("from") as string;
      expect(from).toMatch(/^=\?UTF-8\?B\?/);
      expect(decodedWords(from)).toBe(`${name} <${alice.email}>`);
    }
  });

  it("supports empty bodies, empty optional lists, and Bcc-only envelopes", () => {
    const result = build({
      to: [],
      bcc: [bob],
      cc: [],
      text: "",
      subject: "",
      attachments: [],
      references: [],
    });
    expect(result.raw).not.toMatch(/^(To|Cc|Bcc|References):/m);
    expect(mime(result.raw).bytes).toEqual(Buffer.alloc(0));
    expect(result.envelope.to).toEqual([bob.email]);
    expect(
      build({ to: undefined, bcc: [bob] } as unknown as Partial<ComposeInput>).envelope.to,
    ).toEqual([bob.email]);
  });

  it("preserves Unicode bodies, blank lines, long text and final newline with canonical CRLF", () => {
    const text = `Hello 🦊\n\rNext\r\n${"abc".repeat(100)}\n`;
    const result = build({ text });
    expect(mime(result.raw).bytes?.toString()).toBe(
      `Hello 🦊\r\n\r\nNext\r\n${"abc".repeat(100)}\r\n`,
    );
    expect(result.raw.replaceAll("\r\n", "")).not.toMatch(/[\r\n\u0080-\uffff]/);
  });

  it.each([
    { attachments: [] },
    {
      attachments: [
        { filename: "note.txt", contentType: "text/plain", data: new Uint8Array([10, 13, 255]) },
      ],
    },
  ])("nests text + HTML alternatives correctly with attachments %j", ({ attachments }) => {
    const result = build({ text: "plain 🦊", html: "<p>Hello 🦊</p>\n", attachments });
    let parsed = mime(result.raw);
    if (attachments.length > 0) {
      expect(parsed.contentType).toContain("multipart/mixed");
      expect(parsed.parts).toHaveLength(2);
      expect(parsed.parts?.[1]?.bytes).toEqual(Buffer.from([10, 13, 255]));
      parsed = parsed.parts?.[0] as ReturnType<typeof mime>;
    }
    expect(parsed.contentType).toContain("multipart/alternative");
    expect(parsed.parts).toHaveLength(2);
    expect(parsed.parts?.map((part) => part.contentType)).toEqual([
      "text/plain; charset=utf-8",
      "text/html; charset=utf-8",
    ]);
    expect(parsed.parts?.map((part) => part.bytes?.toString())).toEqual([
      "plain 🦊",
      "<p>Hello 🦊</p>\r\n",
    ]);
  });

  it("serializes binary and empty attachments, 76-column base64 and filename parameters", () => {
    const data = Uint8Array.from({ length: 256 }, (_, i) => i);
    const result = build({
      attachments: [
        { filename: 'a; "quoted".bin', contentType: "application/octet-stream", data },
        { filename: "旅行🦊 notes.txt", contentType: "text/plain", data: new Uint8Array() },
      ],
    });
    const parsed = mime(result.raw);
    expect(parsed.parts?.map((part) => part.bytes)).toEqual([
      Buffer.from(input.text),
      Buffer.from(data),
      Buffer.alloc(0),
    ]);
    expect(result.raw).toContain('filename="a; \\"quoted\\".bin"');
    expect(result.raw).toContain("filename*0*=utf-8''");
    expect(result.raw).toContain("filename*1*=");
    const fragments = [...result.raw.matchAll(/filename\*\d+\*=(?:utf-8'')?([^;\r\n]+)/g)].map(
      (match) => match[1],
    );
    expect(decodeURIComponent(fragments.join(""))).toBe("旅行🦊 notes.txt");
    expect(result.raw.split("\r\n").some((line) => /^[A-Za-z0-9+/]{76}$/.test(line))).toBe(true);
  });

  it("folds long indivisible addresses and preserves local-part case in the envelope", () => {
    const email = `${"a".repeat(64)}@${"b".repeat(60)}.example.org`;
    const raw = build({
      to: [{ email }, { email: "Bob@example.org" }, { email: "bob@EXAMPLE.org" }],
    });
    expect(raw.raw).toContain(`To:\r\n ${email}`);
    expect(raw.envelope.to).toEqual([email, "Bob@example.org", "bob@EXAMPLE.org"]);
  });
});

describe("fail-closed validation", () => {
  it.each([null, [], "message"])("rejects invalid message records %j", (value) =>
    rejects(() => composeMessage(value as unknown as ComposeInput, sources)));
  it.each([
    null,
    1,
    {},
    [],
    { email: "bad" },
    { email: "alice@example.org\r\nBcc: secret@example.org" },
  ])("rejects invalid structured addresses %j", (from) =>
    rejects(
      () => build({ from: from as typeof alice }),
      typeof from === "object" && from !== null && !Array.isArray(from)
        ? "unsupported-address"
        : "invalid-input",
    ));
  it.each([
    "a..b@example.org",
    '"a b"@example.org',
    "é@example.org",
    "a@[127.0.0.1]",
    "a@example.org (name)",
    "Group: a@example.org;",
    `${"a".repeat(65)}@example.org`,
    `${"a".repeat(64)}@${"b".repeat(200)}.org`,
  ])("rejects unsupported mailboxes %s", (email) =>
    rejects(() => build({ from: { email } }), "unsupported-address"));
  it.each([
    "a@-example.org",
    "a@example..org",
    "a@example.org.",
    `a@${"b".repeat(64)}.org`,
  ])("rejects malformed domains %s", (email) => rejects(() => build({ to: [{ email }] })));
  it.each([
    "",
    "-example.org",
    "bad\r\nsecret",
    "a".repeat(254),
    7,
  ])("rejects invalid generated Message-ID domains %j", (messageIdDomain) =>
    rejects(() => build({}, { messageIdDomain: messageIdDomain as string })));
  it.each([
    "",
    "bad\nsecret",
    "bad\rsecret",
    "bad\tsecret",
    "bad\0secret",
    "bad\u007fsecret",
    "bad\u0085secret",
    "\ud800",
  ])("rejects unsafe display names %j", (name) =>
    rejects(() => build({ from: { email: alice.email, name } })));
  it.each([
    null,
    42,
    "bad\r\nsecret",
    "bad\tsecret",
    "\udfff",
  ])("rejects unsafe subjects %j", (subject) =>
    rejects(() => build({ subject: subject as string })));
  it.each(["text", "html"] as const)("rejects malformed %s Unicode", (field) =>
    rejects(() => build({ [field]: "\ud800" })));
  it.each(["to", "cc", "bcc", "replyTo"] as const)("validates the %s list", (field) =>
    rejects(() => build({ [field]: "secret" } as unknown as Partial<ComposeInput>)));
  it("requires recipients and a nonempty supplied Reply-To", () => {
    rejects(() => build({ to: [] }));
    rejects(() => build({ replyTo: [] }));
  });
  it.each([
    "parent@example.org",
    "<bad>",
    "<x@example.org>\r\nsecret",
    "<a@b><c@d>",
    1,
  ])("rejects unsafe threading identifiers %j", (id) => {
    const expected = id === "<bad>" ? "unsupported-address" : "invalid-input";
    rejects(() => build({ inReplyTo: id as string }), expected);
    rejects(() => build({ references: [id as string] }), expected);
  });
  it("requires arrays for references and attachments", () => {
    rejects(() => build({ references: "<a@example.org>" } as unknown as Partial<ComposeInput>));
    rejects(() => build({ attachments: {} } as unknown as Partial<ComposeInput>));
    rejects(() => build({ attachments: new Array(1) }));
  });
  it.each([
    null,
    { filename: "a", contentType: "text/plain; charset=utf-8", data: new Uint8Array() },
    { filename: "a", contentType: "multipart/mixed", data: new Uint8Array() },
    { filename: "a", contentType: "message/rfc822", data: new Uint8Array() },
    { filename: "a", contentType: "text/plain", data: [] },
    { filename: "a", contentType: null, data: new Uint8Array() },
  ])("rejects invalid attachment records %j", (attachment) =>
    rejects(() => build({ attachments: [attachment] } as unknown as Partial<ComposeInput>)));
  it.each([
    "",
    "../secret.txt",
    "a\\secret",
    "bad\r\nsecret",
    "x".repeat(181),
    "\ud800",
    1,
  ])("rejects unsafe filenames %j", (filename) =>
    rejects(() =>
      build({
        attachments: [
          { filename: filename as string, contentType: "text/plain", data: new Uint8Array() },
        ],
      }),
    ));
  it("rejects overlong MIME header lines rather than truncating", () =>
    rejects(() =>
      build({
        attachments: [
          {
            filename: "a.txt",
            contentType: `application/${"x".repeat(1000)}`,
            data: new Uint8Array(),
          },
        ],
      }),
    ));
  it.each([null, [], 1])("rejects invalid sources %j", (value) =>
    rejects(() => composeMessage(input, value as unknown as ComposeSources)));
  it.each([
    new Date("invalid"),
    new Date("1800-01-01Z"),
    new Date("+010000-01-01T00:00:00Z"),
    0,
  ])("rejects unsupported clock values %j", (now) =>
    rejects(() => build({}, { clock: () => now as Date })));
  it.each([new Uint8Array(15), [], null])("rejects wrong random-byte results %j", (value) =>
    rejects(() => build({}, { randomBytes: () => value as Uint8Array })));
  it("wraps throwing or missing injected sources without exposing their error messages", () => {
    rejects(
      () =>
        build(
          {},
          {
            clock: () => {
              throw new Error("secret");
            },
          },
        ),
      "invalid-source",
    );
    rejects(
      () =>
        build(
          {},
          {
            randomBytes: () => {
              throw new Error("secret");
            },
          },
        ),
      "invalid-source",
    );
    rejects(
      () => build({}, { clock: null } as unknown as Partial<ComposeSources>),
      "invalid-source",
    );
  });
});

describe("reply, reply-all and forward drafts", () => {
  it("replies to the sender, prefixes the subject, extends References and quotes all lines", () => {
    const draft = reply(
      {
        ...original,
        references: ["<root@example.org>", "<root@example.org>", original.messageId as string],
      },
      [bob.email],
    );
    expect(draft).toEqual({
      to: [alice],
      cc: [],
      subject: "Re: A synthetic note",
      inReplyTo: "<parent@example.org>",
      references: ["<root@example.org>", "<parent@example.org>"],
      text: "\r\n\r\nOn Mon, 26 Oct 2026 12:34:56 GMT, Alice Example <alice@example.org> wrote:\r\n> Hello Bob!\r\n> \r\n> Regards,\r\n> Alice\r\n> > previous line",
    });
    expect(original.to).toEqual([bob]);
    expect(draft.to[0]).not.toBe(alice);
    const composed = build({ ...draft });
    expect(headers(composed.raw).values.get("references")).toBe(
      "<root@example.org> <parent@example.org>",
    );
    expect(mime(composed.raw).bytes?.toString()).toBe(draft.text);
  });
  it("uses Reply-To, excludes identities/aliases, deduplicates To before Cc, and never copies Bcc", () => {
    const draft = replyAll(
      {
        ...original,
        replyTo: [cara, { email: "bob@EXAMPLE.ORG" }],
        to: [bob, cara, alice],
        cc: [cara, alice, { email: "other@example.org" }, { email: "alias@example.org" }],
      },
      [bob.email, "alias@example.org"],
    );
    expect(draft.to).toEqual([cara, alice]);
    expect(draft.cc).toEqual([{ email: "other@example.org" }]);
    expect(reply({ ...original, replyTo: [cara] }, [bob.email]).to).toEqual([cara]);
  });
  it("handles self-sent mail, absent recipients and domain-only case matching", () => {
    expect(reply(original, [alice.email]).to).toEqual([bob]);
    expect(replyAll(original, [alice.email]).to).toEqual([bob]);
    expect(reply({ ...original, from: { email: "Alice@EXAMPLE.ORG" } }, [alice.email]).to).toEqual([
      { email: "Alice@EXAMPLE.ORG" },
    ]);
    expect(reply({ from: alice, subject: "s", text: "", date: time }, [bob.email])).toMatchObject({
      to: [alice],
      cc: [],
    });
    rejects(() => reply({ ...original, to: [] }, [alice.email]));
    rejects(() => reply({ from: alice, subject: "s", text: "", date: time }, [alice.email]));
  });
  it("handles reply-all with an absent To list and no display name", () => {
    const draft = replyAll({ from: { email: alice.email }, subject: "", text: "", date: time }, [
      bob.email,
    ]);
    expect(draft.to).toEqual([{ email: alice.email }]);
    expect(draft.text).toBe(
      "\r\n\r\nOn Mon, 26 Oct 2026 12:34:56 GMT, alice@example.org wrote:\r\n> ",
    );
  });
  it("supports Cc-only reply-all recipients", () => {
    expect(replyAll({ ...original, to: [], cc: [cara] }, [alice.email])).toMatchObject({
      to: [],
      cc: [cara],
    });
  });
  it("falls back to In-Reply-To and keeps unthreaded sources unthreaded", () => {
    expect(
      reply({ ...original, inReplyTo: "<ancestor@example.org>" }, [bob.email]).references,
    ).toEqual(["<ancestor@example.org>", "<parent@example.org>"]);
    const { messageId: _id, ...unthreaded } = original;
    const draft = reply(unthreaded, [bob.email]);
    expect(draft).not.toHaveProperty("references");
    expect(draft).not.toHaveProperty("inReplyTo");
    expect(
      reply({ ...original, references: [], inReplyTo: "<ignored@example.org>" }, [bob.email])
        .references,
    ).toEqual(["<parent@example.org>"]);
  });
  it("does not repeat Re:/Fwd: prefixes, preserving their existing spelling", () => {
    expect(reply({ ...original, subject: "rE: A note" }, [bob.email]).subject).toBe("rE: A note");
    expect(forward({ ...original, subject: "fWD: A note" }).subject).toBe("fWD: A note");
  });
  it("forwards with attribution and no inherited recipients or thread metadata", () => {
    const draft = forward(original);
    expect(draft.to).toEqual([]);
    expect(draft.cc).toEqual([]);
    expect(draft.subject).toBe("Fwd: A synthetic note");
    expect(draft.text).toContain("---------- Forwarded message ----------\r\n");
    expect(draft.text).toContain("Alice Example <alice@example.org> wrote:\r\n> Hello Bob!");
    expect(draft).not.toHaveProperty("references");
    expect(draft).not.toHaveProperty("inReplyTo");
    expect(forward({ ...original, from: { email: alice.email } }).text).toContain(
      "From: alice@example.org\r\n",
    );
    expect(
      forward({ ...original, from: { email: alice.email, name: "Zoë Example" } }).text,
    ).toContain("From: Zoë Example <alice@example.org>\r\n");
  });
  it.each([null, [], 1])("rejects invalid originals %j", (value) =>
    rejects(() => forward(value as unknown as OriginalMessage)));
  it("validates all original fields even on forwards", () => {
    rejects(() => forward({ ...original, subject: "secret\r\nheader" }));
    rejects(() => forward({ ...original, text: "\ud800" }));
    rejects(() => forward({ ...original, date: new Date("invalid") }));
    rejects(() => forward({ ...original, to: "secret" } as unknown as OriginalMessage));
    rejects(() => forward({ ...original, cc: "secret" } as unknown as OriginalMessage));
    rejects(() => forward({ ...original, replyTo: [] }));
    rejects(() => forward({ ...original, messageId: "invalid" }));
    rejects(() => forward({ ...original, references: ["invalid"] }));
  });
  it.each([[], null, "a@example.org", ["bad"]])("rejects invalid identity lists %j", (identities) =>
    rejects(
      () => reply(original, identities as string[]),
      Array.isArray(identities) && identities.length > 0 ? "unsupported-address" : "invalid-input",
    ));
});
