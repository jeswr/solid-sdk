// AUTHORED-BY Codex GPT-6.1-Sol
import { createGuardedFetch } from "@jeswr/guarded-fetch";
import { describe, expect, it, vi } from "vitest";
import { REDIRECT } from "../test/fixtures.js";
import { Clients, clientMetadata } from "./clients.js";
import { MemoryStore } from "./testing.js";
import type { Client } from "./types.js";

describe("registration metadata", () => {
  it("preserves exact redirect spelling and accepts HTTPS/loopback HTTP", () => {
    const redirects = [
      REDIRECT,
      "https://client.example:443/cb",
      "http://localhost:8080/cb",
      "http://127.0.0.1:3000/cb",
      "http://127.2.3.4/cb",
      "http://[::1]:4000/cb",
    ];
    const value = clientMetadata(
      {
        redirect_uris: [...redirects, REDIRECT],
        response_types: ["code"],
        grant_types: ["authorization_code", "refresh_token", "refresh_token"],
        token_endpoint_auth_method: "none",
        client_name: "name",
      },
      "id",
      100,
    );
    expect(value.redirect_uris).toEqual(redirects);
    expect(value.grant_types).toEqual(["authorization_code", "refresh_token"]);
  });

  it.each([
    null,
    [],
    "string",
    {},
    { redirect_uris: [] },
    { redirect_uris: [123] },
    ...[
      "not-a-url",
      "http://client.example/cb",
      "http://localhost.evil.example/cb",
      "http://10.0.0.1/cb",
      "https://user@client.example/cb",
      "https://:password@client.example/cb",
      "https://client.example/cb#frag",
      "https://client.example/cb#",
      "javascript:alert(1)",
      "https://client.example/ callback",
      "https://client.example/\\callback",
    ].map((uri) => ({ redirect_uris: [uri] })),
  ])("rejects invalid redirects or shape %o", (input) => {
    expect(() => clientMetadata(input, "id", 100)).toThrow();
  });

  it.each([
    { grant_types: "authorization_code" },
    { grant_types: [] },
    { grant_types: ["refresh_token"] },
    { grant_types: ["authorization_code", "password"] },
    { response_types: "code" },
    { response_types: [] },
    { response_types: ["token"] },
    { response_types: ["code", "code"] },
    { token_endpoint_auth_method: "client_secret_basic" },
    { client_secret: "fixture" },
    { client_secret_expires_at: 0 },
    { client_name: 123 },
    { client_name: "n".repeat(257) },
  ])("rejects unsupported client metadata %o", (input) => {
    expect(() => clientMetadata({ redirect_uris: [REDIRECT], ...input }, "id", 100)).toThrow(
      "invalid_client_metadata",
    );
  });
});

