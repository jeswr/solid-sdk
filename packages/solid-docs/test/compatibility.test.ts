// AUTHORED-BY Codex (GPT-6.1 Sol)
import { DataFactory, Parser, Store } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildComment,
  buildDocument,
  buildVersion,
  type DocumentComment,
  DocumentDoc,
  type DocumentVersion,
  parseDocument,
  RevisionDoc,
  readComment,
  readVersion,
  revisionSubject,
  setCommentResolution,
  setCommentText,
} from "../src/index.js";

const url = "https://pod.example/docs/plan.ttl";
const legacy = "https://w3id.org/jeswr/pod-docs#";
function graph(body: string) {
  return new Store(
    new Parser({ baseIRI: url }).parse(`
    @prefix pd: <https://jeswr.org/ns/pod-docs#> .
    @prefix dct: <http://purl.org/dc/terms/> .
    @prefix prov: <http://www.w3.org/ns/prov#> .
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
    ${body}`),
  );
}

describe("Exact divergences", () => {
  it("drops ambiguous, mistyped and language-tagged scalar fields instead of reading the first or throwing", () => {
    const data = parseDocument(
      url,
      graph(`<#it> a pd:Document ; dct:title "one", "two" ;
      pd:body "bonjour"@fr ; pd:format 7 ; dct:creator "not an IRI" ;
      <https://schema.org/wordCount> -1 ; dct:created "2026-01-01"^^xsd:date .`),
    );
    expect(data).toMatchObject({ title: "", body: "", format: "text/html" });
    expect(data?.creator).toBeUndefined();
    expect(data?.wordCount).toBeUndefined();
    expect(data?.created).toBeUndefined();
  });
  it("drops malformed dateTimes and uses the existing sparse-revision epoch default", () => {
    const data = parseDocument(
      url,
      graph(`<#it> a pd:Document ;
      dct:modified "not a date"^^xsd:dateTime ; pd:currentRevision <#rev-0> .
      <#rev-0> a prov:Entity ; prov:generatedAtTime "2026-02-30T00:00:00Z"^^xsd:dateTime .`),
    );
    expect(data?.modified).toBeUndefined();
    expect(data?.revisions[0]?.generatedAt).toBe(new Date(0).toISOString());
  });
  it("drops an invalid supplied creation date instead of throwing during the write", () => {
    expect(
      parseDocument(url, buildDocument(url, { title: "x", created: "not a date" }))?.created,
    ).toBeUndefined();
  });
  it("mark migrates the legacy document class while retaining other types and content", () => {
    const dataset = graph(
      `<#it> a <${legacy}Document>, <https://example.org/Other> ; <${legacy}body> "keep" .`,
    );
    const view = new DocumentDoc(`${url}#it`, dataset, DataFactory).mark();
    expect(view.types.has(`${legacy}Document`)).toBe(false);
    expect(view.types.has("https://jeswr.org/ns/pod-docs#Document")).toBe(true);
    expect(view.types.has("https://example.org/Other")).toBe(true);
    expect(view.body).toBe("keep");
  });
  it("recognises document subclasses declared in the data graph", () => {
    expect(
      parseDocument(
        url,
        graph(`<#Custom> rdfs:subClassOf pd:Document .
      <#it> a <#Custom> ; dct:title "Subclass" .`),
      )?.title,
    ).toBe("Subclass");
  });
  it("rejects unsafe or relative document and revision subjects", () => {
    expect(() => buildDocument("relative.ttl", { title: "x" })).toThrow(TypeError);
    expect(() => revisionSubject("relative.ttl", 0)).toThrow(TypeError);
    expect(() => new DocumentDoc(DataFactory.blankNode(), new Store(), DataFactory)).toThrow(
      TypeError,
    );
    expect(() => new RevisionDoc("https://pod.example/a b", new Store(), DataFactory)).toThrow(
      TypeError,
    );
    expect(parseDocument("relative.ttl", graph(`<#it> a pd:Document .`))).toBeUndefined();
  });
  it("drops unsafe field IRI writes", () => {
    expect(
      parseDocument(url, buildDocument(url, { title: "x", creator: "https://pod.example/a b" }))
        ?.creator,
    ).toBeUndefined();
  });
  it("drops a nonliteral version label instead of exposing its IRI as text", () => {
    const dataset = graph(`<${url}> dct:created "2026-11-11T12:00:00Z"^^xsd:dateTime ;
      pd:snapshot <snapshot.bin> ; pd:versionKind "named" ;
      rdfs:label <https://example.org/not-a-literal> .`);
    expect(readVersion(url, dataset).name).toBeUndefined();
  });
  it("drops a mistyped comment or version scalar instead of using its lexical text", () => {
    const comment: DocumentComment = {
      url: `${url}/comment.ttl`,
      etag: null,
      text: "hello",
      creator: "https://pod.example/#me",
      created: "2026-11-11T12:00:00.000Z",
      target: url,
      kind: "reply",
      resolved: false,
    };
    const dataset = buildComment(comment);
    const node = DataFactory.namedNode(comment.url);
    const predicate = DataFactory.namedNode("http://www.w3.org/ns/oa#bodyValue");
    for (const quad of [...dataset.match(node, predicate)]) dataset.delete(quad);
    dataset.addQuads([...graph(`<${comment.url}> <${predicate.value}> "hello"@en .`)]);
    expect(() => readComment(comment.url, dataset, null)).toThrow("Malformed comment");
    const version = graph(`<${url}> <https://jeswr.org/ns/pod-docs#snapshot> <snapshot.bin> ;
      dct:created "2026-11-11T12:00:00Z"^^xsd:dateTime ; pd:versionKind "named"@en .`);
    expect(() => readVersion(url, version)).toThrow("Malformed document version");
  });
  it("recognises annotation and quote types among additional RDF types", () => {
    const comment: DocumentComment = {
      url: `${url}/comment.ttl`,
      etag: null,
      text: "hello",
      creator: "https://pod.example/#me",
      created: "2026-11-11T12:00:00.000Z",
      target: `${url}#it`,
      kind: "root",
      resolved: false,
      anchor: { exact: "q", prefix: "", suffix: "", start: "1", end: "2" },
    };
    const extras = graph(`<${comment.url}> a <https://example.org/Extra> .
      <${comment.url}#quote> a <https://example.org/Extra> .`);
    const dataset = new Store([...extras, ...buildComment(comment)]);
    expect(readComment(comment.url, dataset, null)).toEqual(comment);
  });
});

