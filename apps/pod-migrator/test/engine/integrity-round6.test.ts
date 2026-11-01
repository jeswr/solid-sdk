// AUTHORED-BY Codex GPT-6
import { LiteralFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { afterEach, expect, it, vi } from "vitest";
import { executeMigration, finalizePlan, planMigration } from "../../src/engine/index.js";
import { serialize } from "../../src/engine/rdf.js";
import { readBody, readResourceBytes } from "../../src/engine/resource-body.js";
import type { PodHttp } from "../../src/engine/types.js";
import { pods, resolve } from "./helpers.js";

const url = "https://source.example/pod/note.ttl";
const value = "café 漢字 🌱";
const jsonld = JSON.stringify({ "@id": "urn:note", "urn:text": [{ "@value": value }] });

afterEach(() => vi.unstubAllGlobals());

async function representations() {
  const dataset = new Store();
  const node = new TermWrapper("urn:note", dataset, DataFactory);
  SetFrom.subjectPredicate(node, "urn:text", (term) => term.value, LiteralFrom.string).add(value);
  const writer = new Writer({ format: "N-Quads" });
  writer.addQuads([...dataset]);
  const nquads = await new Promise<string>((resolve, reject) =>
    writer.end((error, body) => (error ? reject(error) : resolve(body))),
  );
  return { turtle: await serialize(dataset), nquads };
}

function rdf(body: BodyInit | null, type = "text/turtle", length?: number) {
  const headers = new Headers({ "content-type": type });
  if (length !== undefined) headers.set("content-length", String(length));
  return new Response(body, { headers });
}

it.each([
  false,
  true,
])("copies length-framed Turtle from a JSON-LD-only server (rewrite=%s)", async (rewrite) => {
  const { source, target } = await pods();
  const sourceUrl = `${source.root}note.ttl`;
  const destination = `${target.root}note.ttl`;
  const { turtle } = await representations();
  source.store(sourceUrl, turtle, "text/turtle");
  const side = source.side();
  const get = side.http.get;
  const conversions = vi.fn<PodHttp["get"]>(async (_url, init) =>
    init?.accept === "application/ld+json"
      ? rdf(jsonld, "application/ld+json", Buffer.byteLength(jsonld))
      : new Response(null, { status: 406 }),
  );
  side.http = {
    ...side.http,
    get: async (resource, init) => {
      if (resource !== sourceUrl) return get(resource, init);
      if (init?.accept) return conversions(resource, init);
      return rdf(turtle, "text/turtle", Buffer.byteLength(turtle));
    },
  };
  const options = { source: side, target: target.side(), rewriteIris: rewrite };
  const plan = await planMigration(options);
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(result.failed).toEqual([]);
  expect(result.verified).toBe(true);
  expect(conversions).toHaveBeenCalledExactlyOnceWith(sourceUrl, {
    accept: "application/ld+json",
    signal: undefined,
  });
  const warnings = result.log.filter((entry) => entry.level === "warn");
  if (rewrite) expect(warnings).toEqual([]);
  else {
    expect(target.data.get(destination)?.bytes).toEqual(new TextEncoder().encode(turtle));
    expect(warnings).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          `Byte-verbatim completeness cannot be established at ${sourceUrl}`,
        ),
      }),
    );
  }
});

it.each([
  undefined,
  "identity",
  "gzip",
])("accepts self-framed JSON-LD evidence for security reads (encoding=%s)", async (encoding) => {
  const { turtle } = await representations();
  const signal = new AbortController().signal;
  const converted = rdf(jsonld, "Application/LD+JSON; charset=utf-8", Buffer.byteLength(jsonld));
  if (encoding) converted.headers.set("content-encoding", encoding);
  const get = vi.fn<PodHttp["get"]>().mockResolvedValue(converted);
  const body = await readBody(rdf(turtle), url, {
    http: { get },
    securityRelevant: true,
    semantic: true,
    signal,
  });
  expect(body.dataset?.size).toBe(1);
  expect(body.graphProofOnly).toBe(true);
  expect(get).toHaveBeenCalledExactlyOnceWith(url, { accept: "application/ld+json", signal });
});

