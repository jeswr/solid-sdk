// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
/**
 * Tests for the AS2.0 activity model — typed build + Turtle round-trip, IRI
 * coercion safety, and the read-side accessors.
 */
import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory, Parser } from "n3";
import { describe, expect, it } from "vitest";
import {
  ActivityDoc,
  buildActivity,
  escapeIri,
  isHttpIri,
  safeHttpIri,
  serializeTurtle,
} from "./activity.js";

const AS = "https://www.w3.org/ns/activitystreams#";

describe("isHttpIri", () => {
  it("accepts http(s) absolute URLs", () => {
    expect(isHttpIri("https://alice.example/card#me")).toBe(true);
    expect(isHttpIri("http://bob.example/profile")).toBe(true);
  });
  it("rejects undefined, non-http schemes, and non-URLs", () => {
    expect(isHttpIri(undefined)).toBe(false);
    expect(isHttpIri("")).toBe(false);
    expect(isHttpIri("mailto:a@b.com")).toBe(false);
    expect(isHttpIri("ftp://x/")).toBe(false);
    expect(isHttpIri("just text")).toBe(false);
    expect(isHttpIri("urn:uuid:1234")).toBe(false);
  });
});

describe("buildActivity + serializeTurtle", () => {
  it("builds a complete AS2.0 notification and serialises with the as: prefix", async () => {
    const published = new Date("2026-01-02T03:04:05.000Z");
    const store = buildActivity({
      type: "Invite",
      actor: "https://alice.example/card#me",
      object: "https://bob.example/chat/",
      target: "https://bob.example/inbox/",
      summary: "Join the chat",
      content: "Alice invited you to a chat.",
      published,
    });
    const ttl = await serializeTurtle(store);
    expect(ttl).toContain("@prefix as:");
    expect(ttl).toContain("as:Invite");
    expect(ttl).toContain("as:actor");

    // Round-trip: parse it back and read via the typed accessors.
    const ds = await parseRdf(ttl, "text/turtle", {
      baseIRI: "https://x.example/n",
    });
    // The subject was the relative #it, resolved against the base.
    const doc = new ActivityDoc("https://x.example/n#it", ds, DataFactory);
    expect([...doc.types]).toContain(`${AS}Invite`);
    expect(doc.actor).toBe("https://alice.example/card#me");
    expect(doc.activityObject).toBe("https://bob.example/chat/");
    expect(doc.target).toBe("https://bob.example/inbox/");
    expect(doc.summary).toBe("Join the chat");
    expect(doc.content).toBe("Alice invited you to a chat.");
    expect(doc.published?.toISOString()).toBe(published.toISOString());
  });

  it("defaults published to now when omitted", () => {
    const before = Date.now();
    const store = buildActivity({
      type: "Announce",
      actor: "https://alice.example/card#me",
    });
    const doc = new ActivityDoc("#it", store, DataFactory);
    const ts = doc.published?.getTime() ?? 0;
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("NEVER coerces a non-http object/target/actor into a NamedNode", () => {
    const store = buildActivity({
      type: "Announce",
      actor: "not a url",
      object: "mailto:x@y.com",
      target: "javascript:alert(1)",
    });
    const doc = new ActivityDoc("#it", store, DataFactory);
    expect(doc.actor).toBeUndefined();
    expect(doc.activityObject).toBeUndefined();
    expect(doc.target).toBeUndefined();
  });

  it("drops empty/whitespace summary + content", () => {
    const store = buildActivity({
      type: "Announce",
      actor: "https://alice.example/card#me",
      summary: "   ",
      content: "",
    });
    const doc = new ActivityDoc("#it", store, DataFactory);
    expect(doc.summary).toBeUndefined();
    expect(doc.content).toBeUndefined();
  });

  it("can root the activity at an explicit subject", async () => {
    const store = buildActivity(
      { type: "Create", actor: "https://alice.example/card#me" },
      "https://alice.example/n1#it",
    );
    const ttl = await serializeTurtle(store);
    expect(ttl).toContain("alice.example/n1");
  });
});

describe("safeHttpIri", () => {
  it("canonicalises safe http(s) IRIs", () => {
    expect(safeHttpIri("https://alice.example/card#me")).toBe("https://alice.example/card#me");
    // The URL parser percent-encodes Turtle-terminating characters.
    expect(safeHttpIri("https://evil/x> y")).not.toContain(">");
    expect(safeHttpIri("https://evil/x> y")).not.toContain(" ");
  });
  it("percent-encodes the URL-parser-tolerated Turtle-forbidden chars |, ^, `", () => {
    const out = safeHttpIri("https://evil/a|b^c`d");
    expect(out).toBeDefined();
    expect(out).not.toContain("|");
    expect(out).not.toContain("^");
    expect(out).not.toContain("`");
  });
  it("encodes the FULL IRIREF-forbidden set incl. { } \\ left raw by the URL parser (Medium regression)", () => {
    // The WHATWG URL parser leaves `{ } \` intact in the query/fragment, so the
    // pre-fix `.href`-based guard (which only post-encoded | ^ `) emitted them raw
    // — a `}` or `\` in a NamedNode value can still break Turtle parsing.
    const out = safeHttpIri("https://evil/p?a={b}#c\\d`e^f|g");
    expect(out).toBeDefined();
    for (const forbidden of ["{", "}", "\\", "`", "^", "|", "<", ">", '"', " "]) {
      expect(out).not.toContain(forbidden);
    }
    // Round-trips through a real Turtle parser as ONE NamedNode (no breakout).
    const doc = `<https://x/#it> <https://x/p> <${out}> .`;
    const quads = new Parser().parse(doc);
    expect(quads).toHaveLength(1);
  });
  it("preserves the LEXICAL value (does NOT canonicalise via .href)", () => {
    // A default port, upper-case host, and a dot-segment are RDF-lexically
    // significant — `.href` would drop/rewrite them, changing the identity.
    expect(safeHttpIri("https://alice.example:443/x")).toBe("https://alice.example:443/x");
    expect(safeHttpIri("https://Alice.EXAMPLE/x")).toBe("https://Alice.EXAMPLE/x");
    expect(safeHttpIri("https://alice.example/a/./b")).toBe("https://alice.example/a/./b");
  });
  it("REJECTS a value with leading/trailing C0-control-or-space (WHATWG trims → would diverge)", () => {
    // `" https://x"` parses (trimmed) as https://x, but escapeIri(original) would
    // emit `%20https://x` — a different, malformed IRI. Reject outright.
    expect(safeHttpIri(" https://alice.example/x")).toBeUndefined();
    expect(safeHttpIri("https://alice.example/x ")).toBeUndefined();
    expect(safeHttpIri("\thttps://alice.example/x")).toBeUndefined();
    expect(safeHttpIri("https://alice.example/x\n")).toBeUndefined();
    expect(safeHttpIri("\0https://alice.example/x")).toBeUndefined();
  });
  it("never lets the URL parser silently STRIP an EMBEDDED tab/newline/CR (Medium regression)", () => {
    // WHATWG URL removes embedded U+0009/000A/000D from ANYWHERE before parsing, so
    // validating the raw value and emitting an escaped copy could disagree. With
    // escape-first, an embedded control in the SCHEME/AUTHORITY breaks the parse
    // (rejected)…
    expect(safeHttpIri("ht\ntps://alice.example/x")).toBeUndefined();
    expect(safeHttpIri("https://al\tice.example/x")).toBeUndefined();
    expect(safeHttpIri("https://alice.example\r/x")).toBeUndefined();
    // …and an embedded control in the PATH is safely %XX-encoded (never stripped),
    // so the emitted IRI still denotes exactly the escaped string (one NamedNode).
    for (const [input, needle] of [
      ["https://alice.example/a\nb", "%0A"],
      ["https://alice.example/a\tb", "%09"],
      ["https://alice.example/a\rb", "%0D"],
    ] as const) {
      const out = safeHttpIri(input);
      expect(out).toBeDefined();
      expect(out).toContain(needle);
      // No raw control byte survived, and it round-trips as ONE NamedNode. (Code-
      // point check, not a control-character regex, which the linter forbids.)
      expect([...(out as string)].every((c) => (c.codePointAt(0) ?? 0) > 0x1f)).toBe(true);
      const quads = new Parser().parse(`<https://x/#i> <https://x/p> <${out}> .`);
      expect(quads).toHaveLength(1);
    }
    // A clean IRI with a default port is emitted BYTE-IDENTICAL.
    expect(safeHttpIri("https://h:443/x")).toBe("https://h:443/x");
  });
  it("rejects non-http(s) / non-URL / non-string values", () => {
    expect(safeHttpIri(undefined)).toBeUndefined();
    // biome-ignore lint/suspicious/noExplicitAny: exercising a non-string arg at runtime.
    expect(safeHttpIri(123 as any)).toBeUndefined();
    expect(safeHttpIri("mailto:a@b.com")).toBeUndefined();
    expect(safeHttpIri("just text")).toBeUndefined();
  });
});

describe("escapeIri (lexical, scheme-agnostic Turtle-IRIREF escape)", () => {
  it("leaves a well-formed IRI byte-for-byte unchanged", () => {
    expect(escapeIri("https://alice.example/card#me")).toBe("https://alice.example/card#me");
    expect(escapeIri("urn:uuid:1234")).toBe("urn:uuid:1234");
    expect(escapeIri("did:web:alice.example")).toBe("did:web:alice.example");
  });
  it("percent-encodes EXACTLY the IRIREF-forbidden set and nothing else", () => {
    // The residual set the Medium finding named — { } \ — plus the full complement.
    expect(escapeIri("a{b}c")).toBe("a%7Bb%7Dc");
    expect(escapeIri("a\\b")).toBe("a%5Cb");
    expect(escapeIri("a`b")).toBe("a%60b");
    expect(escapeIri("a^b")).toBe("a%5Eb");
    expect(escapeIri("a|b")).toBe("a%7Cb");
    expect(escapeIri("a<b>c")).toBe("a%3Cb%3Ec");
    expect(escapeIri('a"b')).toBe("a%22b");
    expect(escapeIri("a b")).toBe("a%20b"); // space (U+0020)
    expect(escapeIri("a\tb")).toBe("a%09b"); // control (U+0009)
    // A non-forbidden reserved char is preserved (only the IRIREF set is touched).
    expect(escapeIri("a%20b")).toBe("a%20b");
  });
});

describe("Turtle IRI-injection guard (n3.Writer does NOT escape IRIs)", () => {
  // Payload that, written RAW between <…>, would break out of the actor IRI and
  // inject a second, attacker-chosen triple into the serialised (then POSTed) doc.
  const Injection = "https://evil/x> . <https://evil/s2> <https://evil/p2> <https://evil/o2";

  it("does not let a hostile actor inject a second triple", async () => {
    const store = buildActivity({
      type: "Announce",
      actor: Injection,
      object: "https://bob.example/chat/",
    });
    const ttl = await serializeTurtle(store);
    const quads = new Parser().parse(ttl);
    // The smuggled subject/predicate/object must NOT appear as its own triple.
    for (const q of quads) {
      expect(q.subject.value).not.toBe("https://evil/s2");
      expect(q.predicate.value).not.toBe("https://evil/p2");
      expect(q.object.value).not.toBe("https://evil/o2");
    }
    // And the raw breakout sequence never reaches the wire.
    expect(ttl).not.toContain("> . <https://evil/s2>");
  });
});

describe("subject IRI-injection (HIGH — the activity SUBJECT is the id of every quad)", () => {
  it("THROWS on a hostile #-fragment subject that would break out of <…>", () => {
    // A fragment-shaped subject carrying a breakout: it starts with `#` but has a
    // space + `>` + `<`, so it is NOT a safe fragment and NOT a valid absolute IRI.
    const hostile = "#it> <https://evil/s> <https://evil/p> <https://evil/o> .";
    expect(() =>
      buildActivity({ type: "Announce", actor: "https://alice.example/card#me" }, hostile),
    ).toThrow(TypeError);
  });

  it("THROWS on a non-fragment, non-http subject (fails closed, no injected triple)", () => {
    expect(() =>
      buildActivity({ type: "Announce", actor: "https://alice.example/card#me" }, "not a url"),
    ).toThrow(/absolute http\(s\) IRI/);
  });

  it("NEUTRALISES (escapes, no breakout) an absolute-IRI-shaped injection subject", async () => {
    // An http(s)-parseable subject carrying breakout bytes is NOT thrown (it IS a
    // structurally-valid URL) but MUST be emitted lexically-escaped so it stays one
    // NamedNode — no attacker triple, no raw breakout on the wire.
    const hostile = "https://evil/x> . <https://evil/s2> <https://evil/p2> <https://evil/o2";
    const store = buildActivity(
      { type: "Announce", actor: "https://alice.example/card#me" },
      hostile,
    );
    const ttl = await serializeTurtle(store);
    const quads = new Parser().parse(ttl);
    for (const q of quads) {
      expect(q.subject.value).not.toBe("https://evil/s2");
      expect(q.predicate.value).not.toBe("https://evil/p2");
      expect(q.object.value).not.toBe("https://evil/o2");
    }
    expect(ttl).not.toContain("> . <https://evil/s2>");
  });

  it("accepts the safe #it default (and other safe #-fragments)", async () => {
    const store = buildActivity({
      type: "Announce",
      actor: "https://alice.example/card#me",
    });
    const ttl = await serializeTurtle(store);
    // #it resolves against the parse base — read it back via the typed accessor.
    const ds = await parseRdf(ttl, "text/turtle", {
      baseIRI: "https://x.example/n",
    });
    const doc = new ActivityDoc("https://x.example/n#it", ds, DataFactory);
    expect(doc.actor).toBe("https://alice.example/card#me");

    expect(() =>
      buildActivity(
        { type: "Announce", actor: "https://alice.example/card#me" },
        "#custom-thing_1",
      ),
    ).not.toThrow();
  });

  it("round-trips a CLEAN absolute subject BYTE-IDENTICAL (lexical preservation)", async () => {
    // A default port is lexically significant and must survive verbatim; `.href`
    // would have dropped `:443`.
    const subject = "https://alice.example:8443/n1/./x#it";
    const store = buildActivity(
      { type: "Create", actor: "https://alice.example/card#me" },
      subject,
    );
    const ttl = await serializeTurtle(store);
    expect(ttl).toContain(`<${subject}>`);
    const quads = new Parser().parse(ttl);
    expect(quads.some((q) => q.subject.value === subject)).toBe(true);
  });
});
