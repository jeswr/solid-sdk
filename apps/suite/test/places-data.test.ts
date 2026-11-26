// AUTHORED-BY Codex (GPT-6.1 Sol)
import { openPlacesRepository } from "@jeswr/solid-places";
import { createPodClient } from "@jeswr/storage-client";
import { expect, it, vi } from "vitest";
import { openPlaces } from "../src/apps/places/lib/data";
import type { PodSession } from "../src/lib/session/pod-session";

vi.mock("@jeswr/storage-client", () => ({
  createPodClient: vi.fn(async () => ({ storage: "session-client" })),
}));
vi.mock("@jeswr/solid-places", () => ({ openPlacesRepository: vi.fn() }));
it.each([
  "demo",
  "solid",
  "extension",
] as const)("uses the selected %s account transport, owner and storage", async (mode) => {
  const session = {
    mode,
    fetch: vi.fn(),
    storageUrl: "https://pod.example/",
    webId: "https://pod.example/me",
  } as unknown as PodSession;
  await openPlaces(session);
  expect(createPodClient).toHaveBeenCalledWith({
    fetch: mode === "demo" ? expect.any(Function) : session.fetch,
    storage: session.storageUrl,
  });
  expect(openPlacesRepository).toHaveBeenCalledWith({
    fetch: session.fetch,
    storageUrl: session.storageUrl,
    owner: session.webId,
    storage: "session-client",
  });
});
it("propagates storage discovery failures", async () => {
  vi.mocked(openPlacesRepository).mockRejectedValueOnce(new Error("Offline"));
  await expect(openPlaces({} as PodSession)).rejects.toThrow("Offline");
});
// AUTHORED-BY Claude Opus 5.5
const root = "https://pod.example/";
async function demoTransport(metadata: Record<string, string>) {
  const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.redirect === "error") return new Response(null, { headers: metadata });
    return new Response(init?.method === "OPTIONS" ? null : "<> a <#Root>.", {
      headers: { "x-solid-demo-access-control": "none", "wac-allow": 'user="read"' },
    });
  });
  await openPlaces({
    mode: "demo",
    fetch,
    storageUrl: root,
    webId: `${root}me`,
  } as unknown as PodSession);
  const transport = vi.mocked(createPodClient).mock.lastCall?.[0].fetch as typeof globalThis.fetch;
  return { fetch, transport };
}
it("reads the method and URL from a Request when the demo transport receives no init", async () => {
  const { fetch, transport } = await demoTransport({});
  const head = new Request(root, { method: "HEAD" });
  const described = await transport(head);
  expect(fetch).toHaveBeenLastCalledWith(head, undefined);
  expect(described.headers.get("link")).toBe(
    `<${root}>; rel="http://www.w3.org/ns/solid/terms#storageDescription"`,
  );
  const listed = await transport(root);
  expect(listed.headers.get("link")).toBeNull();
  await expect(listed.text()).resolves.toBe("<> a <#Root>.");
});
it("copies advertised root metadata onto OPTIONS without clearing headers the root omits", async () => {
  const { fetch, transport } = await demoTransport({ link: `<${root}.acl>; rel="acl"` });
  const options = await transport(root, { method: "OPTIONS" });
  expect(fetch).toHaveBeenLastCalledWith(root, { method: "HEAD", redirect: "error" });
  expect(options.headers.get("link")).toBe(`<${root}.acl>; rel="acl"`);
  expect(options.headers.get("wac-allow")).toBe('user="read"');
});
