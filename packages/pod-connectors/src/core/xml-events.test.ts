// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { decodeXmlEntities, type XmlEvent, xmlEvents } from "./mini-xml.js";

async function* chunks(text: string, size = 1) {
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}
async function events(text: string, size = 1): Promise<XmlEvent[]> {
  const out = [];
  for await (const event of xmlEvents(chunks(text, size))) out.push(event);
  return out;
}
describe("bounded nested mini-XML", () => {
  it.each([
    1, 7, 16384,
  ])("balances QNames and decodes leaves across %s-character chunks", async (size) => {
    const parsed = await events(
      `<?xml version="1.0"?><g:root xmlns:g='urn:test' x="a&gt;b"><leaf>one<!-- ignored -->&amp; two</leaf><empty /></g:root>`,
      size,
    );
    expect(parsed.filter((e) => e.kind === "start").map((e) => e.name)).toEqual([
      "root",
      "leaf",
      "empty",
    ]);
    expect(parsed.filter((e) => e.kind === "end").map((e) => e.name)).toEqual([
      "leaf",
      "empty",
      "root",
    ]);
    expect(
      parsed
        .filter((e) => e.kind === "text")
        .map((e) => e.text)
        .join(""),
    ).toBe("one& two");
    expect(parsed[0]).toMatchObject({ attrs: { x: "a>b" } });
  });
  it.each([
    "<root><a></b></root>",
    "<a:root></b:root>",
    "<root/>trailing",
    "leading<root/>",
    "<root/><second/>",
    "<root><leaf>",
    '<root x="1" x="2"/>',
    "<root x=unquoted/>",
    '<root x="a<b"/>',
    "<root bogus/>",
    '<root></root x="1">',
    '<root><?xml version="1.0"?></root>',
    "<!DOCTYPE root><root/>",
    "<root><![CDATA[x]]></root>",
    "<root><!-- unfinished",
    '<root x="unfinished',
    "<1root/>",
    `<root ${"a".repeat(65520)}/>`,
    `<root>${"<n>".repeat(64)}</root>`,
    `<root>${"x".repeat(65537)}</root>`,
  ])("rejects malformed or capped XML (case %#)", async (input) => {
    await expect(events(input, 16384)).rejects.toThrow();
  });
  it("never expands source-defined entities, and invalid numeric refs cannot crash decoding", () => {
    expect(decodeXmlEntities("&#x110000; &#55296; &external;")).toBe(
      "&#x110000; &#55296; &external;",
    );
    expect(decodeXmlEntities("&#x1f30d; &#38;")).toBe("🌍 &");
  });
  it("scans long unmatched attribute names linearly without a backtracking attribute regex", async () => {
    await expect(events(`<root ${"a".repeat(60000)}/>`, 16384)).rejects.toThrow(
      "attribute assignment",
    );
  });
  it("does not retain a long ignored comment as a token", async () => {
    expect(await events(`<root><!--${"x".repeat(100000)}--><leaf/></root>`, 16384)).toHaveLength(4);
  });
});
