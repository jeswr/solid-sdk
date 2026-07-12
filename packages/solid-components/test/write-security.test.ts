// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// FILTER-ON-WRITE security regression. The data models' typed SETTERS do NOT apply
// the http(s)-only filter (only their `build*`/`parse*` FUNCTIONS do), and client
// SHACL validation is ADVISORY (UX, not authz), so the §10 merge in each per-class
// form MUST itself drop a non-http(s) IRI for any security-surface field before the
// typed setter — else a hostile `javascript:`/`data:` value edited into a WebID /
// bookmark URL would be persisted. These tests pin that the merge filters:
//   - a hostile bookmark `schema:url` is never written;
//   - a hostile task `wf:assignee` WebID is never written;
//   - a benign http(s) value IS written (the filter is not over-broad).

import type { Store } from "n3";
import { afterEach, describe, expect, it } from "vitest";
import { JeswrBookmarkForm } from "../src/components/bookmark-form.js";
import { JeswrTaskForm } from "../src/components/task-form.js";
import { parseTurtle } from "./fixtures.js";

afterEach(() => {
  document.body.innerHTML = "";
});

class TestTaskForm extends JeswrTaskForm {
  runMerge(formGraph: Store, existing: Store, url: string): void {
    this.applyFormDeltaToExisting(formGraph, existing, url);
  }
}
class TestBookmarkForm extends JeswrBookmarkForm {
  runMerge(formGraph: Store, existing: Store, url: string): void {
    this.applyFormDeltaToExisting(formGraph, existing, url);
  }
}
if (!customElements.get("sec-task-form")) customElements.define("sec-task-form", TestTaskForm);
if (!customElements.get("sec-bookmark-form"))
  customElements.define("sec-bookmark-form", TestBookmarkForm);

const WF = "http://www.w3.org/2005/01/wf/flow#";
const SCHEMA = "http://schema.org/";

describe("filter-on-write — bookmark url (a stored-XSS surface)", () => {
  const url = "https://pod.example/bm/1";
  const subj = `${url}#it`;

  function run(formUrl: string): Store {
    const existing = parseTurtle(
      `@prefix book: <https://w3id.org/jeswr/bookmark#> . @prefix schema: <${SCHEMA}> . <${subj}> a book:Bookmark ; schema:url <https://example.com/safe> .`,
      url,
    );
    const formGraph = parseTurtle(
      `@prefix book: <https://w3id.org/jeswr/bookmark#> . @prefix schema: <${SCHEMA}> . <urn:m> a book:Bookmark ; schema:url <${formUrl}> .`,
      url,
    );
    const el = document.createElement("sec-bookmark-form") as TestBookmarkForm;
    el.runMerge(formGraph, existing, url);
    return existing;
  }

  // Syntactically-valid IRIs with dangerous / non-http(s) schemes (a Turtle-parseable
  // hostile value is the realistic threat — `data:...<script>` is not even valid
  // Turtle, so it can never reach the graph; these can, and must be dropped).
  it.each([
    "javascript:alert(1)",
    "vbscript:msgbox",
    "file:///etc/passwd",
    "data:text/plain,evil",
  ])("drops a hostile url %s (never persisted)", (hostile) => {
    const g = run(hostile);
    const urls = g.getObjects(subj, `${SCHEMA}url`, null).map((o) => o.value);
    expect(urls).not.toContain(hostile);
  });

  it("KEEPS a benign http(s) url (the filter is not over-broad)", () => {
    const g = run("https://example.com/new-good");
    const urls = g.getObjects(subj, `${SCHEMA}url`, null).map((o) => o.value);
    expect(urls).toEqual(["https://example.com/new-good"]);
  });
});

describe("filter-on-write — task assignee (a WebID IRI surface)", () => {
  const url = "https://pod.example/tasks/1";
  const subj = `${url}#it`;

  function run(formAssignee: string): Store {
    const existing = parseTurtle(
      `@prefix wf: <${WF}> . @prefix dct: <http://purl.org/dc/terms/> . <${subj}> a wf:Task, wf:Open ; dct:title "T" .`,
      url,
    );
    const formGraph = parseTurtle(
      `@prefix wf: <${WF}> . @prefix dct: <http://purl.org/dc/terms/> . <urn:m> a wf:Task ; dct:title "T" ; wf:assignee <${formAssignee}> .`,
      url,
    );
    const el = document.createElement("sec-task-form") as TestTaskForm;
    el.runMerge(formGraph, existing, url);
    return existing;
  }

  it("drops a hostile javascript: assignee", () => {
    const g = run("javascript:alert(1)");
    const a = g.getObjects(subj, `${WF}assignee`, null).map((o) => o.value);
    expect(a).not.toContain("javascript:alert(1)");
    expect(a).toHaveLength(0);
  });

  it("KEEPS a benign http(s) WebID assignee", () => {
    const g = run("https://alice.example/profile/card#me");
    const a = g.getObjects(subj, `${WF}assignee`, null).map((o) => o.value);
    expect(a).toEqual(["https://alice.example/profile/card#me"]);
  });
});
