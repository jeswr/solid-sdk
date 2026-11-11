// AUTHORED-BY Codex (GPT-6.1 Sol)
// @vitest-environment jsdom
import { expect, it } from "vitest";
import { parseNetscapeBookmarks, serializeNetscapeBookmarks } from "../src/netscape.js";

it("uses the platform DOMParser on an inert subset and keeps folder ancestry", () => {
  expect(typeof (globalThis as unknown as { DOMParser: unknown }).DOMParser).toBe("function");
  const result = parseNetscapeBookmarks(
    '<DL><DT><H3>A &amp; B</H3><DL><DT><A HREF="https://example.org/" onclick="throw 1">First</A><DD>One<br>Two</DL><DT><A HREF="https://example.net/">Second</A></DL><img src="https://tracking.test"><script>throw 1</script>',
  );
  expect(result.bookmarks[0]).toMatchObject({
    tags: ["A & B"],
    title: "First",
    description: "One\nTwo",
  });
  expect(result.bookmarks[1]?.tags).toEqual([]);
  expect(parseNetscapeBookmarks(serializeNetscapeBookmarks(result.bookmarks))).toEqual(result);
});
it("uses the platform's complete entity decoder without creating elements from encoded HTML", () => {
  const result = parseNetscapeBookmarks(
    '<A HREF="https://example.org/">&alpha; &eacute; &lt;img src=x onerror=alert(1)&gt;</A>',
  );
  expect(result.bookmarks[0]?.title).toBe("α é <img src=x onerror=alert(1)>");
  expect(() => parseNetscapeBookmarks("<DL>".repeat(129))).toThrow("nested too deeply");
});