describe("compatibility policies retained outside the generated projection", () => {
  it.each([
    DocumentDoc,
    RevisionDoc,
  ])("keeps shared legacy content canonical-first and clears only its own subject", (View) => {
    const dataset = graph(`<#it> pd:body "current" ; <${legacy}body> "old" ; <${legacy}format> "" .
      <#other> <${legacy}body> "keep" .`);
    const view = new View(`${url}#it`, dataset, DataFactory);
    expect(view.body).toBe("current");
    expect(view.format).toBe("");
    view.body = "replacement";
    view.format = undefined;
    expect(view.body).toBe("replacement");
    expect([...dataset].filter((q) => q.subject.value === `${url}#it`)).toHaveLength(1);
    expect(
      [...dataset].some((q) => q.subject.value === `${url}#other` && q.object.value === "keep"),
    ).toBe(true);
  });
  it("preserves editor control characters and IRI lexical spelling", () => {
    const data = parseDocument(
      url,
      buildDocument(url, {
        title: "a\u0000b",
        body: "text\u0001",
        creator: "https://POD.example:443/profile#me",
      }),
    );
    expect(data?.title).toBe("a\u0000b");
    expect(data?.body).toBe("text\u0001");
    expect(data?.creator).toBe("https://POD.example:443/profile#me");
  });
  it("round-trips conditional anchored comments and edits without typing the target node", () => {
    const comment: DocumentComment = {
      url: `${url}/comment.ttl`,
      etag: '"c"',
      text: "hello",
      creator: "https://pod.example/#me",
      created: "2026-11-11T12:00:00.000Z",
      target: `${url}#it`,
      kind: "root",
      resolved: false,
      anchor: { exact: "quote", prefix: "before", suffix: "after", start: "1", end: "2" },
    };
    const dataset = buildComment(comment);
    expect(readComment(comment.url, dataset, comment.etag)).toEqual(comment);
    expect([...dataset].filter((q) => q.subject.value === `${comment.url}#target`)).toHaveLength(2);
    setCommentResolution(comment.url, dataset, true, comment.creator, new Date(comment.created));
    setCommentText(comment.url, dataset, "changed");
    expect(readComment(comment.url, dataset, comment.etag)).toMatchObject({
      text: "changed",
      resolved: true,
    });
    setCommentResolution(comment.url, dataset, false, comment.creator, new Date(comment.created));
    expect(
      [...dataset].some(
        (q) => q.predicate.value.endsWith("resolvedBy") || q.predicate.value.endsWith("resolvedAt"),
      ),
    ).toBe(false);
  });
  it("isolates version metadata with a mistyped optional creator", () => {
    const dataset = graph(`<${url}> dct:created "2026-11-11T12:00:00Z"^^xsd:dateTime ;
      pd:snapshot <snapshot.bin> ; pd:versionKind "named" ; dct:creator "literal" .`);
    expect(() => readVersion(url, dataset)).toThrow();
  });
  it("round-trips historical version metadata without asserting a new RDF type", () => {
    const version: DocumentVersion = {
      url,
      snapshot: `${url}.bin`,
      kind: "named",
      created: "2026-11-11T12:00:00.000Z",
      creator: "https://pod.example/#me",
      name: "Draft",
    };
    const dataset = buildVersion(version);
    expect({ url, ...readVersion(url, dataset) }).toEqual(version);
    expect([...dataset].some((q) => q.predicate.value.endsWith("#type"))).toBe(false);
  });
});
