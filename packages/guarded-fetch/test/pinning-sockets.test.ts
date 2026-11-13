// AUTHORED-BY Codex GPT-6.1-Sol
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  Agent,
  EnvHttpProxyAgent,
  getGlobalDispatcher,
  ProxyAgent,
  setGlobalDispatcher,
} from "undici";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createGuardedFetch, type DnsLookup, SsrfError } from "../src/index.js";
import { createNodeGuardedFetch } from "../src/node.js";

const loopback: DnsLookup = async () => [{ address: "127.0.0.1", family: 4 }];
const originalDispatcher = getGlobalDispatcher();
let server: Server;
let port: number;
let requests = 0;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    requests += 1;
    if (req.url === "/redirect") {
      res.writeHead(302, { location: `http://other.test:${port}/` }).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ body: Buffer.concat(chunks).toString(), headers: req.headers }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as AddressInfo).port;
});

beforeEach(() => {
  for (const name of [
    "HTTP_PROXY",
    "http_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
    "NO_PROXY",
    "no_proxy",
    "NODE_USE_ENV_PROXY",
    "NODE_OPTIONS",
  ])
    vi.stubEnv(name, undefined);
  vi.stubGlobal("process", Object.assign(Object.create(process), { execArgv: [] }));
});

afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const factories = {
  root: (resolve = loopback) => createGuardedFetch({ allowLoopback: true, dnsLookup: resolve }),
  node: (resolve = loopback) =>
    createNodeGuardedFetch({ allowLoopback: true, resolveAll: resolve }),
};

