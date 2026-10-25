// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import {
  httpUrl,
  inStorage,
  parseResource,
  primarySubject,
  readResource,
  serializeTurtle,
  subjectOf,
} from "../../src/apps/home/lib/model/rdf";
import { fixtureFetch, rdf, STORAGE } from "./fixtures";

describe("typed RDF read model", () => {
  it("selects #it, #this, then most statements, with deterministic ties", async () => {
    const doc = `${STORAGE}item.ttl`;
    for (const [body, expected] of [
      [
        '<#this> schema:name "This" ; schema:description "more" . <#it> schema:name "It" .',
        `${doc}#it`,
      ],
      [
        '<#this> schema:name "This" . <> schema:name "Doc" ; schema:description "more" .',
        `${doc}#this`,
      ],
      ['<#a> schema:name "A" . <#b> schema:name "B" ; schema:description "more" .', `${doc}#b`],
      ['<#a> schema:name "A" . <#b> schema:name "B" .', `${doc}#a`],
    ])
      expect(primarySubject(await rdf(body as string), `${doc}#fragment`)?.value).toBe(expected);
    expect(primarySubject(await rdf(""), doc)).toBeUndefined();
    expect(primarySubject(await rdf('[] schema:name "Blank" .'), doc)?.termType).toBe("BlankNode");
  });

  it("reads legacy predicates and tolerates malformed term types and lexical dates", async () => {
    const dataset = await rdf(
      '<> a "broken", schema:Book ; schema:name <https://wrong.example/> ; old:name "", " ", "A book" ; dct:modified "nonsense", "2026-01-02" ; schema:url "not an IRI", <https://goodreads.com/book/1> .',
    );
    const node = subjectOf(dataset, DataFactory.namedNode(`${STORAGE}item.ttl`));
    expect(node.types).toEqual([`${NS.SCHEMA}Book`]);
    expect(node.name).toBe("A book");
    expect(node.modified).toBe("2026-01-02");
    expect(node.sourceUrls).toEqual(["https://goodreads.com/book/1"]);
    expect(subjectOf(await rdf(""), `${STORAGE}item.ttl`).name).toBeUndefined();
  });

  it("round-trips RDF through the shared parser and serialiser without rewriting identities or literals", async () => {
    const original = await rdf(
      '<#it> a old:Book ; old:name "http://schema.org/unchanged" ; vcard:hasEmail [ vcard:hasValue <mailto:alice@example.com> ] .',
    );
    const turtle = await serializeTurtle(original);
    const roundTrip = await parseResource(turtle, "text/turtle", `${STORAGE}item.ttl`);
    expect(roundTrip.size).toBe(original.size);
    expect(subjectOf(roundTrip, `${STORAGE}item.ttl#it`).name).toBe("http://schema.org/unchanged");
    expect(turtle).toContain("http://schema.org/Book");
    expect(await serializeTurtle(await rdf(""))).toBe("");
    await expect(parseResource("invalid", "text/turtle", STORAGE)).rejects.toThrow();
  });

  it.each([
    ["https://pod.example/alice/a.ttl", true],
    ["https://pod.example/alice", false],
    ["https://pod.example/alice2/a.ttl", false],
    ["https://foreign.example/alice/a.ttl", false],
    ["https://pod.example/alice/../private/a.ttl", false],
    ["https://pod.example/alice/%2fprivate/a.ttl", false],
    ["https://pod.example/alice/%2e/private/a.ttl", false],
    ["https://pod.example/alice/%5Cprivate/a.ttl", false],
    ["https://pod.example/alice/a.ttl?query", false],
    ["https://pod.example/alice/a.ttl#it", true],
    ["javascript:alert(1)", false],
    ["https://user:password@pod.example/alice/a", false],
    ["not a URL", false],
  ])("checks storage scope for %s", (value, expected) =>
    expect(inStorage(value, STORAGE)).toBe(expected));

  it("validates roots and fetches only through the injected transport with revalidation", async () => {
    expect(inStorage(STORAGE, "bad")).toBe(false);
    expect(inStorage(STORAGE, STORAGE.slice(0, -1))).toBe(false);
    expect(httpUrl("http://pod.example/")?.protocol).toBe("http:");
    const fetch = fixtureFetch({ [STORAGE]: '<> schema:name "Root" .' });
    const signal = new AbortController().signal;
    const response = await readResource(fetch, STORAGE, signal);
    expect(response.etag).toBe('"/alice/"');
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.signal).toBe(signal);
    expect(init?.redirect).toBe("error");
    expect(new Headers(init?.headers).get("cache-control")).toBe("no-cache");
    await readResource(fetch, STORAGE);
    expect(() => readResource(fetch, "data:text/plain,not-rdf")).toThrow(TypeError);
    await expect(readResource(fetch, `${STORAGE}missing`)).rejects.toMatchObject({ status: 404 });
  });
});
