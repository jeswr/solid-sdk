// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { afterEach, describe, expect, it, vi } from "vitest";
import { search } from "../src/pod.js";
import { createFetchPodPort } from "../src/pod-port.js";
import { SearchBudget } from "../src/search-budget.js";
import { containerTurtle, makeFakePod, poisonedContainerTurtle } from "./fake-pod.js";

const POD = "https://alice.example/pod/";
const WEBID = `${POD}profile/card#me`;
const INDEX = `${POD}settings/index.ttl`;
const SOLID = "http://www.w3.org/ns/solid/terms#";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe.each([false, true])("search profile redirect policy (fetch PodPort: %s)", (portable) => {
  const source = (fetch: typeof globalThis.fetch, webId: string) => {
    const config = { fetch, podRoot: POD, webId };
    return portable ? createFetchPodPort(config) : config;
  };

  it.each([
    301, 302, 303, 307, 308,
  ])("refuses off-pod profile HTTP %s redirects", async (status) => {
    const webId = "https://identity.example/card#me";
    for (const location of [
      "http://169.254.169.254/latest/meta-data/",
      "https://evil.example/card",
      "https://identity.example/other",
      `${POD}card`,
    ]) {
      const cancel = vi.fn();
      const response = new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), {
        status,
        headers: { location, "content-type": "application/ld+json" },
      });
      if (!response.body) throw new Error("Expected redirect fixture body");
      const read = vi.spyOn(response.body, "getReader");
      const fixture = makeFakePod({
        [POD]: { contentType: "text/turtle", body: containerTurtle(POD, []) },
      });
      const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
        if (String(input) !== webId) return fixture.fetch(input, init);
        // Model fetch's default automatic following without any real network I/O.
        if (init?.redirect !== "manual") return fetch(location, init);
        return response;
      });
      expect(await search(source(fetch, webId), "match")).toEqual([]);
      expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([webId, POD]);
      expect(fetch.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
      expect(read).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
    }
  });

  it.each([301, 302, 303, 307, 308])("guards in-pod profile HTTP %s redirects", async (status) => {
    for (const location of [
      "http://169.254.169.254/latest/meta-data/",
      "https://evil.example/card",
      "https://alice.example/other/card",
    ]) {
      const fixture = makeFakePod({
        [WEBID]: {
          contentType: "text/plain",
          body: "",
          redirectTo: location,
          redirectStatus: status,
        },
        [POD]: { contentType: "text/turtle", body: containerTurtle(POD, []) },
      });
      const fetch = vi.fn(fixture.fetch);
      expect(await search(source(fetch, WEBID), "match")).toEqual([]);
      expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([WEBID, POD]);
      expect(fetch.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
    }
  });

  it.each([
    301, 302, 303, 307, 308,
  ])("follows validated in-pod profile HTTP %s redirects", async (status) => {
    const finalProfile = `${POD}actual/card`;
    const index = `${POD}actual/index.ttl`;
    const note = `${POD}actual/note.ttl`;
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), {
      status,
      headers: { location: "../actual/card", "content-type": "application/ld+json" },
    });
    if (!response.body) throw new Error("Expected redirect fixture body");
    const read = vi.spyOn(response.body, "getReader");
    const fixture = makeFakePod({
      [finalProfile]: {
        contentType: "text/turtle",
        body: `<#me> <${SOLID}publicTypeIndex> <index.ttl>.`,
      },
      [index]: { contentType: "text/turtle", body: `<#r> <${SOLID}instance> <note.ttl>.` },
      [note]: { contentType: "text/turtle", body: '<> <https://schema.org/text> "avocado".' },
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, []) },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input) === WEBID) return response;
      const result = await fixture.fetch(input, init);
      Object.defineProperty(result, "url", { value: String(input) });
      return result;
    });
    expect((await search(source(fetch, WEBID), "avocado")).map((hit) => hit.url)).toEqual([note]);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
      WEBID,
      finalProfile,
      index,
      note,
      POD,
    ]);
    expect(fetch.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
    expect(read).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    1, 2, 3, 4, 5, 6,
  ])("charges profile redirect hops to the shared resource cap %s", async (maxResources) => {
    const first = `${POD}first/card`;
    const last = `${POD}last/card`;
    const note = `${POD}note.ttl`;
    const fixture = makeFakePod({
      [WEBID]: { contentType: "text/plain", body: "", redirectTo: first },
      [first]: { contentType: "text/plain", body: "", redirectTo: last },
      [last]: { contentType: "text/turtle", body: `<#me> <${SOLID}publicTypeIndex> <${INDEX}>.` },
      [INDEX]: { contentType: "text/turtle", body: `<#r> <${SOLID}instance> <${note}>.` },
      [note]: { contentType: "text/turtle", body: '<> <https://schema.org/text> "avocado".' },
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, []) },
    });
    const fetch = vi.fn(fixture.fetch);
    const hits = await search(source(fetch, WEBID), "avocado", { maxResources });
    expect(hits.map((hit) => hit.url)).toEqual(maxResources >= 5 ? [note] : []);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual(
      [WEBID, first, last, INDEX, note, POD].slice(0, maxResources),
    );
  });

  it("cancels a stalled redirected profile at the shared deadline", async () => {
    vi.useFakeTimers();
    const finalProfile = `${POD}actual/card`;
    const cancel = vi.fn();
    let signal: AbortSignal | null | undefined;
    const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input) === WEBID) {
        return new Response(null, { status: 302, headers: { location: finalProfile } });
      }
      signal = init?.signal;
      return new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), {
        headers: { "content-type": "text/turtle" },
      });
    });
    const result = search(source(fetch, WEBID), "avocado", { maxTimeMs: 25 });
    await vi.advanceTimersByTimeAsync(25);
    expect(await result).toEqual([]);
    expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([WEBID, finalProfile]);
    expect(signal?.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("search fetch cancellation", () => {
  it("merges caller cancellation for Request and URL inputs", async () => {
    const caller = new AbortController();
    const request = new Request(POD, { signal: caller.signal });
    const fetch = vi.fn(async () => new Response(null));
    const budget = new SearchBudget(1, 1000);
    const wrapped = budget.wrap(fetch);
    await wrapped(request);
    await wrapped(new URL(POD), { signal: caller.signal });
    const signal = (fetch.mock.calls as unknown as Array<[unknown, RequestInit]>)[0]?.[1].signal;
    caller.abort();
    expect(signal?.aborted).toBe(true);
    budget.stop();
    await expect(wrapped(POD)).rejects.toThrow(/budget exhausted/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("cancels a response when an injected fetch ignores an already aborted caller", async () => {
    const caller = new AbortController();
    caller.abort();
    const cancel = vi.fn();
    const fetch = vi.fn(async () => new Response(new ReadableStream({ cancel })));
    const budget = new SearchBudget(1, 1000);
    await expect(budget.wrap(fetch)(POD, { signal: caller.signal })).rejects.toThrow();
    expect(cancel).toHaveBeenCalledOnce();
    budget.stop();
  });
});

describe("one bounded search across discovery and scanning", () => {
  it.each([
    "profile",
    "index",
    "container",
    "literal",
  ])("preserves opaque JSON literals in the search %s read", async (stage) => {
    const network = vi.fn(() => {
      throw new Error("Unexpected network");
    });
    vi.stubGlobal("fetch", network);
    const note = `${POD}note.ttl`;
    const opaque = {
      "@type": "@json",
      "@value": {
        "@context": "https://evil.example/context",
        nested: [{ "@import": "http://127.0.0.1/context" }],
      },
    };
    const document = (name: string, value: object) => ({
      contentType: "application/ld+json",
      body: JSON.stringify({ ...value, ...(stage === name ? { "urn:data": opaque } : {}) }),
    });
    const fixture = makeFakePod({
      [WEBID]: document("profile", {
        "@id": WEBID,
        [`${SOLID}publicTypeIndex`]: { "@id": INDEX },
      }),
      [INDEX]: document("index", {
        "@id": `${INDEX}#registration`,
        [`${SOLID}instance`]: { "@id": note },
      }),
      [POD]: document("container", {
        "@id": POD,
        ...(stage === "container" || stage === "literal"
          ? { "http://www.w3.org/ns/ldp#contains": { "@id": note } }
          : {}),
      }),
      [note]: document("literal", {
        "@id": note,
        "https://schema.org/text": "avocado",
      }),
    });
    const fetch = vi.fn(fixture.fetch);
    const config = { fetch, podRoot: POD, ...(stage === "container" ? {} : { webId: WEBID }) };
    for (const source of [config, createFetchPodPort(config)]) {
      expect((await search(source, "avocado")).map((hit) => hit.url)).toEqual([note]);
    }
    expect(network).not.toHaveBeenCalled();
  });

  it.each([
    "profile",
    "index",
    "container",
    "literal",
  ])("skips excessive inline context expansion in the search %s read", async (stage) => {
    const note = `${POD}note.ttl`;
    const context = {
      p: `https://example.org/${"long".repeat(4096)}/`,
      ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, "p:x"])),
    };
    const documents = {
      profile: { "@id": WEBID, [`${SOLID}publicTypeIndex`]: { "@id": INDEX } },
      index: { "@id": `${INDEX}#r`, [`${SOLID}instance`]: { "@id": note } },
      container: { "@id": POD, "http://www.w3.org/ns/ldp#contains": { "@id": note } },
      literal: { "@id": note, "https://schema.org/text": "avocado" },
    };
    const resource = (name: keyof typeof documents) => ({
      contentType: "application/ld+json",
      body: JSON.stringify({
        ...(stage === name ? { "@context": context } : {}),
        ...documents[name],
      }),
    });
    const pod = makeFakePod({
      [WEBID]: resource("profile"),
      [INDEX]: resource("index"),
      [POD]:
        stage === "container"
          ? resource("container")
          : { contentType: "text/turtle", body: containerTurtle(POD, []) },
      [note]: resource("literal"),
    });
    const fetch = vi.fn(pod.fetch);
    expect(
      await search(
        { fetch, podRoot: POD, ...(stage === "container" ? {} : { webId: WEBID }) },
        "avocado",
      ),
    ).toEqual([]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(
      stage === "profile"
        ? [WEBID, POD]
        : stage === "index"
          ? [WEBID, INDEX, POD]
          : stage === "container"
            ? [POD]
            : [WEBID, INDEX, note, POD],
    );
  });

  it.each([
    "container",
    "index",
    "literal",
  ])("follows JSON-LD redirects before reading any body during %s search", async (stage) => {
    const note = `${POD}note.ttl`;
    const target = stage === "container" ? POD : stage === "index" ? INDEX : note;
    const finalUrl = `${POD}actual/${stage}`;
    for (const [status, body] of [
      [301, ""],
      [302, "invalid JSON"],
      [303, "x".repeat(1024 * 1024 + 1)],
      [307, '{"@context":"https://evil.example/context"}'],
      [308, null],
    ] as const) {
      const cancel = vi.fn();
      const redirect = new Response(
        body === null ? new ReadableStream({ cancel }, { highWaterMark: 0 }) : body,
        {
          status,
          headers: { location: finalUrl, "content-type": "application/ld+json" },
        },
      );
      if (!redirect.body) throw new Error("Expected redirect fixture body");
      const read = vi.spyOn(redirect.body, "getReader");
      const pod = makeFakePod({
        [WEBID]: {
          contentType: "text/turtle",
          body: `<${WEBID}> <${SOLID}publicTypeIndex> <${INDEX}>.`,
        },
        [INDEX]: { contentType: "text/turtle", body: `<#r> <${SOLID}instance> <${note}>.` },
        [POD]: { contentType: "text/turtle", body: containerTurtle(POD, []) },
        [note]: { contentType: "text/turtle", body: '<> <https://schema.org/text> "avocado".' },
        [finalUrl]: {
          contentType: "application/ld+json",
          body: JSON.stringify(
            stage === "container"
              ? { "@id": POD, "http://www.w3.org/ns/ldp#contains": { "@id": note } }
              : stage === "index"
                ? { "@id": `${finalUrl}#r`, [`${SOLID}instance`]: { "@id": note } }
                : { "@id": note, "https://schema.org/text": "avocado" },
          ),
        },
      });
      const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === target ? redirect : pod.fetch(input, init),
      );
      const hits = await search(
        { fetch, podRoot: POD, ...(stage === "container" ? {} : { webId: WEBID }) },
        "avocado",
        { maxTimeMs: 500 },
      );
      expect(hits.map((hit) => hit.url)).toEqual([note]);
      expect(read).not.toHaveBeenCalled();
      expect(redirect.body?.locked).toBe(false);
      if (body === null) expect(cancel).toHaveBeenCalledOnce();
      expect(fetch.mock.calls.map(([url]) => url)).toEqual(
        stage === "container"
          ? [POD, finalUrl, note]
          : stage === "index"
            ? [WEBID, INDEX, finalUrl, note, POD]
            : // Portable authorization checks the resolved resource separately.
              [WEBID, INDEX, note, finalUrl, finalUrl, POD],
      );
    }
  });

  it("finds memory notes and RDF chat titles through Type Index instances", async () => {
    const note = `${POD}private/memory/note.ttl`;
    const chat = `${POD}private/chats/title.ttl`;
    const pod = makeFakePod({
      [WEBID]: {
        contentType: "text/turtle",
        body: `<${WEBID}> <${SOLID}privateTypeIndex> <${INDEX}> .`,
      },
      [INDEX]: {
        contentType: "text/turtle",
        body: `<#r> <${SOLID}instance> <${note}>, <${chat}> .`,
      },
      [note]: {
        contentType: "text/turtle",
        body: '<> <https://schema.org/text> "I prefer avocados" .',
      },
      [chat]: {
        contentType: "text/turtle",
        body: '<> <https://www.w3.org/ns/activitystreams#name> "Avocado recipes" .',
      },
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, []) },
    });
    const hits = await search({ fetch: pod.fetch, podRoot: POD, webId: WEBID }, "avocado");
    expect(hits.map((hit) => hit.url).sort()).toEqual([chat, note].sort());
  });

  it("negotiates RDF for extensionless direct instances and skips non-RDF instances", async () => {
    const note = `${POD}memory/123`;
    const binary = `${POD}memory/456`;
    const pod = makeFakePod({
      [WEBID]: {
        contentType: "text/turtle",
        body: `<${WEBID}> <${SOLID}privateTypeIndex> <${INDEX}>.`,
      },
      [INDEX]: {
        contentType: "text/turtle",
        body: `<#r> <${SOLID}instance> <${note}>, <${binary}>.`,
      },
      [note]: { contentType: "text/turtle", body: '<> <https://schema.org/text> "avocado".' },
      [binary]: { contentType: "image/png", body: "avocado" },
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, []) },
    });
    const fetch = vi.fn(pod.fetch);
    const hits = await search({ fetch, podRoot: POD, webId: WEBID }, "avocado");
    expect(hits).toEqual([{ url: note, name: "123", snippet: "literal: avocado" }]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([WEBID, INDEX, note, binary, POD]);
    for (const [, init] of fetch.mock.calls) {
      expect(new Headers(init?.headers).get("accept")).toContain("text/turtle");
    }
  });

  it.each([
    "profile",
    "index",
    "container",
    "literal",
  ])("enforces expanded RDF budgets in the search %s read", async (stage) => {
    const note = `${POD}note.ttl`;
    const iri = `https://example.org/${"long".repeat(4096)}`;
    const expansion = `@prefix p: <${iri}> .\n${'<#s> p:name "avocado" .\n'.repeat(100)}`;
    const pod = makeFakePod({
      [WEBID]: {
        contentType: "text/turtle",
        body: `${stage === "profile" ? expansion : ""}<${WEBID}> <${SOLID}publicTypeIndex> <${INDEX}>.`,
      },
      [INDEX]: {
        contentType: "text/turtle",
        body: `${stage === "index" ? expansion : ""}<#r> <${SOLID}instance> <${note}>.`,
      },
      [POD]: {
        contentType: "text/turtle",
        body:
          stage === "container"
            ? expansion + containerTurtle(POD, [{ name: "note.ttl" }])
            : containerTurtle(POD, []),
      },
      [note]: {
        contentType: "text/turtle",
        body: stage === "literal" ? expansion : '<> <https://schema.org/text> "avocado".',
      },
    });
    const fetch = vi.fn(pod.fetch);
    const hits = await search(
      { fetch, podRoot: POD, ...(stage === "container" ? {} : { webId: WEBID }) },
      "avocado",
    );
    expect(hits).toEqual([]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(
      stage === "profile"
        ? [WEBID, POD]
        : stage === "index"
          ? [WEBID, INDEX, POD]
          : stage === "container"
            ? [POD]
            : [WEBID, INDEX, note, POD],
    );
  });

  it("resolves redirected container children against the effective URL", async () => {
    const finalUrl = `${POD}actual/`;
    const child = `${finalUrl}match.ttl`;
    const pod = makeFakePod({
      [POD]: { contentType: "text/plain", body: "", redirectTo: finalUrl },
      [finalUrl]: {
        contentType: "text/turtle",
        body: "<> a <http://www.w3.org/ns/ldp#Container>; <http://www.w3.org/ns/ldp#contains> <match.ttl>.",
      },
      [child]: { contentType: "text/turtle", body: '<> <https://schema.org/name> "match".' },
    });
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await pod.fetch(input, init);
      Object.defineProperty(response, "url", { value: String(input) });
      return response;
    });
    const hits = await search({ fetch, podRoot: POD }, "match");
    expect(hits.map((hit) => hit.url)).toEqual([child]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([POD, finalUrl, child]);
  });

  it("preserves the final profile URL for relative Type Index discovery", async () => {
    const finalProfile = `${POD}actual/card`;
    const index = `${POD}actual/index.ttl`;
    const note = `${POD}actual/note.ttl`;
    const pod = makeFakePod({
      [WEBID]: {
        contentType: "text/turtle",
        body: `<#me> <${SOLID}publicTypeIndex> <index.ttl>.`,
      },
      [index]: { contentType: "text/turtle", body: `<#r> <${SOLID}instance> <note.ttl>.` },
      [note]: { contentType: "text/turtle", body: '<> <https://schema.org/name> "avocado".' },
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, []) },
    });
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await pod.fetch(input, init);
      Object.defineProperty(response, "url", {
        value: String(input) === WEBID ? finalProfile : String(input),
      });
      return response;
    });
    const hits = await search({ fetch, podRoot: POD, webId: WEBID }, "avocado");
    expect(hits.map((hit) => hit.url)).toEqual([note]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([WEBID, index, note, POD]);
  });

  it.each([
    '"@context":"https://evil.example/context"',
    '"@context":{"@import":"https://evil.example/context"}',
  ])("normalizes duplicate JSON-LD contexts in discovery: %s", async (discarded) => {
    const network = vi.fn(() => {
      throw new Error("Unexpected network");
    });
    vi.stubGlobal("fetch", network);
    const note = `${POD}note.ttl`;
    const pod = makeFakePod({
      [WEBID]: {
        contentType: "application/ld+json",
        body: `{${discarded},"@context":{"index":{"@id":"${SOLID}publicTypeIndex","@type":"@id"}},"@id":"${WEBID}","index":"${INDEX}"}`,
      },
      [INDEX]: { contentType: "text/turtle", body: `<#r> <${SOLID}instance> <${note}>.` },
      [note]: { contentType: "text/turtle", body: '<> <https://schema.org/name> "avocado".' },
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, []) },
    });
    const hits = await search({ fetch: pod.fetch, podRoot: POD, webId: WEBID }, "avocado");
    expect(hits.map((hit) => hit.url)).toEqual([note]);
    expect(network).not.toHaveBeenCalled();
  });

  it("caps direct index instances together with discovery", async () => {
    const urls = Array.from({ length: 20 }, (_, index) => `${POD}match-${index}.ttl`);
    const pod = makeFakePod({
      [WEBID]: {
        contentType: "text/turtle",
        body: `<${WEBID}> <${SOLID}publicTypeIndex> <${INDEX}> .`,
      },
      [INDEX]: {
        contentType: "text/turtle",
        body: `<#r> <${SOLID}instance> ${urls.map((url) => `<${url}>`).join(",")} .`,
      },
      ...Object.fromEntries(urls.map((url) => [url, { contentType: "text/turtle", body: "" }])),
    });
    const fetch = vi.fn(pod.fetch);
    const hits = await search({ fetch, podRoot: POD, webId: WEBID }, "match", { maxResources: 4 });
    expect(hits).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([WEBID, INDEX, urls[0], urls[1]]);
  });

  it("caps index document discovery and hinted container requests", async () => {
    const indexes = Array.from({ length: 20 }, (_, i) => `${POD}index-${i}.ttl`);
    const pod = makeFakePod({
      [WEBID]: {
        contentType: "text/turtle",
        body: `<${WEBID}> <${SOLID}publicTypeIndex> ${indexes.map((url) => `<${url}>`).join(",")} .`,
      },
    });
    const fetch = vi.fn(pod.fetch);
    await search({ fetch, podRoot: POD, webId: WEBID }, "x", { maxResources: 3 });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("counts the root and each child once and respects depth zero", async () => {
    const pod = makeFakePod({
      [POD]: {
        contentType: "text/turtle",
        body: containerTurtle(POD, [
          { name: "sub/", container: true },
          { name: "match.ttl" },
          { name: "match-too.ttl" },
        ]),
      },
      [`${POD}sub/`]: {
        contentType: "text/turtle",
        body: containerTurtle(`${POD}sub/`, [{ name: "deep-match.ttl" }]),
      },
      [`${POD}match.ttl`]: { contentType: "text/turtle", body: "" },
    });
    const fetch = vi.fn(pod.fetch);
    const hits = await search({ fetch, podRoot: POD }, "match", { maxResources: 3, maxDepth: 0 });
    expect(hits.map((hit) => hit.url)).toEqual([`${POD}match.ttl`]);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([POD, `${POD}match.ttl`]);
  });

  it("never follows poisoned listing or index URLs", async () => {
    const evil = "http://169.254.169.254/latest/meta-data/";
    const pod = makeFakePod({
      [POD]: {
        contentType: "text/turtle",
        body: poisonedContainerTurtle(POD, [evil, `${POD}match.ttl`]),
      },
      [WEBID]: {
        contentType: "text/turtle",
        body: `<${WEBID}> <${SOLID}publicTypeIndex> <${INDEX}>, <${evil}> .`,
      },
      [INDEX]: { contentType: "text/turtle", body: `<#r> <${SOLID}instanceContainer> <${evil}> .` },
      [`${POD}match.ttl`]: { contentType: "text/turtle", body: "" },
    });
    const fetch = vi.fn(pod.fetch);
    const hits = await search({ fetch, podRoot: POD, webId: WEBID }, "match");
    expect(hits.map((hit) => hit.url)).toEqual([`${POD}match.ttl`]);
    expect(fetch.mock.calls.every(([url]) => String(url).startsWith(POD))).toBe(true);
  });

  it("bounds redirect hops in the same resource budget", async () => {
    const pod = makeFakePod({
      [POD]: { contentType: "text/plain", body: "", redirectTo: `${POD}next/` },
    });
    const fetch = vi.fn(pod.fetch);
    expect(await search({ fetch, podRoot: POD }, "match", { maxResources: 1 })).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "discovery",
    "container",
    "literal",
    "body",
  ])("stops a stalled %s read at the deadline", async (stage) => {
    vi.useFakeTimers();
    const fixture = makeFakePod({
      [POD]: {
        contentType: "text/turtle",
        body: containerTurtle(POD, [{ name: "match.ttl" }, { name: "pending-match.ttl" }]),
      },
      [`${POD}match.ttl`]: { contentType: "text/turtle", body: "" },
    });
    let signal: AbortSignal | null | undefined;
    let resolveLate: (value: Response) => void = () => {};
    const cancel = vi.fn();
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (stage === "literal" && [POD, `${POD}match.ttl`].includes(url))
        return fixture.fetch(input, init);
      signal = init?.signal;
      if (stage === "body")
        return new Response(new ReadableStream({ cancel }), {
          headers: { "content-type": "text/turtle" },
        });
      return new Promise<Response>((resolve) => {
        resolveLate = resolve;
      });
    });
    const result = search(
      { fetch, podRoot: POD, ...(stage === "discovery" ? { webId: WEBID } : {}) },
      "match",
      { maxTimeMs: 25 },
    );
    await vi.advanceTimersByTimeAsync(25);
    const hits = await result;
    expect(hits.map((hit) => hit.url)).toEqual(stage === "literal" ? [`${POD}match.ttl`] : []);
    expect(hits.map((hit) => hit.url)).not.toContain(`${POD}pending-match.ttl`);
    expect(signal?.aborted).toBe(true);
    if (stage === "body") expect(cancel).toHaveBeenCalledOnce();
    const calls = fetch.mock.calls.length;
    resolveLate(new Response(containerTurtle(POD, [{ name: "late-match.ttl" }])));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(calls);
    expect(hits.map((hit) => hit.url)).not.toContain(`${POD}late-match.ttl`);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { maxResources: 0 },
    { maxTimeMs: 0 },
  ])("does no I/O with zero budget %j", async (options) => {
    const fetch = vi.fn(makeFakePod({}).fetch);
    expect(await search({ fetch, podRoot: POD, webId: WEBID }, "x", options)).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -1, 0.5, 2_147_483_648])("rejects invalid budget %s", async (limit) => {
    for (const key of ["maxDepth", "maxResources", "maxTimeMs"]) {
      await expect(
        search({ fetch: makeFakePod({}).fetch, podRoot: POD }, "x", { [key]: limit }),
      ).rejects.toThrow(/non-negative integer/);
    }
  });

  it("uses configured server caps and cleans up timers after success", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      makeFakePod({
        [POD]: { contentType: "text/turtle", body: containerTurtle(POD, [{ name: "match.ttl" }]) },
      }).fetch,
    );
    expect(
      await search({ fetch, podRoot: POD, searchLimits: { maxResources: 1 } }, "match"),
    ).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("skips oversized scan responses", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("#".repeat(1024 * 1024 + 1), { headers: { "content-type": "text/turtle" } }),
    );
    expect(await search({ fetch, podRoot: POD }, "x")).toEqual([]);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("refuses remote contexts in discovery without any parser network requests", async () => {
    const network = vi.fn(() => {
      throw new Error("Unexpected network");
    });
    vi.stubGlobal("fetch", network);
    const pod = makeFakePod({
      [WEBID]: {
        contentType: "application/ld+json",
        body: '{"@context":"http://127.0.0.1/context"}',
      },
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, [{ name: "match.txt" }]) },
      [`${POD}match.txt`]: { contentType: "text/plain", body: "readable match" },
    });
    expect(
      (await search({ fetch: pod.fetch, podRoot: POD, webId: WEBID }, "match")).map(
        (hit) => hit.url,
      ),
    ).toEqual([`${POD}match.txt`]);
    expect(network).not.toHaveBeenCalled();
  });
});
