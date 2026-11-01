// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { MemoryStore } from "./index.js";

const CONTAINER = "https://pod.example/alice/";

describe("MemoryStore shared scope boundary", () => {
  it.each([
    `${CONTAINER}..%2fsecret`,
    `${CONTAINER}..%2Fsecret`,
    `${CONTAINER}..%5csecret`,
    `${CONTAINER}..%5Csecret`,
    `${CONTAINER}%2e%2e/secret`,
    `${CONTAINER}../secret`,
    "https://fixture-user:fixture-pass@pod.example/alice/item",
    "https://pod.example/alice2/item",
    "https://pod.example:8443/alice/item",
    CONTAINER,
    CONTAINER.slice(0, -1),
    "item",
  ])("refuses CRUD target before authenticated fetch: %s", async (url) => {
    const inner = vi.fn(async () => new Response(null, { status: 404 }));
    const store = new MemoryStore({ container: CONTAINER, fetch: inner });
    await expect(store.get(url)).rejects.toThrow();
    await expect(store.delete(url)).rejects.toThrow();
    expect(inner).not.toHaveBeenCalled();
  });

  it("still reaches the injected fetch for an in-scope resource", async () => {
    const inner = vi.fn(async () => new Response(null, { status: 404 }));
    const store = new MemoryStore({ container: CONTAINER, fetch: inner });
    expect(await store.get(`${CONTAINER}item`)).toBeNull();
    expect(inner).toHaveBeenCalledExactlyOnceWith(
      `${CONTAINER}item`,
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
      }),
    );
  });
});
