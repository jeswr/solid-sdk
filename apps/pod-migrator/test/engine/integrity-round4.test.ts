// AUTHORED-BY Codex GPT-6
import { gzipSync } from "node:zlib";
import { parseRdf } from "@jeswr/fetch-rdf";
import { LiteralFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import { expect, it, vi } from "vitest";
import { executeMigration, finalizePlan, planMigration } from "../../src/engine/index.js";
import { serialize } from "../../src/engine/rdf.js";
import { readResourceBytes } from "../../src/engine/resource-body.js";
import { pods, resolve } from "./helpers.js";

async function turtle(value: string): Promise<string> {
  const dataset = new Store();
  const node = new TermWrapper("urn:note", dataset, DataFactory);
  SetFrom.subjectPredicate(node, "urn:text", (term) => term.value, LiteralFrom.string).add(value);
  return serialize(dataset);
}
async function nquads(body: string, url: string): Promise<string> {
  const writer = new Writer({ format: "N-Quads" });
  writer.addQuads([...(await parseRdf(body, "text/turtle", { baseIRI: url }))]);
  return new Promise((resolve, reject) =>
    writer.end((error, result) => (error ? reject(error) : resolve(result))),
  );
}
function rdf(body: string, type = "text/turtle", length?: number): Response {
  const headers = new Headers({ "content-type": type });
  if (length !== undefined) headers.set("content-length", String(length));
  return new Response(body, { headers });
}

it.each([
  false,
  true,
])("checks length-free Unicode data before writes (truncated=%s)", async (truncated) => {
  const { source, target } = await pods();
  const folder = `${source.root}folder/`;
  const url = `${folder}note.ttl`;
  const destination = `${target.root}folder/note.ttl`;
  const prefix = await turtle("café");
  const complete = prefix + (await turtle("distinct trailing triple"));
  source.store(folder, "", "text/turtle");
  source.store(url, complete, "text/turtle");
  const converted = await nquads(complete, url);
  const side = source.side();
  const get = side.http.get;
  const conversions = vi.fn(() => rdf(converted, "application/n-quads"));
  side.http = {
    ...side.http,
    get: async (resource, init) =>
      resource === url
        ? init?.accept === "application/n-quads"
          ? conversions()
          : rdf(truncated ? prefix : complete)
        : get(resource, init),
  };
  const options = { source: side, target: target.side() };
  const plan = await planMigration(options);
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(conversions).toHaveBeenCalledTimes(1);
  if (truncated) {
    expect(result.failed).toEqual([
      {
        url: destination,
        error: expect.stringContaining(`completeness cannot be established at ${url}`),
      },
    ]);
    expect(result.verified).toBe(false);
    expect(result.copied).toEqual([]);
    expect(target.requests.filter((request) => request.method === "PUT")).toEqual([]);
  } else {
    expect(result.failed).toEqual([]);
    expect(result.verified).toBe(true);
    expect(target.data.get(destination)?.bytes).toEqual(new TextEncoder().encode(complete));
    expect(result.log.filter((entry) => entry.level === "warn")).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining(
          `Byte-verbatim completeness cannot be established at ${url}`,
        ),
      }),
    );
  }
});

it.each([
  "406",
  "error",
  "echoed",
  "length-framed",
  "malformed",
])("accepts length-free data without warning when conversion is %s, but refuses access documents", async (evidence) => {
  const url = "https://source.example/pod/note.ttl";
  const body = await turtle("café");
  const converted = await nquads(body, url);
  const get = vi.fn(async () => {
    if (evidence === "406") return new Response(null, { status: 406 });
    if (evidence === "error") throw new Error("conversion unavailable");
    if (evidence === "echoed") return rdf(body);
    if (evidence === "malformed") return rdf("broken", "application/n-quads");
    return rdf(converted, "application/n-quads", Buffer.byteLength(converted));
  });
  const onGraphProofOnly = vi.fn();
  const options = { http: { get } as never, onGraphProofOnly };
  expect(await readResourceBytes(rdf(body), url, options)).toEqual(new TextEncoder().encode(body));
  expect(onGraphProofOnly).not.toHaveBeenCalled();
  await expect(
    readResourceBytes(rdf(body), url, { ...options, securityRelevant: true }),
  ).rejects.toMatchObject({
    resourceUrl: url,
    message: expect.stringContaining("completeness cannot be established"),
  });
  expect(get).toHaveBeenCalledTimes(4);
});

