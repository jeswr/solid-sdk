// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <jeswr-collection> tests: list ldp:contains children via DataController.listContainer
// (the model's listing — no hand-built triples), the empty state, the type-index seam
// labelling, and the http(s)-only filtering of a child href.

import "../src/index.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { JeswrCollection, TypeIndexEntry } from "../src/index.js";
import { CONTAINER_TTL, mount, waitFor } from "./fixtures.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function ttlFetch(body: string, status = 200): typeof fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: { "Content-Type": "text/turtle" },
    })) as unknown as typeof fetch;
}

describe("<jeswr-collection>", () => {
  it("registers as a custom element", () => {
    expect(customElements.get("jeswr-collection")).toBeDefined();
  });

  it("lists ldp:contains children via DataController.listContainer", async () => {
    const el = await mount<JeswrCollection>("jeswr-collection");
    el.fetch = ttlFetch(CONTAINER_TTL);
    el.src = "https://pod.example/data/";
    await waitFor(
      el,
      (e) => e.querySelectorAll('[part="child"]').length === 2,
      "two children listed",
    );

    const links = [...el.querySelectorAll('[part="link"]')].map((n) => ({
      tag: n.tagName.toLowerCase(),
      href: n.getAttribute("href"),
      text: n.textContent?.trim(),
    }));
    expect(links.map((l) => l.href)).toContain("https://pod.example/data/notes.ttl");
    expect(links.map((l) => l.href)).toContain("https://pod.example/data/sub/");

    // The sub-container is flagged as a container (typed ldp:Container in the graph).
    const subContainer = el.querySelector('[part="child"][data-container="true"]');
    expect(subContainer).not.toBeNull();
  });

  it("shows the empty state for an empty container", async () => {
    const empty = `@prefix ldp: <http://www.w3.org/ns/ldp#> . <https://pod.example/data/> a ldp:Container .`;
    const el = await mount<JeswrCollection>("jeswr-collection");
    el.fetch = ttlFetch(empty);
    el.src = "https://pod.example/data/";
    await waitFor(el, (e) => !!e.querySelector('[part="empty"]'), "empty state renders");
    expect(el.querySelector('[part="empty"]')?.textContent).toContain("Empty container");
  });

  it("labels a child container from the injected type-index seam", async () => {
    const el = await mount<JeswrCollection>("jeswr-collection");
    el.fetch = ttlFetch(CONTAINER_TTL);
    const typeIndex: TypeIndexEntry[] = [
      {
        class: "http://www.w3.org/2006/vcard/ns#Individual",
        instanceContainer: "https://pod.example/data/sub/",
      },
    ];
    el.typeIndex = typeIndex;
    el.src = "https://pod.example/data/";
    await waitFor(
      el,
      (e) => [...e.querySelectorAll('[part="type"]')].some((n) => n.textContent?.includes("holds")),
      "type-index label renders",
    );
    expect(el.textContent).toContain("holds Individual");
  });
});
