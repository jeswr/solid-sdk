// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, describe, expect, it, vi } from "vitest";
import { search } from "../src/pod.js";
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
      [POD]: { contentType: "text/turtle", body: containerTurtle(POD, [{ name: "match.ttl" }]) },
    });
    let signal: AbortSignal | null | undefined;
    let resolveLate: (value: Response) => void = () => {};
    const cancel = vi.fn();
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (stage === "literal" && url === POD) return fixture.fetch(input, init);
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
    });
    expect(
      (await search({ fetch: pod.fetch, podRoot: POD, webId: WEBID }, "match")).map(
        (hit) => hit.url,
      ),
    ).toEqual([`${POD}match.txt`]);
    expect(network).not.toHaveBeenCalled();
  });
});
