// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import {
  duplicateContacts,
  exportContacts,
  type ImportRow,
  importContacts,
  previewVcards,
} from "../src/apps/contacts/lib/import-export";
import { parseVCards } from "../src/apps/contacts/lib/vcard";

const card = (name: string, fields = "") =>
  `BEGIN:VCARD\r\nVERSION:4.0\r\nFN:${name}\r\n${fields}END:VCARD\r\n`;

describe("vCard preview and export", () => {
  it("finds exact email and phone duplicates without treating malformed or empty values as keys", () => {
    const book = [
      { name: "Mira", emails: ["mailto:MIRA@example.org"], phones: ["tel:+12025550123"] },
      { name: "bad", emails: ["bad"], phones: ["bad"] },
      { name: "empty" },
    ];
    expect(
      duplicateContacts(
        { name: "a", emails: ["mira@example.org", "bad"], phones: ["bad"] },
        book,
      ).map((person) => person.name),
    ).toEqual(["Mira"]);
    expect(
      duplicateContacts({ name: "a", phones: ["+1 (202) 555-0123"] }, book).map(
        (person) => person.name,
      ),
    ).toEqual(["Mira"]);
    expect(duplicateContacts({ name: "a", phones: ["+12025550123"] }, book, false)).toEqual([]);
    expect(duplicateContacts({ name: "a" }, book)).toEqual([]);
  });
  it("defaults existing and in-batch duplicates to unchecked, preserving organisation and notes", () => {
    const rows = previewVcards(
      card("Copy", "EMAIL:mira@example.org\r\n") +
        card(
          "New",
          "EMAIL;TYPE=work:new@example.org\r\nTEL;TYPE=cell;VALUE=uri:tel:+12025550124\r\nORG:Acme;Team\r\nNOTE:Hello\r\nBDAY:20000101\r\n",
        ) +
        card("Copy new", "EMAIL:new@example.org\r\n"),
      [{ name: "Mira", emails: ["mailto:mira@example.org"] }],
    );
    expect(rows.map((row) => row.include)).toEqual([false, true, false]);
    expect(rows[0]?.duplicates).toEqual(["Mira"]);
    expect(rows[1]?.data).toMatchObject({
      organization: "Acme; Team",
      note: "Hello",
      phones: ["tel:+12025550124"],
    });
    expect(rows[1]?.warnings).toHaveLength(2);
    expect(rows[2]?.duplicates).toEqual(["New"]);
  });
  it("handles optional fields, invalid field warnings, malformed envelopes and empty files", () => {
    const rows = previewVcards(
      card("Just a name") + card("Invalid", "EMAIL:bad\r\nTEL:bad\r\n"),
      [],
    );
    expect(rows[0]).toMatchObject({ include: true, warnings: [], data: { name: "Just a name" } });
    expect(rows[1]?.include).toBe(false);
    expect(rows[1]?.warnings.length).toBeGreaterThan(0);
    expect(() => previewVcards("", [])).toThrow("No contacts");
    expect(() => previewVcards("BEGIN:VCARD", [])).toThrow();
  });
  it.each([
    "ADR:;;1 Main St;Town;;;Country\r\n",
    "BDAY:20000101\r\n",
    "PHOTO:https://example.org/photo.jpg\r\n",
    "TITLE:Captain\r\n",
    "CATEGORIES:Friends\r\n",
  ])("warns about unrepresentable source fields: %s", (fields) => {
    expect(previewVcards(card("Person", fields), [])[0]?.warnings).toHaveLength(1);
  });
  it("warns about typed phones and retains multiple exported URLs", () => {
    expect(
      previewVcards(card("Phone", "TEL;TYPE=cell;VALUE=uri:tel:+12025550123\r\n"), [])[0]?.warnings,
    ).toHaveLength(1);
    expect(
      parseVCards(card("URLs", "URL:https://example.org/one\r\nURL:https://example.org/two\r\n"))[0]
        ?.urls,
    ).toHaveLength(2);
  });
  it("validates source URLs instead of silently dropping an unsafe WebID", () => {
    const unsafe = previewVcards(card("Unsafe", "URL:javascript:alert(1)\r\n"), [])[0];
    expect(unsafe?.include).toBe(false);
    expect(unsafe?.warnings).toContain(
      "Enter an absolute HTTPS WebID (HTTP is allowed only on localhost).",
    );
    const multiple = previewVcards(
      card("Multiple", "URL:https://example.org/one\r\nURL:https://example.org/two\r\n"),
      [],
    )[0];
    expect(multiple?.data.webId).toBe("https://example.org/one");
    expect(multiple?.warnings).toContain(
      "Only the first URL can be saved as a WebID. Keep the original file for additional URLs.",
    );
  });
  it("exports parseable multiple cards with escaped text and all represented fields", () => {
    const text = exportContacts([
      {
        name: "Mira, Quill",
        emails: ["mailto:mira@example.org"],
        phones: ["tel:+12025550123"],
        organization: "Org",
        note: "one\ntwo",
        webId: "https://example.org/id#me",
      },
      { name: "Empty" },
    ]);
    expect(parseVCards(text)).toMatchObject([
      {
        fn: "Mira, Quill",
        emails: [{ value: "mira@example.org" }],
        tels: [{ value: "tel:+12025550123" }],
        org: ["Org"],
        note: "one\ntwo",
        urls: [{ value: "https://example.org/id#me" }],
      },
      { fn: "Empty", emails: [], tels: [] },
    ]);
    expect(exportContacts([])).toBe("");
  });
});
describe("bounded import through the optimistic controller seam", () => {
  const row = (name: string, include = true): ImportRow => ({
    data: { name },
    include,
    warnings: [],
    duplicates: [],
    valid: true,
  });
  it("bounds creates to three, completes after partial errors and distinguishes label failures", async () => {
    let active = 0;
    let peak = 0;
    const create = vi.fn(async (data: { name: string }) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      if (data.name === "fail") throw new Error("write failed");
      return data.name;
    });
    const label = vi.fn(async (id: string) => {
      if (id === "unlabelled") throw new Error("label failed");
    });
    const progress = vi.fn();
    expect(
      await importContacts(
        [row("one"), row("fail"), row("unlabelled"), row("four"), row("skip", false)],
        create,
        label,
        progress,
      ),
    ).toEqual({
      imported: ["one", "unlabelled", "four"],
      failed: ["fail"],
      labelFailed: ["unlabelled"],
    });
    expect(peak).toBe(3);
    expect(create).toHaveBeenCalledTimes(4);
    expect(progress.mock.calls.map(([n]) => n)).toEqual([1, 2, 3, 4]);
  });
  it("imports without labels, and safely accepts an empty selection", async () => {
    const create = vi.fn(async () => "id");
    expect(await importContacts([row("one")], create, undefined, () => {})).toEqual({
      imported: ["id"],
      failed: [],
      labelFailed: [],
    });
    expect(await importContacts([], create, undefined, () => {})).toEqual({
      imported: [],
      failed: [],
      labelFailed: [],
    });
  });
});
