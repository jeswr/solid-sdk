// AUTHORED-BY Codex GPT-6.1-Sol
import { createSourceAuth } from "@jeswr/pod-connectors";
import { exchangeCodeForToken } from "@jeswr/pod-connectors/oauth";
import { afterEach, expect, it, vi } from "vitest";

// Source APIs stay on their pristine transport alongside the shared core.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("keeps source API and token requests free of Pod Authorization and DPoP alongside pod-auth", async () => {
  const seen: Request[] = [];
  const platformFetch = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    seen.push(request);
    if (request.url.endsWith("/token")) return Response.json({ access_token: "source-token" });
    return new Response(null, { status: request.headers.has("dpop") ? 200 : 401 });
  });
  vi.stubGlobal("fetch", platformFetch);
  const { sourceFetch, publicFetch } = await import("./source-fetch");
  const { createPodAuth } = await import("@jeswr/pod-auth");
  const auth = createPodAuth({
    clientId: "https://app.test/clientid.jsonld", redirectUri: "https://app.test/callback.html",
    ui: { getWebId: async () => { throw new Error("No gesture"); }, getCode: async () => { throw new Error("No gesture"); } },
  });
  expect(await auth.restore()).toBeNull();
  expect(globalThis.fetch).toBe(platformFetch);

  const oauth = {
    clientId: "public-client",
    authorizationEndpoint: "https://source.test/authorize",
    tokenEndpoint: "https://source.test/token",
    scopes: [],
    tokenExchange: "public" as const,
  };
  const token = await exchangeCodeForToken("toy", oauth, {
    code: "code", verifier: "verifier", redirectUri: "https://app.test/callback",
  }, sourceFetch);
  const source = createSourceAuth("toy", {
    metadata: { id: "toy", name: "Toy", tier: "A", authKind: "oauth-pkce", scopes: [], categories: [], whatYouGet: "", requirements: [] },
    fixtures: () => [{ url: "https://source.test/items", json: {} }],
    import: async () => ({}),
  }, token, sourceFetch);
  expect((await source.fetch("https://source.test/items")).status).toBe(401);
  expect(seen.map((request) => request.headers.get("authorization"))).toEqual([null, "Bearer source-token"]);
  expect(seen.every((request) => !request.headers.has("dpop"))).toBe(true);

  await publicFetch("https://public.example/profile", { credentials: "include" });
  expect(seen.at(-1)?.credentials).toBe("omit");

  // Out-of-bound requests remain anonymous, and neither creation nor logout patches global fetch.
  expect((await auth.fetch("https://pod.test/private")).status).toBe(401);
  expect(seen.at(-1)?.headers.has("authorization")).toBe(false);
  expect(seen.at(-1)?.headers.has("dpop")).toBe(false);
  await auth.logout();
  expect(globalThis.fetch).toBe(platformFetch);
});
