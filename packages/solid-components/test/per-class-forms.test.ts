// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
// AUTHORED-BY Codex GPT-6.1-Sol
//
// Per-class editable form tests (jeswr-task-form / jeswr-contact-form /
// jeswr-bookmark-form):
//   - they register + mount the inner editable <jeswr-shacl-form> bound to their
//     model shape + the resource at `src`;
//   - the end-to-end save through the form's OWN mergeSaveCallback performs the §10
//     conditional merge write (pre-read with the etag → If-Match PUT of the merged
//     graph) against a stubbed fetch, preserving untouched triples;
//   - the DataWriter scope guard is wired (a save can't leave the resource dir);
//   - the filter-on-write security guard (a hostile assignee/url is dropped).

import "../src/index.js";
import { Store } from "n3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JeswrBookmarkForm } from "../src/components/bookmark-form.js";
import type { AbstractFormElement } from "../src/components/form-base.js";
import { JeswrTaskForm } from "../src/components/task-form.js";
import type { MergeSaveCallback } from "../src/index.js";
import {
  BOOKMARKS_TTL,
  CONTACTS_TTL,
  parseRdfTurtle,
  parseTurtle,
  TASKS_TTL,
  waitFor,
} from "./fixtures.js";

// shacl-form's 200 ms initialization debounce outlives Lit's updateComplete.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(async () => {
  document.body.innerHTML = "";
  try {
    // Finish detached forms' initialization while jsdom still provides document.
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
  }
});

const TURTLE = "text/turtle";
const BOOK = "https://jeswr.org/ns/bookmark#";
const LEGACY_BOOK = "https://w3id.org/jeswr/bookmark#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SH = "http://www.w3.org/ns/shacl#";

function ttlRes(body: string, etag?: string): Response {
  const headers = new Headers();
  headers.set("Content-Type", TURTLE);
  if (etag) headers.set("ETag", etag);
  return new Response(body, { status: 200, headers });
}
function statusRes(status: number, etag?: string): Response {
  const headers = new Headers();
  if (etag) headers.set("ETag", etag);
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    body: null,
    text: async () => "",
  } as unknown as Response;
}

/** A test subclass that exposes the protected mergeSaveCallback for a direct save. */
class TestTaskForm extends JeswrTaskForm {
  callback(): MergeSaveCallback {
    return this.mergeSaveCallback();
  }
}
class TestBookmarkForm extends JeswrBookmarkForm {
  callback(): MergeSaveCallback {
    return this.mergeSaveCallback();
  }
}
if (!customElements.get("test-task-form-e2e"))
  customElements.define("test-task-form-e2e", TestTaskForm);
if (!customElements.get("test-bookmark-form-e2e"))
  customElements.define("test-bookmark-form-e2e", TestBookmarkForm);

