// AUTHORED-BY Codex (GPT-6.1 Sol)
import { describe, expect, it } from "vitest";
import { parseNetscapeBookmarks, serializeNetscapeBookmarks } from "../src/netscape.js";

describe("Netscape bookmark interchange (without a DOM)", () => {
  it("reads nested folders, attribute tags, dates, entities and descriptions", () => {
    const result = parseNetscapeBookmarks(`<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
      <DT><H3>Garden &amp; home</H3><DL><p><DT><H3>Ideas</H3><DL>
      <DT><A HREF='https://example.org/?a=1&amp;b=2' ADD_DATE="1700000000" TAGS="reading, Ideas, ,reading">A &lt;good&gt; &#x1f331; &#39;idea&#39;</A>
      <DD>A &quot;description&quot;<BR>on two lines
      </DL><DT><A HREF=https://example.net/>Second</A></DL>
      <DT><A HREF="https://example.com/">Outside</A></DL>`);
    expect(result.skipped).toBe(0);
    expect(result.bookmarks[0]).toEqual({
      url: "https://example.org/?a=1&b=2",
      title: "A <good> 🌱 'idea'",
      tags: ["Garden & home", "Ideas", "reading"],
      created: new Date(1700000000000),
      description: 'A "description"\non two lines',
      archived: false,
    });
    expect(result.bookmarks[1]?.tags).toEqual(["Garden & home"]);
    expect(result.bookmarks[2]?.tags).toEqual([]);
  });
  it("tolerates missing end tags, unquoted attributes, mixed case and EOF", () => {
    const result = parseNetscapeBookmarks(
      '<dL><DT><a href=https://example.com/ ADD_DATE=0>First<DT><A HREF="https://example.net/a%3Eb" NOTES="a>b" add_date="bad">Second',
    );
    expect(result.bookmarks.map((item) => item.title)).toEqual(["First", "Second"]);
    expect(result.bookmarks[0]?.created).toEqual(new Date(0));
    expect(result.bookmarks[1]?.created).toBeUndefined();
    expect(result.bookmarks[1]?.url).toBe("https://example.net/a%3Eb");
  });
  it("refuses unsafe and missing URLs and ignores scripts, styles and comments", () => {
    const result = parseNetscapeBookmarks(`<!--<a href="https://ignored.test">x</a>-->
      <script><a href="https://ignored.test">x</a></script><style><a href="https://ignored.test">x</a></style>
      <iframe><a href="https://ignored.test">x</a></iframe><template><a href="https://ignored.test">x</a></template>
      <A HREF="javascript:alert(1)">bad</A><A HREF="data:text/html,x">bad</A><A HREF="/relative">bad</A><A>missing</A>
      <A HREF="https://example.com/" href="javascript:x" onclick="alert(1)"><img src="https://tracking.test">Safe</A>`);
    expect(result.skipped).toBe(4);
    expect(result.bookmarks).toHaveLength(1);
    expect(result.bookmarks[0]?.title).toBe("Safe");
  });
  it("handles empty, malformed and ignored tails without looping", () => {
    for (const html of [
      "",
      "text",
      "<!-- no end",
      "<script>no end",
      "<",
      "<!>",
      "</dl></dl>",
      "<dd>orphan",
    ])
      expect(parseNetscapeBookmarks(html)).toEqual({ bookmarks: [], skipped: 0 });
    expect(parseNetscapeBookmarks('<a href="https://example.org/"').bookmarks[0]?.title).toBe(
      "example.org",
    );
    expect(
      parseNetscapeBookmarks(
        '<a href="https://example.org/">&#0;&#xD800;&#1114112;&unknown;&copy;&nbsp;</a>',
      ).bookmarks[0]?.title,
    ).toBe("���&unknown;©");
    expect(() => parseNetscapeBookmarks(" ".repeat(10_000_001))).toThrow(RangeError);
  });
  it("omits invalid and out-of-range dates", () => {
    for (const date of ["-1", "NaN", "1.5", "99999999999999999", ""])
      expect(
        parseNetscapeBookmarks(`<A HREF="https://example.org/" ADD_DATE="${date}">x</A>`)
          .bookmarks[0]?.created,
      ).toBeUndefined();
  });
  it("round-trips metadata and escapes all markup in export", () => {
    const data = {
      url: "https://example.org/?a=1&b=%22x%22",
      title: '<script>alert("x")</script>',
      description: "Line <one> & two",
      notes: "A 'note'\nwith a second line",
      tags: ["one", "two"],
      created: new Date("2026-01-01T12:34:56Z"),
      archived: true,
    };
    const html = serializeNetscapeBookmarks([data]);
    expect(html).toContain("<!DOCTYPE NETSCAPE-Bookmark-file-1>");
    expect(html).not.toContain('<script>alert("x")</script>');
    expect(parseNetscapeBookmarks(html).bookmarks).toEqual([data]);
    expect(
      parseNetscapeBookmarks(serializeNetscapeBookmarks([{ url: "https://example.net/" }]))
        .bookmarks[0]?.title,
    ).toBe("example.net");
    expect(parseNetscapeBookmarks(serializeNetscapeBookmarks([])).bookmarks).toEqual([]);
  });
  it("rejects unsafe export URLs and dates", () => {
    expect(() => serializeNetscapeBookmarks([{ url: "javascript:x" }])).toThrow(TypeError);
    for (const created of [new Date(Number.NaN), new Date(-1000)])
      expect(() => serializeNetscapeBookmarks([{ url: "https://example.org/", created }])).toThrow(
        TypeError,
      );
  });
  it("decodes Latin-1 entities and preserves unknown names without prototype lookups", () => {
    expect(
      parseNetscapeBookmarks('<A HREF="https://example.org/">&eacute; &Agrave; &constructor;</A>')
        .bookmarks[0]?.title,
    ).toBe("é À &constructor;");
  });
  it("bounds malformed nesting and token floods", () => {
    expect(() => parseNetscapeBookmarks("<DL>".repeat(129))).toThrow("nested too deeply");
    expect(() => parseNetscapeBookmarks("<p>".repeat(100_002))).toThrow("too many HTML tokens");
  });
});
