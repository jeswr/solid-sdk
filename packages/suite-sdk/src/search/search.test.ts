// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment node
import { DataFactory, type LocalIndex } from "@jeswr/rdf-engine";
import { createRdfEngine } from "@jeswr/rdf-engine/node";
import { createFakeRdfEngine } from "@jeswr/rdf-engine/testing";
import { deriveFeatures, type StorageDescription } from "@jeswr/storage-capabilities";
import type { Entry } from "@jeswr/storage-client";
import { afterAll, afterEach, expect, test, vi } from "vitest";
import {
  buildSearchQuery,
  createLocalSearch,
  createSearch,
  createSearchFeeder,
  type SearchCapabilities,
  type SearchQuery,
} from "./index.js";
import { jsonRows, searchPage } from "./results.js";

const { namedNode: nn, literal, quad } = DataFactory;
const root = "https://pod.example/alice/";
const drive = `${root}drive/`;
const tasks = `${root}tasks/`;
const endpoint = "https://pod.example/query"; // service is beside the storage path
const wfTask = "http://www.w3.org/2005/01/wf/flow#Task";
const dct = "http://purl.org/dc/terms/";
const xsd = "http://www.w3.org/2001/XMLSchema#";
const engine = createRdfEngine();
const indexes: LocalIndex[] = [];
afterEach(() => {
  for (const index of indexes.splice(0)) index.dispose();
});
afterAll(() => engine.dispose());

async function index() {
  const result = await engine.createIndex();
  indexes.push(result);
  return result;
}

function entry(url: string, fields: Partial<Entry> = {}): Entry {
  return {
    url,
    kind: "resource",
    contentType: null,
    size: null,
    modified: null,
    types: [],
    ...fields,
  };
}
const pdf = entry(`${drive}Quarterly%20report.pdf`, {
  contentType: "application/pdf",
  size: 2048,
  modified: new Date("2026-04-03T12:00:00Z"),
});
const memo = entry(`${drive}Memo.txt`, { modified: new Date("2026-02-01T12:00:00Z") });
const task = `${tasks}report.ttl#it`;

