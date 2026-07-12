// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// §10 MERGE-NOT-REPLACE round-trip — THE correctness invariant. shacl-form's
// `toRDF()` emits ONLY the shaped node's triples, so a naive `toRDF() → PUT` would
// (a) DROP every triple outside the shape and (b) clobber the dual-predicate
// federation compat (a task writes BOTH wf:description + dct:description). These
// tests prove the per-class forms' §10 merge — `applyFormDeltaToExisting`, which
// applies the form delta to the LOADED existing graph through the MODEL's typed
// accessors — does NEITHER:
//   - editing ONE field does NOT drop an unrelated triple (a foreign predicate, a
//     triple on ANOTHER subject, or a shape-uncovered field like the task's state);
//   - the dual-predicate contract is preserved (description → BOTH predicates).
//
// We exercise the merge at its real boundary (the n3 Store level) with a constructed
// "form graph" standing in for shacl-form's toRDF() output (whose field widgets do
// not populate under jsdom — see the element tests), which is the correct unit-test
// seam for the merge logic.

import { parseTask } from "@jeswr/solid-task-model/task";
import type { Store } from "n3";
import { afterEach, describe, expect, it } from "vitest";
import { JeswrBookmarkForm } from "../src/components/bookmark-form.js";
import { JeswrContactForm } from "../src/components/contact-form.js";
import { JeswrTaskForm } from "../src/components/task-form.js";
import { parseTurtle } from "./fixtures.js";

afterEach(() => {
  document.body.innerHTML = "";
});

/** A test subclass exposing the protected merge so we can call it directly. */
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
class TestContactForm extends JeswrContactForm {
  runMerge(formGraph: Store, existing: Store, url: string): void {
    this.applyFormDeltaToExisting(formGraph, existing, url);
  }
}
if (!customElements.get("test-task-form")) customElements.define("test-task-form", TestTaskForm);
if (!customElements.get("test-bookmark-form"))
  customElements.define("test-bookmark-form", TestBookmarkForm);
if (!customElements.get("test-contact-form"))
  customElements.define("test-contact-form", TestContactForm);

const TASK_URL = "https://pod.example/tasks/1";
const TASK_SUBJ = "https://pod.example/tasks/1#it";

const WF = "http://www.w3.org/2005/01/wf/flow#";
const DCT = "http://purl.org/dc/terms/";
const SCHEMA = "http://schema.org/";

describe("§10 task merge — preserves untouched triples + the dual-predicate contract", () => {
  it("editing the title preserves an UNRELATED triple AND the task's state", () => {
    // The existing resource: a task with a title, a dual-predicate description, an
    // OPEN state (rdf:type wf:Open — NOT in the editable shape), a tracker link (not
    // in the shape), AND a foreign triple about ANOTHER subject in the same doc.
    const existing = parseTurtle(
      `
      @prefix wf: <${WF}> .
      @prefix dct: <${DCT}> .
      @prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
      <${TASK_SUBJ}> a wf:Task, wf:Open ;
        dct:title "Original title" ;
        wf:description "Body" ; dct:description "Body" ;
        wf:tracker <https://pod.example/projects/p1> .
      <https://pod.example/tasks/1#note> dct:title "a sibling subject" .
    `,
      TASK_URL,
    );

    // The form graph (shacl-form toRDF): the edited shape fields, on a MINTED subject
    // (shacl-form does not reuse #it). Only the editable shape's predicates.
    const formGraph = parseTurtle(
      `
      @prefix wf: <${WF}> .
      @prefix dct: <${DCT}> .
      <urn:minted:abc> a wf:Task ;
        dct:title "Edited title" ;
        wf:description "New body" .
    `,
      TASK_URL,
    );

    const el = document.createElement("test-task-form") as TestTaskForm;
    el.runMerge(formGraph, existing, TASK_URL);

    // 1) The edited title landed on the RESOURCE subject (#it), not the minted one.
    const result = parseTask(TASK_URL, existing);
    expect(result?.title).toBe("Edited title");
    // 2) The DUAL-PREDICATE description was written to BOTH predicates.
    expect(existing.getObjects(TASK_SUBJ, `${WF}description`, null).map((o) => o.value)).toEqual([
      "New body",
    ]);
    expect(existing.getObjects(TASK_SUBJ, `${DCT}description`, null).map((o) => o.value)).toEqual([
      "New body",
    ]);
    // 3) The shape-UNCOVERED state survived (still Open) — editing the title did NOT
    //    flip the task's state (the §10 merge only touches shape-covered predicates).
    expect(result?.state).toBe("open");
    // 4) The shape-uncovered tracker link survived.
    expect(existing.getObjects(TASK_SUBJ, `${WF}tracker`, null).map((o) => o.value)).toEqual([
      "https://pod.example/projects/p1",
    ]);
    // 5) The UNRELATED sibling-subject triple survived untouched.
    expect(
      existing
        .getObjects("https://pod.example/tasks/1#note", `${DCT}title`, null)
        .map((o) => o.value),
    ).toEqual(["a sibling subject"]);
  });

  it("does NOT do a naive replace: a foreign predicate the shape ignores is kept", () => {
    const existing = parseTurtle(
      `
      @prefix wf: <${WF}> .
      @prefix dct: <${DCT}> .
      @prefix ex: <https://producer.example/> .
      <${TASK_SUBJ}> a wf:Task, wf:Open ;
        dct:title "T" ;
        ex:producerScopedField "must survive a save" .
    `,
      TASK_URL,
    );
    const formGraph = parseTurtle(
      `@prefix wf: <${WF}> . @prefix dct: <${DCT}> . <urn:m> a wf:Task ; dct:title "T2" .`,
      TASK_URL,
    );
    const el = document.createElement("test-task-form") as TestTaskForm;
    el.runMerge(formGraph, existing, TASK_URL);
    expect(
      existing
        .getObjects(TASK_SUBJ, "https://producer.example/producerScopedField", null)
        .map((o) => o.value),
    ).toEqual(["must survive a save"]);
  });
});