describe("per-class forms register + mount the editable form", () => {
  it.each([
    { type: BOOK, fields: BOOK },
    { type: LEGACY_BOOK, fields: LEGACY_BOOK },
    { type: BOOK, fields: LEGACY_BOOK },
    { type: LEGACY_BOOK, fields: BOOK },
  ])("populates canonical form fields from either namespace (case $#)", async ({
    type,
    fields,
  }) => {
    const url = "https://pod.example/bookmarks/1";
    const subj = `${url}#it`;
    const el = document.createElement("jeswr-bookmark-form") as JeswrBookmarkForm;
    const fetch = vi.fn(async () =>
      ttlRes(`
      <${subj}> a <${type}Bookmark> ; <http://schema.org/url> <https://example.com/> ;
        <${fields}notes> "kept notes" ; <${fields}archived> true .
    `),
    );
    el.fetch = fetch as unknown as typeof globalThis.fetch;
    el.src = url;
    document.body.appendChild(el);
    await waitFor(el, (e) => !!e.querySelector("shacl-form"));
    const form = el.querySelector("shacl-form") as HTMLElement;
    const values = await parseRdfTurtle(form.dataset.values ?? "");
    const shapes = await parseRdfTurtle(form.dataset.shapes ?? "");
    expect(values.getObjects(subj, RDF_TYPE, null).map((o) => o.value)).toEqual([
      `${BOOK}Bookmark`,
    ]);
    expect(values.getObjects(subj, `${BOOK}notes`, null).map((o) => o.value)).toEqual([
      "kept notes",
    ]);
    expect(values.getObjects(subj, `${BOOK}archived`, null).map((o) => o.value)).toEqual(["true"]);
    expect(values.getObjects(subj, `${LEGACY_BOOK}notes`, null)).toHaveLength(0);
    expect(values.getObjects(subj, `${LEGACY_BOOK}archived`, null)).toHaveLength(0);
    expect(shapes.getObjects(null, `${SH}targetClass`, null).map((o) => o.value)).toEqual([
      `${BOOK}Bookmark`,
    ]);
    const paths = shapes.getObjects(null, `${SH}path`, null).map((o) => o.value);
    expect(paths).toContain(`${BOOK}notes`);
    expect(paths).toContain(`${BOOK}archived`);
    expect(paths.some((path) => path.startsWith(LEGACY_BOOK))).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1); // Display migration is local; no write/fetch.
  });

  it("populates mixed fields with canonical empty/false values and keeps unrelated data", async () => {
    const subj = "https://pod.example/bookmarks/1#it";
    const el = document.createElement("jeswr-bookmark-form") as JeswrBookmarkForm;
    el.fetch = (async () =>
      ttlRes(`
      <${subj}> a <${LEGACY_BOOK}Bookmark>, <${BOOK}Bookmark> ;
        <http://schema.org/url> <https://example.com/> ;
        <${BOOK}notes> "" ; <${LEGACY_BOOK}notes> "stale" ;
        <${BOOK}archived> false ; <${LEGACY_BOOK}archived> true ; <urn:extension> "keep" .
      <urn:sibling> <urn:extension> "sibling" .
    `)) as typeof globalThis.fetch;
    el.src = "https://pod.example/bookmarks/1";
    document.body.appendChild(el);
    await waitFor(el, (e) => !!e.querySelector("shacl-form"));
    const form = el.querySelector("shacl-form") as HTMLElement;
    const values = await parseRdfTurtle(form.dataset.values ?? "");
    expect(values.getObjects(subj, `${BOOK}notes`, null).map((o) => o.value)).toEqual([""]);
    expect(values.getObjects(subj, `${BOOK}archived`, null).map((o) => o.value)).toEqual(["false"]);
    expect(values.getObjects(subj, `${LEGACY_BOOK}notes`, null)).toHaveLength(0);
    expect(values.getObjects(subj, `${LEGACY_BOOK}archived`, null)).toHaveLength(0);
    expect(values.getObjects(subj, "urn:extension", null).map((o) => o.value)).toEqual(["keep"]);
    expect(values.getObjects("urn:sibling", "urn:extension", null).map((o) => o.value)).toEqual([
      "sibling",
    ]);
  });

  it("all three are registered", () => {
    expect(customElements.get("jeswr-task-form")).toBeDefined();
    expect(customElements.get("jeswr-contact-form")).toBeDefined();
    expect(customElements.get("jeswr-bookmark-form")).toBeDefined();
  });

  it.each([
    { tag: "jeswr-task-form", src: "https://pod.example/tasks/1", data: TASKS_TTL },
    { tag: "jeswr-bookmark-form", src: "https://pod.example/bookmarks/1", data: BOOKMARKS_TTL },
    { tag: "jeswr-contact-form", src: "https://pod.example/contacts/alice", data: CONTACTS_TTL },
  ])("$tag drains pending initialization after removal", async ({ tag, src, data }) => {
    const el = document.createElement(tag) as AbstractFormElement;
    el.fetch = (async () => ttlRes(data, '"v1"')) as unknown as typeof globalThis.fetch;
    el.src = src;
    document.body.appendChild(el);
    for (let i = 0; i < 60; i++) {
      await el.updateComplete;
      await Promise.resolve();
      if (el.querySelector("shacl-form")) break;
    }
    expect(el.querySelector("jeswr-shacl-form")).not.toBeNull();
    const form = el.querySelector("shacl-form");
    expect(form).not.toBeNull();
    expect(form?.hasAttribute("loading")).toBe(true);
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    // Removal alone leaves shacl-form's initialization debounce pending.
    el.remove();
    expect(el.isConnected).toBe(false);
    await vi.runAllTimersAsync();
    expect(vi.getTimerCount()).toBe(0);
    expect(form?.hasAttribute("loading")).toBe(false);
    const root = form?.shadowRoot ?? form;
    expect(root?.querySelector("shacl-node")).not.toBeNull();
  });

  it("with no src shows the empty placeholder", async () => {
    const el = document.createElement("jeswr-contact-form") as HTMLElement;
    document.body.appendChild(el);
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(el.querySelector('[part="empty"]')).not.toBeNull();
  });

  it("publicRead reads the data with the credential-free publicFetch, not the auth fetch", async () => {
    // roborev MEDIUM regression: a public-read form must read `src` with publicFetch,
    // never the authenticated fetch (the credential boundary).
    const authFetch = vi.fn(
      async () =>
        ttlRes(
          `@prefix wf: <http://www.w3.org/2005/01/wf/flow#> . @prefix dct: <http://purl.org/dc/terms/> . <https://foreign.example/tasks/1#it> a wf:Task ; dct:title "T" .`,
        ) as unknown as Response,
    );
    const publicFetch = vi.fn(
      async () =>
        ttlRes(
          `@prefix wf: <http://www.w3.org/2005/01/wf/flow#> . @prefix dct: <http://purl.org/dc/terms/> . <https://foreign.example/tasks/1#it> a wf:Task ; dct:title "T" .`,
        ) as unknown as Response,
    );
    const el = document.createElement("jeswr-task-form") as JeswrTaskForm;
    el.fetch = authFetch as unknown as typeof globalThis.fetch;
    el.publicFetch = publicFetch as unknown as typeof globalThis.fetch;
    el.publicRead = true;
    el.src = "https://foreign.example/tasks/1";
    document.body.appendChild(el);
    for (let i = 0; i < 50; i++) {
      await el.updateComplete;
      await Promise.resolve();
      if (el.querySelector("shacl-form")) break;
    }
    expect(publicFetch).toHaveBeenCalled();
    expect(authFetch).not.toHaveBeenCalled();
  });
});