describe("client metadata fetching and bounded cache", () => {
  const id = "https://client.example/client.json";
  const data = { client_id: id, client_name: "name", redirect_uris: [REDIRECT] };
  const make = () => {
    let now = 100;
    const store = new MemoryStore<Client>();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(data));
    const clients = new Clients(store, () => now, fetcher);
    return {
      clients,
      store,
      fetcher,
      advance: (seconds: number) => {
        now += seconds;
      },
    };
  };

  it("uses stored clients, caches valid JSON and returns snapshots", async () => {
    const f = make();
    const stored = clientMetadata(data, "registered", 100);
    await f.store.put("registered", stored);
    expect(await f.clients.get("registered")).toEqual(stored);
    expect(f.fetcher).not.toHaveBeenCalled();
    const client = await f.clients.get(id);
    client.redirect_uris.length = 0;
    expect((await f.clients.get(id)).redirect_uris).toEqual([REDIRECT]);
    expect(f.fetcher).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        redirect: "manual",
        credentials: "omit",
        headers: { accept: "application/json" },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    f.advance(300);
    await f.clients.get(id);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["no-store", null, 0],
    ["no-cache", null, 0],
    ["max-age=0", null, 0],
    ["max-age=10", "5", 5],
    ["max-age=600", null, 300],
    ["max-age=10", "invalid", 0],
    ["max-age=10", "20", 0],
    ['public, max-age="10"', null, 10],
  ])("respects cache directives %s Age=%s", async (control, age, lifetime) => {
    const f = make();
    f.fetcher.mockImplementation(async () =>
      Response.json(data, {
        headers: {
          "cache-control": control,
          ...(age === null ? {} : { age }),
        },
      }),
    );
    await f.clients.get(id);
    if (lifetime > 0) {
      f.advance(lifetime - 1);
      await f.clients.get(id);
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      f.advance(1);
    }
    await f.clients.get(id);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest entry at 256 entries", async () => {
    const f = make();
    f.fetcher.mockImplementation(async (input) =>
      Response.json({ ...data, client_id: String(input) }),
    );
    for (let i = 0; i < 257; i++) await f.clients.get(`https://client.example/${i}.json`);
    await f.clients.get("https://client.example/0.json");
    expect(f.fetcher).toHaveBeenCalledTimes(258);
  });

  it.each([
    "http://client.example/client.json",
    "https://client.example",
    "https://client.example/a/../b.json",
    "https://client.example/%2e/id",
    "https://client.example/%2e%2e/id",
    "https://client.example/./id",
  ])("rejects invalid raw client URLs %s before fetching", async (url) => {
    const f = make();
    await expect(f.clients.get(url)).rejects.toMatchObject({
      error: "invalid_client",
      status: 401,
    });
    expect(f.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    () => new Response("{}", { status: 404 }),
    () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }),
    () => new Response("{}", { headers: { "content-type": "text/html" } }),
    () => new Response("{}"),
    () => Response.json({ ...data, client_id: `${id}?different` }),
    () => Response.json({ ...data, redirect_uris: ["http://evil.example/"] }),
    () => Response.json([]),
    () => new Response("{", { headers: { "content-type": "application/json" } }),
    () => new Response("x".repeat(65537), { headers: { "content-type": "application/json" } }),
    () =>
      new Response("{}", {
        headers: { "content-type": "application/json", "content-length": "65537" },
      }),
  ])("rejects and never caches invalid documents %#", async (response) => {
    const f = make();
    f.fetcher.mockImplementation(async () => response());
    await expect(f.clients.get(id)).rejects.toMatchObject({ error: "invalid_client" });
    await expect(f.clients.get(id)).rejects.toMatchObject({ error: "invalid_client" });
    expect(f.fetcher).toHaveBeenCalledTimes(2);
  });

  it("accepts application/*+json and hides network errors", async () => {
    const f = make();
    f.fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify(data), {
        headers: {
          "content-type": "application/ld+json; charset=utf-8",
          "cache-control": "no-store",
        },
      }),
    );
    expect(await f.clients.get(id)).toHaveProperty("client_id", id);
    f.fetcher.mockRejectedValueOnce(new Error("private-network-detail"));
    await expect(f.clients.get(id)).rejects.toMatchObject({ message: "invalid_client" });
  });

  it("uses a real guarded-fetch policy over fixture transport for SSRF, rebinding and redirect failures", async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json(data));
    const lookup = vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]);
    const guard = createGuardedFetch({
      pinningFetch: transport,
      dnsLookup: lookup,
      requireDnsPinning: true,
      maxRedirects: 0,
      maxBytes: 65536,
    });
    const clients = new Clients(new MemoryStore(), () => 100, guard);
    for (const url of [
      "https://127.0.0.1/client.json",
      "https://169.254.169.254/latest",
      "https://[::1]/id",
    ]) {
      await expect(clients.get(url)).rejects.toThrow("invalid_client");
    }
    expect(transport).not.toHaveBeenCalled();
    lookup.mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }]);
    await expect(clients.get(id)).rejects.toThrow("invalid_client");
    expect(transport).not.toHaveBeenCalled();
    transport.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "https://other.example/id" } }),
    );
    await expect(clients.get(id)).rejects.toThrow("invalid_client");
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