describe("§10 bookmark merge — preserves untouched triples", () => {
  it("editing the title keeps an unrelated triple + the created timestamp", () => {
    const url = "https://pod.example/bookmarks/1";
    const subj = `${url}#it`;
    const existing = parseTurtle(
      `
      @prefix book: <https://w3id.org/jeswr/bookmark#> .
      @prefix schema: <${SCHEMA}> .
      @prefix dct: <${DCT}> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <${subj}> a book:Bookmark ;
        schema:url <https://example.com/a> ;
        dct:title "Old" ;
        dct:created "2026-01-01T00:00:00Z"^^xsd:dateTime ;
        schema:keywords "keepme" .
    `,
      url,
    );
    const formGraph = parseTurtle(
      `
      @prefix book: <https://w3id.org/jeswr/bookmark#> .
      @prefix schema: <${SCHEMA}> .
      @prefix dct: <${DCT}> .
      <urn:m> a book:Bookmark ;
        schema:url <https://example.com/a> ;
        dct:title "New" ;
        schema:keywords "keepme" .
    `,
      url,
    );
    const el = document.createElement("test-bookmark-form") as TestBookmarkForm;
    el.runMerge(formGraph, existing, url);

    expect(existing.getObjects(subj, `${DCT}title`, null).map((o) => o.value)).toEqual(["New"]);
    // The created timestamp (not in the form's emitted fields here) survived.
    expect(existing.getObjects(subj, `${DCT}created`, null)).toHaveLength(1);
    // The tag survived.
    expect(existing.getObjects(subj, `${SCHEMA}keywords`, null).map((o) => o.value)).toContain(
      "keepme",
    );
  });

  it("a hostile javascript: url in the form is DROPPED (model filter), keeping the safe existing url", () => {
    const url = "https://pod.example/bookmarks/1";
    const subj = `${url}#it`;
    const existing = parseTurtle(
      `
      @prefix book: <https://w3id.org/jeswr/bookmark#> .
      @prefix schema: <${SCHEMA}> .
      <${subj}> a book:Bookmark ; schema:url <https://example.com/safe> .
    `,
      url,
    );
    const formGraph = parseTurtle(
      `
      @prefix book: <https://w3id.org/jeswr/bookmark#> .
      @prefix schema: <${SCHEMA}> .
      <urn:m> a book:Bookmark ; schema:url <javascript:alert(1)> .
    `,
      url,
    );
    const el = document.createElement("test-bookmark-form") as TestBookmarkForm;
    el.runMerge(formGraph, existing, url);
    // The url setter drops a non-http(s) value → the stored url is cleared, never
    // becomes the hostile scheme. No javascript: IRI is ever in the graph.
    const urls = existing.getObjects(subj, `${SCHEMA}url`, null).map((o) => o.value);
    expect(urls).not.toContain("javascript:alert(1)");
  });
});

describe("§10 contact merge — preserves the structured emails when editing the name", () => {
  it("editing the name keeps the structured vcard:hasEmail blank node + webid", () => {
    const url = "https://pod.example/contacts/alice";
    const subj = `${url}#this`;
    const Vcard = "http://www.w3.org/2006/vcard/ns#";
    const existing = parseTurtle(
      `
      @prefix vcard: <${Vcard}> .
      <${subj}> a vcard:Individual ;
        vcard:fn "Alice" ;
        vcard:hasEmail [ a vcard:Home ; vcard:value <mailto:alice@example.com> ] ;
        vcard:url [ a vcard:WebId ; vcard:value <https://alice.example/me> ] .
    `,
      url,
    );
    const formGraph = parseTurtle(
      `@prefix vcard: <${Vcard}> . <urn:m> a vcard:Individual ; vcard:fn "Alice Smith" .`,
      url,
    );
    const el = document.createElement("test-contact-form") as TestContactForm;
    el.runMerge(formGraph, existing, url);

    // The name was updated.
    expect(existing.getObjects(subj, `${Vcard}fn`, null).map((o) => o.value)).toEqual([
      "Alice Smith",
    ]);
    // The structured email blank node (NOT in the form's flat shape) survived: the
    // hasEmail edge + its value triple are still present (the §10 merge preserved them).
    const emailNodes = existing.getObjects(subj, `${Vcard}hasEmail`, null);
    expect(emailNodes).toHaveLength(1);
    const values = existing.getObjects(emailNodes[0], `${Vcard}value`, null).map((o) => o.value);
    expect(values).toContain("mailto:alice@example.com");
    // The WebID structured node survived too.
    expect(existing.getObjects(subj, `${Vcard}url`, null)).toHaveLength(1);
  });
});
