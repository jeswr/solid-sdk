// AUTHORED-BY GPT-5.6 Codex
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fixturePorts, startFixtureServer } from "../e2e/fixture-server.mjs";

type Reply = { status: number; headers: Record<string, string>; body?: string | Buffer };
type Handler = (
  req: { method?: string; url?: string },
  res: {
    writeHead: (status: number, headers?: Record<string, string>) => unknown;
    end: (body?: string | Buffer) => void;
  },
) => void;
const http = vi.hoisted(() => ({
  handlers: [] as Handler[],
  servers: [] as {
    port?: number;
    host?: string;
    close: ReturnType<typeof vi.fn>;
    closeAllConnections: ReturnType<typeof vi.fn>;
  }[],
  failPort: undefined as number | undefined,
}));

// Exercise real handlers and real fixture files without requiring permission to bind sockets.
// CI's emulator scenario separately exercises actual node:http connections.
vi.mock("node:http", () => ({
  createServer: (handler: Handler) => {
    http.handlers.push(handler);
    let onError: (error: Error) => void;
    const server = {
      port: undefined as number | undefined,
      host: undefined as string | undefined,
      once: (_event: string, callback: typeof onError) => {
        onError = callback;
      },
      listen: (port: number, host: string, ready: () => void) => {
        server.port = port;
        server.host = host;
        queueMicrotask(() => (port === http.failPort ? onError(new Error("EADDRINUSE")) : ready()));
      },
      close: vi.fn((callback: (error?: Error) => void) => callback()),
      closeAllConnections: vi.fn(),
    };
    http.servers.push(server);
    return server;
  },
}));

let fixture: Awaited<ReturnType<typeof startFixtureServer>>;
beforeEach(async () => {
  http.handlers.length = 0;
  http.servers.length = 0;
  http.failPort = undefined;
  fixture = await startFixtureServer();
});
afterEach(async () => {
  await fixture?.close();
});

function request(path: string, method = "GET", listener = 0): Reply {
  const reply: Reply = { status: 0, headers: {} };
  const response = {
    writeHead(status: number, headers: Record<string, string> = {}) {
      reply.status = status;
      reply.headers = headers;
      return response;
    },
    end(body?: string | Buffer) {
      reply.body = body;
    },
  };
  const handler = http.handlers[listener];
  if (!handler) throw new Error("No fixture handler");
  handler({ method, url: path }, response);
  return reply;
}

describe("loopback-only static fixture server", () => {
  test("uses distinct validated ports and binds only IPv4 loopback", () => {
    expect(fixturePorts()).toEqual({ port: 4173, iframePort: 4174 });
    expect(fixturePorts("1024", "65535")).toEqual({ port: 1024, iframePort: 65535 });
    for (const value of ["0", "1023", "65536", "NaN", " 4173", "1.5", "-1", "", "4173;bad"]) {
      expect(() => fixturePorts(value, "4174")).toThrow("integers");
    }
    expect(() => fixturePorts("4173", "4173")).toThrow("distinct");
    expect(http.servers.map(({ port, host }) => ({ port, host }))).toEqual([
      { port: 4173, host: "127.0.0.1" },
      { port: 4174, host: "127.0.0.1" },
    ]);
  });
  test("serves consistent origins and a fixture-specific health identity", () => {
    expect(fixture.suiteOrigin).not.toBe(fixture.foreignOrigin);
    for (const listener of [0, 1]) {
      const config = request("/config.json", "GET", listener);
      expect(config.headers["Cache-Control"]).toBe("no-store");
      expect(JSON.parse(String(config.body))).toEqual({
        suiteOrigin: fixture.suiteOrigin,
        foreignOrigin: fixture.foreignOrigin,
      });
      expect(JSON.parse(String(request("/health", "GET", listener).body))).toEqual({
        fixture: "suite-mobile-e2e",
      });
    }
  });
  test("serves the actual static pages and JavaScript without dependencies", () => {
    for (const path of [
      "/",
      "/index.html",
      "/hostile.html",
      "/navigation.html",
      "/foreign.html",
      "/index.js",
      "/hostile.js",
      "/ios-probes.js",
      "/navigation.js?cache=none",
    ]) {
      const response = request(path);
      expect(response.status).toBe(200);
      expect(response.headers["Content-Type"]).toMatch(
        path.includes(".js") ? /javascript/ : /html/,
      );
      expect(String(response.body)).toContain("AUTHORED-BY GPT-5.6 Codex");
    }
  });
  test("serves HEAD without a body", () => {
    const response = request("/index.js", "HEAD");
    expect(response.status).toBe(200);
    expect(response.body).toBeUndefined();
  });
  test.each([
    "/package.json",
    "/../package.json",
    "/%2e%2e%2fpackage.json",
    "/index.js%00",
    "/index.html/extra",
    "/missing",
  ])("refuses unknown and encoded file paths %s", (path) => {
    expect(request(path).status).toBe(404);
  });
  test.each(["POST", "PUT", "DELETE", "OPTIONS"])("refuses %s", (method) => {
    const response = request("/index.html", method);
    expect(response.status).toBe(405);
    expect(response.headers.Allow).toBe("GET, HEAD");
  });
  test("cleans up the first listener if the second port cannot bind", async () => {
    http.failPort = 24174;
    await expect(startFixtureServer({ port: 24173, iframePort: 24174 })).rejects.toThrow(
      "EADDRINUSE",
    );
    expect(http.servers[2]?.close).toHaveBeenCalledOnce();
    expect(http.servers[2]?.closeAllConnections).toHaveBeenCalledOnce();
  });
});
