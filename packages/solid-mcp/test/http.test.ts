// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6 — shutdown regression tests
// AUTHORED-BY Codex GPT-6 — CORS and parse-error regression tests

import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { createAuthorizationServer } from "@jeswr/mcp-oauth";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMcpHttpHandler, type McpHttpHandler, type McpHttpOptions } from "../src/http.js";

const RESOURCE = "https://mcp.example/mcp";
const ORIGIN = "https://client.example";
const MAX_BYTES = 1024 * 1024;
const MESSAGE = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
const closeCallbacks: (() => Promise<unknown>)[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of closeCallbacks.splice(0).reverse()) await close();
});

function principalServer(principal: string): McpServer {
  const server = new McpServer({ name: "http-test", version: "1.0.0" });
  server.registerTool("principal", {}, async () => ({
    content: [{ type: "text", text: principal }],
  }));
  return server;
}

function setup(overrides: Partial<McpHttpOptions<string>> = {}) {
  const authenticate = vi.fn(() => "alice");
  const server = vi.fn(principalServer);
  const options = {
    resourceUrl: RESOURCE,
    allowedOrigins: [ORIGIN],
    authenticate,
    server,
    ...overrides,
  };
  return { handler: createMcpHttpHandler(options), authenticate, server };
}

function request(headers: HeadersInit = {}, body: BodyInit | null = MESSAGE): Request {
  return new Request(RESOURCE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body,
    // @ts-expect-error Node requires duplex for streamed request bodies.
    duplex: "half",
  });
}

async function localServer() {
  let handler: McpHttpHandler;
  const node = createServer((req, res) => {
    void handler(req, res).catch(() => res.destroy());
  });
  node.listen(0, "127.0.0.1");
  await once(node, "listening");
  closeCallbacks.push(() => new Promise<void>((resolve) => node.close(() => resolve())));
  const address = node.address();
  if (!address || typeof address === "string") throw new Error("Expected local TCP address");
  const resourceUrl = `http://127.0.0.1:${address.port}/mcp`;
  return {
    resourceUrl,
    setHandler(next: McpHttpHandler) {
      handler = next;
    },
  };
}

describe("configuration", () => {
  it.each([
    "not a URL",
    "ftp://mcp.example/mcp",
    "https://user@mcp.example/mcp",
    "https://:password@mcp.example/mcp",
    `${RESOURCE}?query=1`,
    `${RESOURCE}#fragment`,
  ])("rejects unsafe resource URL %s", (resourceUrl) => {
    expect(() => setup({ resourceUrl })).toThrow();
  });

  it.each([
    "*",
    "null",
    "https://*.example",
    `${ORIGIN}/`,
    `${ORIGIN}/path`,
    "HTTPS://CLIENT.EXAMPLE",
  ])("rejects non-exact origin %s", (origin) => {
    // A wildcard in a syntactically valid hostname must also be rejected.
    expect(() => setup({ allowedOrigins: [origin] })).toThrow();
  });

  it("snapshots the allow-list and supports denying all browser origins", async () => {
    const allowedOrigins = [ORIGIN];
    const { handler } = setup({ allowedOrigins });
    allowedOrigins.push("https://evil.example");
    expect((await handler(request({ Origin: "https://evil.example" }))).status).toBe(403);
    const closed = setup({ allowedOrigins: [] }).handler;
    expect((await closed(request({ Origin: ORIGIN }))).status).toBe(403);
    expect((await closed(request())).status).toBe(200);
  });
});