describe("per-class form §10 end-to-end save (conditional merge write)", () => {
  it.each([
    BOOK,
    LEGACY_BOOK,
  ])("creates only canonical bookmark data from %s", async (namespace) => {
    const url = "https://pod.example/bookmarks/new";
    const subj = `${url}#it`;
    const puts: RequestInit[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return statusRes(404);
      puts.push(init ?? {});
      return statusRes(201, '"v1"');
    });
    const el = document.createElement("test-bookmark-form-e2e") as TestBookmarkForm;
    el.src = url;
    el.fetch = fetch as unknown as typeof globalThis.fetch;
    await el.callback()(
      await parseRdfTurtle(`
      <urn:minted> a <${namespace}Bookmark> ; <http://schema.org/url> <https://example.com/> ;
        <${namespace}notes> "New notes" ; <${namespace}archived> true .
    `),
    );
    expect(puts).toHaveLength(1);
    expect((puts[0].headers as Record<string, string>)["If-None-Match"]).toBe("*");
    const saved = await parseRdfTurtle(puts[0].body as string);
    expect(saved.getObjects(subj, RDF_TYPE, null).map((o) => o.value)).toEqual([`${BOOK}Bookmark`]);
    expect(saved.getObjects(subj, `${BOOK}notes`, null).map((o) => o.value)).toEqual(["New notes"]);
    expect(saved.getObjects(subj, `${BOOK}archived`, null).map((o) => o.value)).toEqual(["true"]);
    expect(puts[0].body).not.toContain(LEGACY_BOOK);
  });

  it("conditional updates of a legacy bookmark serialize only canonical aliases", async () => {
    const url = "https://pod.example/bookmarks/1";
    const subj = `${url}#it`;
    const puts: RequestInit[] = [];
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET")
        return ttlRes(
          `
        <${subj}> a <${LEGACY_BOOK}Bookmark> ; <${LEGACY_BOOK}notes> "stale" ;
          <${LEGACY_BOOK}archived> true ; <urn:extension> "keep" .
      `,
          '"v1"',
        );
      puts.push(init ?? {});
      return statusRes(205, '"v2"');
    });
    const el = document.createElement("test-bookmark-form-e2e") as TestBookmarkForm;
    el.src = url;
    el.fetch = fetch as unknown as typeof globalThis.fetch;
    await el.callback()(
      await parseRdfTurtle(`
      <urn:minted> a <${BOOK}Bookmark> ; <http://schema.org/url> <https://example.com/> .
    `),
    );
    expect(puts).toHaveLength(1);
    expect((puts[0].headers as Record<string, string>)["If-Match"]).toBe('"v1"');
    expect(puts[0].body).not.toContain(LEGACY_BOOK);
    const saved = await parseRdfTurtle(puts[0].body as string);
    expect(saved.getObjects(subj, RDF_TYPE, null).map((o) => o.value)).toEqual([`${BOOK}Bookmark`]);
    expect(saved.getObjects(subj, `${BOOK}notes`, null)).toHaveLength(0);
    expect(saved.getObjects(subj, `${BOOK}archived`, null).map((o) => o.value)).toEqual(["false"]);
    expect(saved.getObjects(subj, "urn:extension", null).map((o) => o.value)).toEqual(["keep"]);
  });

  it("task: save pre-reads with the etag then If-Match PUTs the merged graph", async () => {
    const existing = `
      @prefix wf: <http://www.w3.org/2005/01/wf/flow#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      @prefix ex: <https://producer.example/> .
      <https://pod.example/tasks/1#it> a wf:Task, wf:Open ;
        dct:title "Original" ; ex:keep "must survive" .
    `;
    const puts: { headers: Record<string, string>; body: string }[] = [];
    const fetch = vi.fn(async (_u: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return ttlRes(existing, '"v1"');
      puts.push({
        headers: (init?.headers as Record<string, string>) ?? {},
        body: init?.body as string,
      });
      return statusRes(205, '"v2"');
    });

    const el = document.createElement("test-task-form-e2e") as TestTaskForm;
    el.fetch = fetch as unknown as typeof globalThis.fetch;
    el.src = "https://pod.example/tasks/1";

    // The "form graph" shacl-form would emit (edited title; minted subject).
    const formGraph = parseTurtle(
      `@prefix wf: <http://www.w3.org/2005/01/wf/flow#> . @prefix dct: <http://purl.org/dc/terms/> . <urn:m> a wf:Task ; dct:title "Edited" .`,
      "https://pod.example/tasks/1",
    );
    await el.callback()(formGraph);

    expect(puts).toHaveLength(1);
    expect(puts[0].headers["If-Match"]).toBe('"v1"'); // lost-update guard.
    expect(puts[0].body).toContain("Edited"); // the edit landed.
    expect(puts[0].body).toContain("must survive"); // the untouched triple survived.
    // The dual-predicate description contract isn't exercised here (no description in
    // the form graph), but the state (wf:Open) must survive (shape-uncovered).
    expect(puts[0].body).toContain("Open");
  });

  it("bookmark: a hostile javascript: url edited in is DROPPED, the safe existing url kept-or-cleared (never the hostile scheme)", async () => {
    const existing = `
      @prefix book: <https://w3id.org/jeswr/bookmark#> .
      @prefix schema: <http://schema.org/> .
      <https://pod.example/bm/1#it> a book:Bookmark ; schema:url <https://example.com/safe> .
    `;
    let putBody = "";
    const fetch = vi.fn(async (_u: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return ttlRes(existing, '"v1"');
      putBody = init?.body as string;
      return statusRes(205, '"v2"');
    });
    const el = document.createElement("test-bookmark-form-e2e") as TestBookmarkForm;
    el.fetch = fetch as unknown as typeof globalThis.fetch;
    el.src = "https://pod.example/bm/1";

    const formGraph = parseTurtle(
      `@prefix book: <https://w3id.org/jeswr/bookmark#> . @prefix schema: <http://schema.org/> . <urn:m> a book:Bookmark ; schema:url <javascript:alert(1)> .`,
      "https://pod.example/bm/1",
    );
    await el.callback()(formGraph);
    // The hostile scheme is NEVER written.
    expect(putBody).not.toContain("javascript:alert(1)");
  });

  it("the save is scope-guarded: a foreign src is refused before any fetch", async () => {
    const fetch = vi.fn(async () => ttlRes("", '"v1"'));
    const el = document.createElement("test-task-form-e2e") as TestTaskForm;
    el.fetch = fetch as unknown as typeof globalThis.fetch;
    // base is defaulted to the resource dir; point src outside a tight base.
    el.base = "https://pod.example/tasks/";
    el.src = "https://evil.example/tasks/1";
    const formGraph = new Store();
    await expect(el.callback()(formGraph)).rejects.toThrow(/Refusing to write/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a successful save fires EXACTLY ONE jeswr-save on the per-class form (no duplicate)", async () => {
    // roborev LOW regression: the parent stops the child's bubbling event before
    // re-emitting its own, so a listener on the per-class form gets ONE event.
    const existing = `@prefix wf: <http://www.w3.org/2005/01/wf/flow#> . @prefix dct: <http://purl.org/dc/terms/> . <https://pod.example/tasks/1#it> a wf:Task ; dct:title "T" .`;
    const fetch = vi.fn(async (_u: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") return ttlRes(existing, '"v1"');
      return statusRes(205, '"v2"');
    });
    const el = document.createElement("jeswr-task-form") as JeswrTaskForm;
    el.fetch = fetch as unknown as typeof globalThis.fetch;
    el.src = "https://pod.example/tasks/1";
    document.body.appendChild(el);
    for (let i = 0; i < 50; i++) {
      await el.updateComplete;
      await Promise.resolve();
      if (el.querySelector("shacl-form")) break;
    }
    const events: unknown[] = [];
    el.addEventListener("jeswr-save", (e) => events.push((e as CustomEvent).detail));
    await el.save();
    expect(events).toHaveLength(1);
  });
});