async function seed(target: LocalIndex) {
  const feed = createSearchFeeder(target);
  await feed.container(root, [
    entry(drive, { kind: "container" }),
    entry(tasks, { kind: "container" }),
  ]);
  await feed.container(drive, [pdf, memo]);
  await feed.resource(`${tasks}report.ttl`, [
    quad(nn(task), nn("http://www.w3.org/2000/01/rdf-schema#label"), literal("Report planning")),
    quad(nn(task), nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"), nn(wfTask)),
    quad(nn(task), nn(`${dct}modified`), literal("2026-04-05T12:00:00Z", nn(`${xsd}dateTime`))),
    quad(nn(task), nn(`${dct}description`), literal("Prepare the quarterly figures")),
  ]);
  await feed.resource(`${tasks}note.ttl`, [
    quad(nn(`${tasks}note.ttl`), nn("https://schema.org/name"), literal("A report note")),
  ]);
  await feed.resource(`${tasks}exact.ttl`, [
    quad(nn(`${tasks}exact.ttl`), nn("http://schema.org/name"), literal("report")),
  ]);
  return createLocalSearch(target);
}

function capabilities(
  state: "available" | "unknown" | "unavailable" = "available",
  url: string | undefined = endpoint,
): SearchCapabilities {
  return {
    root,
    features: { serverSearch: { state, evidence: "fixture:ACQ", detail: { endpoint: url } } },
  };
}

/** ACQ fixture: evaluate the received query through an actual independent WASM LocalIndex. */
function acq(target: LocalIndex) {
  return vi.fn<typeof fetch>(async (input, init) => {
    expect(String(input)).toBe(endpoint);
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("manual");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/sparql-query");
    expect(new Headers(init?.headers).get("accept")).toBe("application/sparql-results+json");
    const bindings = await target.select(init?.body as string);
    return Response.json(
      {
        head: { vars: ["s", "title", "resultType", "modified", "snippet", "contentType"] },
        results: {
          bindings: bindings.map((row) =>
            Object.fromEntries(
              [...row].map(([key, term]) => [
                key.value,
                {
                  type: term.termType === "NamedNode" ? "uri" : "literal",
                  value: term.value,
                },
              ]),
            ),
          ),
        },
      },
      { headers: { "Content-Type": "application/sparql-results+json" } },
    );
  });
}

test("real Node WASM: server and local queries return equal resource sets for a Drive-like tree", async () => {
  const localIndex = await index();
  const remoteIndex = await index();
  const local = await seed(localIndex);
  await seed(remoteIndex);
  const transport = acq(remoteIndex);
  const server = createSearch({ capabilities: capabilities(), fetch: transport, local });
  const queries: SearchQuery[] = [
    {},
    { text: "REPORT" },
    { types: [wfTask] },
    { within: [drive] },
    { within: [drive.slice(0, -1)], orderBy: "modified" },
    { within: [tasks, drive], orderBy: "relevance" },
    { text: "report", types: [wfTask], within: [tasks], limit: 1 },
    { limit: 2 },
    { limit: 2, cursor: btoa("2") },
    { limit: 2, cursor: btoa("4") },
    { text: '")) } UNION { ?s ?p ?o } #\\\n\r\t\b\f' },
  ];
  const spy = vi.spyOn(localIndex, "select");
  for (const q of queries) {
    const a = await local.search(q);
    const b = await server.search(q);
    expect(a.source).toBe("local");
    expect(b.source).toBe("server");
    expect(new Set(a.results.map((row) => row.url))).toEqual(
      new Set(b.results.map((row) => row.url)),
    );
    expect(a.results).toEqual(b.results);
    expect(a.next).toBe(b.next);
    // Same template; the server copy is additionally held to the storage origin.
    expect(spy.mock.lastCall?.[0]).toBe(buildSearchQuery(q));
    expect(transport.mock.lastCall?.[1]?.body).toBe(
      buildSearchQuery(q, { origin: "https://pod.example/" }),
    );
  }
  expect(engine.loaded).toBe(true);
  const binary = await local.search({ text: "quarterly" });
  expect(binary.results).toEqual([
    expect.objectContaining({
      url: pdf.url,
      title: "Quarterly report.pdf",
      parent: drive,
      contentType: "application/pdf",
      modified: pdf.modified,
    }),
  ]);
  expect(localIndex.has(pdf.url)).toBe(false); // no binary bytes were indexed
  expect((await local.search({ types: [wfTask] })).results).toEqual([
    expect.objectContaining({
      url: task,
      type: wfTask,
      snippet: "Prepare the quarterly figures",
      parent: tasks,
    }),
  ]);
  expect((await local.search({ within: [drive] })).results.map((row) => row.url)).toEqual([
    pdf.url,
    memo.url,
    drive,
  ]);
  expect((await local.recent({ limit: 2 })).results.map((row) => row.url)).toEqual([task, pdf.url]);
  expect((await server.recent({ within: [drive], limit: 1 })).results[0]?.url).toBe(pdf.url);
  expect((await local.search({ text: "report" })).results.map((row) => row.url)).toEqual([
    `${tasks}exact.ttl`,
    task,
    pdf.url,
    `${tasks}note.ttl`,
  ]);
});

test("cursor pages contain each resource once, with deterministic ties and a final page", async () => {
  const target = await index();
  const local = await seed(target);
  const all = await local.search({ orderBy: "modified" });
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await local.search({ orderBy: "modified", limit: 2, cursor });
    seen.push(...page.results.map((row) => row.url));
    cursor = page.next;
  } while (cursor);
  expect(seen).toEqual(all.results.map((row) => row.url));
  expect(new Set(seen).size).toBe(seen.length);
  expect((await local.search({ cursor: btoa("1000") })).results).toEqual([]);
});

test("listing feeds replace removed members, preserve resource graphs, and write typed metadata", async () => {
  const target = await index();
  const feed = createSearchFeeder(target);
  await feed.resource(drive, [quad(nn(drive), nn(`${dct}title`), literal("Drive"))]);
  await feed.container(drive, [
    pdf,
    memo,
    entry(`${drive}broken%FF/`, { kind: "container", types: [wfTask], size: 0 }),
  ]);
  expect(target.list()).toContain(drive);
  expect(target.list()).toContain(`urn:jeswr:search:listing:${encodeURIComponent(drive)}`);
  const local = createLocalSearch(target);
  expect((await local.search({ text: "broken" })).results[0]?.title).toBe("broken%FF");
  expect(
    (
      await target.select(
        `SELECT ?size { GRAPH ?g { <${pdf.url}> <http://www.w3.org/ns/posix/stat#size> ?size } }`,
      )
    )[0]?.get("size")?.value,
  ).toBe("2048");
  expect((await local.search({ types: [wfTask] })).results[0]?.parent).toBe(drive);
  await feed.container(drive, [memo]);
  expect((await local.search({ text: "quarterly" })).results).toEqual([]);
  expect((await local.search({ text: "drive" })).results[0]?.url).toBe(drive);
  await feed.container(drive, []);
  expect((await local.search({ within: [drive] })).results).toHaveLength(1);
});

