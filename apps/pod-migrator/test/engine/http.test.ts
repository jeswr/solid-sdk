// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import { createPodHttp } from "../../src/engine/index.js";

const root = "https://shared.example/alice/";
describe("PodHttp credential boundary", () => {
  it("sends only primitive checked URLs and allowlisted request fields", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response());
    const http = createPodHttp({ root, fetch });
    await http.get(`${root}x`, {
      accept: "text/turtle",
      headers: { Authorization: "evil", DPoP: "evil" },
    } as never);
    await http.head(`${root}x`);
    await http.put(`${root}x`, "x", {
      contentType: "text/plain",
      ifNoneMatch: "*",
      ifMatch: '"etag"',
    });
    await http.put(`${root}x`, new Uint8Array([1]), { contentType: "application/octet-stream" });
    await http.delete(`${root}x`);
    expect(fetch).toHaveBeenCalledTimes(5);
    for (const [url, init] of fetch.mock.calls) {
      expect(typeof url).toBe("string");
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).has("authorization")).toBe(false);
      expect(new Headers(init?.headers).has("dpop")).toBe(false);
    }
    expect(new Headers(fetch.mock.calls[2]?.[1]?.headers).get("if-none-match")).toBe("*");
    expect(http.root).toBe(root);
  });
  it.each([
    `${root}../bob/private`,
    "https://shared.example/bob/private",
    "https://shared.example/alice-evil/private",
    "https://evil.example/alice/x",
    `${root}%2e%2e/bob/x`,
    `${root}..%2fbob/x`,
    `${root}%255c..%255cbob/x`,
    `${root}..\\bob/x`,
    `https://user:secret@shared.example/alice/x`,
    `//shared.example/alice/x`,
    "javascript:alert(1)",
    `${root}x?query`,
    `${root}x#hash`,
    new Request(`${root}x`),
    new URL(`${root}x`),
  ])("refuses crafted input %s before credentials", async (input) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const http = createPodHttp({ root, fetch });
    await expect(http.get(input as string)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([301, 302, 303, 307, 308, 304])("refuses redirect status %s", async (status) => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(null, { status, headers: { location: "https://shared.example/bob/stolen" } }),
      );
    await expect(createPodHttp({ root, fetch }).get(`${root}x`)).rejects.toThrow("redirect");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("checks successful Location and final response URL", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(null, { status: 201, headers: { location: "https://shared.example/bob/" } }),
      )
      .mockResolvedValueOnce(
        Object.defineProperty(new Response(), "url", { value: `${root}different` }),
      )
      .mockResolvedValueOnce(Object.defineProperty(new Response(), "redirected", { value: true }))
      .mockResolvedValueOnce(
        Object.defineProperty(new Response(), "type", { value: "opaqueredirect" }),
      );
    const http = createPodHttp({ root, fetch });
    for (let i = 0; i < 4; i++) await expect(http.head(`${root}x`)).rejects.toThrow();
  });
  it("permits explicitly opted-in loopback only", () => {
    for (const root of [
      "http://localhost:3000/pod/",
      "http://127.0.0.1:3000/pod/",
      "http://[::1]:3000/pod/",
    ]) {
      expect(() => createPodHttp({ root, fetch, allowInsecureLoopback: true })).not.toThrow();
      expect(() => createPodHttp({ root, fetch })).toThrow();
    }
    for (const root of [
      "http://evil.example/pod/",
      "https://shared.example/pod/?x",
      "https://shared.example/pod/#x",
      "https://shared.example\\pod/",
      1 as never,
    ])
      expect(() => createPodHttp({ root, fetch, allowInsecureLoopback: true })).toThrow();
  });
});
