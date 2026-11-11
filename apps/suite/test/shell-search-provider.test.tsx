// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { createRdfEngine, DataFactory, type LocalIndex, type RdfEngine } from "@jeswr/rdf-engine";
import { createFakeRdfEngine } from "@jeswr/rdf-engine/testing";
import { createPodClient, type PodClient, type StorageClient } from "@jeswr/storage-client";
import type { Bindings, Term, Variable } from "@rdfjs/types";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SearchResponse, SearchSource } from "../src/shell/lib/search-results";
import { ShellSearchProvider, useShellSearchSource } from "../src/shell/search/search-context";
import type { AccountsContextValue } from "../src/shell/session/accounts-provider";
import type { SuiteAccount } from "../src/shell/session/types";
import { act, h } from "./drive-ui-dom";

const requireUi = createRequire(
  new URL("../../../packages/suite-ui/package.json", import.meta.url),
);
const { cleanup, fireEvent, render, screen, waitFor } = requireUi(
  "@testing-library/react",
) as typeof import("../../../packages/suite-ui/node_modules/@testing-library/react");
const accounts = vi.hoisted(() => ({ current: {} as AccountsContextValue }));
vi.mock("../src/shell/session/accounts-provider", () => ({ useAccounts: () => accounts.current }));
vi.mock("@jeswr/storage-client", async (original) => ({
  ...(await original<typeof import("@jeswr/storage-client")>()),
  createPodClient: vi.fn(),
}));
vi.mock("@jeswr/rdf-engine", async (original) => ({
  ...(await original<typeof import("@jeswr/rdf-engine")>()),
  createRdfEngine: vi.fn(),
}));

const alice: SuiteAccount = {
  id: "alice",
  webId: "https://pod.example/alice/profile#me",
  storageUrl: "https://pod.example/alice/",
  name: "Alice",
  kind: "solid",
};
const bob: SuiteAccount = {
  ...alice,
  id: "bob",
  webId: "https://pod.example/bob/profile#me",
  storageUrl: "https://pod.example/bob/",
  name: "Bob",
};
let engines: RdfEngine[];
let indexes: LocalIndex[];
let localRows: Bindings[];
let source: SearchSource;
const signal = () => new AbortController().signal;
function bindings(url: string, title: string): Bindings {
  return new Map<Variable, Term>([
    [DataFactory.variable("s"), DataFactory.namedNode(url)],
    [DataFactory.variable("title"), DataFactory.literal(title)],
  ]) as unknown as Bindings;
}
function storage(account = alice, server = false): StorageClient {
  return {
    root: account.storageUrl,
    features: {
      serverSearch: {
        state: server ? "available" : "unknown",
        detail: server ? { endpoint: "https://pod.example/query" } : {},
        evidence: "test",
      },
    },
    list: vi.fn().mockResolvedValue({ items: [], next: null }),
    isWithinStorage: (url: string) => url.startsWith(account.storageUrl),
  } as unknown as StorageClient;
}
function discover(value: StorageClient) {
  vi.mocked(createPodClient).mockResolvedValue({ storage: value } as PodClient);
}
function Consumer() {
  const current = useShellSearchSource();
  source = current;
  const [response, setResponse] = useState<SearchResponse>();
  // Like GlobalSearch and the /search page, a new source clears displayed results.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the source identity is the trigger
  useEffect(() => setResponse(undefined), [current]);
  return h(
    "main",
    null,
    h(
      "button",
      { onClick: () => void source.search("plan", { signal: signal() }).then(setResponse) },
      "Search",
    ),
    h("p", null, response?.results.map((row) => row.title).join(", ")),
  );
}
function tree() {
  return h(ShellSearchProvider, { children: h(Consumer) });
}

