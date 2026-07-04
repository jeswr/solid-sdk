// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import { granaryToCanonical } from "../src/ingest.js";
import { granaryObjectToCanonical, importedDate, refToIri, safeHttpIri } from "../src/map.js";
import { hostileNote, mastodonNote, messyFeed, rssFeed } from "./fixtures.js";

// NOTE: `safeHttpIri` is no longer implemented in this repo — it is re-exported from
// `@jeswr/rdf-serialize` (the suite's single audited IRI-safety guard), whose own test
// suite exhaustively covers the injection-escaping contract (`>`-breakout, control
// chars, non-http scheme, `|`/`^`/`` ` ``/`{`/`}` residual escaping, lexical identity
// preservation). The granary-level injection-safety property — that a hostile IRI in a
// payload cannot break out of the SERIALISED Turtle through the public `ingestGranary`
// API — is proved end-to-end in `ingest.test.ts` ("a hostile `>`-bearing IRI cannot
// inject triples into the written Turtle"). So no local unit copy of those assertions
// lives here; `refToIri` below exercises the map's use of the imported guard.

// Boundary smoke test for the RE-EXPORT: this package depends on the exact security
// contract of `safeHttpIri` at every IRI mapping call site (`refToIri`, `room`,
// `derivedFrom`), so pin that the symbol re-exported from `../src/map.js` still resolves
// to the http(s)-only, injection-escaping guard — a mis-wired re-export (e.g. to the
// scheme-agnostic `safeIri`, or a dropped import) would be caught here rather than in
// prod. Exhaustive cases live in `@jeswr/rdf-serialize`; this guards THIS package's wiring.
describe("safeHttpIri (re-export contract smoke test)", () => {
  it("keeps a clean http(s) IRI usable", () => {
    expect(safeHttpIri("https://example.org/profile#me")).toBe("https://example.org/profile#me");
  });
  it("drops non-http(s) schemes (never widened to a scheme-agnostic guard)", () => {
    expect(safeHttpIri("mailto:alice@example.com")).toBeUndefined();
    expect(safeHttpIri("urn:uuid:1234")).toBeUndefined();
    expect(safeHttpIri("javascript:alert(1)")).toBeUndefined();
  });
  it("neutralises a Turtle-IRIREF breakout payload (the `>` cannot survive)", () => {
    const safe = safeHttpIri(
      "http://evil.example/o> . <http://victim.example/s> <http://p> <http://o",
    );
    expect(safe).toBeDefined();
    expect(safe).not.toContain(">");
    expect(safe).not.toContain(" ");
  });
});

describe("refToIri", () => {
  it("resolves a bare http(s) IRI string", () => {
    expect(refToIri("https://example.org/a")).toBe("https://example.org/a");
  });
  it("resolves an embedded actor's id, preferred over url", () => {
    expect(refToIri({ id: "https://example.org/id", url: "https://example.org/url" })).toBe(
      "https://example.org/id",
    );
  });
  it("falls back to the first url when no id", () => {
    expect(refToIri({ url: ["https://a.example/1", "https://a.example/2"] })).toBe(
      "https://a.example/1",
    );
  });
  it("returns the first valid IRI from an array of refs", () => {
    expect(refToIri(["mailto:x@y", "https://ok.example/z"])).toBe("https://ok.example/z");
  });
  it("drops non-http(s) values (javascript:, mailto:, urn:, bare string)", () => {
    expect(refToIri("javascript:alert(1)")).toBeUndefined();
    expect(refToIri("mailto:a@b.c")).toBeUndefined();
    expect(refToIri("urn:uuid:1")).toBeUndefined();
    expect(refToIri("not a url")).toBeUndefined();
    expect(refToIri({ id: "javascript:evil()" })).toBeUndefined();
  });
  it("returns undefined for absent/null", () => {
    expect(refToIri(undefined)).toBeUndefined();
    // biome-ignore lint/suspicious/noExplicitAny: testing null robustness.
    expect(refToIri(null as any)).toBeUndefined();
  });
});

describe("importedDate", () => {
  it("normalises a valid ISO date", () => {
    expect(importedDate("2026-06-20T10:00:00Z")).toBe("2026-06-20T10:00:00.000Z");
  });
  it("drops a garbage/absent/non-string date", () => {
    expect(importedDate("not-a-date")).toBeUndefined();
    expect(importedDate("")).toBeUndefined();
    expect(importedDate(undefined)).toBeUndefined();
    expect(importedDate(123)).toBeUndefined();
    expect(importedDate({})).toBeUndefined();
  });
});

describe("granaryObjectToCanonical", () => {
  it("maps a Mastodon Note with object-valued actor + reply", () => {
    const msg = granaryObjectToCanonical(mastodonNote);
    expect(msg.content).toBe("Just shipped @jeswr/solid-granary 🌾");
    expect(msg.mediaType).toBe("text/html");
    expect(msg.author).toBe("https://mastodon.social/users/alice");
    expect(msg.published).toBe("2026-06-20T09:30:00.000Z");
    expect(msg.inReplyTo).toBe("https://mastodon.social/users/bob/statuses/109999");
    // imported → provenance carries source author + permalink
    expect(msg.provenance?.attributedTo).toBe("https://mastodon.social/users/alice");
    expect(msg.provenance?.derivedFrom).toBe("https://mastodon.social/@alice/110001");
  });

  it("recovers content from contentMap when content is absent", () => {
    const [, second] = granaryToCanonical(rssFeed);
    expect(second.content).toBe("Second post body (contentMap)");
  });

  it("defaults mediaType to text/plain when absent or wrong-typed", () => {
    const msg = granaryObjectToCanonical({ type: "Note", content: "x" });
    expect(msg.mediaType).toBe("text/plain");
  });

  it("uses context then conversation as the room, http(s)-filtered", () => {
    expect(
      granaryObjectToCanonical({ type: "Note", content: "x", context: "https://room.example/r" })
        .room,
    ).toBe("https://room.example/r");
    expect(
      granaryObjectToCanonical({
        type: "Note",
        content: "x",
        conversation: "https://conv.example/c",
      }).room,
    ).toBe("https://conv.example/c");
    expect(
      granaryObjectToCanonical({ type: "Note", content: "x", conversation: "urn:bad" }).room,
    ).toBeUndefined();
  });

  it("HARDENING: a hostile/malformed object drops every bad field, never throws", () => {
    const msg = granaryObjectToCanonical(hostileNote);
    // wrong-typed content dropped → contentMap recovered
    expect(msg.content).toBe("recovered body from contentMap");
    // wrong-typed mediaType → default
    expect(msg.mediaType).toBe("text/plain");
    // non-http(s) author / reply / room / id-permalink all dropped
    expect(msg.author).toBeUndefined();
    expect(msg.inReplyTo).toBeUndefined();
    expect(msg.room).toBeUndefined();
    // garbage published dropped
    expect(msg.published).toBeUndefined();
    // no salvageable provenance IRI → no provenance object
    expect(msg.provenance).toBeUndefined();
  });

  it("HARDENING: a feed of junk + one good item imports only the good item", () => {
    const msgs = granaryToCanonical(messyFeed);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]?.content).toBe("the one good item");
    expect(msgs[0]?.author).toBe("https://example.org/eve");
  });
});
