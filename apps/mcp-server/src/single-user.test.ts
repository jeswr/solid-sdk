// AUTHORED-BY Codex GPT-6.1-Sol
import { afterEach, expect, it, vi } from "vitest";
import { appFromEnvironment } from "./config.js";
import { podRootFor } from "./pod.js";
import { createSingleUserApp } from "./single-user.js";

afterEach(() => vi.unstubAllEnvs());

it.each([
  "https://pod.example/",
  "http://127.0.0.1:3000/",
])("uses a separate MCP bearer, DPoP pod credentials, read-only defaults and token caching (%s)", async (issuer) => {
  const upstream = vi.fn<typeof fetch>(async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    const request = new Request(input, init);
    if (url.endsWith("/.well-known/openid-configuration"))
      return Response.json({
        issuer,
        token_endpoint: `${issuer}token`,
      });
    if (url.endsWith("/token")) {
      expect(request.headers.get("authorization")).toMatch(/^Basic /);
      expect(request.headers.has("dpop")).toBe(true);
      return Response.json({
        access_token: "upstream-private-token",
        token_type: "DPoP",
        expires_in: 300,
      });
    }
    if (url.endsWith("/.well-known/solid"))
      return new Response("", { headers: { "content-type": "text/turtle" } });
    if (request.method === "HEAD")
      return new Response(null, {
        headers: {
          link: `<${issuer}.well-known/solid>; rel="http://www.w3.org/ns/solid/terms#storageDescription", <http://www.w3.org/ns/pim/space#Storage>; rel="type", <http://www.w3.org/ns/ldp#BasicContainer>; rel="type"`,
        },
      });
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });
    if (!request.headers.has("authorization"))
      return new Response(null, { status: 401, headers: { "www-authenticate": "DPoP" } });
    expect(request.headers.get("authorization")).toBe("DPoP upstream-private-token");
    expect(request.headers.get("cookie")).toBeNull();
    return new Response("private content", { headers: { "content-type": "text/plain" } });
  });
  const options = {
    publicOrigin: "https://mcp.example",
    accessToken: "t".repeat(43),
    credentials: { issuer, id: "account", secret: "private" },
    podRoot: `${issuer}alice/`,
    webId: `${issuer}alice/profile/card#me`,
    upstreamFetch: upstream,
    allowInsecureLoopback: issuer.startsWith("http:"),
  };
  const app = await createSingleUserApp(options);
  const call = (name: string, args: unknown, token = options.accessToken) =>
    app(
      new Request("https://mcp.example/mcp", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }),
    );
  expect(
    (await call("pod_read", { url: `${options.podRoot}note.txt` }, "upstream-private-token"))
      .status,
  ).toBe(401);
  for (let n = 0; n < 2; n += 1) {
    const response = await call("pod_read", { url: `${options.podRoot}note.txt` });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.result.content[0].text).toBe("private content");
  }
  expect(
    upstream.mock.calls.filter(([url]) =>
      (url instanceof Request ? url.url : String(url)).endsWith("/token"),
    ),
  ).toHaveLength(1);
  const result = await (
    await call("pod_write", {
      url: `${options.podRoot}new.txt`,
      content: "test",
      contentType: "text/plain",
    })
  ).json();
  expect(result.result.isError).toBe(true);
  const offPod = await (await call("fetch", { id: "https://evil.example/secret" })).json();
  expect(offPod.result.isError).toBe(true);
  expect(
    upstream.mock.calls.some(([url]) =>
      (url instanceof Request ? url.url : String(url)).includes("evil.example"),
    ),
  ).toBe(false);
  await expect(createSingleUserApp({ ...options, accessToken: "weak" })).rejects.toThrow();
});

it("fails closed on configuration errors, private stores on Vercel and ambiguous roots", async () => {
  await expect(appFromEnvironment({})).rejects.toThrow("MCP_PUBLIC_ORIGIN");
  await expect(appFromEnvironment({ MCP_PUBLIC_ORIGIN: "http://mcp.example" })).rejects.toThrow();
  await expect(
    appFromEnvironment({
      MCP_PUBLIC_ORIGIN: "https://mcp.example",
      VERCEL: "1",
      MCP_VAULT_STORE: "memory",
    }),
  ).rejects.toThrow("shared KV");
  await expect(
    appFromEnvironment({
      MCP_PUBLIC_ORIGIN: "https://mcp.example",
      MCP_VAULT_STORE: "memory",
      MCP_VAULT_KEY: Buffer.alloc(32, 7).toString("base64"),
      MCP_LWS_AUTHORIZATION_SERVERS: "https://lws.example/,http://cleartext.example/",
    }),
  ).rejects.toThrow("invalid_request");
  await expect(
    podRootFor(
      "https://pod.example/#me",
      async () => new Response("", { headers: { "content-type": "text/turtle" } }),
    ),
  ).rejects.toThrow("exactly one");
});

it("keeps HTTP credentials restricted to explicit loopback development", async () => {
  const upstreamFetch = vi.fn<typeof fetch>();
  const options = {
    publicOrigin: "https://mcp.example",
    accessToken: "t".repeat(43),
    credentials: { issuer: "http://127.0.0.1:3000/", id: "account", secret: "fixture" },
    podRoot: "http://127.0.0.1:3000/alice/",
    webId: "http://127.0.0.1:3000/alice/profile/card#me",
    upstreamFetch,
  };
  await expect(createSingleUserApp(options)).rejects.toThrow("requires HTTPS");
  await expect(
    createSingleUserApp({
      ...options,
      allowInsecureLoopback: true,
      podRoot: "http://pod.example/alice/",
    }),
  ).rejects.toThrow("requires HTTPS");
  vi.stubEnv("NODE_ENV", "production");
  await expect(createSingleUserApp({ ...options, allowInsecureLoopback: true })).rejects.toThrow(
    "local development only",
  );
  expect(upstreamFetch).not.toHaveBeenCalled();
});