test("one subject across labels, types and graphs appears once; all supported label vocabularies work", async () => {
  const target = await index();
  const feed = createSearchFeeder(target);
  const url = `${drive}labelled`;
  const predicates = [
    `${dct}title`,
    "http://www.w3.org/2000/01/rdf-schema#label",
    "https://schema.org/name",
    "http://schema.org/name",
    "http://www.w3.org/2005/01/wf/flow#description",
    "http://rdfs.org/sioc/ns#name",
  ];
  for (const [i, predicate] of predicates.entries()) {
    await feed.resource(`${drive}graph${i}`, [quad(nn(url), nn(predicate), literal(`label ${i}`))]);
    expect((await createLocalSearch(target).search({ text: `label ${i}` })).results[0]?.url).toBe(
      url,
    );
  }
  await feed.resource(`${drive}types`, [
    quad(nn(url), nn("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"), nn(wfTask)),
  ]);
  expect((await createLocalSearch(target).search({ types: [wfTask] })).results).toHaveLength(1);
  expect(
    (await createLocalSearch(target).search({ types: [wfTask, "https://example.org/Other"] }))
      .results,
  ).toHaveLength(1);
  expect(
    (await createLocalSearch(target).search({ types: [], within: [], text: "missing" })).results,
  ).toEqual([]);
});

test("text injection remains a literal, including quotes, slash escapes, newlines and Unicode", async () => {
  const target = await index();
  const feed = createSearchFeeder(target);
  const text = 'hello ") } UNION { ?s ?p ?o } #\\\n\r\t\b\f café 😀';
  await feed.resource(`${drive}literal`, [
    quad(nn(`${drive}literal`), nn(`${dct}title`), literal(text)),
  ]);
  await feed.resource(`${drive}other`, [
    quad(nn(`${drive}other`), nn(`${dct}title`), literal("other")),
  ]);
  expect((await createLocalSearch(target).search({ text })).results.map((row) => row.url)).toEqual([
    `${drive}literal`,
  ]);
  expect(buildSearchQuery({ text })).toContain(JSON.stringify(text));
});

test.each([
  "javascript:alert(1)",
  "/relative",
  "urn:example:Task",
  "https://example.org/Type> } UNION { ?s ?p ?o } #",
  'https://example.org/"Type',
  "https://example.org/\\u003e",
  "https://example.org/\nType",
  "https://user:secret@example.org/Type",
  "https://",
  "https://example.org/bad%ZZ",
])("invalid type and prefix IRIs are rejected before I/O: %s", async (input) => {
  const target = await index();
  const local = createLocalSearch(target);
  const fetch = acq(target);
  const server = createSearch({ capabilities: capabilities(), fetch, local });
  for (const search of [local.search, server.search]) {
    await expect(search({ types: [input] })).rejects.toThrow();
    await expect(search({ within: [input] })).rejects.toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  "https://pod.example/drive/?query",
  "https://pod.example/drive/#fragment",
])("container filters refuse query/fragment: %s", (within) => {
  expect(() => buildSearchQuery({ within: [within] })).toThrow("query or fragment");
});

test("within is a container boundary and never includes siblings with the same spelling", async () => {
  const target = await index();
  const feed = createSearchFeeder(target);
  await feed.container(drive, [pdf]);
  await feed.container(`${root}drive-other/`, [entry(`${root}drive-other/report.pdf`)]);
  expect(
    (await createLocalSearch(target).search({ within: [drive.slice(0, -1)] })).results.map(
      (row) => row.url,
    ),
  ).toEqual([pdf.url]);
});

test.each([0, -1, 1.5, 1001, NaN, Infinity])("invalid limit %s is rejected", (limit) => {
  expect(() => buildSearchQuery({ limit })).toThrow(RangeError);
});
test.each([
  "!",
  "",
  btoa("-1"),
  btoa("1.1"),
  btoa("1e2"),
  btoa("01"),
  btoa(" 2"),
  "MQ",
  btoa("9007199254740991"),
  btoa("999999999999999999999"),
])("invalid cursor %s is rejected", (cursor) => {
  expect(() => buildSearchQuery({ cursor })).toThrow();
});
test("zero cursor and limit boundaries are valid", () => {
  expect(buildSearchQuery({ limit: 1000, cursor: btoa("0") })).toContain("LIMIT 1001\nOFFSET 0");
});

test.each([
  "unknown",
  "unavailable",
] as const)("%s search capability chooses local without fetching", async (state) => {
  const target = await index();
  const local = await seed(target);
  const fetch = vi.fn<typeof globalThis.fetch>();
  const search = createSearch({ capabilities: capabilities(state), fetch, local });
  expect((await search.search({ text: "quarterly" })).source).toBe("local");
  expect((await search.recent()).results[0]?.url).toBe(task);
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  "https://evil.example/query",
  "http://pod.example/query",
  "https://pod.example:444/query",
  "https://user:secret@pod.example/query",
  "//pod.example/query",
  "https://pod.example/a%2fb",
])("unsafe search endpoint is refused before authenticated fetch: %s", async (url) => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const local = { search: vi.fn() };
  const search = createSearch({ capabilities: capabilities("available", url), fetch, local });
  await expect(search.search({})).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(local.search).not.toHaveBeenCalled();
});

