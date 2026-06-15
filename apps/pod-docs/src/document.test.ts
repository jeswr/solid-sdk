import { Writer } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildDocument,
  documentSubject,
  parseDocument,
  type Revision,
  revisionSubject,
} from "./document.js";
import { turtleToStore } from "./test-helpers.js";
import { DEFAULT_FORMAT, DOCUMENT_CLASS, PREFIXES, PROV } from "./vocab.js";

const RES = "https://alice.pod/pod-docs/note-abc.ttl";

function serialize(store: ReturnType<typeof buildDocument>): Promise<string> {
  return new Promise((resolve, reject) => {
    const w = new Writer({ prefixes: PREFIXES });
    for (const q of store) w.addQuad(q);
    w.end((err, result) => (err ? reject(err) : resolve(result)));
  });
}

describe("documentSubject / revisionSubject", () => {
  it("derive deterministic fragment IRIs", () => {
    expect(documentSubject(RES)).toBe(`${RES}#it`);
    expect(revisionSubject(RES, 0)).toBe(`${RES}#rev-0`);
    expect(revisionSubject(RES, 3)).toBe(`${RES}#rev-3`);
  });
});

describe("buildDocument", () => {
  it("mints a fresh document with a rev-0 head revision", async () => {
    const now = new Date("2026-06-15T10:00:00.000Z");
    const store = buildDocument(RES, {
      title: "Hello",
      body: "<p>hi</p>",
      creator: "https://alice.pod/profile/card#me",
      priorRevisions: [],
      now,
    });
    const parsed = parseDocument(RES, store);
    expect(parsed).toBeDefined();
    expect(parsed?.title).toBe("Hello");
    expect(parsed?.body).toBe("<p>hi</p>");
    expect(parsed?.format).toBe(DEFAULT_FORMAT);
    expect(parsed?.creator).toBe("https://alice.pod/profile/card#me");
    expect(parsed?.created).toBe(now.toISOString());
    expect(parsed?.modified).toBe(now.toISOString());
    expect(parsed?.revisions).toHaveLength(1);
    const head = parsed?.revisions[0];
    expect(head?.id).toBe(`${RES}#rev-0`);
    expect(head?.body).toBe("<p>hi</p>");
    expect(head?.generatedAt).toBe(now.toISOString());
    expect(head?.attributedTo).toBe("https://alice.pod/profile/card#me");
    expect(head?.wasRevisionOf).toBeUndefined();
  });

  it("stamps the document with the pd:Document class", () => {
    const store = buildDocument(RES, { title: "t", body: "b", priorRevisions: [] });
    expect(parseDocument(RES, store)).toBeDefined();
  });

  it("falls back to the default format when none/blank is given", () => {
    const store = buildDocument(RES, { title: "t", body: "b", format: "   ", priorRevisions: [] });
    expect(parseDocument(RES, store)?.format).toBe(DEFAULT_FORMAT);
  });

  it("honours an explicit format and an explicit created stamp", () => {
    const created = new Date("2020-01-01T00:00:00.000Z");
    const now = new Date("2026-06-15T11:00:00.000Z");
    const store = buildDocument(RES, {
      title: "md",
      body: "# heading",
      format: "text/markdown",
      created,
      priorRevisions: [],
      now,
    });
    const parsed = parseDocument(RES, store);
    expect(parsed?.format).toBe("text/markdown");
    expect(parsed?.created).toBe(created.toISOString());
    expect(parsed?.modified).toBe(now.toISOString());
  });

  it("uses a real clock when `now` is omitted", () => {
    const before = Date.now();
    const store = buildDocument(RES, { title: "t", body: "b", priorRevisions: [] });
    const after = Date.now();
    const ts = new Date(parseDocument(RES, store)?.modified ?? 0).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("appends a new head revision and preserves the prior chain", () => {
    const t0 = new Date("2026-06-15T10:00:00.000Z");
    const first = buildDocument(RES, {
      title: "v1",
      body: "one",
      creator: "https://alice.pod/profile/card#me",
      priorRevisions: [],
      now: t0,
    });
    const afterFirst = parseDocument(RES, first);
    expect(afterFirst?.revisions).toHaveLength(1);

    const t1 = new Date("2026-06-15T12:00:00.000Z");
    const second = buildDocument(RES, {
      title: "v2",
      body: "two",
      creator: "https://alice.pod/profile/card#me",
      priorRevisions: afterFirst?.revisions,
      now: t1,
    });
    const afterSecond = parseDocument(RES, second);
    expect(afterSecond?.body).toBe("two");
    expect(afterSecond?.revisions).toHaveLength(2);
    // Head-first: newest then oldest.
    expect(afterSecond?.revisions[0]?.id).toBe(`${RES}#rev-1`);
    expect(afterSecond?.revisions[0]?.body).toBe("two");
    expect(afterSecond?.revisions[0]?.wasRevisionOf).toBe(`${RES}#rev-0`);
    expect(afterSecond?.revisions[1]?.id).toBe(`${RES}#rev-0`);
    expect(afterSecond?.revisions[1]?.body).toBe("one");
  });

  it("indexes the next revision past the highest existing one", () => {
    const prior: Revision[] = [
      {
        id: `${RES}#rev-5`,
        body: "e",
        format: "text/html",
        generatedAt: new Date(0).toISOString(),
      },
      {
        id: `${RES}#rev-2`,
        body: "b",
        format: "text/html",
        generatedAt: new Date(0).toISOString(),
      },
    ];
    const store = buildDocument(RES, { title: "t", body: "new", priorRevisions: prior });
    expect(parseDocument(RES, store)?.revisions[0]?.id).toBe(`${RES}#rev-6`);
  });

  it("ignores prior revisions from other resources when indexing", () => {
    const prior: Revision[] = [
      {
        id: "https://other.pod/x.ttl#rev-99",
        body: "x",
        format: "text/html",
        generatedAt: new Date(0).toISOString(),
        wasRevisionOf: undefined,
      },
    ];
    const store = buildDocument(RES, { title: "t", body: "new", priorRevisions: prior });
    // First local revision is rev-0 since no prior IRI matched THIS resource.
    expect(parseDocument(RES, store)?.revisions[0]?.id).toBe(`${RES}#rev-0`);
  });

  it("ignores a non-numeric rev suffix when computing the next index", () => {
    const prior: Revision[] = [
      {
        id: `${RES}#rev-notanumber`,
        body: "x",
        format: "text/html",
        generatedAt: new Date(0).toISOString(),
      },
    ];
    const store = buildDocument(RES, { title: "t", body: "n", priorRevisions: prior });
    expect(parseDocument(RES, store)?.revisions[0]?.id).toBe(`${RES}#rev-0`);
  });

  it("treats a missing priorRevisions as an empty history", () => {
    const store = buildDocument(RES, { title: "t", body: "b" });
    const parsed = parseDocument(RES, store);
    expect(parsed?.revisions).toHaveLength(1);
    expect(parsed?.revisions[0]?.id).toBe(`${RES}#rev-0`);
  });

  it("omits a blank title from the serialised document", async () => {
    const store = buildDocument(RES, { title: "", body: "b", priorRevisions: [] });
    const ttl = await serialize(store);
    expect(ttl).not.toContain("title");
    expect(parseDocument(RES, store)?.title).toBe("");
  });
});

describe("parseDocument", () => {
  it("returns undefined when no pd:Document is present", () => {
    const store = turtleToStore(`<#it> <http://purl.org/dc/terms/title> "Just a title" .`, RES);
    expect(parseDocument(RES, store)).toBeUndefined();
  });

  it("round-trips a hand-written Turtle document", () => {
    const ttl = `
      @prefix pd: <https://w3id.org/jeswr/pod-docs#> .
      @prefix dct: <http://purl.org/dc/terms/> .
      @prefix prov: <http://www.w3.org/ns/prov#> .
      @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
      <#it> a pd:Document ;
        dct:title "Read me" ;
        pd:body "<h1>hi</h1>" ;
        pd:format "text/html" ;
        dct:creator <https://bob.pod/card#me> ;
        dct:created "2026-01-01T00:00:00.000Z"^^xsd:dateTime ;
        dct:modified "2026-02-02T00:00:00.000Z"^^xsd:dateTime ;
        pd:currentRevision <#rev-0> .
      <#rev-0> a prov:Entity ;
        pd:body "<h1>hi</h1>" ;
        pd:format "text/html" ;
        prov:generatedAtTime "2026-02-02T00:00:00.000Z"^^xsd:dateTime ;
        prov:wasAttributedTo <https://bob.pod/card#me> .
    `;
    const parsed = parseDocument(RES, turtleToStore(ttl, RES));
    expect(parsed?.title).toBe("Read me");
    expect(parsed?.body).toBe("<h1>hi</h1>");
    expect(parsed?.creator).toBe("https://bob.pod/card#me");
    expect(parsed?.created).toBe("2026-01-01T00:00:00.000Z");
    expect(parsed?.modified).toBe("2026-02-02T00:00:00.000Z");
    expect(parsed?.revisions).toHaveLength(1);
    expect(parsed?.revisions[0]?.attributedTo).toBe("https://bob.pod/card#me");
  });

  it("defaults a revision's body/format/timestamp when the entity is sparse", () => {
    const ttl = `
      @prefix pd: <https://w3id.org/jeswr/pod-docs#> .
      @prefix prov: <http://www.w3.org/ns/prov#> .
      <#it> a pd:Document ; pd:currentRevision <#rev-0> .
      <#rev-0> a prov:Entity .
    `;
    const parsed = parseDocument(RES, turtleToStore(ttl, RES));
    expect(parsed?.revisions).toHaveLength(1);
    expect(parsed?.revisions[0]?.body).toBe("");
    expect(parsed?.revisions[0]?.format).toBe(DEFAULT_FORMAT);
    expect(parsed?.revisions[0]?.generatedAt).toBe(new Date(0).toISOString());
  });

  it("yields an empty history when currentRevision is absent", () => {
    const ttl = `
      @prefix pd: <https://w3id.org/jeswr/pod-docs#> .
      <#it> a pd:Document ; pd:body "x" .
    `;
    expect(parseDocument(RES, turtleToStore(ttl, RES))?.revisions).toHaveLength(0);
  });

  it("stops the walk when the linked revision is not a prov:Entity", () => {
    const ttl = `
      @prefix pd: <https://w3id.org/jeswr/pod-docs#> .
      <#it> a pd:Document ; pd:currentRevision <#rev-0> .
      <#rev-0> pd:body "orphan, not an Entity" .
    `;
    expect(parseDocument(RES, turtleToStore(ttl, RES))?.revisions).toHaveLength(0);
  });

  it("breaks a self-referential / cyclic wasRevisionOf chain", () => {
    const ttl = `
      @prefix pd: <https://w3id.org/jeswr/pod-docs#> .
      @prefix prov: <http://www.w3.org/ns/prov#> .
      <#it> a pd:Document ; pd:currentRevision <#rev-1> .
      <#rev-1> a prov:Entity ; pd:body "1" ; prov:wasRevisionOf <#rev-0> .
      <#rev-0> a prov:Entity ; pd:body "0" ; prov:wasRevisionOf <#rev-1> .
    `;
    const revs = parseDocument(RES, turtleToStore(ttl, RES))?.revisions ?? [];
    // Two distinct nodes, then the visited-set guard stops the cycle.
    expect(revs).toHaveLength(2);
    expect(new Set(revs.map((r) => r.id)).size).toBe(2);
  });
});

describe("class marker", () => {
  it("a built document carries the document class on its subject", () => {
    const store = buildDocument(RES, { title: "t", body: "b", priorRevisions: [] });
    const subj = documentSubject(RES);
    let found = false;
    for (const q of store.match()) {
      if (q.subject.value === subj && q.object.value === DOCUMENT_CLASS) found = true;
    }
    expect(found).toBe(true);
    // The head revision carries the PROV Entity class.
    let revTyped = false;
    for (const q of store.match()) {
      if (q.object.value === PROV.Entity) revTyped = true;
    }
    expect(revTyped).toBe(true);
  });
});
