// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { forward } from "../src/apps/mail/lib/compose";
import {
  MAX_BODY_BYTES,
  MAX_BODY_LINES,
  QuoteError,
  type QuoteErrorCode,
  type QuoteOptions,
  splitQuotedText,
} from "../src/apps/mail/lib/quotes";

function reconstructed(body: string, options?: QuoteOptions): string {
  return splitQuotedText(body, options)
    .segments.map(({ text }) => text)
    .join("");
}

function rejects(body: string, code: QuoteErrorCode, options?: QuoteOptions): void {
  expect(() => splitQuotedText(body, options)).toThrow(QuoteError);
  expect(() => splitQuotedText(body, options)).toThrow(expect.objectContaining({ code }));
}

describe("mail quoted history", () => {
  it("separates body, attribution, quotes and signature without losing text", () => {
    const source =
      "Hello.\r\nOn Monday, Mira Sage wrote:\r\n> Earlier.\r\nReply.\r\n-- \r\nSol\r\n";
    const result = splitQuotedText(source);
    expect(result.segments).toEqual([
      { kind: "body", text: "Hello.\n", depth: 0 },
      { kind: "attribution", text: "On Monday, Mira Sage wrote:\n", depth: 0 },
      { kind: "quote", text: "> Earlier.\n", depth: 1 },
      { kind: "body", text: "Reply.\n", depth: 0 },
      { kind: "signature", text: "-- \nSol\n", depth: 0 },
    ]);
    expect(result.visibleText).toBe("Hello.\nReply.\n");
    expect(result.hasQuotedHistory).toBe(true);
    expect(result.segments.map(({ text }) => text).join("")).toBe(source.replaceAll("\r\n", "\n"));
  });

  it("handles empty input, exact whitespace, terminal newlines and bare CRs", () => {
    expect(splitQuotedText("")).toEqual({ segments: [], visibleText: "", hasQuotedHistory: false });
    for (const source of ["plain", " \n\t\n", "\n", "\r\n\r\n", "a\rb\n", "🌲 é 中\u2028\u2029"]) {
      const normalised = source.replaceAll("\r\n", "\n");
      expect(splitQuotedText(source)).toEqual({
        segments: [{ kind: "body", text: normalised, depth: 0 }],
        visibleText: normalised,
        hasQuotedHistory: false,
      });
    }
  });

  it("counts only leading quote markers, including space-separated runs", () => {
    const result = splitQuotedText(
      ">one\n> two > literal\n>>three\n> > four\n>  > >five\n>>>>\n> \nend\n > indented\n>\t> tab\n",
    );
    expect(result.segments).toEqual([
      { kind: "quote", text: ">one\n> two > literal\n", depth: 1 },
      { kind: "quote", text: ">>three\n> > four\n", depth: 2 },
      { kind: "quote", text: ">  > >five\n", depth: 3 },
      { kind: "quote", text: ">>>>\n", depth: 4 },
      { kind: "quote", text: "> \n", depth: 1 },
      { kind: "body", text: "end\n > indented\n", depth: 0 },
      { kind: "quote", text: ">\t> tab\n", depth: 1 },
    ]);
    expect(result.visibleText).toBe("end\n > indented\n");
  });

  it.each([
    "On Monday, Mira Sage <mira@example.org> wrote:",
    "Am Montag schrieb Mira Sage:",
    "Le lundi, Mira Sage a écrit :",
    "Le lundi, Mira Sage a écrit:",
    "On Monday, Mira wrote:\t ",
  ])("recognises the fixed attribution pattern %s", (attribution) => {
    expect(splitQuotedText(`Intro\n${attribution}\n \n\t\n> history`).segments).toEqual([
      { kind: "body", text: "Intro\n", depth: 0 },
      { kind: "attribution", text: `${attribution}\n`, depth: 0 },
      { kind: "body", text: " \n\t\n", depth: 0 },
      { kind: "quote", text: "> history", depth: 1 },
    ]);
  });

  it.each([
    "On Monday, Mira wrote:\nA new sentence.",
    "On Monday, Mira wrote: extra",
    "on Monday, Mira wrote:",
    "El lunes, Mira escribió:",
    "Am Montag, Mira:",
    "Am Montag schrieb :",
    "Am  schrieb Mira:",
    "Le lundi, Mira écrit :",
    " On Monday, Mira wrote:",
    "On Monday, Mira wrote:\n-- ",
  ])("keeps unsupported or nonadjacent attribution literal: %s", (source) => {
    const result = splitQuotedText(`${source}\n> old`);
    expect(result.segments.some(({ kind }) => kind === "attribution")).toBe(false);
    expect(reconstructed(source)).toBe(source);
  });

  it("marks only the last matching attribution and preserves quoted attributions as quotes", () => {
    expect(splitQuotedText("On Monday, Mira wrote:").segments[0]?.kind).toBe("body");
    expect(splitQuotedText("On A wrote:\nOn B wrote:\n> On C wrote:\n>> history").segments).toEqual(
      [
        { kind: "body", text: "On A wrote:\n", depth: 0 },
        { kind: "attribution", text: "On B wrote:\n", depth: 0 },
        { kind: "quote", text: "> On C wrote:\n", depth: 1 },
        { kind: "quote", text: ">> history", depth: 2 },
      ],
    );
    expect(splitQuotedText("> old\n\n> old again").segments.map(({ kind }) => kind)).toEqual([
      "quote",
      "body",
      "quote",
    ]);
  });

  it("handles long quote prefixes and repeated nonmatching attribution words within the limits", () => {
    const markers = ">".repeat(MAX_BODY_BYTES);
    expect(splitQuotedText(markers).segments).toEqual([
      { kind: "quote", text: markers, depth: MAX_BODY_BYTES },
    ]);
    const prose = `Am ${"Mira schrieb ".repeat(10_000)}no terminal colon`;
    expect(splitQuotedText(`${prose}\n> history`).visibleText).toBe(`${prose}\n`);
    for (const separator of ["\r", "\u2028", "\u2029"]) {
      const source = `Am ${"Mira schrieb ".repeat(10_000)}${separator}:`;
      expect(splitQuotedText(`${source}\n> history`).visibleText).toBe(`${source}\n`);
    }
    const manyLines = `${"a\n".repeat(MAX_BODY_LINES - 1)}a`;
    expect(reconstructed(manyLines)).toBe(manyLines);
  });

  const outlook = [
    "From: Mira Sage <mira@example.org>",
    "Sent: Monday, 26 October 2026",
    "To: Sol Vale <sol@example.org>",
    "Subject: Fictional meeting",
  ].join("\n");

  it("recognises a complete Outlook block immediately before a quote", () => {
    expect(splitQuotedText(`Intro\n${outlook}\n\n> old`).segments).toEqual([
      { kind: "body", text: "Intro\n", depth: 0 },
      { kind: "attribution", text: `${outlook}\n`, depth: 0 },
      { kind: "body", text: "\n", depth: 0 },
      { kind: "quote", text: "> old", depth: 1 },
    ]);
    expect(splitQuotedText(`${outlook}\n> old`).segments[0]?.kind).toBe("attribution");
  });

  it.each([
    "From: Mira\nSent: Monday\nTo: Sol",
    "From: Mira\nTo: Sol\nSent: Monday\nSubject: Meeting",
    "From: Mira\nSent: Monday\n\nTo: Sol\nSubject: Meeting",
    "From: Mira\nSent: Monday\nTo: Sol\nSubject: Meeting\nBody",
    "From: Mira\nSent: Monday\nTo: Sol\nSubject:",
    "> From: Mira\nSent: Monday\nTo: Sol\nSubject: Meeting",
    "Von: Mira\nGesendet: Montag\nAn: Sol\nBetreff: Treffen",
  ])("does not guess an incomplete or reordered Outlook block: %s", (source) => {
    expect(
      splitQuotedText(`${source}\n> old`).segments.some(({ kind }) => kind === "attribution"),
    ).toBe(false);
  });

  it.each(["-- ", "--"])("starts a signature at an exact %j delimiter", (delimiter) => {
    const result = splitQuotedText(`Body\n${delimiter}\nMira\nmira@example.org\n`);
    expect(result.segments).toEqual([
      { kind: "body", text: "Body\n", depth: 0 },
      { kind: "signature", text: `${delimiter}\nMira\nmira@example.org\n`, depth: 0 },
    ]);
    expect(result.visibleText).toBe("Body\n");
    expect(result.hasQuotedHistory).toBe(false);
    expect(splitQuotedText(delimiter).segments[0]?.kind).toBe("signature");
  });

  it("selects the last unquoted signature delimiter and stops at the next quote block", () => {
    expect(splitQuotedText("-- \nfirst\n--\nlast\n> -- \n> old\nBody after").segments).toEqual([
      { kind: "body", text: "-- \nfirst\n", depth: 0 },
      { kind: "signature", text: "--\nlast\n", depth: 0 },
      { kind: "quote", text: "> -- \n> old\n", depth: 1 },
      { kind: "body", text: "Body after", depth: 0 },
    ]);
    expect(
      splitQuotedText("--\nMira\nOn Monday, Sol wrote:\n> old").segments.map(({ kind }) => kind),
    ).toEqual(["signature", "attribution", "quote"]);
    expect(
      splitQuotedText("--\nold sig\n> old\n--\nnew sig").segments.map(({ kind }) => kind),
    ).toEqual(["body", "quote", "signature"]);
  });

  it.each([
    " -- ",
    "--  ",
    "---",
    "--\t",
    "-- name",
    "> -- ",
  ])("does not infer a signature from %j", (source) => {
    expect(
      splitQuotedText(`${source}\nMira`).segments.some(({ kind }) => kind === "signature"),
    ).toBe(false);
  });

  it.each([
    "---------- Forwarded message ---------",
    "---------- Forwarded message ----------",
    "-----Original Message-----",
  ])("treats %s and its unquoted remainder as forwarded history", (marker) => {
    const source = `Intro\n${marker}\n${outlook}\nForwarded body\n-- \nMira`;
    const result = splitQuotedText(source);
    expect(result.segments).toEqual([
      { kind: "body", text: "Intro\n", depth: 0 },
      { kind: "forwarded", text: `${marker}\n${outlook}\nForwarded body\n-- \nMira`, depth: 0 },
    ]);
    expect(result.visibleText).toBe("Intro\n");
    expect(result.hasQuotedHistory).toBe(true);
    expect(splitQuotedText(marker).segments[0]?.kind).toBe("forwarded");
  });

  it("recognises forwarded history emitted by the composer", () => {
    const draft = forward({
      from: { email: "mira@example.org", name: "Mira Sage" },
      subject: "Fictional meeting",
      text: "Earlier message.",
      date: new Date("2026-10-26T12:00:00Z"),
    });
    const source = `Intro${draft.text}`;
    const result = splitQuotedText(source);
    expect(result.visibleText).toBe("Intro\n\n");
    expect(result.hasQuotedHistory).toBe(true);
    expect(result.segments).toEqual([
      { kind: "body", text: "Intro\n\n", depth: 0 },
      {
        kind: "forwarded",
        text: "---------- Forwarded message ----------\nFrom: Mira Sage <mira@example.org>\nSubject: Fictional meeting\n\n",
        depth: 0,
      },
      {
        kind: "attribution",
        text: "On Mon, 26 Oct 2026 12:00:00 GMT, Mira Sage <mira@example.org> wrote:\n",
        depth: 0,
      },
      { kind: "quote", text: "> Earlier message.", depth: 1 },
    ]);
    expect(reconstructed(source)).toBe(source.replaceAll("\r\n", "\n"));
  });

  it("ends a signature at a forward and retains quote/attribution kinds inside history", () => {
    const marker = "-----Original Message-----";
    const source = `--\nSol\n${marker}\nOn Monday, Mira wrote:\n> old\nRemainder`;
    expect(splitQuotedText(source).segments.map(({ kind }) => kind)).toEqual([
      "signature",
      "forwarded",
      "attribution",
      "quote",
      "forwarded",
    ]);
    expect(splitQuotedText(`> ${marker}\nReply`).segments.map(({ kind }) => kind)).toEqual([
      "quote",
      "body",
    ]);
    for (const value of [` ${marker}`, `${marker} `, "-----original message-----"]) {
      expect(splitQuotedText(value).hasQuotedHistory).toBe(false);
    }
  });
});

