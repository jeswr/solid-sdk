// AUTHORED-BY Codex GPT-6.1-Sol
import {
  escapeIri as sharedEscapeIri,
  safeHttpIri as sharedSafeHttpIri,
} from "@jeswr/rdf-serialize";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import { ActivityDoc, buildActivity, escapeIri, safeHttpIri } from "./activity.js";

// Frozen from 0d884208, retained only as differential oracles.
const IRIREF_FORBIDDEN_CHARS: ReadonlySet<number> = new Set(
  ["<", ">", '"', "{", "}", "|", "^", "`", "\\"].map((c) => c.charCodeAt(0)),
);

function legacyEscapeIri(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) as number;
    if (code <= 0x20 || IRIREF_FORBIDDEN_CHARS.has(code)) {
      out += `%${code.toString(16).toUpperCase().padStart(2, "0")}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function legacySafeHttpIri(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const firstCode = value.charCodeAt(0);
  const lastCode = value.charCodeAt(value.length - 1);
  if (firstCode <= 0x20 || lastCode <= 0x20) return undefined;
  const escaped = legacyEscapeIri(value);
  let u: URL;
  try {
    u = new URL(escaped);
  } catch {
    return undefined;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
  return escaped;
}

// Same adversarial corpus for each historical copy; fixtures never dereference IRIs.
const corpus: Array<string | undefined> = [
  undefined,
  "",
  "relative",
  "/path",
  "../path",
  "//example.org/path",
  "#fragment",
  "urn:uuid:abc",
  "did:example:123",
  "mailto:a@example.org",
  "ftp://example.org/path",
  "file:///tmp/example",
  "javascript:alert(1)",
  "data:text/plain,example",
  "http://example.org/path",
  "HTTPS://Example.ORG:443/a/../b#me",
  "https://example.org",
  "http://example.org:80",
  "https://example.org#me",
  "https://user:password@example.org/path",
  "https://user%40name@example.org/path",
  "https://例え.テスト/é/😀",
  "https://xn--r8jz45g.xn--zckzah/path",
  "https://example.org/%2f/%3E/%09?x=%20#%0a",
  "https://example.org/%not-hex",
  "https:example.org",
  "http:example.org/path",
  "https:/example.org/path",
  "https:///example.org/path",
  "http:////example.org/path",
  "https://?query",
  "https://#fragment",
  "https://",
  "https://[invalid]/path",
  "https://example.org:99999/path",
  "https://example.org/path> . <https://evil.example/s> <https://evil.example/p> <https://evil.example/o",
];
const forbidden = [
  ...Array.from({ length: 0x21 }, (_, code) => String.fromCharCode(code)),
  ...'<>{}|^`\\"',
];
for (const char of forbidden) {
  corpus.push(
    `${char}https://example.org/path`,
    `https://example.org/path${char}`,
    `ht${char}tps://example.org/path`,
    `https://exa${char}mple.org/path`,
    `https://example.org/a${char}b`,
    `https://example.org/path?q=a${char}b`,
    `https://example.org/path#a${char}b`,
    `urn:example:a${char}b`,
  );
}

describe("notification IRI guard differentials", () => {
  it("re-exports the audited guards without wrappers", () => {
    expect(escapeIri).toBe(sharedEscapeIri);
    expect(safeHttpIri).toBe(sharedSafeHttpIri);
  });
  it.each(corpus)("compares both historical copies with the shared guards for %j", (value) => {
    const old = legacySafeHttpIri(value);
    const shared = sharedSafeHttpIri(value);
    expect(safeHttpIri(value)).toBe(shared);
    // Canonical acceptance must be a subset of the old notification guard.
    if (shared !== undefined) expect(shared).toBe(old);
    if (value !== undefined) {
      expect(sharedEscapeIri(value)).toBe(legacyEscapeIri(value));
      expect(escapeIri(value)).toBe(legacyEscapeIri(value));
    }
  });
  it.each([
    "https:example.org",
    "https:///example.org/path",
    "http:////example.org/path",
  ])("records the stricter shared authority requirement for %s", (value) => {
    expect(legacySafeHttpIri(value)).toBe(value);
    expect(sharedSafeHttpIri(value)).toBeUndefined();
    expect(safeHttpIri(value)).toBeUndefined();
    const store = buildActivity({ type: "Announce", actor: value, object: value, target: value });
    const doc = new ActivityDoc("#it", store, DataFactory);
    expect(doc.actor).toBeUndefined();
    expect(doc.activityObject).toBeUndefined();
    expect(doc.target).toBeUndefined();
    expect(() =>
      buildActivity({ type: "Announce", actor: "https://example.org/#me" }, value),
    ).toThrow(TypeError);
  });
});