const unusableJsonld = [
  { name: "truncated", response: () => rdf(jsonld.slice(0, -1), "application/ld+json") },
  { name: "trailing junk", response: () => rdf(`${jsonld} trailing`, "application/ld+json") },
  { name: "invalid RDF", response: () => rdf('{"@id":42}', "application/ld+json") },
  {
    name: "invalid UTF-8",
    response: () => {
      const bytes = new TextEncoder().encode(jsonld);
      bytes[bytes.indexOf(0xc3)] = 0xff;
      return rdf(bytes, "application/ld+json");
    },
  },
  {
    name: "remote context",
    response: () => rdf('{"@context":"https://context.example/context"}', "application/ld+json"),
  },
  { name: "unavailable", response: () => new Response(null, { status: 406 }) },
  {
    name: "partial",
    response: () =>
      new Response(null, { status: 206, headers: { "content-type": "application/ld+json" } }),
  },
  {
    name: "network error",
    response: () => {
      throw new Error("offline");
    },
  },
];

it.each(unusableJsonld)("falls back to N-Quads when JSON-LD has $name", async ({ response }) => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  const { turtle, nquads } = await representations();
  const get = vi.fn<PodHttp["get"]>(async (_url, init) =>
    init?.accept === "application/ld+json" ? response() : rdf(nquads, "application/n-quads"),
  );
  const onGraphProofOnly = vi.fn();
  expect(
    await readResourceBytes(rdf(turtle, "text/turtle", Buffer.byteLength(turtle)), url, {
      http: { get },
      onGraphProofOnly,
    }),
  ).toEqual(new TextEncoder().encode(turtle));
  expect(get.mock.calls.map(([, init]) => init?.accept)).toEqual([
    "application/ld+json",
    "application/n-quads",
  ]);
  expect(onGraphProofOnly).toHaveBeenCalledOnce();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  "length-framed",
  "security-relevant",
  "length-free data",
])("keeps fail-closed rules after a truncated JSON-LD conversion (%s)", async (kind) => {
  const { turtle } = await representations();
  const get = vi.fn<PodHttp["get"]>(async (_url, init) =>
    init?.accept === "application/ld+json"
      ? rdf(jsonld.slice(0, -2), "application/ld+json")
      : new Response(null, { status: 406 }),
  );
  const onGraphProofOnly = vi.fn();
  const reading = readResourceBytes(
    rdf(turtle, "text/turtle", kind === "length-framed" ? Buffer.byteLength(turtle) : undefined),
    url,
    { http: { get }, securityRelevant: kind === "security-relevant", onGraphProofOnly },
  );
  if (kind === "length-free data") expect(await reading).toEqual(new TextEncoder().encode(turtle));
  else await expect(reading).rejects.toThrow("completeness cannot be established");
  expect(get).toHaveBeenCalledTimes(2);
  expect(onGraphProofOnly).not.toHaveBeenCalled();
});

it("refuses a complete but disagreeing JSON-LD graph without trying N-Quads", async () => {
  const { turtle } = await representations();
  const get = vi.fn<PodHttp["get"]>().mockResolvedValue(rdf("[]", "application/ld+json"));
  await expect(readBody(rdf(turtle), url, { http: { get } })).rejects.toThrow("graph mismatch");
  expect(get).toHaveBeenCalledOnce();
});

it("compares JSON-LD blank nodes and named graphs against an N-Quads original", async () => {
  const original = '_:a <urn:text> "café" <urn:graph> .\n';
  const converted = JSON.stringify({
    "@id": "urn:graph",
    "@graph": [{ "@id": "_:new", "urn:text": [{ "@value": "café" }] }],
  });
  const get = vi.fn<PodHttp["get"]>().mockResolvedValue(rdf(converted, "application/ld+json"));
  const result = await readBody(rdf(original, "application/n-quads"), url, { http: { get } });
  expect(result.graphProofOnly).toBe(true);
  expect(get).toHaveBeenCalledExactlyOnceWith(url, {
    accept: "application/ld+json",
    signal: undefined,
  });
});