describe("RFC 3676 flowed text", () => {
  it("requires explicit opt-in and ignores delSp on fixed text", () => {
    const source = " one \r\ntwo\r\n> quote \r\n> continued\r\n";
    expect(reconstructed(source)).toBe(source.replaceAll("\r\n", "\n"));
    expect(reconstructed(source, { flowed: false, delSp: true })).toBe(
      source.replaceAll("\r\n", "\n"),
    );
  });

  it("unflows runs, retaining one separating space by default and preserving hard breaks", () => {
    const source = "one \r\ntwo \r\nthree\r\n\r\nfour\r\nfive\r\n";
    const result = splitQuotedText(source, { flowed: true });
    expect(result.visibleText).toBe("one two three\n\nfour\nfive\n");
    expect(reconstructed(source, { flowed: true, delSp: false })).toBe(result.visibleText);
    expect(reconstructed("", { flowed: true })).toBe("");
  });

  it("deletes exactly one trailing space per flowed line when delSp is true", () => {
    expect(reconstructed("long \nword  \nend\n", { flowed: true, delSp: true })).toBe(
      "longword end\n",
    );
    expect(reconstructed("tab\t\nnext\n", { flowed: true, delSp: true })).toBe("tab\t\nnext\n");
    expect(reconstructed("text \n\nnext", { flowed: true, delSp: true })).toBe("text\nnext");
  });

  it.each(["", "\n", "\r\n"])("decodes terminal flowed lines ending in %j", (eol) => {
    const ending = eol === "" ? "" : "\n";
    for (const prefix of ["", "> "]) {
      for (const spaces of [" ", "  "]) {
        const source = `${prefix}hello${spaces}${eol}`;
        expect(reconstructed(source, { flowed: true, delSp: true })).toBe(
          `${prefix}hello${spaces.slice(0, -1)}${ending}`,
        );
        expect(reconstructed(source, { flowed: true, delSp: false })).toBe(
          source.replaceAll("\r\n", "\n"),
        );
      }
    }
  });

  it("joins equal-depth quotes using the first prefix, preserving transitions", () => {
    expect(
      splitQuotedText("> one \n>two\n>> three \n>> four\nbody \n> old", { flowed: true }).segments,
    ).toEqual([
      { kind: "quote", text: "> one two\n", depth: 1 },
      { kind: "quote", text: ">> three four\n", depth: 2 },
      { kind: "body", text: "body \n", depth: 0 },
      { kind: "quote", text: "> old", depth: 1 },
    ]);
    expect(reconstructed("> a \n>> b \nbody", { flowed: true, delSp: true })).toBe(
      "> a\n>> b\nbody",
    );
    expect(
      splitQuotedText("body \r\n> old \r\n>> nested \r\nbody again\r\n\r\nend", {
        flowed: true,
        delSp: true,
      }).segments,
    ).toEqual([
      { kind: "body", text: "body\n", depth: 0 },
      { kind: "quote", text: "> old\n", depth: 1 },
      { kind: "quote", text: ">> nested\n", depth: 2 },
      { kind: "body", text: "body again\n\nend", depth: 0 },
    ]);
  });

  it.each([
    {
      source: "> > a \r\n> > b\r\n",
      expected: "> > a > b\n",
      delSpExpected: "> > a> b\n",
      depth: 2,
    },
    {
      source: ">> > a \r\n>> > b\r\n",
      expected: ">> > a > b\n",
      delSpExpected: ">> > a> b\n",
      depth: 3,
    },
    {
      source: "> a \r\n> > b\r\n",
      expected: "> a > b\n",
      delSpExpected: "> a> b\n",
      depth: 1,
    },
    {
      source: "> > a \r\n>b\r\n",
      expected: "> > a b\n",
      delSpExpected: "> > ab\n",
      depth: 2,
    },
    {
      source: ">  > a \r\n>  > b\r\n",
      expected: ">  > a  > b\n",
      delSpExpected: ">  > a > b\n",
      depth: 2,
    },
    {
      source: "> > text \n> > -- \n> tail",
      expected: "> > text > -- tail",
      delSpExpected: "> > text> --tail",
      depth: 2,
    },
  ])("preserves literal markers while unflowing $source", ({
    source,
    expected,
    delSpExpected,
    depth,
  }) => {
    for (const delSp of [false, true]) {
      expect(splitQuotedText(source, { flowed: true, delSp })).toEqual({
        segments: [{ kind: "quote", text: delSp ? delSpExpected : expected, depth }],
        visibleText: "",
        hasQuotedHistory: true,
      });
    }
  });

  it.each([
    ["> > a \r\n>> b\r\n", "> > a \n>> b\n", "> > a\n>> b\n"],
    [">> a \r\n> > b\r\n", ">> a \n> > b\n", ">> a\n> > b\n"],
  ])("keeps RFC depth changes separate when API depths match: %j", (source, expected, delSpExpected) => {
    for (const delSp of [false, true]) {
      expect(splitQuotedText(source, { flowed: true, delSp }).segments).toEqual([
        { kind: "quote", text: delSp ? delSpExpected : expected, depth: 2 },
      ]);
    }
  });

  it("removes one stuffing space without turning escaped literal quotes into history", () => {
    const result = splitQuotedText(" From Mira\n  indent\n >literal \n >continued\n", {
      flowed: true,
    });
    expect(result).toEqual({
      segments: [{ kind: "body", text: "From Mira\n indent\n>literal >continued\n", depth: 0 }],
      visibleText: "From Mira\n indent\n>literal >continued\n",
      hasQuotedHistory: false,
    });
    expect(
      splitQuotedText(" >literal\n> quoted", { flowed: true }).segments.map(({ depth }) => depth),
    ).toEqual([0, 1]);
  });

  it("never flows signature separators, even inside quotes", () => {
    for (const delSp of [true, false]) {
      const space = delSp ? "" : " ";
      expect(splitQuotedText("body \n-- \nMira", { flowed: true, delSp }).segments).toEqual([
        { kind: "body", text: `body${space}\n`, depth: 0 },
        { kind: "signature", text: "-- \nMira", depth: 0 },
      ]);
      expect(reconstructed("> text \n> -- \n> Mira", { flowed: true, delSp })).toBe(
        `> text${space}\n> -- \n> Mira`,
      );
      expect(reconstructed("one \n--\nMira", { flowed: true, delSp })).toBe(
        `one${space}\n--\nMira`,
      );
      for (const signature of ["-- ", "> -- "]) {
        expect(reconstructed(signature, { flowed: true, delSp })).toBe(signature);
      }
    }
  });

  it("detects attributions after unflowing their physical lines", () => {
    expect(splitQuotedText("On Monday, Mira \nwrote:\n> old", { flowed: true }).segments).toEqual([
      { kind: "attribution", text: "On Monday, Mira wrote:\n", depth: 0 },
      { kind: "quote", text: "> old", depth: 1 },
    ]);
  });
});