beforeEach(() => {
  engines = [];
  indexes = [];
  localRows = [];
  accounts.current = {
    active: alice,
    status: "ready",
    fetch: vi.fn(),
  } as unknown as AccountsContextValue;
  discover(storage());
  vi.mocked(createRdfEngine).mockImplementation(() => {
    const engine = createFakeRdfEngine({ query: { select: () => localRows } });
    const create = engine.createIndex.bind(engine);
    vi.spyOn(engine, "createIndex").mockImplementation(async (options) => {
      const index = await create(options);
      vi.spyOn(index, "dispose");
      indexes.push(index);
      return index;
    });
    vi.spyOn(engine, "dispose");
    engines.push(engine);
    return engine;
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("uses the advertised server and account fetch, reusing one discovery cache", async () => {
  discover(storage(alice, true));
  vi.mocked(accounts.current.fetch).mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          results: {
            bindings: [
              {
                s: { type: "uri", value: `${alice.storageUrl}plan.ttl` },
                title: { type: "literal", value: "Server plan" },
              },
            ],
          },
        }),
      ),
  );
  render(tree());
  const response = await source.search("plan", { signal: signal() });
  expect(response).toMatchObject({
    source: "server",
    serverSearch: true,
    results: [{ title: "Server plan" }],
  });
  expect(accounts.current.fetch).toHaveBeenCalledWith(
    "https://pod.example/query",
    expect.objectContaining({
      method: "POST",
      redirect: "manual",
      signal: expect.any(AbortSignal),
    }),
  );
  const options = vi.mocked(createPodClient).mock.calls[0]?.[0];
  expect(options?.capabilities).toBeDefined();
  await options?.fetch(alice.storageUrl, { method: "HEAD" });
  expect(accounts.current.fetch).toHaveBeenCalledTimes(2);
  await source.search("again", { signal: signal() });
  expect(createPodClient).toHaveBeenCalledTimes(1);
});

it("uses an account-owned LocalIndex when serverSearch is unknown", async () => {
  localRows = [bindings(`${alice.storageUrl}plan.ttl`, "Local plan")];
  render(tree());
  expect(await source.search("plan", { signal: signal() })).toMatchObject({
    source: "local",
    serverSearch: false,
    results: [{ title: "Local plan" }],
  });
  expect(indexes).toHaveLength(1);
  expect(accounts.current.fetch).not.toHaveBeenCalled();
});

it("treats explicitly unavailable server search as local and respects cancellation", async () => {
  const pod = storage();
  pod.features.serverSearch.state = "unavailable";
  discover(pod);
  render(tree());
  expect((await source.search("plan", { signal: signal() })).source).toBe("local");
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(source.search("plan", { signal: cancelled.signal })).rejects.toThrow();
});

it("falls back to local when capability discovery fails", async () => {
  vi.mocked(createPodClient).mockRejectedValue(new Error("Discovery unavailable"));
  localRows = [bindings(`${alice.storageUrl}plan.ttl`, "Saved plan")];
  render(tree());
  expect(await source.search("plan", { signal: signal() })).toMatchObject({
    source: "local",
    serverSearch: false,
    results: [{ title: "Saved plan" }],
  });
});

it("disposes on account switch and sign-out, resets visible results, and fences old sources/fetch", async () => {
  localRows = [bindings(`${alice.storageUrl}plan.ttl`, "Alice private plan")];
  const view = render(tree());
  fireEvent.click(screen.getByText("Search"));
  await waitFor(() => expect(screen.getByText("Alice private plan")).toBeTruthy());
  const previous = source;
  const oldFetch = vi.mocked(createPodClient).mock.calls[0]?.[0].fetch;
  const oldSignal = vi.mocked(createPodClient).mock.calls[0]?.[0].signal;
  const firstIndex = indexes[0];
  localRows = [bindings(`${bob.storageUrl}plan.ttl`, "Bob plan")];
  accounts.current = { ...accounts.current, active: bob };
  discover(storage(bob));
  view.rerender(tree());
  expect(screen.queryByText("Alice private plan")).toBeNull();
  expect(firstIndex?.dispose).toHaveBeenCalled();
  expect(oldSignal?.aborted).toBe(true);
  await expect(previous.search("plan", { signal: signal() })).rejects.toThrow();
  await expect(oldFetch?.(alice.storageUrl)).rejects.toThrow();
  expect(
    (await source.search("plan", { signal: signal() })).results.map((row) => row.title),
  ).toEqual(["Bob plan"]);
  expect(vi.mocked(createPodClient).mock.calls[1]?.[0].capabilities).not.toBe(
    vi.mocked(createPodClient).mock.calls[0]?.[0].capabilities,
  );
  accounts.current = { ...accounts.current, active: null, status: "signed-out" };
  view.rerender(tree());
  expect(indexes[1]?.dispose).toHaveBeenCalled();
  expect(await source.search("plan", { signal: signal() })).toEqual({
    results: [],
    source: "local",
    serverSearch: false,
  });
});