for (const [entry, factory] of Object.entries(factories)) {
  describe(`${entry}: real undici sockets`, () => {
    it("serializes Node's global FormData with a matching multipart boundary", async () => {
      const body = new FormData();
      body.set("message", "hello multipart");
      body.set("upload", new Blob(["file contents"], { type: "text/plain" }), "fixture.txt");
      const response = await factory()(`http://pinned.test:${port}/`, { method: "POST", body });
      const echoed = await response.json();
      expect(echoed.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
      const parsed = await new Response(echoed.body, {
        headers: { "content-type": echoed.headers["content-type"] },
      }).formData();
      expect(parsed.get("message")).toBe("hello multipart");
      const file = parsed.get("upload") as File;
      expect(file.name).toBe("fixture.txt");
      expect(await file.text()).toBe("file contents");
    });

    it.each([
      "blob",
      "search",
      "stream",
    ])("preserves %s upload bytes and content type", async (kind) => {
      const payload = "hello=world+space";
      const body =
        kind === "blob"
          ? new Blob([payload], { type: "application/custom" })
          : kind === "search"
            ? new URLSearchParams({ hello: "world space" })
            : new ReadableStream({
                start(controller) {
                  controller.enqueue(new TextEncoder().encode(payload));
                  controller.close();
                },
              });
      const response = await factory()(`http://pinned.test:${port}/`, {
        method: "POST",
        body,
        ...(kind === "stream" ? { duplex: "half" } : {}),
      } as RequestInit);
      const echoed = await response.json();
      expect(echoed.body).toBe(payload);
      expect(echoed.headers["content-type"]).toBe(
        kind === "blob"
          ? "application/custom"
          : kind === "search"
            ? "application/x-www-form-urlencoded;charset=UTF-8"
            : undefined,
      );
    });

    it("preserves a caller content-type when normalizing FormData", async () => {
      const body = new FormData();
      body.set("message", "hello");
      const echoed = await (
        await factory()(`http://pinned.test:${port}/`, {
          method: "POST",
          body,
          headers: { "content-type": "application/custom" },
        })
      ).json();
      expect(echoed.headers["content-type"]).toBe("application/custom");
      expect(echoed.body).toContain('name="message"');
    });

    it("connects using a multi-record A/AAAA pin with IPv6 fallback", async () => {
      const resolve = vi.fn(async () => [
        { address: "::1", family: 6 },
        { address: "127.0.0.1", family: 4 },
      ]);
      expect((await factory(resolve)(`http://pinned.test:${port}/`)).status).toBe(200);
      expect(resolve).toHaveBeenCalledTimes(entry === "root" ? 1 : 2);
    });

    it.each([
      "hostname",
      "literal",
    ])("handles a global CONNECT proxy for a %s according to the entry policy", async (target) => {
      const proxy = new ProxyAgent(`http://127.0.0.1:${port}`);
      setGlobalDispatcher(proxy);
      const count = requests;
      try {
        const request = factory()(
          `http://${target === "hostname" ? "pinned.test" : "127.0.0.1"}:${port}/`,
        );
        if (entry === "root") {
          await expect(request).rejects.toThrow(/requireDnsPinning: false.*pinningFetch/);
          expect(requests).toBe(count);
        } else {
          expect((await request).status).toBe(200);
          expect(requests).toBe(count + 1);
        }
      } finally {
        setGlobalDispatcher(originalDispatcher);
        await proxy.close();
      }
    });

    it("handles global Agent TLS settings according to the entry policy", async () => {
      const dispatcher = new Agent({ connect: { ca: "fixture CA" } });
      setGlobalDispatcher(dispatcher);
      const count = requests;
      try {
        const request = factory()(`http://pinned.test:${port}/`);
        if (entry === "root") {
          await expect(request).rejects.toBeInstanceOf(SsrfError);
          expect(requests).toBe(count);
        } else {
          expect((await request).status).toBe(200);
          expect(requests).toBe(count + 1);
        }
      } finally {
        setGlobalDispatcher(originalDispatcher);
        await dispatcher.close();
      }
    });

    it("handles a configured environment-proxy dispatcher according to the entry policy", async () => {
      const dispatcher = new EnvHttpProxyAgent({ httpProxy: `http://127.0.0.1:${port}` });
      setGlobalDispatcher(dispatcher);
      try {
        const request = factory()(`http://pinned.test:${port}/`);
        if (entry === "root") await expect(request).rejects.toThrow(/requireDnsPinning/);
        else expect((await request).status).toBe(200);
      } finally {
        setGlobalDispatcher(originalDispatcher);
        await dispatcher.close();
      }
    });

    it("accepts a pristine default dispatcher (undici upgrade canary)", async () => {
      const dispatcher = new Agent();
      setGlobalDispatcher(dispatcher);
      try {
        expect((await factory()(`http://pinned.test:${port}/`)).status).toBe(200);
      } finally {
        setGlobalDispatcher(originalDispatcher);
        await dispatcher.close();
      }
    });

    it.each([
      "HTTP_PROXY",
      "http_proxy",
      "HTTPS_PROXY",
      "https_proxy",
      "ALL_PROXY",
      "all_proxy",
    ])("ignores inactive proxy configuration through %s", async (name) => {
      vi.stubEnv(name, "http://proxy.invalid:8080");
      expect((await factory()(`http://pinned.test:${port}/`)).status).toBe(200);
    });

    it.each([
      "env",
      "options",
      "argv",
    ])("ignores %s proxy activation without a proxy URL", async (activation) => {
      if (activation === "env") vi.stubEnv("NODE_USE_ENV_PROXY", "1");
      else if (activation === "options") vi.stubEnv("NODE_OPTIONS", "--use-env-proxy");
      else
        vi.stubGlobal(
          "process",
          Object.assign(Object.create(process), { execArgv: ["--use-env-proxy"] }),
        );
      expect((await factory()(`http://pinned.test:${port}/`)).status).toBe(200);
    });

    it.each([
      "env",
      "options",
      "argv",
    ])("refuses an effective proxy activated through %s before opening a socket", async (activation) => {
      vi.stubEnv("HTTP_PROXY", "http://proxy.invalid:8080");
      if (activation === "env") vi.stubEnv("NODE_USE_ENV_PROXY", "1");
      else if (activation === "options") vi.stubEnv("NODE_OPTIONS", "--use-env-proxy");
      else
        vi.stubGlobal(
          "process",
          Object.assign(Object.create(process), { execArgv: ["--use-env-proxy"] }),
        );
      const count = requests;
      const error = await factory()(`http://pinned.test:${port}/`).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SsrfError);
      expect(String(error)).toMatch(
        entry === "node" ? /Node entry.*root entry/ : /requireDnsPinning: false.*pinningFetch/,
      );
      expect(requests).toBe(count);
    });

    it.each([
      "*",
      "PINNED.TEST",
      ".test",
      "*.test",
      "other.test, pinned.test",
      "other.test pinned.test",
      "port",
    ])("honours NO_PROXY=%s for this target", async (exclusion) => {
      vi.stubEnv("NODE_USE_ENV_PROXY", "1");
      vi.stubEnv("HTTP_PROXY", "http://proxy.invalid:8080");
      vi.stubEnv("NO_PROXY", exclusion === "port" ? `pinned.test:${port}` : exclusion);
      expect((await factory()(`http://pinned.test:${port}/`)).status).toBe(200);
    });

    it.each([
      "other.test",
      "inned.test",
      "pinned.test.invalid",
      "port",
    ])("does not bypass the proxy for NO_PROXY=%s", async (exclusion) => {
      vi.stubEnv("NODE_USE_ENV_PROXY", "1");
      vi.stubEnv("HTTP_PROXY", "http://proxy.invalid:8080");
      vi.stubEnv("NO_PROXY", exclusion === "port" ? `pinned.test:${port + 1}` : exclusion);
      const count = requests;
      await expect(factory()(`http://pinned.test:${port}/`)).rejects.toBeInstanceOf(SsrfError);
      expect(requests).toBe(count);
    });

    it("honours lowercase no_proxy precedence", async () => {
      vi.stubEnv("NODE_USE_ENV_PROXY", "1");
      vi.stubEnv("http_proxy", "http://proxy.invalid:8080");
      vi.stubEnv("NO_PROXY", "other.test");
      vi.stubEnv("no_proxy", "pinned.test");
      expect((await factory()(`http://pinned.test:${port}/`)).status).toBe(200);
    });

    it("ignores HTTPS_PROXY for an HTTP target", async () => {
      vi.stubEnv("NODE_USE_ENV_PROXY", "1");
      vi.stubEnv("HTTPS_PROXY", "http://proxy.invalid:8080");
      expect((await factory()(`http://pinned.test:${port}/`)).status).toBe(200);
    });

    it("rechecks NO_PROXY for each redirect target", async () => {
      vi.stubEnv("NODE_USE_ENV_PROXY", "1");
      vi.stubEnv("HTTP_PROXY", "http://proxy.invalid:8080");
      vi.stubEnv("NO_PROXY", "pinned.test");
      const count = requests;
      await expect(factory()(`http://pinned.test:${port}/redirect`)).rejects.toBeInstanceOf(
        SsrfError,
      );
      expect(requests).toBe(count + 1);
    });
  });
}

