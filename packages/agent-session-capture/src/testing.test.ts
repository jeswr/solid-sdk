// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import { createCaptureTestTransport } from "./testing.js";

describe("capture fixture conditional writes", () => {
  it("returns strong ETags and refuses stale replacements and conflicting creates", async () => {
    const { fetch: transportFetch, resources } = createCaptureTestTransport();
    const url = "https://pod.example/private/chats/.acl";
    const created = await transportFetch(url, {
      method: "PUT",
      body: "first",
      headers: { "if-none-match": "*" },
    });
    const etag = created.headers.get("etag");
    expect(etag).toMatch(/^"capture-\d+"$/);
    expect((await transportFetch(url)).headers.get("etag")).toBe(etag);
    expect(
      (
        await transportFetch(url, {
          method: "PUT",
          body: "second",
          headers: { "if-match": etag as string },
        })
      ).status,
    ).toBe(201);
    expect((await transportFetch(url)).headers.get("etag")).not.toBe(etag);
    expect(
      (
        await transportFetch(url, {
          method: "PUT",
          body: "stale",
          headers: { "if-match": etag as string },
        })
      ).status,
    ).toBe(412);
    expect(
      (
        await transportFetch(url, {
          method: "PUT",
          body: "conflict",
          headers: { "if-none-match": "*" },
        })
      ).status,
    ).toBe(412);
    expect(resources.get(url)).toBe("second");
  });
});