it("ignores a server response delivered after switching accounts even when fetch ignores abort", async () => {
  discover(storage(alice, true));
  let deliver!: (response: Response) => void;
  vi.mocked(accounts.current.fetch).mockImplementation(
    () =>
      new Promise((resolve) => {
        deliver = resolve;
      }),
  );
  const view = render(tree());
  const pending = source.search("private", { signal: signal() });
  const rejected = expect(pending).rejects.toThrow();
  await waitFor(() => expect(deliver).toBeTypeOf("function"));
  accounts.current = { ...accounts.current, active: bob };
  discover(storage(bob));
  view.rerender(tree());
  deliver(new Response(JSON.stringify({ results: { bindings: [] } })));
  await rejected;
});

it("keeps server permission failures visible", async () => {
  discover(storage(alice, true));
  vi.mocked(accounts.current.fetch).mockResolvedValue(new Response(null, { status: 403 }));
  render(tree());
  await expect(source.search("plan", { signal: signal() })).rejects.toThrow("403");
});

it("rejects a local query completed after sign-out and never starts search for an expired session", async () => {
  const view = render(tree());
  await source.search("initial", { signal: signal() });
  const index = indexes[0];
  if (!index) throw new Error("Expected an account index");
  let deliver!: (rows: Bindings[]) => void;
  vi.spyOn(index, "select").mockImplementation(
    () =>
      new Promise((resolve) => {
        deliver = resolve;
      }),
  );
  const pending = source.search("private", { signal: signal() });
  const rejected = expect(pending).rejects.toThrow();
  await waitFor(() => expect(deliver).toBeTypeOf("function"));
  accounts.current = { ...accounts.current, active: null, status: "signed-out" };
  view.rerender(tree());
  deliver([bindings(`${alice.storageUrl}private.ttl`, "Retired private result")]);
  await rejected;
  expect(screen.queryByText("Retired private result")).toBeNull();
  const discoveryCount = vi.mocked(createPodClient).mock.calls.length;
  accounts.current = { ...accounts.current, active: alice, status: "expired" };
  view.rerender(tree());
  expect((await source.search("plan", { signal: signal() })).results).toEqual([]);
  expect(createPodClient).toHaveBeenCalledTimes(discoveryCount);
});

it("disposes an index that completes initialization after sign-out", async () => {
  let deliver!: (index: LocalIndex) => void;
  const index = { dispose: vi.fn() } as unknown as LocalIndex;
  vi.mocked(createRdfEngine).mockReturnValue({
    createIndex: () =>
      new Promise((resolve) => {
        deliver = resolve;
      }),
    dispose: vi.fn(),
  } as unknown as RdfEngine);
  const view = render(tree());
  const pending = source.search("plan", { signal: signal() });
  const rejected = expect(pending).rejects.toThrow();
  await waitFor(() => expect(deliver).toBeTypeOf("function"));
  accounts.current = { ...accounts.current, active: null, status: "signed-out" };
  view.rerender(tree());
  deliver(index);
  await rejected;
  expect(index.dispose).toHaveBeenCalledOnce();
});

it("preserves demo seed search without capability discovery, pod fetch or WASM", async () => {
  accounts.current = { ...accounts.current, active: { ...alice, kind: "demo" } };
  render(tree());
  await waitFor(async () =>
    expect((await source.search("budget", { signal: signal() })).results.length).toBeGreaterThan(0),
  );
  const result = await source.search("budget", { signal: signal() });
  expect(result.source).toBe("local");
  expect(result.serverSearch).toBe(false);
  expect(createPodClient).not.toHaveBeenCalled();
  expect(createRdfEngine).not.toHaveBeenCalled();
  expect(accounts.current.fetch).not.toHaveBeenCalled();
  await act(async () => {});
});
