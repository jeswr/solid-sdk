// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { beforeEach, expect, it, vi } from "vitest";
import { createMemoryPod, TEST_POD_ROOT, TEST_PROFILE_DOC, TEST_WEBID } from "../core/testing.js";
import { ProfileTypeIndexAnchor } from "./type-index.js";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./rdf-read.js", () => ({ freshRdf: read }));

import { ensureTypeRegistrations } from "./type-index-write.js";

const ROOT = TEST_POD_ROOT;
const PROFILE = TEST_PROFILE_DOC;
const WEBID = TEST_WEBID;
const INDEX = `${ROOT}settings/privateTypeIndex.ttl`;

beforeEach(() => {
  read.mockReset();
});

it.each([
  ["profile", "https://foreign.example/steal"],
  ["profile", `${ROOT}unrelated.ttl`],
  ["index", "https://foreign.example/steal"],
  ["index", `${ROOT}unrelated.ttl`],
])("refuses a shadowed Request at the %s document boundary: %s", async (stage, target) => {
  const profile = createMemoryPod().dataset(PROFILE);
  const anchor = new ProfileTypeIndexAnchor(WEBID, profile, DataFactory);
  anchor.privateIndex = INDEX;
  const transport = vi.fn(async () => new Response());
  read.mockImplementation(async (url: string, fetch: typeof globalThis.fetch) => {
    if (url === PROFILE && stage === "index") {
      return { dataset: profile };
    }
    const request = new Request(target);
    Object.defineProperty(request, "url", { value: url });
    await fetch(request);
    throw new Error("unexpected transport access");
  });
  await expect(
    ensureTypeRegistrations({
      webId: WEBID,
      podRoot: ROOT,
      profileDocumentUrl: PROFILE,
      registrations: [],
      fetchImpl: transport,
    }),
  ).rejects.toThrow(/outside|escapes/);
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  ["profile", "own"],
  ["index", "own"],
  ["profile", "inherited"],
  ["index", "inherited"],
  ["profile", "hidden"],
  ["index", "hidden"],
])("forwards %s Request init through %s fetch wrappers", async (stage, kind) => {
  const profile = createMemoryPod().dataset(PROFILE);
  new ProfileTypeIndexAnchor(WEBID, profile, DataFactory).privateIndex = INDEX;
  const target = stage === "profile" ? PROFILE : INDEX;
  const headers = new Headers({ "x-explicit": "keep" });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("replacement payload"));
      controller.close();
    },
  });
  const init = {
    method: "PUT",
    headers,
    body,
    duplex: "half",
    signal: new AbortController().signal,
    cache: "no-store",
  } as RequestInit;
  const sent: { url: string; method: string; headers: Headers; body: string }[] = [];
  const transport = vi.fn<typeof fetch>(async (input, options) => {
    const request = new Request(input, options);
    sent.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: await request.text(),
    });
    return new Response(null, { status: 204 });
  });
  const original = new Request(target, {
    method: "POST",
    headers: { "x-original": "discard" },
    body: "original payload",
  });
  read.mockImplementation(async (url: string, fetch: typeof globalThis.fetch) => {
    if (url === target) {
      const options =
        kind === "inherited"
          ? Object.create(init)
          : kind === "hidden"
            ? Object.defineProperties(
                {},
                Object.fromEntries(Object.entries(init).map(([key, value]) => [key, { value }])),
              )
            : init;
      await fetch(original, options);
    }
    return { dataset: url === PROFILE ? profile : new Store() };
  });

  await expect(
    ensureTypeRegistrations({
      webId: WEBID,
      podRoot: ROOT,
      profileDocumentUrl: PROFILE,
      registrations: [],
      fetchImpl: transport,
    }),
  ).resolves.toMatchObject({ indexUrl: INDEX, added: 0, bootstrapped: false });

  expect(transport).toHaveBeenCalledOnce();
  expect(transport.mock.calls[0]?.[1]).toMatchObject({ ...init, redirect: "manual" });
  expect(transport.mock.calls[0]?.[1]?.body).toBe(body);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ url: target, method: "PUT", body: "replacement payload" });
  expect(sent[0]?.headers.get("x-explicit")).toBe("keep");
  expect(sent[0]?.headers.has("x-original")).toBe(false);
  expect(await original.text()).toBe("original payload");
});

for (const stage of ["profile", "index"]) {
  it.each([
    "inherited",
    "hidden",
  ])(`${stage}: preserves an aborted %s signal before I/O`, async (kind) => {
    const profile = createMemoryPod().dataset(PROFILE);
    new ProfileTypeIndexAnchor(WEBID, profile, DataFactory).privateIndex = INDEX;
    const target = stage === "profile" ? PROFILE : INDEX;
    const reason = new Error("cancelled");
    const signal = AbortSignal.abort(reason);
    const send = vi.fn();
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      init?.signal?.throwIfAborted();
      send(new Request(input, init));
      return new Response();
    });
    read.mockImplementation(async (url: string, fetch: typeof globalThis.fetch) => {
      if (url === target) {
        const init =
          kind === "inherited"
            ? Object.create({ signal })
            : Object.defineProperty({}, "signal", { value: signal });
        await fetch(new Request(target), init);
      }
      return { dataset: profile };
    });
    await expect(
      ensureTypeRegistrations({
        webId: WEBID,
        podRoot: ROOT,
        registrations: [],
        fetchImpl: transport,
      }),
    ).rejects.toBe(reason);
    expect(transport).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it(`${stage}: uploads a stream from a single body accessor read through all wrappers`, async () => {
    const profile = createMemoryPod().dataset(PROFILE);
    new ProfileTypeIndexAnchor(WEBID, profile, DataFactory).privateIndex = INDEX;
    const target = stage === "profile" ? PROFILE : INDEX;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("replacement"));
        controller.close();
      },
    });
    const body = vi.fn().mockReturnValueOnce(stream).mockReturnValue(undefined);
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      expect(await new Request(input, init).text()).toBe("replacement");
      return new Response();
    });
    read.mockImplementation(async (url: string, fetch: typeof globalThis.fetch) => {
      if (url === target)
        await fetch(new Request(target, { method: "POST", body: "original" }), {
          method: "PUT",
          duplex: "half",
          get body() {
            return body();
          },
        } as RequestInit);
      return { dataset: url === PROFILE ? profile : new Store() };
    });
    await ensureTypeRegistrations({
      webId: WEBID,
      podRoot: ROOT,
      registrations: [],
      fetchImpl: transport,
    });
    expect(body).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledOnce();
  });
}