describe("mail quote input limits and typed errors", () => {
  it("exports inclusive byte and line limits", () => {
    expect(MAX_BODY_BYTES).toBe(2_097_152);
    expect(MAX_BODY_LINES).toBe(50_000);
    const source = "a".repeat(MAX_BODY_BYTES);
    expect(reconstructed(source)).toBe(source);
    rejects(`${source}a`, "BODY_TOO_LARGE");
    const lines = "\n".repeat(MAX_BODY_LINES - 1);
    expect(reconstructed(lines)).toBe(lines);
    rejects(`${lines}\n`, "BODY_TOO_LARGE");
    expect(reconstructed(`${lines}x`)).toBe(`${lines}x`);
  });

  it.each([
    "é",
    "中",
    "🌲",
  ])("counts UTF-8 bytes for %s before allocating decoded text", (character) => {
    const width = new TextEncoder().encode(character).length;
    const source =
      character.repeat(Math.floor(MAX_BODY_BYTES / width)) + "a".repeat(MAX_BODY_BYTES % width);
    expect(new TextEncoder().encode(source)).toHaveLength(MAX_BODY_BYTES);
    expect(reconstructed(source)).toBe(source);
    rejects(`${source}a`, "BODY_TOO_LARGE");
  });

  it("bounds original CRLF bytes and physical lines even when flowing would shrink the body", () => {
    const source = "\r\n".repeat(MAX_BODY_LINES - 1);
    expect(reconstructed(source, { flowed: true })).toBe("\n".repeat(MAX_BODY_LINES - 1));
    rejects(`${source}\r\n`, "BODY_TOO_LARGE", { flowed: true });
    rejects("a \n".repeat(MAX_BODY_LINES), "BODY_TOO_LARGE", { flowed: true });
    const crlf = `${"a".repeat(MAX_BODY_BYTES - 2)}\r\n`;
    expect(reconstructed(crlf)).toBe(`${"a".repeat(MAX_BODY_BYTES - 2)}\n`);
    rejects(`${crlf}a`, "BODY_TOO_LARGE");
  });

  it.each([
    "\u0000",
    "before\u0000after",
    "\ud800",
    "\ud800a",
    "\udbff\ud800",
    "\udc00",
    "\udfff",
    "🌲\udc00",
  ])("rejects invalid Unicode %j without echoing content", (source) => {
    rejects(source, "INVALID_TEXT");
  });

  it("accepts complete surrogate pairs at both ends of the surrogate range", () => {
    const source = "\ud800\udc00\udbff\udfff";
    expect(reconstructed(source)).toBe(source);
  });

  it("fails closed on invalid runtime argument types", () => {
    for (const body of [null, undefined, 42, {}, ["text"]]) {
      rejects(body as string, "INVALID_TEXT");
    }
    for (const options of [
      null,
      true,
      "flowed",
      { flowed: 1 },
      { flowed: null },
      { delSp: "yes" },
    ]) {
      rejects("text", "INVALID_TEXT", options as QuoteOptions);
    }
    expect(
      splitQuotedText("text", { flowed: undefined, delSp: undefined } as unknown as QuoteOptions)
        .visibleText,
    ).toBe("text");
  });

  it("provides machine-readable codes and content-free messages", () => {
    for (const code of ["INVALID_TEXT", "BODY_TOO_LARGE"] as const) {
      const error = new QuoteError(code);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("QuoteError");
      expect(error.code).toBe(code);
      expect(error.message).toBe(`Mail quotes: ${code}`);
    }
  });
});