describe("authority and CORS", () => {
  it.each([
    "https://evil.example/mcp",
    "https://mcp.example:444/mcp",
  ])("rejects URL authority %s before authentication", async (url) => {
    const { handler, authenticate } = setup();
    const response = await handler(new Request(url));
    expect(response.status).toBe(403);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it.each([
    "evil.example",
    "mcp.example:444",
    "mcp.example, mcp.example",
    "mcp.example.evil",
    "",
  ])("rejects Host %s even with forwarding headers", async (host) => {
    const { handler, authenticate } = setup();
    const response = await handler(request({ Host: host, "X-Forwarded-Host": "mcp.example" }));
    expect(response.status).toBe(403);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it.each([
    "null",
    "https://evil.example",
    `${ORIGIN}/`,
    `${ORIGIN}, https://evil.example`,
    "",
  ])("rejects Origin %s before authentication without reflecting it", async (origin) => {
    const { handler, authenticate, server } = setup();
    const response = await handler(request({ Origin: origin }));
    expect(response.status).toBe(403);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    expect(authenticate).not.toHaveBeenCalled();
    expect(server).not.toHaveBeenCalled();
  });

  it("accepts an exact Host and origin and exposes the authentication challenge", async () => {
    const { handler } = setup({ authenticate: () => null });
    const response = await handler(request({ Host: "mcp.example", Origin: ORIGIN }));
    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("access-control-expose-headers")).toContain("WWW-Authenticate");
    expect(response.headers.has("access-control-allow-credentials")).toBe(false);
    expect(response.headers.get("vary")).toBe("Origin");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    "POST",
    "GET",
  ])("answers allowed %s preflights without authentication or wildcard headers", async (method) => {
    const { handler, authenticate, server } = setup();
    const response = await handler(
      new Request(RESOURCE, {
        method: "OPTIONS",
        headers: {
          Origin: ORIGIN,
          "Access-Control-Request-Method": method,
          "Access-Control-Request-Headers": "authorization, content-type, mcp-protocol-version",
        },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(response.headers.get("access-control-allow-headers")).toContain("MCP-Protocol-Version");
    expect([...response.headers.values()].some((value) => value.includes("*"))).toBe(false);
    expect(authenticate).not.toHaveBeenCalled();
    expect(server).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { Origin: ORIGIN },
    { Origin: ORIGIN, "Access-Control-Request-Method": "DELETE" },
  ])("rejects incomplete/unsupported preflights %j", async (headers) => {
    const { handler } = setup();
    const response = await handler(new Request(RESOURCE, { method: "OPTIONS", headers }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
  });

  it("checks Origin even for OPTIONS", async () => {
    const { handler } = setup();
    expect(
      (
        await handler(
          new Request(RESOURCE, {
            method: "OPTIONS",
            headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
          }),
        )
      ).status,
    ).toBe(403);
  });
});

describe("authentication and methods", () => {
  it.each([
    null,
    undefined,
    false,
  ])("challenges rejected authentication (%s)", async (principal) => {
    const { handler, server } = setup({ authenticate: () => principal });
    const response = await handler(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource/mcp"',
    );
    expect(server).not.toHaveBeenCalled();
  });

  it.each([
    "https://mcp.example/",
    "https://mcp.example/mcp",
    "https://mcp.example/nested/mcp/",
  ])("serves metadata at the advertised challenge URL for %s", async (resourceUrl) => {
    const { handler } = setup({ resourceUrl, authenticate: () => null });
    const response = await handler(new Request(resourceUrl));
    const challenge = response.headers.get("www-authenticate") ?? "";
    const url = /^Bearer resource_metadata="([^"]+)"$/.exec(challenge)?.[1];
    expect(url).toBeDefined();
    const oauth = createAuthorizationServer({
      issuer: "https://mcp.example/auth",
      resource: resourceUrl,
      podSessions: {
        begin: async () => {
          throw new Error("Unexpected login");
        },
        complete: async () => {
          throw new Error("Unexpected login");
        },
        fetchFor: async () => {
          throw new Error("Unexpected pod access");
        },
        revoke: async () => {},
      },
      consent: async () => false,
    });
    const metadata = await oauth.handle(new Request(url as string));
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({
      resource: resourceUrl,
      authorization_servers: ["https://mcp.example/auth"],
    });
  });

  it("sanitizes authentication exceptions and trims the metadata separator", async () => {
    const { handler } = setup({
      resourceUrl: `${RESOURCE}/`,
      authenticate: async () => {
        throw new Error("private diagnostic");
      },
    });
    const response = await handler(request());
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain(
      "https://mcp.example/.well-known/oauth-protected-resource/mcp",
    );
    expect(await response.text()).not.toContain("private diagnostic");
  });

  it.each(["GET", "DELETE", "PUT", "HEAD"])("authenticates then rejects %s", async (method) => {
    const { handler, authenticate, server } = setup();
    const response = await handler(new Request(RESOURCE, { method, headers: { Origin: ORIGIN } }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
    expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(authenticate).toHaveBeenCalledOnce();
    expect(server).not.toHaveBeenCalled();
  });

  it("challenges unauthenticated GET requests", async () => {
    const { handler } = setup({ authenticate: () => null });
    expect((await handler(new Request(RESOURCE))).status).toBe(401);
  });
});

describe("body limits", () => {
  it.each([
    "-1",
    "1.5",
    "not a number",
    "9007199254740992",
  ])("rejects invalid Content-Length %s", async (length) => {
    const { handler, server } = setup();
    const response = await handler(request({ "Content-Length": length }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe(-32000);
    expect(server).not.toHaveBeenCalled();
  });

  it("rejects a declared oversize body without reading it", async () => {
    const { handler, server } = setup();
    const input = request({ "Content-Length": String(MAX_BYTES + 1) });
    const response = await handler(input);
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe(-32000);
    expect(input.bodyUsed).toBe(false);
    expect(server).not.toHaveBeenCalled();
  });

  it.each([{}, { "Content-Length": "1" }])("caps actual streamed bytes (%j)", async (headers) => {
    const cancel = vi.fn().mockRejectedValue(new Error("cancellation failed"));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_BYTES / 2));
        controller.enqueue(new Uint8Array(MAX_BYTES / 2 + 1));
      },
      cancel,
    });
    const { handler, server } = setup();
    expect((await handler(request(headers, body))).status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(server).not.toHaveBeenCalled();
  });

  it("accepts exactly 1 MiB with a valid Content-Length", async () => {
    const { handler } = setup();
    const response = await handler(
      request({ "Content-Length": String(MAX_BYTES) }, MESSAGE.padEnd(MAX_BYTES)),
    );
    expect(response.status).toBe(200);
  });

  it("counts UTF-8 bytes rather than characters", async () => {
    const { handler } = setup();
    expect((await handler(request({}, JSON.stringify("é".repeat(MAX_BYTES / 2))))).status).toBe(
      413,
    );
  });

  it.each([
    null,
    "",
    "{",
    new Uint8Array([0xff]),
  ])("rejects empty or invalid JSON/UTF-8 (%s)", async (body) => {
    const { handler, server } = setup();
    const response = await handler(request({}, body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      jsonrpc: "2.0",
      error: { code: -32700, message: "Invalid request body" },
      id: null,
    });
    expect(server).not.toHaveBeenCalled();
  });

  it("sanitizes stream read failures", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error("private diagnostic"));
      },
    });
    const { handler } = setup();
    const response = await handler(request({}, body));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private diagnostic");
  });
});

describe("SDK lifecycle", () => {
  it("lists tools with the SDK client over local HTTP", async () => {
    const node = await localServer();
    const servers: McpServer[] = [];
    const handler = createMcpHttpHandler({
      resourceUrl: node.resourceUrl,
      allowedOrigins: [],
      authenticate: (input) =>
        input.headers.get("authorization") === "Bearer fixture" ? "alice" : null,
      server: () => {
        const server = principalServer("alice");
        vi.spyOn(server, "close");
        server.server.onclose = vi.fn();
        servers.push(server);
        return server;
      },
    });
    node.setHandler(handler);
    const client = new Client({ name: "test", version: "1.0.0" });
    closeCallbacks.push(() => client.close());
    const transport = new StreamableHTTPClientTransport(new URL(node.resourceUrl), {
      requestInit: { headers: { Authorization: "Bearer fixture" } },
    });
    await client.connect(transport);
    const result = await client.listTools();
    expect(result.tools.map((tool) => tool.name)).toEqual(["principal"]);
    expect(transport.sessionId).toBeUndefined();
    expect(servers.length).toBeGreaterThanOrEqual(3);
    expect(new Set(servers).size).toBe(servers.length);
    for (const server of servers) {
      expect(server.close).toHaveBeenCalledOnce();
      expect(server.server.onclose).toHaveBeenCalledOnce();
    }
  });

  it("supports the SDK client with a Web fetch adapter", async () => {
    const { handler } = setup();
    const client = new Client({ name: "web-test", version: "1.0.0" });
    closeCallbacks.push(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(RESOURCE), {
        fetch: async (input, init) => handler(new Request(input, init)),
      }),
    );
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["principal"]);
  });

  it("isolates simultaneous principals even when they reuse JSON-RPC ids", async () => {
    const { handler } = setup({ authenticate: (input) => input.headers.get("x-principal") });
    const call = JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "principal" },
    });
    const responses = await Promise.all(
      ["alice", "bob"].map(async (principal) => {
        const response = await handler(request({ "X-Principal": principal }, call));
        expect(response.headers.has("mcp-session-id")).toBe(false);
        return (await response.json()).result.content[0].text;
      }),
    );
    expect(responses).toEqual(["alice", "bob"]);
  });

  it("rejects a reused server instance", async () => {
    const server = principalServer("alice");
    const { handler } = setup({ server: () => server });
    expect((await handler(request())).status).toBe(200);
    expect((await handler(request())).status).toBe(500);
  });

  it("sanitizes server construction failures", async () => {
    const { handler } = setup({
      server: async () => {
        throw new Error("private diagnostic");
      },
    });
    const response = await handler(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private diagnostic");
  });

  it("cleans up when connecting fails", async () => {
    const server = principalServer("alice");
    vi.spyOn(server, "connect").mockRejectedValue(new Error("private diagnostic"));
    const close = vi.spyOn(server, "close");
    const transportClose = vi.spyOn(WebStandardStreamableHTTPServerTransport.prototype, "close");
    const { handler } = setup({ server: () => server });
    expect((await handler(request())).status).toBe(500);
    expect(close).toHaveBeenCalledOnce();
    expect(transportClose).toHaveBeenCalledOnce();
  });

  it("closes the transport even if server cleanup fails", async () => {
    const server = principalServer("alice");
    vi.spyOn(server, "close").mockRejectedValue(new Error("private diagnostic"));
    const transportClose = vi.spyOn(WebStandardStreamableHTTPServerTransport.prototype, "close");
    server.server.onclose = vi.fn();
    const { handler } = setup({ server: () => server });
    expect((await handler(request())).status).toBe(200);
    expect(server.server.transport).toBeUndefined();
    expect(transportClose).toHaveBeenCalledOnce();
    expect(server.server.onclose).toHaveBeenCalledOnce();
  });

  it("does not repeat transport cleanup if server cleanup fails after closing it", async () => {
    const server = principalServer("alice");
    const close = server.close.bind(server);
    vi.spyOn(server, "close").mockImplementation(async () => {
      await close();
      throw new Error("private diagnostic");
    });
    const transportClose = vi.spyOn(WebStandardStreamableHTTPServerTransport.prototype, "close");
    server.server.onclose = vi.fn();
    const { handler } = setup({ server: () => server });
    expect((await handler(request())).status).toBe(200);
    expect(transportClose).toHaveBeenCalledOnce();
    expect(server.server.onclose).toHaveBeenCalledOnce();
  });

  it("closes once when SDK request handling fails", async () => {
    const server = principalServer("alice");
    server.server.onclose = vi.fn();
    vi.spyOn(WebStandardStreamableHTTPServerTransport.prototype, "handleRequest").mockRejectedValue(
      new Error("private diagnostic"),
    );
    const transportClose = vi.spyOn(WebStandardStreamableHTTPServerTransport.prototype, "close");
    const { handler } = setup({ server: () => server });
    const response = await handler(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private diagnostic");
    expect(transportClose).toHaveBeenCalledOnce();
    expect(server.server.onclose).toHaveBeenCalledOnce();
  });

  it("preserves the response when fallback cleanup rejects", async () => {
    const server = principalServer("alice");
    vi.spyOn(server, "close").mockRejectedValue(new Error("private diagnostic"));
    const transportClose = vi.spyOn(WebStandardStreamableHTTPServerTransport.prototype, "close");
    server.server.onclose = vi.fn(() => {
      throw new Error("private diagnostic");
    });
    const { handler } = setup({ server: () => server });
    expect((await handler(request())).status).toBe(200);
    expect(transportClose).toHaveBeenCalledOnce();
    expect(server.server.onclose).toHaveBeenCalledOnce();
  });

  it.each([
    ["Content-Type", "text/plain", 415],
    ["Accept", "application/json", 406],
    ["MCP-Protocol-Version", "unsupported", 400],
  ])("preserves SDK validation: %s", async (header, value, status) => {
    const server = principalServer("alice");
    const close = vi.spyOn(server, "close");
    server.server.onclose = vi.fn();
    const { handler } = setup({ server: () => server });
    expect((await handler(request({ [header]: value }))).status).toBe(status);
    expect(close).toHaveBeenCalledOnce();
    expect(server.server.onclose).toHaveBeenCalledOnce();
  });

  it("returns 202 for initialized notifications", async () => {
    const { handler } = setup();
    const response = await handler(
      request({}, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })),
    );
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
  });
});

