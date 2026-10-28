// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it } from "vitest";
import { fixture, RESOURCE, SESSION } from "../test/fixtures.js";
import { mediaType, object, parameter, readBody, secureUrl } from "./protocol.js";
import { MemoryGrantStore, MemoryStore } from "./testing.js";
import type { Grant } from "./types.js";

describe("memory store atomicity and isolation", () => {
  it("retains consumed tombstones and rejects overwrites", async () => {
    const store = new MemoryStore<{ list: string[] }>();
    expect(await store.get("missing")).toBeUndefined();
    expect(await store.consume("missing")).toBeUndefined();
    const value = { list: ["one"] };
    await store.put("key", value);
    value.list.length = 0;
    const first = await store.get("key");
    expect(first).toEqual({ list: ["one"] });
    if (first) first.list.length = 0;
    const used = await Promise.all([store.consume("key"), store.consume("key")]);
    expect(used.map((entry) => entry?.firstUse)).toEqual([true, false]);
    expect(used[0]?.value).toEqual({ list: ["one"] });
    if (used[0]) used[0].value.list.length = 0;
    expect(await store.get("key")).toEqual({ list: ["one"] });
    await expect(store.put("key", value)).rejects.toThrow("exists");
  });

  it("revokes grants irreversibly and snapshots values", async () => {
    const store = new MemoryGrantStore();
    expect(await store.get("missing")).toBeUndefined();
    await store.revoke("missing");
    const value: Grant = {
      id: "grant",
      clientId: "client",
      session: { ...SESSION },
      resource: RESOURCE,
      scope: "",
      expiresAt: 200,
      revoked: false,
      refreshAllowed: true,
    };
    await store.put("grant", value);
    value.session.id = "mutated";
    expect((await store.get("grant"))?.session.id).toBe(SESSION.id);
    const copy = await store.get("grant");
    if (copy) copy.session.id = "mutated";
    await store.revoke("grant");
    await store.revoke("grant");
    expect((await store.get("grant"))?.revoked).toBe(true);
    await expect(store.put("grant", value)).rejects.toThrow("exists");
  });

  it("retains idempotent session tombstones independently of grant records", async () => {
    const store = new MemoryGrantStore();
    expect(await store.isSessionRevoked(SESSION.id)).toBe(false);
    await Promise.all([store.revokeSession(SESSION.id), store.revokeSession(SESSION.id)]);
    await store.revoke("missing");
    expect(await store.isSessionRevoked(SESSION.id)).toBe(true);
    expect(await store.isSessionRevoked("other-session")).toBe(false);
  });
});

describe("bounded protocol primitives", () => {
  it("handles null bodies and empty media types", async () => {
    expect(await readBody(new Response(null))).toBe("");
    expect(mediaType(new Response(null))).toBe("");
    expect(
      mediaType(
        new Response(null, { headers: { "content-type": "APPLICATION/JSON; charset=utf-8" } }),
      ),
    ).toBe("application/json");
    expect(object({ a: 1 })).toEqual({ a: 1 });
    for (const value of [null, false, [], "text"])
      expect(() => object(value)).toThrow("invalid_request");
    expect(() => parameter(new URLSearchParams("state=x&state=y"), "state")).toThrow(
      "invalid_request",
    );
    expect(secureUrl("https://example.com/").protocol).toBe("https:");
  });

  it("reads multiple chunks and cancels before buffering over the cap", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(40000));
        controller.enqueue(new Uint8Array(40000));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readBody(new Response(stream))).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
    const complete = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("one"));
        controller.enqueue(new TextEncoder().encode("two"));
        controller.close();
      },
    });
    expect(await readBody(new Response(complete))).toBe("onetwo");
  });

  it("never leaks unexpected request stream failures", async () => {
    const f = fixture();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("sensitive"));
      },
    });
    const request = new Request("https://mcp.example/auth/register", {
      method: "POST",
      body,
      headers: { "content-type": "application/json" },
      duplex: "half",
    } as RequestInit);
    const response = await f.server.handle(request);
    expect(await response.json()).toEqual({ error: "invalid_client_metadata" });
  });
});
