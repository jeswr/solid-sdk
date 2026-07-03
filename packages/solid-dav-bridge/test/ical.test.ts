// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate.
import { describe, expect, it } from "vitest";
import {
  findComponents,
  getProperties,
  getProperty,
  parseComponents,
  parseContentLine,
  unescapeText,
  unfoldLines,
} from "../src/ical.js";
import {
  vcardMessy,
  veventFolded,
  veventHostile,
  veventMulti,
  veventWithRrule,
} from "./fixtures.js";

describe("unfoldLines", () => {
  it("joins a line folded with a leading space (RFC 5545 §3.1 — fold WS is consumed)", () => {
    // Per RFC 5545 §3.1, unfolding removes the CRLF *and* the single leading
    // whitespace char that marks the continuation, so "Hello\r\n World" → "HelloWorld".
    const lines = unfoldLines("SUMMARY:Hello\r\n World");
    expect(lines).toEqual(["SUMMARY:HelloWorld"]);
  });
  it("joins a line folded with a leading TAB", () => {
    const lines = unfoldLines("SUMMARY:Hello\r\n\tWorld");
    expect(lines).toEqual(["SUMMARY:HelloWorld"]);
  });
  it("normalises CRLF, bare LF and bare CR", () => {
    expect(unfoldLines("A:1\r\nB:2\nC:3\rD:4")).toEqual(["A:1", "B:2", "C:3", "D:4"]);
  });
  it("drops empty lines", () => {
    expect(unfoldLines("A:1\r\n\r\nB:2")).toEqual(["A:1", "B:2"]);
  });
  it("a leading-space first line is NOT treated as a continuation (no prior line to join)", () => {
    // With no prior logical line, a leading-space line cannot be a continuation;
    // it is kept verbatim (it will simply fail to parse as a content line later).
    expect(unfoldLines(" leading")).toEqual([" leading"]);
  });
});

describe("parseContentLine", () => {
  it("parses name:value", () => {
    expect(parseContentLine("SUMMARY:Hello")).toEqual({
      name: "SUMMARY",
      params: {},
      value: "Hello",
    });
  });
  it("upper-cases the property name", () => {
    expect(parseContentLine("summary:x")?.name).toBe("SUMMARY");
  });
  it("parses params", () => {
    const cl = parseContentLine("DTSTART;VALUE=DATE;TZID=Europe/London:20260101");
    expect(cl?.params).toEqual({ VALUE: "DATE", TZID: "Europe/London" });
    expect(cl?.value).toBe("20260101");
  });
  it("does NOT split on a colon inside a quoted param value", () => {
    const cl = parseContentLine('ATTENDEE;CN="Doe, John: VIP":mailto:john@example.com');
    expect(cl?.name).toBe("ATTENDEE");
    expect(cl?.params.CN).toBe("Doe, John: VIP");
    expect(cl?.value).toBe("mailto:john@example.com");
  });
  it("strips surrounding DQUOTEs from a param value", () => {
    expect(parseContentLine('X;P="quoted":v')?.params.P).toBe("quoted");
  });
  it("returns undefined for a line with no colon", () => {
    expect(parseContentLine("NO COLON HERE")).toBeUndefined();
  });
  it("returns undefined for an empty name", () => {
    expect(parseContentLine(":value")).toBeUndefined();
  });
  it("skips a malformed param (no '=') without throwing", () => {
    const cl = parseContentLine("X;broken;K=v:val");
    expect(cl?.params).toEqual({ K: "v" });
  });
  it("strips a vCard property GROUP prefix (RFC 6350 §3.3) into `group`", () => {
    const cl = parseContentLine("item1.EMAIL;TYPE=work:grace@example.com");
    expect(cl?.name).toBe("EMAIL");
    expect(cl?.group).toBe("ITEM1");
    expect(cl?.value).toBe("grace@example.com");
    expect(cl?.params).toEqual({ TYPE: "work" });
  });
  it("does not split a value with a dot, only the head name", () => {
    // a dot in the VALUE (after the colon) must not be mistaken for a group
    const cl = parseContentLine("URL:https://x.example/a.b.c");
    expect(cl?.name).toBe("URL");
    expect(cl?.group).toBeUndefined();
    expect(cl?.value).toBe("https://x.example/a.b.c");
  });
  it("strips NUL (U+0000) bytes from the name, params and value", () => {
    const nulChar = String.fromCharCode(0);
    const cl = parseContentLine(`SUM${nulChar}MARY;P=v${nulChar}1:he${nulChar}llo`);
    expect(cl?.name).toBe("SUMMARY");
    expect(cl?.params.P).toBe("v1");
    expect(cl?.value).toBe("hello");
    // no field carries a residual NUL
    expect(cl?.name).not.toContain(nulChar);
    expect(cl?.value).not.toContain(nulChar);
    expect(cl?.params.P).not.toContain(nulChar);
  });
});

