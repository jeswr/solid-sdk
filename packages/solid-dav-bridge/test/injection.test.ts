// AUTHORED-BY Claude Fable 5
/**
 * RDF/Turtle INJECTION regression suite.
 *
 * An attacker who controls the imported CalDAV/CardDAV feed must NOT be able to
 * inject arbitrary triples into the owner's pod resource. The pre-fix bug: a
 * hostile `URL:` (event) or `UID:`/`URL:` (contact) value was emitted as a RAW IRI
 * term — and `n3.Writer` does NOT escape IRIs — so a value containing `>` broke out
 * of the `<...>` IRIREF and injected triples (e.g. a forged `solid:oidcIssuer` on
 * the victim's WebID). The fix canonicalises every untrusted IRI via `safeHttpIri`.
 */
import { serializePerson } from "@jeswr/solid-task-model/contacts";
import { Parser, Store, Writer } from "n3";
import { describe, expect, it } from "vitest";
import { findComponents, parseComponents } from "../src/ical.js";
import { vcardToContact, veventToEvent } from "../src/map.js";
import { SCHEMA_URL, safeHttpIri } from "../src/vocab.js";

/** Serialise event quads exactly as the ingest layer does (n3.Writer over a Store). */
function eventToTurtle(quads: ReturnType<typeof veventToEvent>["quads"]): Promise<string> {
  const writer = new Writer();
  writer.addQuads([...new Store(quads)]);
  return new Promise((resolve, reject) => {
    writer.end((err, res) => (err ? reject(err) : resolve(res)));
  });
}

/** Injection-critical characters that must never survive into an emitted IRIREF. */
const ILLEGAL = ["<", ">", '"', " ", "\n", "{", "}", "|"];

/** The forged-triple payload an attacker would try to smuggle in. */
const FORGED =
  "> . <https://victim.pod.example/profile/card#me> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://attacker.example/> . <https://dummy/#s> <https://dummy/#p> <https://dummy/#o";

describe("RDF injection is neutralised (event schema:url)", () => {
  it("a hostile VEVENT URL cannot inject triples and its IRI carries no illegal char", async () => {
    const ics = [
      "BEGIN:VEVENT",
      "UID:x",
      "SUMMARY:hi",
      `URL:https://e.org/a${FORGED}`,
      "END:VEVENT",
    ].join("\r\n");
    const mapped = veventToEvent(findComponents(parseComponents(ics), "VEVENT")[0]!, {
      subject: "https://alice.pod.example/imports/ev.ttl#it",
    });
    const iri = mapped.quads.find((q) => q.predicate.value === SCHEMA_URL)?.object.value ?? "";
    expect(iri.length).toBeGreaterThan(0);
    for (const ch of ILLEGAL) expect(iri).not.toContain(ch);

    const turtle = await eventToTurtle(mapped.quads);
    const quads = new Parser().parse(turtle);
    // NO forged triple materialised
    expect(quads.some((q) => q.predicate.value.includes("oidcIssuer"))).toBe(false);
    expect(quads.some((q) => q.subject.value.includes("victim.pod.example"))).toBe(false);
  });
});

describe("RDF injection is neutralised (contact webId)", () => {
  it("a hostile vCard UID cannot inject triples through serializePerson", async () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:4.0",
      "FN:Bob",
      `UID:https://e.org/x${FORGED}`,
      "END:VCARD",
    ].join("\r\n");
    const mapped = vcardToContact(findComponents(parseComponents(vcf), "VCARD")[0]!);
    expect(mapped.data.webId).toBeDefined();
    for (const ch of ILLEGAL) expect(mapped.data.webId ?? "").not.toContain(ch);

    const turtle = await serializePerson("https://alice.pod.example/contacts/bob.ttl", mapped.data);
    const quads = new Parser().parse(turtle);
    expect(quads.some((q) => q.predicate.value.includes("oidcIssuer"))).toBe(false);
    expect(quads.some((q) => q.subject.value.includes("victim.pod.example"))).toBe(false);
  });
});

describe("safeHttpIri", () => {
  it("percent-encodes IRIREF-illegal characters (no injection char survives)", () => {
    const out = safeHttpIri('https://e.org/a> <x> "y" {z}|w');
    expect(out).toBeDefined();
    for (const ch of ILLEGAL) expect(out ?? "").not.toContain(ch);
    // still a parseable absolute http IRI
    expect(new URL(out!).protocol).toBe("https:");
  });

  it("preserves an already-canonical http(s) IRI unchanged", () => {
    expect(safeHttpIri("https://meet.example.com/standup")).toBe(
      "https://meet.example.com/standup",
    );
    expect(safeHttpIri("https://bob.example/profile/card#me")).toBe(
      "https://bob.example/profile/card#me",
    );
  });

  it("rejects non-http(s) and unparseable values", () => {
    expect(safeHttpIri("javascript:alert(1)")).toBeUndefined();
    expect(safeHttpIri("urn:uuid:abc")).toBeUndefined();
    expect(safeHttpIri("mailto:a@b.com")).toBeUndefined();
    expect(safeHttpIri("not a url")).toBeUndefined();
    expect(safeHttpIri(undefined)).toBeUndefined();
    expect(safeHttpIri("")).toBeUndefined();
  });
});