test("available endpoint must exist and the trusted root must be valid", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  const local = { search: vi.fn() };
  const caps = capabilities();
  caps.features.serverSearch.detail = {};
  await expect(createSearch({ capabilities: caps, fetch, local }).search({})).rejects.toThrow(
    "requires an endpoint",
  );
  expect(() =>
    createSearch({ capabilities: { ...caps, root: "file:///root" }, fetch, local }),
  ).toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

test("redirects, including browser opaque redirects, are refused without forwarding credentials", async () => {
  for (const response of [
    new Response(null, { status: 302, headers: { Location: "https://evil.example/" } }),
    Object.defineProperty(new Response(null, { status: 200 }), "type", { value: "opaqueredirect" }),
  ]) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const local = { search: vi.fn() };
    await expect(
      createSearch({ capabilities: capabilities(), fetch, local }).search({}),
    ).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("manual");
    expect(local.search).not.toHaveBeenCalled();
  }
});

test("HTTP, network, JSON and SELECT envelope errors propagate without local fallback", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 403 }))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(new Response("not JSON"))
    .mockResolvedValueOnce(Response.json({ boolean: true }))
    .mockResolvedValueOnce(Response.json({ results: { bindings: [null] } }));
  const local = { search: vi.fn() };
  const search = createSearch({ capabilities: capabilities(), fetch, local });
  for (const message of ["403", "offline", "JSON", "Invalid SPARQL", "Invalid SPARQL"])
    await expect(search.search({})).rejects.toThrow(message);
  expect(local.search).not.toHaveBeenCalled();
});

test("abort is checked before I/O and after server response processing", async () => {
  const abort = new AbortController();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    abort.abort();
    return Response.json({ results: { bindings: [] } });
  });
  const local = { search: vi.fn() };
  const search = createSearch({ capabilities: capabilities(), fetch, local });
  await expect(search.search({}, { signal: abort.signal })).rejects.toThrow();
  expect(fetch.mock.calls[0]?.[1]?.signal).toBe(abort.signal);
  await expect(search.search({}, { signal: abort.signal })).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
  const localSearch = createLocalSearch(await index());
  await expect(localSearch.search({}, { signal: abort.signal })).rejects.toThrow();
});

test("local cancellation discards a query that completes after abort; query errors propagate", async () => {
  const abort = new AbortController();
  const fake = createFakeRdfEngine({
    query: {
      select: () => {
        abort.abort();
        return [];
      },
    },
  });
  try {
    const local = createLocalSearch(await fake.createIndex());
    await expect(local.search({}, { signal: abort.signal })).rejects.toThrow();
  } finally {
    fake.dispose();
  }
  const broken = createFakeRdfEngine();
  try {
    await expect(createLocalSearch(await broken.createIndex()).search({})).rejects.toThrow(
      "does not support",
    );
  } finally {
    broken.dispose();
  }
});

