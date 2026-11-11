// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { DEMO_ROOT } from "../src/lib/demo-pod/seed";
import { decodeRef } from "../src/lib/refs";
import { demoSearchItems } from "../src/shell/search/demo-items";
import { createLocalSearchSource } from "../src/shell/search/local-source";

describe("demo search items", () => {
  const items = demoSearchItems([
    { path: "profile/card" },
    { path: "drive/" },
    { path: "drive/Work/Budget%202026.csv", modified: 0 },
    { path: "drive/Archive/", modified: 5 },
  ]);
  it("indexes Drive files and folders only, with readable titles and parents", () => {
    expect(items.map((item) => [item.title, item.parent])).toEqual([
      ["Budget 2026.csv", "My Drive / Work"],
      ["Archive", "My Drive"],
    ]);
    expect(items[1]?.modified).toEqual(new Date(5));
    expect(items[0]?.modified).toBeUndefined();
  });
  it("links files to the preview and folders to the folder view", () => {
    expect(items[0]?.href.startsWith("/drive/p/")).toBe(true);
    expect(decodeRef(items[0]?.href.slice("/drive/p/".length) ?? "")).toBe(
      `${DEMO_ROOT}drive/Work/Budget%202026.csv`,
    );
    expect(items[1]?.href.startsWith("/drive/f/")).toBe(true);
  });
  it("indexes seeded events through the same source and links to their real resource", async () => {
    const source = createLocalSearchSource(
      demoSearchItems([
        {
          path: "calendar/work/planning.ttl",
          search: {
            iri: `${DEMO_ROOT}calendar/work/planning.ttl#it`,
            label: "Project planning",
            kind: "event",
          },
        },
      ]),
    );
    const page = await source.search("planning", { signal: new AbortController().signal });
    expect(page.results[0]?.app).toBe("calendar");
    expect(page.results[0]?.href).toContain("/calendar/e/");
    expect(page.results[0]?.id).toBe(`${DEMO_ROOT}calendar/work/planning.ttl#it`);
  });
  it("is searchable through the local source", async () => {
    const source = createLocalSearchSource(items);
    const { results, source: kind } = await source.search("budget", {
      signal: new AbortController().signal,
    });
    expect(kind).toBe("local");
    expect(results.map((result) => result.title)).toEqual(["Budget 2026.csv"]);
  });
});
