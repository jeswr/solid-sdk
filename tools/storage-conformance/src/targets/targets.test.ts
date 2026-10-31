// AUTHORED-BY Codex GPT-6.1-Sol
import { Buffer } from "node:buffer";
import type { SolidPod } from "@sparq-org/solid-server";
import { expect, test, vi } from "vitest";
import { moveProbe } from "../cases.js";
import { selectTargets } from "./index.js";
import { memoryTarget } from "./memory.js";
import { podFetch } from "./sparq-solid.js";

test("selection expands both memory protocols, deduplicates and refuses typos", () => {
  expect(selectTargets().map((target) => target.name)).toEqual([
    "memory-solid",
    "memory-lws",
    "sparq-solid",
  ]);
  expect(selectTargets("memory,memory-lws,memory-solid,sparq-solid")).toHaveLength(3);
  expect(() => selectTargets("css")).toThrow("Unknown conformance target");
  expect(() => selectTargets("")).toThrow();
});

test("memory has no accidental network fallback and refuses second-identity impersonation", async () => {
  const running = await memoryTarget("solid").start();
  await expect(running.fetch(running.root)).rejects.toThrow("no HTTP transport");
  expect(await running.authFetchFor(running.webId)).toBe(running.fetch);
  await expect(running.authFetchFor("https://identity.example/bob#me")).rejects.toMatchObject({
    code: "unsupported",
  });
  await running.stop();
});

test("move absence probe propagates faults, never treating a network error as unsupported", async () => {
  const running = await memoryTarget("lws").start();
  running.storage.move = vi.fn(async () => {
    throw new Error("network unavailable");
  });
  await expect(moveProbe(running)).rejects.toThrow("network unavailable");
});

test.each([
  204, 405, 412,
])("network move absence probes actual linkset PATCH (%i)", async (status) => {
  const running = await memoryTarget("lws").start();
  running.resolveFeatures = undefined;
  const sdkMove = vi.spyOn(running.storage, "move");
  const transport = vi.fn<typeof fetch>(async () => new Response(null, { status }));
  running.fetch = transport;
  if (status === 412)
    await expect(moveProbe(running)).rejects.toThrow("Unexpected move probe response");
  else expect(await moveProbe(running)).toBe(status === 204);
  expect(sdkMove).not.toHaveBeenCalled();
  expect(transport).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({
      method: "PATCH",
      redirect: "manual",
      headers: expect.objectContaining({ "If-Match": expect.any(String) }),
    }),
  );
  const request = transport.mock.calls[0]?.[1];
  expect(JSON.parse(request?.body as string)[1]).toMatchObject({
    op: "replace",
    path: "/linkset/0/up/0/href",
  });
});

test("a network fault during a raw move probe is not evidence of absence", async () => {
  const running = await memoryTarget("lws").start();
  running.resolveFeatures = undefined;
  running.fetch = async () => {
    throw new Error("transport offline");
  };
  await expect(moveProbe(running)).rejects.toThrow("transport offline");
});

test("dispatcher fetch copies byte bodies, combines repeated headers, preserves response URLs", async () => {
  const dispatch = vi.fn(async () => ({
    status: 200,
    headers: ["Link", '<urn:a>; rel="type"', "Link", '<urn:b>; rel="type"'],
    body: Buffer.from([0, 255, 128]),
  }));
  const pod: SolidPod = {
    baseUrl: "http://pod.example",
    ownerWebid: "https://id.example/#me",
    dispatch,
    free: vi.fn(),
  };
  const transport = podFetch(pod);
  const response = await transport("http://pod.example/resource?cursor=opaque%2F", {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: Uint8Array.from([1, 0, 255]),
  });
  expect(dispatch).toHaveBeenCalledWith({
    method: "PUT",
    url: "/resource?cursor=opaque%2F",
    rawHeaders: ["content-type", "application/octet-stream"],
    body: Uint8Array.from([1, 0, 255]),
  });
  expect(response.url).toBe("http://pod.example/resource?cursor=opaque%2F");
  expect(response.headers.get("link")).toContain("urn:b");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(Uint8Array.from([0, 255, 128]));
  await expect(transport("http://foreign.example/")).rejects.toThrow("Foreign pod request");
  expect(dispatch).toHaveBeenCalledTimes(1);
  dispatch.mockResolvedValue({ status: 204, headers: [], body: Buffer.from([]) });
  expect((await transport("http://pod.example/")).body).toBeNull();
  dispatch.mockResolvedValue({ status: 200, headers: [], body: Buffer.from("ignored") });
  expect((await transport("http://pod.example/", { method: "HEAD" })).body).toBeNull();
});

test("dispatcher fetch honors aborts before and after dispatch", async () => {
  const controller = new AbortController();
  const dispatch = vi.fn(async () => {
    controller.abort();
    return { status: 200, headers: [], body: Buffer.from([]) };
  });
  const transport = podFetch({
    baseUrl: "http://pod.example",
    ownerWebid: "https://id.example/#me",
    dispatch,
    free: vi.fn(),
  });
  await expect(transport("http://pod.example/", { signal: controller.signal })).rejects.toThrow();
  expect(dispatch).toHaveBeenCalledOnce();
  await expect(transport("http://pod.example/", { signal: controller.signal })).rejects.toThrow();
  expect(dispatch).toHaveBeenCalledOnce();
});
