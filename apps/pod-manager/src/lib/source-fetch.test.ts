// AUTHORED-BY Codex GPT-6.1-Sol
import { createSourceAuth } from "@jeswr/pod-connectors";
import { exchangeCodeForToken } from "@jeswr/pod-connectors/oauth";
import { afterEach, expect, it, vi } from "vitest";

// Capture the source transport before installing the real auth manager's patch.
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("keeps source API and token requests free of Pod Authorization and DPoP after patching", async () => {
  const seen: Request[] = [];
  const platformFetch = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    seen.push(request);
    if (request.url.endsWith("/token")) return Response.json({ access_token: "source-token" });
    return new Response(null, { status: request.headers.has("dpop") ? 200 : 401 });
  });
  vi.stubGlobal("fetch", platformFetch);
  const { sourceFetch } = await import("./source-fetch");
  const upgrade = vi.fn(async (request: Request) => {
    const headers = new Headers(request.headers);
    headers.set("authorization", "DPoP pod-token");
    headers.set("dpop", "pod-proof");
    return new Request(request, { headers });
  });
  vi.stubGlobal("HTMLElement", class {});
  const { ReactiveFetchManager } = await import("@solid/reactive-authentication");
  const manager = new ReactiveFetchManager([{ matches: async () => true, upgrade }]);
  manager.registerGlobally();

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
  expect(upgrade).not.toHaveBeenCalled();
  expect(seen.map((request) => request.headers.get("authorization"))).toEqual([null, "Bearer source-token"]);
  expect(seen.every((request) => !request.headers.has("dpop"))).toBe(true);

  // Prove the patched transport would upgrade that same challenge with Pod credentials.
  expect((await manager.fetch("https://pod.test/private")).status).toBe(200);
  expect(upgrade).toHaveBeenCalledOnce();
  expect(seen.at(-1)?.headers.get("authorization")).toBe("DPoP pod-token");
  expect(seen.at(-1)?.headers.get("dpop")).toBe("pod-proof");
});