describe("unescapeText", () => {
  it("unescapes \\n, \\,, \\;, \\\\", () => {
    expect(unescapeText("a\\nb\\,c\\;d\\\\e")).toBe("a\nb,c;d\\e");
  });
  it("treats \\N as a newline too", () => {
    expect(unescapeText("a\\Nb")).toBe("a\nb");
  });
  it("leaves an unknown escape as-is", () => {
    expect(unescapeText("a\\qb")).toBe("a\\qb");
  });
  it("does not re-interpret an escaped backslash followed by n", () => {
    // "\\\\n" is an escaped backslash then a literal 'n' → "\n" the two chars.
    expect(unescapeText("\\\\n")).toBe("\\n");
  });
});

describe("parseComponents", () => {
  it("parses a VCALENDAR with a nested VEVENT", () => {
    const roots = parseComponents(veventWithRrule);
    expect(roots).toHaveLength(1);
    expect(roots[0]?.name).toBe("VCALENDAR");
    const vevents = findComponents(roots, "VEVENT");
    expect(vevents).toHaveLength(1);
    expect(getProperty(vevents[0]!, "SUMMARY")?.value).toBe("Weekly standup");
  });

  it("finds every VEVENT in a multi-event calendar", () => {
    const vevents = findComponents(parseComponents(veventMulti), "VEVENT");
    expect(vevents).toHaveLength(2);
  });

  it("unfolds a folded property value across the parse", () => {
    const vevents = findComponents(parseComponents(veventFolded), "VEVENT");
    expect(getProperty(vevents[0]!, "SUMMARY")?.value).toBe(
      "This is a long summary that spans\tacross two folded lines",
    );
  });

  it("HARDENING: a stray END / property outside a card is ignored; valid card survives", () => {
    const vcards = findComponents(parseComponents(vcardMessy), "VCARD");
    expect(vcards).toHaveLength(1);
    expect(getProperty(vcards[0]!, "FN")?.value).toBe("Eve Good");
  });

  it("HARDENING: a property with no colon is dropped, valid props kept", () => {
    const vevents = findComponents(parseComponents(veventHostile), "VEVENT");
    expect(vevents).toHaveLength(1);
    expect(getProperty(vevents[0]!, "SUMMARY")?.value).toBe("Recovered summary");
  });

  it("drops an unterminated component (missing END) — no half-built event", () => {
    const roots = parseComponents("BEGIN:VEVENT\r\nUID:x\r\nSUMMARY:y");
    expect(findComponents(roots, "VEVENT")).toHaveLength(0);
  });

  it("ignores an END with no matching BEGIN", () => {
    const roots = parseComponents("END:VEVENT\r\nBEGIN:VCARD\r\nFN:x\r\nEND:VCARD");
    expect(findComponents(roots, "VCARD")).toHaveLength(1);
  });

  it("getProperties returns every matching property (multi-valued)", () => {
    const roots = parseComponents("BEGIN:VCARD\r\nEMAIL:a@x.com\r\nEMAIL:b@x.com\r\nEND:VCARD");
    const vcard = findComponents(roots, "VCARD")[0]!;
    expect(getProperties(vcard, "EMAIL")).toHaveLength(2);
  });

  it("never throws on a hostile oversized line (bounded)", () => {
    // A single 5MB line — must parse without throwing or hanging.
    const big = `SUMMARY:${"x".repeat(5_000_000)}`;
    expect(() => parseComponents(`BEGIN:VEVENT\r\n${big}\r\nEND:VEVENT`)).not.toThrow();
  });

  it("bounds nesting depth (no stack blow-up on deeply nested BEGINs)", () => {
    const deep = `${"BEGIN:X\r\n".repeat(100)}FN:y\r\n${"END:X\r\n".repeat(100)}`;
    expect(() => parseComponents(deep)).not.toThrow();
  });
});
