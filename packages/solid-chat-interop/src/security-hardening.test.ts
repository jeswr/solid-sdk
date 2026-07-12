// AUTHORED-BY Claude Fable 5.
/**
 * Adversarial external-readiness hardening — the injection + smuggling surface.
 *
 * Everything this package reads is FOREIGN, untrusted RDF and everything it writes
 * goes through `n3.Writer`, which does NOT escape IRIs. These tests refute the two
 * classes of attack that a bare http(s)-only string filter does NOT stop:
 *
 *  1. **IRI injection** — an untrusted IRI-valued object (author / inReplyTo / …)
 *     that VALIDATES as an absolute http(s) URL yet carries a Turtle-`IRIREF`-illegal
 *     character (`>` breaks out of `<…>` and injects arbitrary triples; `|`/`^`/`\`
 *     in a fragment yield an invalid `IRIREF`). The fix LEXICALLY percent-encodes
 *     every forbidden character, so no injection character reaches `namedNode()`.
 *  2. **Control-character smuggling** — a body/title carrying `ESC`/`DEL`/C1 control
 *     bytes that `n3.Writer` emits RAW into the serialised literal. The fix strips
 *     them (keeping `\t`/`\n`/`\r`).
 */

import { Parser } from "n3";
import { describe, expect, it } from "vitest";
import { buildAs2Message, parseAs2Message } from "./as2.js";
import { safeHttpIri, sanitizeText } from "./iri.js";
import { LibreChatAdapter } from "./librechat.js";
import { buildLongChatMessage } from "./longchat.js";
import { serializeAs2, serializeLongChat } from "./reconcile.js";

const SUBJECT = "https://alice.example/chat/room1/msg1.ttl#it";

// A hostile author IRI that PASSES `new URL()` (so a bare http(s) check accepts it)
// but whose raw `>` would break out of `<…>` and inject a triple under n3.Writer.
const BREAKOUT_AUTHOR =
  "https://evil.example/a> <https://alice.example/chat/room1/msg1.ttl#it> <http://www.w3.org/ns/prov#wasAttributedTo> <https://evil.example/pwned";