it.each([
  "plain",
  "turtle",
  "unicode-turtle",
])("accepts intact %s whose gzip expands it through a CORS response", async (kind) => {
  const body = kind === "plain" ? "abc" : await turtle(kind === "turtle" ? "x" : "é");
  const compressed = gzipSync(body);
  if (kind === "plain") expect(compressed.byteLength).toBe(23);
  expect(compressed.byteLength).toBeGreaterThan(Buffer.byteLength(body));
  const filtered = new Response(body, {
    headers: {
      "content-type": kind === "plain" ? "text/plain" : "text/turtle",
      "content-length": String(compressed.byteLength),
    },
  });
  Object.defineProperty(filtered, "type", { value: "cors" });
  expect(filtered.headers.has("content-encoding")).toBe(false);
  const get = vi.fn(async () => new Response(null, { status: 406 }));
  const onGraphProofOnly = vi.fn();
  expect(
    await readResourceBytes(filtered, "https://source.example/pod/gzip", {
      http: { get } as never,
      onGraphProofOnly,
    }),
  ).toEqual(new TextEncoder().encode(body));
  expect(get).toHaveBeenCalledTimes(kind === "unicode-turtle" ? 2 : 0);
  expect(onGraphProofOnly).not.toHaveBeenCalled();
});

it.each([
  "basic",
  "default",
  "cors",
] as const)("still rejects short %s bodies with reliable framing", async (type) => {
  const headers = new Headers({ "content-length": "23" });
  if (type === "cors") headers.set("content-encoding", "identity");
  const response = new Response("abc", { headers });
  Object.defineProperty(response, "type", { value: type });
  await expect(readResourceBytes(response, "urn:short")).rejects.toThrow(
    "Content-Length is 23 bytes, received 3",
  );
});

it.each([
  "intact",
  "changed",
  "short",
])("verifies Unicode uploads against retained bytes without target conversion (%s)", async (state) => {
  const { source, target } = await pods();
  const url = `${source.root}note.ttl`;
  const destination = `${target.root}note.ttl`;
  const body = await turtle("café");
  source.store(url, body, "text/turtle");
  const sourceSide = source.side();
  const sourceGet = sourceSide.http.get;
  const converted = await nquads(body, url);
  sourceSide.http = {
    ...sourceSide.http,
    get: async (resource, init) =>
      resource === url && init?.accept === "application/n-quads"
        ? rdf(converted, "application/n-quads")
        : sourceGet(resource, init),
  };
  const targetSide = target.side();
  const targetGet = targetSide.http.get;
  const conversions = vi.fn(async () => new Response(null, { status: 406 }));
  targetSide.http = {
    ...targetSide.http,
    get: async (resource, init) => {
      if (resource !== destination) return targetGet(resource, init);
      if (init?.accept === "application/n-quads") return conversions();
      const actual = state === "intact" ? body : state === "changed" ? body.replace("é", "è") : "";
      return rdf(actual, "text/turtle", Buffer.byteLength(actual));
    },
  };
  const options = { source: sourceSide, target: targetSide };
  const plan = await planMigration(options);
  const result = await executeMigration(finalizePlan(plan, resolve(plan)), options);
  expect(target.data.get(destination)?.bytes).toEqual(new TextEncoder().encode(body));
  expect(conversions).not.toHaveBeenCalled();
  expect(result.verified).toBe(state === "intact");
  expect(result.failed).toEqual(
    state === "intact" ? [] : [{ url: destination, error: "Content verification failed" }],
  );
});