describe("lossless segmentation properties", () => {
  const scalar = fc
    .integer({ min: 1, max: 0x10ffff })
    .filter((point) => point < 0xd800 || point > 0xdfff)
    .map((point) => String.fromCodePoint(point));
  const prose = fc.array(scalar, { maxLength: 40 }).map((characters) => characters.join(""));
  const line = fc.oneof(
    prose,
    fc.constantFrom(
      "",
      "--",
      "-- ",
      "> quoted",
      ">> nested",
      "> > spaced",
      "On Monday, Mira wrote:",
      "Am Montag schrieb Mira:",
      "Le lundi, Mira a écrit :",
      "-----Original Message-----",
      "---------- Forwarded message ---------",
      "---------- Forwarded message ----------",
      "From: Mira",
      "Sent: Monday",
      "To: Sol",
      "Subject: Test",
    ),
  );

  it("reproduces all LF-normalised fixed input and derives visibleText only from body segments", () => {
    fc.assert(
      fc.property(
        fc.array(line, { maxLength: 80 }),
        fc.constantFrom("\n", "\r\n"),
        (lines, eol) => {
          const source = lines.join(eol);
          const result = splitQuotedText(source);
          expect(result.segments.map(({ text }) => text).join("")).toBe(
            source.replaceAll("\r\n", "\n"),
          );
          expect(result.visibleText).toBe(
            result.segments
              .filter(({ kind }) => kind === "body")
              .map(({ text }) => text)
              .join(""),
          );
          expect(result.hasQuotedHistory).toBe(
            result.segments.some(({ kind }) => kind === "quote" || kind === "forwarded"),
          );
          expect(
            result.segments.every(
              ({ text, depth, kind }) =>
                text.length > 0 && (kind === "quote" ? depth > 0 : depth === 0),
            ),
          ).toBe(true);
        },
      ),
      { numRuns: 500, seed: 3676 },
    );
  });

  it("reconstructs independently generated flowed logical paragraphs for either DelSp mode", () => {
    const word = fc
      .array(fc.constantFrom("a", "b", "é", "中", "🌲"), { minLength: 1, maxLength: 15 })
      .map((letters) => letters.join(""));
    fc.assert(
      fc.property(
        fc.array(word, { minLength: 1, maxLength: 30 }),
        fc.integer({ min: 0, max: 8 }),
        fc.boolean(),
        fc.boolean(),
        (words, depth, delSp, terminated) => {
          const prefix = depth === 0 ? "" : `${">".repeat(depth)} `;
          const eol = terminated ? "\r\n" : "";
          const source = words
            .map((word, index) => `${prefix}${word}${index < words.length - 1 ? " \r\n" : eol}`)
            .join("");
          const expected = `${prefix}${words.join(delSp ? "" : " ")}${terminated ? "\n" : ""}`;
          expect(reconstructed(source, { flowed: true, delSp })).toBe(expected);
        },
      ),
      { numRuns: 500, seed: 3677 },
    );
  });
});
