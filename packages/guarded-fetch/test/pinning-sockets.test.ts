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
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
    ])("refuses a global CONNECT proxy for a %s without opening a direct socket", async (target) => {
      const proxy = new ProxyAgent(`http://127.0.0.1:${port}`);
      setGlobalDispatcher(proxy);
      const count = requests;
      try {
        await expect(
          factory()(`http://${target === "hostname" ? "pinned.test" : "127.0.0.1"}:${port}/`),
        ).rejects.toThrow(/requireDnsPinning: false.*pinningFetch/);
        expect(requests).toBe(count);
      } finally {
        setGlobalDispatcher(originalDispatcher);
        await proxy.close();
      }
    });

    it("refuses global Agent TLS settings instead of discarding them", async () => {
      const dispatcher = new Agent({ connect: { ca: "fixture CA" } });
      setGlobalDispatcher(dispatcher);
      const count = requests;
      try {
        await expect(factory()(`http://pinned.test:${port}/`)).rejects.toBeInstanceOf(SsrfError);
        expect(requests).toBe(count);
      } finally {
        setGlobalDispatcher(originalDispatcher);
        await dispatcher.close();
      }
    });

    it("refuses a configured environment-proxy dispatcher", async () => {
      const dispatcher = new EnvHttpProxyAgent({ httpProxy: `http://127.0.0.1:${port}` });
      setGlobalDispatcher(dispatcher);
      try {
        await expect(factory()(`http://pinned.test:${port}/`)).rejects.toThrow(/requireDnsPinning/);
      } finally {
        setGlobalDispatcher(originalDispatcher);
        await dispatcher.close();
      }
    });

    it.each([
      "NODE_USE_ENV_PROXY",
      "NODE_OPTIONS",
      "HTTPS_PROXY",
      "https_proxy",
    ])("refuses proxy configuration through %s", async (name) => {
      vi.stubEnv(
        name,
        name === "NODE_USE_ENV_PROXY"
          ? "1"
          : name === "NODE_OPTIONS"
            ? "--use-env-proxy"
            : "http://proxy.invalid:8080",
      );
      const count = requests;
      await expect(factory()(`http://pinned.test:${port}/`)).rejects.toThrow(/requireDnsPinning/);
      expect(requests).toBe(count);
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

it("connects over a real IPv6-only AAAA pin", async () => {
  const ipv6 = createServer((_req, res) => res.end("ipv6"));
  await new Promise<void>((resolve, reject) => {
    ipv6.once("error", reject);
    ipv6.listen(0, "::1", resolve);
  });
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
