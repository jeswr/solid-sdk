// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
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
import { afterEach, describe, expect, it, vi } from "vitest";
import { JeswrBookmarkForm } from "../src/components/bookmark-form.js";
import { JeswrTaskForm } from "../src/components/task-form.js";
import type { MergeSaveCallback } from "../src/index.js";
import { parseTurtle } from "./fixtures.js";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const TURTLE = "text/turtle";

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
  it("all three are registered", () => {
    expect(customElements.get("jeswr-task-form")).toBeDefined();
    expect(customElements.get("jeswr-contact-form")).toBeDefined();
    expect(customElements.get("jeswr-bookmark-form")).toBeDefined();
  });

  it("a task form with a src mounts an inner <jeswr-shacl-form>", async () => {
    const el = document.createElement("jeswr-task-form") as JeswrTaskForm;
    el.fetch = (async () =>
      ttlRes(
        `@prefix wf: <http://www.w3.org/2005/01/wf/flow#> . @prefix dct: <http://purl.org/dc/terms/> . <https://pod.example/tasks/1#it> a wf:Task ; dct:title "T" .`,
        '"v1"',
      )) as unknown as typeof globalThis.fetch;
    el.src = "https://pod.example/tasks/1";
    document.body.appendChild(el);
    for (let i = 0; i < 40; i++) {
      await el.updateComplete;
      await Promise.resolve();
      if (el.querySelector("jeswr-shacl-form")) break;
    }
    expect(el.querySelector("jeswr-shacl-form")).not.toBeNull();
  });

  it("with no src shows the empty placeholder", async () => {
    const el = document.createElement("jeswr-contact-form") as HTMLElement;
    document.body.appendChild(el);
    await (el as unknown as { updateComplete: Promise<unknown> }).updateComplete;
    expect(el.querySelector('[part="empty"]')).not.toBeNull();
  });
});

describe("per-class form §10 end-to-end save (conditional merge write)", () => {
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
});