it("root's explicit weaker opt-out uses the configured global dispatcher", async () => {
  const dispatcher = new Agent();
  const dispatch = vi.spyOn(dispatcher, "dispatch");
  setGlobalDispatcher(dispatcher);
  try {
    expect(
      (
        await createGuardedFetch({ allowLoopback: true, requireDnsPinning: false })(
          `http://127.0.0.1:${port}/`,
        )
      ).status,
    ).toBe(200);
    expect(dispatch).toHaveBeenCalled();
  } finally {
    setGlobalDispatcher(originalDispatcher);
    await dispatcher.close();
  }
});

it("connects over a real IPv6-only AAAA pin", async (context) => {
  const ipv6 = createServer((_req, res) => res.end("ipv6"));
  try {
    await new Promise<void>((resolve, reject) => {
      ipv6.once("error", reject);
      ipv6.listen(0, "::1", resolve);
    });
  } catch (error) {
    if (
      ["EAFNOSUPPORT", "EADDRNOTAVAIL", "EPROTONOSUPPORT"].includes(
        (error as NodeJS.ErrnoException).code ?? "",
      )
    ) {
      context.skip("IPv6 loopback is unavailable on this host");
      return;
    }
    throw error;
  }
  try {
    const resolve = async () => [{ address: "::1", family: 6 }];
    for (const factory of Object.values(factories)) {
      const response = await factory(resolve)(
        `http://pinned.test:${(ipv6.address() as AddressInfo).port}/`,
      );
      expect(await response.text()).toBe("ipv6");
    }
  } finally {
    ipv6.closeAllConnections();
    await new Promise<void>((resolve) => ipv6.close(() => resolve()));
  }
});