describe("Node adapter", () => {
  async function invoke(handler: McpHttpHandler, properties: Record<string, unknown>) {
    const input = Object.assign(Readable.from([MESSAGE]), {
      headers: { host: "mcp.example" },
      rawHeaders: [
        "Host",
        "mcp.example",
        "Content-Type",
        "application/json",
        "Accept",
        "application/json, text/event-stream",
      ],
      method: "POST",
      url: "/mcp",
      ...properties,
    });
    const output = { writeHead: vi.fn(), end: vi.fn() };
    await handler(input as IncomingMessage, output as unknown as ServerResponse);
    return output;
  }

  it("rejects a missing Host", async () => {
    const { handler, authenticate } = setup();
    const response = await invoke(handler, { headers: {}, rawHeaders: [] });
    expect(response.writeHead.mock.calls[0]?.[0]).toBe(403);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("rejects malformed request targets", async () => {
    const { handler } = setup();
    expect((await invoke(handler, { url: "http://[" })).writeHead.mock.calls[0]?.[0]).toBe(400);
  });

  it("uses safe defaults for missing method and URL", async () => {
    const { handler } = setup();
    expect(
      (await invoke(handler, { method: undefined, url: undefined })).writeHead.mock.calls[0]?.[0],
    ).toBe(405);
  });

  it("does not trust an absolute request target or repeated Host", async () => {
    const { handler } = setup();
    expect(
      (await invoke(handler, { url: "https://evil.example/mcp" })).writeHead.mock.calls[0]?.[0],
    ).toBe(403);
    expect(
      (await invoke(handler, { rawHeaders: ["Host", "mcp.example", "Host", "evil.example"] }))
        .writeHead.mock.calls[0]?.[0],
    ).toBe(403);
  });

  it("rejects chunked oversized bodies over real local HTTP", async () => {
    const node = await localServer();
    node.setHandler(setup({ resourceUrl: node.resourceUrl }).handler);
    const response = await fetch(node.resourceUrl, {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(MAX_BYTES + 1));
          controller.close();
        },
      }),
      // @ts-expect-error Node requires duplex for streamed request bodies.
      duplex: "half",
    });
    expect(response.status).toBe(413);
  });
});
