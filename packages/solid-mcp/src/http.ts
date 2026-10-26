// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6 — transport shutdown
// AUTHORED-BY Codex GPT-6 — CORS and parse-error fixes
import type { IncomingMessage, ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

/** Authentication and server construction belong to the application, not the transport. */
export interface McpHttpOptions<Principal> {
  /** Return a NEW server bound to this principal's pod session on every call. */
  server: (principal: Principal) => McpServer | Promise<McpServer>;
  /** Verify the MCP resource token; return null/undefined/false or throw on failure. */
  authenticate: (
    request: Request,
  ) => Principal | null | undefined | false | Promise<Principal | null | undefined | false>;
  /** Exact serialized http(s) origins. Wildcards and opaque origins are rejected. */
  allowedOrigins: readonly string[];
  /** Public MCP endpoint URL; its authority is the only accepted Host. */
  resourceUrl: string;
}

/** The same handler supports native Web requests and Node's http.createServer. */
export interface McpHttpHandler {
  (request: Request): Promise<Response>;
  (request: IncomingMessage, response: ServerResponse): Promise<void>;
}

const MAX_BODY_BYTES = 1024 * 1024;
const ALLOW = "POST, OPTIONS";
const CORS_HEADERS = "Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id";

class BodyError extends Error {
  constructor(readonly status: number) {
    super("Invalid request body");
  }
}

function errorResponse(status: number, message: string, code = -32000): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status });
}

function httpUrl(value: string): URL {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new TypeError("Expected an http(s) URL without credentials, query or fragment");
  }
  return url;
}

/** Bound actual streamed bytes as well as the untrusted Content-Length hint. */
async function readJson(request: Request): Promise<unknown> {
  const length = request.headers.get("content-length");
  if (length !== null) {
    if (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))) {
      throw new BodyError(400);
    }
    if (Number(length) > MAX_BODY_BYTES) throw new BodyError(413);
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) {
          // Do not wait for an untrusted producer's cancellation callback.
          void reader.cancel().catch(() => {});
          throw new BodyError(413);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/**
 * Stateless MCP Streamable HTTP with JSON responses (no persistent GET stream).
 * Checks authority and Origin before authentication, caps POST bodies at 1 MiB,
 * and creates/closes a principal-bound server and SDK transport for every POST.
 * Mount at resourceUrl; reverse proxies must preserve the public Host header.
 */
export function createMcpHttpHandler<Principal>(
  options: McpHttpOptions<Principal>,
): McpHttpHandler {
  const resource = httpUrl(options.resourceUrl);
  const origins = new Set(options.allowedOrigins);
  for (const origin of origins) {
    if (httpUrl(origin).origin !== origin || origin.includes("*")) {
      throw new TypeError("allowedOrigins must contain exact serialized http(s) origins");
    }
  }
  const challenge = `Bearer resource_metadata="${resource.href.replace(/\/$/, "")}/.well-known/oauth-protected-resource"`;
  const servers = new WeakSet<McpServer>();

  async function dispatch(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (new URL(request.url).host !== resource.host || (host !== null && host !== resource.host)) {
      return errorResponse(403, "Forbidden Host");
    }
    if (origin !== null && !origins.has(origin)) {
      return errorResponse(403, "Forbidden Origin");
    }
    // Preflight requests carry no bearer token. Browser access is still restricted
    // to the explicit allow-list and fixed methods/headers.
    if (request.method === "OPTIONS") {
      const method = request.headers.get("access-control-request-method");
      if (origin === null || (method !== "POST" && method !== "GET")) {
        return new Response(null, { status: 405, headers: { Allow: ALLOW } });
      }
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": CORS_HEADERS,
        },
      });
    }

    let principal: Principal | null | undefined | false;
    try {
      principal = await options.authenticate(request);
    } catch {
      principal = null;
    }
    if (principal === null || principal === undefined || principal === false) {
      const response = errorResponse(401, "Unauthorized");
      response.headers.set("WWW-Authenticate", challenge);
      return response;
    }
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: ALLOW } });
    }

    let parsedBody: unknown;
    try {
      parsedBody = await readJson(request);
    } catch (error) {
      if (error instanceof BodyError) return errorResponse(error.status, "Invalid request body");
      return errorResponse(400, "Invalid request body", -32700);
    }

    try {
      const server = await options.server(principal);
      // A factory accidentally returning a singleton must never reconnect another
      // principal's server, including while its first request is still running.
      if (servers.has(server)) return errorResponse(500, "Internal server error");
      servers.add(server);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      let transportClosed = false;
      transport.onclose = () => {
        transportClosed = true;
      };
      try {
        await server.connect(transport);
        return await transport.handleRequest(request, { parsedBody });
      } finally {
        await Promise.allSettled([server.close()]);
        // The server owns shutdown; fall back if connect/close failed before closing the transport.
        if (!transportClosed) await Promise.allSettled([transport.close()]);
      }
    } catch {
      return errorResponse(500, "Internal server error");
    }
  }

  async function web(request: Request): Promise<Response> {
    const response = await dispatch(request);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Vary", "Origin");
    const origin = request.headers.get("origin");
    if (origin !== null && origins.has(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set(
        "Access-Control-Expose-Headers",
        "WWW-Authenticate, MCP-Protocol-Version",
      );
    }
    return response;
  }

  async function node(request: IncomingMessage, response: ServerResponse): Promise<void> {
    let result: Response;
    if (request.headers.host === undefined) {
      result = errorResponse(403, "Forbidden Host");
    } else {
      let converted: Request;
      try {
        const { Readable } = await import("node:stream");
        const headers = new Headers();
        for (let index = 0; index < request.rawHeaders.length; index += 2) {
          headers.append(
            request.rawHeaders[index] as string,
            request.rawHeaders[index + 1] as string,
          );
        }
        const method = request.method ?? "GET";
        converted = new Request(new URL(request.url ?? resource.href, resource), {
          method,
          headers,
          ...(method === "POST"
            ? { body: Readable.toWeb(request) as ReadableStream<Uint8Array>, duplex: "half" }
            : {}),
        });
      } catch {
        result = errorResponse(400, "Invalid HTTP request");
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(new Uint8Array(await result.arrayBuffer()));
        return;
      }
      result = await web(converted);
    }
    response.writeHead(result.status, Object.fromEntries(result.headers));
    response.end(new Uint8Array(await result.arrayBuffer()));
  }

  function handler(request: Request): Promise<Response>;
  function handler(request: IncomingMessage, response: ServerResponse): Promise<void>;
  function handler(
    request: Request | IncomingMessage,
    response?: ServerResponse,
  ): Promise<Response> | Promise<void> {
    if (response) return node(request as IncomingMessage, response);
    return web(request as Request);
  }
  return handler;
}
