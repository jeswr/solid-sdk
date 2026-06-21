// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-bookmark-list> tests: render book:Bookmark fields (url link / title / tags /
// archived) via the model's typed accessors, the empty state, and the hostile-url
// guard (a `javascript:` schema:url is DROPPED by the model and never an href).

import "../src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JeswrBookmarkList } from "../src/index.js";
import { BOOKMARKS_TTL, HOSTILE_BOOKMARK_TTL, mount, parseTurtle, waitFor } from "./fixtures.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("<jeswr-bookmark-list>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("jeswr-bookmark-list")).toBeDefined();
  });

  it("renders book:Bookmark items via the typed Bookmark accessor", async () => {
    const el = await mount<JeswrBookmarkList>("jeswr-bookmark-list");
    el.store = parseTurtle(BOOKMARKS_TTL);
    await waitFor(
      el,
      (e) => e.querySelectorAll('[part="bookmark"]').length === 2,
      "two bookmarks render",
    );

    const first = el.querySelector('[part="title"]') as HTMLAnchorElement | null;
    expect(first?.tagName.toLowerCase()).toBe("a");
    expect(first?.getAttribute("href")).toBe("https://example.com/article");
    expect(first?.textContent?.trim()).toBe("A great article");

    // tags read from schema:keywords (sorted).
    const tags = [...el.querySelectorAll('[part="tags"] li')].map((n) => n.textContent?.trim());
    expect(tags).toEqual(["reading", "tech"]);

    // archived flag read from book:archived.
    const archived = el.querySelector('[part="bookmark"][data-archived="true"]');
    expect(archived).not.toBeNull();
    expect(archived?.textContent).toContain("Archived");
  });

  it("shows the empty state when there are no bookmarks", async () => {
    const el = await mount<JeswrBookmarkList>("jeswr-bookmark-list");
    el.store = parseTurtle("@prefix ex: <https://ex.example/> . ex:a ex:b ex:c .");
    await waitFor(el, (e) => !!e.querySelector('[part="empty"]'), "empty state renders");
    expect(el.querySelector('[part="empty"]')?.textContent).toContain("No bookmarks");
  });

  it("drops a hostile (non-http(s)) schema:url — no clickable javascript: bookmark", async () => {
    const el = await mount<JeswrBookmarkList>("jeswr-bookmark-list");
    el.store = parseTurtle(HOSTILE_BOOKMARK_TTL);
    // The model rejects a bookmark whose schema:url is not http(s) → 0 bookmarks.
    await waitFor(el, (e) => !!e.querySelector('[part="empty"]'), "hostile bookmark dropped");
    expect(el.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});
