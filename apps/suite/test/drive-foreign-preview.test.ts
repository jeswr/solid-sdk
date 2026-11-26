// AUTHORED-BY Claude Sonnet 5.5
// A previewed resource outside the user's storage is read without the signed-in transport, and
// whatever its response names (images, storage description, owner WebID) stays in its own pod.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolveItemOwner } from "../src/apps/drive/lib/client/ownership";
import {
  foreignSecondaryFetch,
  previewImageResolverFor,
} from "../src/apps/drive/lib/preview/foreign";
import { createPreviewImageResolver } from "../src/apps/drive/lib/preview/image-resolver";

const MINE = "https://pod.example/alice/";
const FOREIGN = "https://bob.example/pod/doc.ttl";
const session = (sessionFetch: typeof fetch = vi.fn()) => ({
  fetch: sessionFetch,
  storageUrl: MINE,
});
const globalFetch = vi.fn<typeof fetch>();
const urlOf = (call: unknown[]) => String(call[0] instanceof Request ? call[0].url : call[0]);

beforeEach(() => {
  globalFetch.mockReset();
  globalFetch.mockImplementation(async () => new Response("ok"));
  vi.stubGlobal("fetch", globalFetch);
});
afterEach(() => vi.unstubAllGlobals());

it("reads a same-origin public URL credential-free, never through the session", async () => {
  const sessionFetch = vi.fn<typeof fetch>();
  const http = foreignSecondaryFetch(session(sessionFetch), FOREIGN);
  await http("https://bob.example/pod/pic.png", { headers: { authorization: "DPoP secret" } });
  expect(sessionFetch).not.toHaveBeenCalled();
  const [, init] = globalFetch.mock.calls[0] as [unknown, RequestInit];
  expect(init.credentials).toBe("omit");
  expect(new Headers(init.headers).has("authorization")).toBe(false);
});

it.each([
  ["a URL in the user's own pod", "https://pod.example/alice/private/photo.png", FOREIGN],
  [
    "the user's own pod even when it shares the previewed origin",
    "https://pod.example/alice/photo.png",
    "https://pod.example/bob/doc.ttl",
  ],
  ["a private-network host", "https://192.168.0.1/x.png", "https://192.168.0.1/doc.ttl"],
  ["a loopback name", "https://localhost/x.png", "https://localhost/doc.ttl"],
  ["a plain http URL", "http://bob.example/pod/pic.png", FOREIGN],
  ["another origin", "https://evil.example/pic.png", FOREIGN],
])("refuses %s without making a request", async (_name, target, resource) => {
  const sessionFetch = vi.fn<typeof fetch>();
  const http = foreignSecondaryFetch(session(sessionFetch), resource);
  await expect(http(target)).rejects.toThrow(TypeError);
  expect(sessionFetch).not.toHaveBeenCalled();
  expect(globalFetch).not.toHaveBeenCalled();
});

it("a foreign document cannot make the preview read an image from the user's own pod", async () => {
  const sessionFetch = vi.fn<typeof fetch>(async () => new Response("secret"));
  const resolve = previewImageResolverFor(session(sessionFetch), FOREIGN);
  const signal = new AbortController().signal;
  // The picture falls back to its placeholder when the resolver rejects.
  await expect(resolve("https://pod.example/alice/private/photo.png", signal)).rejects.toThrow();
  await expect(resolve("https://10.0.0.5/p.png", signal)).rejects.toThrow();
  expect(sessionFetch).not.toHaveBeenCalled();
  expect(globalFetch).not.toHaveBeenCalled();
});

it("keeps the session transport for an image of a document inside the user's storage", async () => {
  const sessionFetch = vi.fn<typeof fetch>(async () => new Response(new Blob(["x"])));
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: () => "blob:ok", revokeObjectURL() {} }),
  );
  const resolve = previewImageResolverFor(session(sessionFetch), `${MINE}doc.ttl`);
  expect(await resolve(`${MINE}pic.png`, new AbortController().signal)).toBe("blob:ok");
  expect(sessionFetch).toHaveBeenCalledTimes(1);
  expect(globalFetch).not.toHaveBeenCalled();
});

it("refuses a foreign image over the byte cap, declared or streamed", async () => {
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: () => "blob:ok", revokeObjectURL() {} }),
  );
  const resolve = previewImageResolverFor(session(), FOREIGN);
  const signal = new AbortController().signal;
  // Declared: the body is never read.
  globalFetch.mockResolvedValueOnce(
    new Response("tiny", { headers: { "content-length": String(64 * 1024 * 1024) } }),
  );
  expect(await resolve("https://bob.example/pod/big.png", signal)).toBeUndefined();
  // Streamed without a length: reading stops at the cap.
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled += 1;
      controller.enqueue(new Uint8Array(1024 * 1024));
    },
    cancel() {
      cancelled = true;
    },
  });
  globalFetch.mockResolvedValueOnce(new Response(stream));
  expect(await resolve("https://bob.example/pod/stream.png", signal)).toBeUndefined();
  expect(cancelled).toBe(true);
  expect(pulled).toBeLessThan(20);
  // Within the cap it is shown.
  globalFetch.mockResolvedValueOnce(new Response(new Blob(["small"])));
  expect(await resolve("https://bob.example/pod/ok.png", signal)).toBe("blob:ok");
});

it("the own-storage resolver is uncapped, as before", async () => {
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: () => "blob:ok", revokeObjectURL() {} }),
  );
  const big = new Response(new Blob([new Uint8Array(9 * 1024 * 1024)]));
  const resolve = createPreviewImageResolver(async () => big);
  expect(await resolve(`${MINE}big.png`, new AbortController().signal)).toBe("blob:ok");
});

it("owner discovery for a foreign resource never follows the response into the user's pod or a private host", async () => {
  const sessionFetch = vi.fn<typeof fetch>();
  globalFetch.mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const rel = "http://www.w3.org/ns/solid/terms#storageDescription";
    if (init?.method === "HEAD")
      return new Response(null, {
        headers: { link: `<${MINE}description>; rel="${rel}", <https://10.0.0.5/d>; rel="${rel}"` },
      });
    return new Response("", { status: 404, headers: { "x-url": url } });
  });
  const http = foreignSecondaryFetch(session(sessionFetch), FOREIGN);
  await resolveItemOwner(FOREIGN, {
    storageUrl: MINE,
    webId: "https://pod.example/alice#me",
    fetch: http,
  });
  const seen = globalFetch.mock.calls.map(urlOf);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((url) => url.startsWith("https://bob.example/"))).toBe(true);
  expect(sessionFetch).not.toHaveBeenCalled();
});