describe("safeHttpIri — percent-encodes + neutralises IRI-injection characters", () => {
  it("accepts a clean http(s) IRI unchanged", () => {
    expect(safeHttpIri("https://alice.example/profile/card#me")).toBe(
      "https://alice.example/profile/card#me",
    );
    expect(safeHttpIri("http://x.example/a")).toBe("http://x.example/a");
  });

  it("drops non-http(s) and empty values", () => {
    for (const v of ["javascript:alert(1)", "mailto:a@b.example", "urn:uuid:1", "not-a-url", ""]) {
      expect(safeHttpIri(v)).toBeUndefined();
    }
    expect(safeHttpIri(undefined)).toBeUndefined();
  });

  it("percent-encodes a break-out '>' so it can never close an IRIREF", () => {
    const safe = safeHttpIri("http://ex.org/a>b");
    expect(safe).toBeDefined();
    expect(safe).not.toContain(">");
    expect(safe).toContain("%3E");
  });

  it("percent-encodes residual '|', '^', '\\' left unencoded by URL in a fragment", () => {
    expect(safeHttpIri("http://ex.org/foo#a|b")).not.toContain("|");
    expect(safeHttpIri("http://ex.org/foo#a^b")).not.toContain("^");
    expect(safeHttpIri("http://ex.org/foo#a" + "\\" + "b")).not.toContain("\\");
  });

  it("leaves no Turtle-IRIREF-forbidden character in its output", () => {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting the output carries NO forbidden byte.
    const Forbidden = /[\u0000-\u0020<>"{}|^`\\]/;
    for (const v of [
      "http://ex.org/a>b",
      "http://ex.org/foo#a|b^c`d",
      "http://ex.org/x y",
      BREAKOUT_AUTHOR,
    ]) {
      const safe = safeHttpIri(v);
      expect(safe).toBeDefined();
      expect(Forbidden.test(safe as string)).toBe(false);
    }
  });
});

describe("AS2.0 write — an IRI-injection author cannot inject triples", () => {
  it("emits no NamedNode carrying a raw '>' and injects no extra triple", async () => {
    const store = buildAs2Message(SUBJECT, {
      content: "hi",
      mediaType: "text/plain",
      author: BREAKOUT_AUTHOR,
    });
    for (const q of store) {
      if (q.object.termType === "NamedNode") expect(q.object.value).not.toContain(">");
    }

    // Serialise and RE-PARSE: the graph must contain exactly the subject we wrote,
    // never the attacker's `https://evil.example/chat...msg1#it` injected subject.
    const turtle = await serializeAs2(
      { content: "hi", mediaType: "text/plain", author: BREAKOUT_AUTHOR },
      SUBJECT,
    );
    const quads = new Parser({ format: "text/turtle" }).parse(turtle);
    const subjects = new Set(quads.map((q) => q.subject.value));
    expect(subjects).toEqual(new Set([SUBJECT]));
    // No triple asserts the attacker-controlled pwned object.
    expect(
      quads.some((q) => q.object.value.includes("pwned") && q.object.value.includes(" ")),
    ).toBe(false);
  });

  it("round-trips the encoded author as a single well-formed NamedNode", () => {
    const store = buildAs2Message(SUBJECT, {
      content: "hi",
      mediaType: "text/plain",
      author: "http://ex.org/a>b",
    });
    const msg = parseAs2Message(SUBJECT, store);
    expect(msg?.author).toBe("http://ex.org/a%3Eb");
  });

  // Explicit end-to-end regression over the canonical @jeswr/rdf-serialize guard:
  // the classic `http://evil/> <s> <p> .` Turtle-breakout payload (passes new URL())
  // must NOT be able to inject a triple through this repo's public serialize API.
  it("neutralises the classic '> <s> <p> .' breakout payload through serializeAs2", async () => {
    const payload = "http://evil/> <http://evil/s> <http://evil/p> <http://evil/o> .";
    const turtle = await serializeAs2(
      { content: "hi", mediaType: "text/plain", author: payload },
      SUBJECT,
    );
    const quads = new Parser({ format: "text/turtle" }).parse(turtle);
    // Exactly one subject (ours) — the attacker's `<http://evil/s>` never becomes a subject.
    expect(new Set(quads.map((q) => q.subject.value))).toEqual(new Set([SUBJECT]));
    // No NamedNode carries a raw '>' and no attacker predicate/object leaked in.
    for (const q of quads) {
      if (q.object.termType === "NamedNode") expect(q.object.value).not.toContain(">");
      expect(q.predicate.value).not.toBe("http://evil/p");
    }
  });
});

describe("LongChat write — an IRI-injection author cannot inject triples", () => {
  it("emits no NamedNode carrying a raw '>'", () => {
    const store = buildLongChatMessage(SUBJECT, {
      content: "hi",
      mediaType: "text/plain",
      author: BREAKOUT_AUTHOR,
      inReplyTo: BREAKOUT_AUTHOR,
    });
    for (const q of store) {
      if (q.object.termType === "NamedNode") expect(q.object.value).not.toContain(">");
    }
  });
});

describe("subject IRI is validated + injection-escaped (fail closed)", () => {
  it("throws on a non-http(s) subject rather than emitting a malformed graph", () => {
    expect(() => buildAs2Message("urn:uuid:x", { content: "x", mediaType: "text/plain" })).toThrow(
      /absolute http\(s\) IRI/,
    );
    expect(() =>
      buildLongChatMessage("mailto:a@b.example", { content: "x", mediaType: "text/plain" }),
    ).toThrow(/absolute http\(s\) IRI/);
  });

  it("percent-encodes an injection character in the subject (no break-out)", async () => {
    const hostileSubject = "https://alice.example/x#it> <http://evil> <http://p> <http://o";
    const turtle = await serializeAs2({ content: "x", mediaType: "text/plain" }, hostileSubject);
    const quads = new Parser({ format: "text/turtle" }).parse(turtle);
    const subjects = [...new Set(quads.map((q) => q.subject.value))];
    // Exactly ONE subject, still rooted at the real authority — the attacker's
    // injected `<http://evil>`/`<http://p>`/`<http://o>` did NOT become their own
    // subject; the whole payload collapsed into one safe percent-encoded fragment.
    expect(subjects).toHaveLength(1);
    const only = subjects[0] as string;
    expect(only).not.toContain(">");
    expect(new URL(only).origin).toBe("https://alice.example");
  });
});

describe("body/title control-character smuggling is stripped", () => {
  const Esc = String.fromCharCode(0x1b);
  const Nul = String.fromCharCode(0x00);
  const Del = String.fromCharCode(0x7f);
  const C1 = String.fromCharCode(0x9b); // CSI
  const Smuggled = `hello${Esc}[31m${Nul}world${Del}${C1}`;

  it("sanitizeText strips C0/C1 controls but keeps tab/newline/CR", () => {
    expect(sanitizeText(Smuggled)).toBe("hello[31mworld");
    expect(sanitizeText("a\tb\nc\rd")).toBe("a\tb\nc\rd");
    expect(sanitizeText(undefined)).toBeUndefined();
  });

  it("AS2.0 serialised body carries no raw control byte", async () => {
    const turtle = await serializeAs2(
      { content: Smuggled, mediaType: "text/plain", task: { state: "open", title: Smuggled } },
      SUBJECT,
    );
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting NO raw smuggling control byte survives.
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(turtle)).toBe(false);
    // The visible text survives.
    const msg = parseAs2Message(
      SUBJECT,
      buildAs2Message(SUBJECT, { content: Smuggled, mediaType: "text/plain" }),
    );
    expect(msg?.content).toBe("hello[31mworld");
  });

  it("LongChat serialised body carries no raw control byte", async () => {
    const turtle = await serializeLongChat({ content: Smuggled, mediaType: "text/plain" }, SUBJECT);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: asserting NO raw smuggling control byte survives.
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(turtle)).toBe(false);
  });
});

describe("LibreChat adapter — an absolute id with an injection char is percent-escaped", () => {
  it("percent-escapes a conversationId carrying a raw '>' rather than passing it through", () => {
    const adapter = new LibreChatAdapter();
    const msg = adapter.toCanonical({
      text: "x",
      isCreatedByUser: true,
      conversationId: "https://rooms.example/r>injected",
    });
    expect(msg.room).toBeDefined();
    expect(msg.room).not.toContain(">");
    expect(msg.room).toContain("%3E");
  });
});
