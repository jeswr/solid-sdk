// AUTHORED-BY Codex GPT-6.1-Sol
import { createPodClient } from "@jeswr/storage-client";
import { describe, expect, it, vi } from "vitest";
import solidDriver from "../src/index.js";

vi.unmock("@jeswr/storage-client");

let fixtureId = 0;
const LWS = "https://www.w3.org/ns/lws#";

async function fixture(injected: boolean, rename?: "resource" | "container") {
  const base = `https://unstorage-lws-create-${++fixtureId}.example/kv/`;
  const nodes = new Map<string, { container: boolean; body: BodyInit | null }>([
    [base, { container: true, body: null }],
  ]);
  const requests: { url: string; method: string; headers: Headers }[] = [];
  const createdHints: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    requests.push({ url, method, headers });
    if (url === base && method === "GET")
      return Response.json({
        "@context": ["https://www.w3.org/ns/cid/v1", "https://www.w3.org/ns/lws/v1"],
        id: base,
        type: "Storage",
        service: [{ type: "StorageRoot", serviceEndpoint: base }],
      });
    if (method === "POST") {
      if (!nodes.get(url)?.container) return new Response(null, { status: 404 });
      const hint = headers.get("slug") as string;
      const container = headers.get("link")?.includes(`${LWS}Container`) ?? false;
      const name = rename === (container ? "container" : "resource") ? "server-chosen" : hint;
      const location = `${url}${name}${container ? "/" : ""}`;
      nodes.set(location, { container, body: init?.body ?? null });
      createdHints.push(hint);
      return new Response(null, { status: 201, headers: { location, etag: '"created"' } });
    }
    const node = nodes.get(url);
    if (!node) return new Response(null, { status: 404 });
    if (method === "HEAD" || method === "GET")
      return new Response(method === "HEAD" ? null : node.body, {
        headers: {
          etag: '"current"',
          link: `<${base}>; rel="${LWS}storage", <${LWS}${node.container ? "Container" : "DataResource"}>; rel="type"`,
        },
      });
    throw new Error(`Unexpected ${method} ${url}`);
  };
  const storage = injected ? (await createPodClient({ storage: base, fetch })).storage : undefined;
  return { base, nodes, requests, createdHints, driver: solidDriver({ base, fetch, storage }) };
}

describe.each([false, true])("LWS creation with injected storage: %s", (injected) => {
  describe.each(["setItem", "setItemRaw"] as const)("LWS %s name hints", (method) => {
    it.each([
      "資料",
      "📁:café:資料%3A100%25",
      "a%3Ab:percent%25",
      " 資料 : café%3A100%25 ",
    ])("creates escaped key %s and its missing ancestors at the expected URLs", async (key) => {
      const { base, driver, nodes, createdHints } = await fixture(injected);
      const parts = key.split(":").map((part) => encodeURIComponent(decodeURIComponent(part)));
      const value = method === "setItem" ? "value" : new Uint8Array([0, 255, 1]);
      await driver[method]?.(key, value, {});
      expect(createdHints).toEqual(parts);
      expect([...nodes.keys()]).toEqual([
        base,
        ...parts.map(
          (_, i) => `${base}${parts.slice(0, i + 1).join("/")}${i < parts.length - 1 ? "/" : ""}`,
        ),
      ]);
      if (method === "setItem") expect(await driver.getItem?.(key, {})).toBe(value);
      else expect(await driver.getItemRaw?.(key, {})).toEqual(value);
    });
  });

  it.each([
    "resource",
    "container",
  ] as const)("still refuses a renamed Unicode %s without deleting the returned URL", async (kind) => {
    const { base, driver, nodes, requests } = await fixture(injected, kind);
    const key = kind === "resource" ? "資料" : "資料:文";
    await expect(driver.setItem?.(key, "value", {})).rejects.toThrow(
      kind === "resource" ? /preserve the key name/ : /preserve the container name/,
    );
    expect(nodes.has(`${base}server-chosen${kind === "container" ? "/" : ""}`)).toBe(true);
    expect(requests.every(({ method }) => ["HEAD", "GET", "POST"].includes(method))).toBe(true);
  });
});