const uri = (value: string) => ({ type: "uri", value });
const lit = (value: string) => ({ type: "literal", value });
const row = { s: uri(`${drive}file#it`), title: lit("File") };
test("SPARQL JSON parsing handles unbound metadata, invalid dates, legacy literals and root parents", () => {
  for (const modified of [undefined, lit("not a date")]) {
    expect(searchPage("server", [{ ...row, modified }], {}).results[0]).toEqual({
      url: `${drive}file#it`,
      title: "File",
      parent: drive,
    });
  }
  expect(
    searchPage(
      "server",
      [
        {
          ...row,
          s: uri("https://pod.example/"),
          title: { type: "typed-literal", value: "" },
          modified: lit("2026-01-01"),
        },
      ],
      {},
    ).results[0],
  ).toEqual(
    expect.objectContaining({
      parent: "https://pod.example/",
      title: "",
      modified: new Date("2026-01-01"),
    }),
  );
  expect(jsonRows({ results: { bindings: [] } })).toEqual([]);
  for (const bad of [
    undefined,
    null,
    {},
    { results: {} },
    { results: { bindings: [1] } },
    { results: { bindings: [null] } },
  ])
    expect(() => jsonRows(bad)).toThrow();
});
test.each([
  {},
  { ...row, title: undefined },
  { ...row, s: lit(pdf.url) },
  { ...row, title: uri("https://example.org/") },
  { ...row, modified: null },
  { ...row, snippet: { type: "literal", value: 5 } },
  { ...row, contentType: {} },
])("invalid result bindings are refused: %j", (bad) => {
  expect(() => searchPage("server", [bad], {})).toThrow();
});

test("real capability derivation only enables the server path for an ACQ-profiled query service", async () => {
  const { SSD, ACQ } = await import("@jeswr/storage-capabilities/vocab");
  const service = {
    type: [SSD.SparqlQueryService],
    endpoint,
    conformsTo: [ACQ.profile],
    extra: {},
  };
  const description = {
    id: root,
    root,
    protocol: "solid" as const,
    descriptionUrl: `${root}.description`,
    sources: ["solid-description" as const],
    services: [service],
    capabilities: [],
    evidence: [],
    fetchedAt: 0,
    maxAgeMs: 100,
    verificationMethods: [],
    etag: null,
  } satisfies StorageDescription;
  expect(deriveFeatures(description).serverSearch.state).toBe("available");
  expect(
    deriveFeatures({ ...description, services: [{ ...service, conformsTo: [] }] }).serverSearch
      .state,
  ).toBe("unknown");
});

// AUTHORED-BY Claude Opus 5.5
test("non-HTTP subjects are filtered before paging, so search({}) and recent() still succeed", async () => {
  const localIndex = await index();
  const remoteIndex = await index();
  for (const target of [localIndex, remoteIndex]) {
    await seed(target);
    await createSearchFeeder(target).resource(`${tasks}urn.ttl`, [
      quad(nn("urn:uuid:7d4a"), nn(`${dct}title`), literal("report")),
      quad(nn("urn:uuid:7d4a"), nn(`${dct}modified`), literal("2027-01-01T00:00:00Z")),
    ]);
  }
  const local = createLocalSearch(localIndex);
  const server = createSearch({ capabilities: capabilities(), fetch: acq(remoteIndex), local });
  for (const client of [local, server]) {
    const all = await client.search({});
    expect(all.results.map((row) => row.url)).not.toContain("urn:uuid:7d4a");
    const recent = await client.recent({ limit: 1 });
    expect(recent.results.map((row) => row.url)).toEqual([task]);
  }
});

test("server results are held to the storage origin inside the query; a service ignoring it is refused", async () => {
  const localIndex = await index();
  const remoteIndex = await index();
  const local = await seed(localIndex);
  await seed(remoteIndex);
  const foreign = "https://pod.example.evil/doc";
  await createSearchFeeder(remoteIndex).resource(foreign, [
    quad(nn(foreign), nn(`${dct}title`), literal("report")),
    quad(nn(foreign), nn(`${dct}modified`), literal("2027-01-01T00:00:00Z")),
  ]);
  const server = createSearch({ capabilities: capabilities(), fetch: acq(remoteIndex), local });
  // Filtered before LIMIT: the one-row page is still a pod resource, not a shortened page.
  const page = await server.search({ text: "report", orderBy: "modified", limit: 1 });
  expect(page.results.map((row) => row.url)).toEqual([task]);
  expect(page.next).toBeDefined();
  const rogue = vi.fn<typeof fetch>(async () =>
    Response.json({
      results: {
        bindings: [{ s: { type: "uri", value: foreign }, title: { type: "literal", value: "x" } }],
      },
    }),
  );
  await expect(
    createSearch({ capabilities: capabilities(), fetch: rogue, local }).search({}),
  ).rejects.toThrow("outside the storage origin");
});
