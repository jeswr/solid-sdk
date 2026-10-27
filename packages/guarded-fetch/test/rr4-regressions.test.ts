// AUTHORED-BY Codex GPT-6.1-Sol
import { type AddressInfo, createServer } from "node:http";
import { MockAgent, Request as UndiciRequest, fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createGuardedFetch,
  createPodScopedFetch,
  refuseRedirects,
  SsrfError,
} from "../src/index.js";
import { createNodeGuardedFetch } from "../src/node.js";

const BASE = "https://pod.example/alice/";
const TARGET = `${BASE}item`;
const followingWrappers = {
  scope: (fetch: typeof globalThis.fetch) => createPodScopedFetch(BASE, { fetch }),
  ssrf: (fetch: typeof globalThis.fetch) =>
    createGuardedFetch({ fetch, dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }] }),
};
const wrappers = {
  ...followingWrappers,
  refusal: (fetch: typeof globalThis.fetch) => refuseRedirects(fetch),
};
const requestImplementations = {
  native: (url: string, init?: RequestInit) => new Request(url, init),
  undici: (url: string, init?: RequestInit) =>
    new UndiciRequest(url, init as never) as unknown as Request,
};

for (const [name, wrap] of Object.entries(followingWrappers)) {
  describe(`${name}: round 4 redirect and Request-brand regressions`, () => {
    it.each([307, 308])("replays an explicit body after a consuming %s hop", async (status) => {
      const seen: Array<{ url: string; method: string; body: string }> = [];
      const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        // Reading the actual request body makes reusing a consumed stream fail on hop two.
        const request = new Request(input, init);
        seen.push({ url: request.url, method: request.method, body: await request.text() });
        expect(request.redirect).toBe("manual");
        return seen.length === 1
          ? new Response(null, { status, headers: { location: `${BASE}next` } })
          : new Response("ok");
      });

      const response = await wrap(transport)(new Request(TARGET), {
        method: "POST",
        body: "payload",
      });

      expect(await response.text()).toBe("ok");
      expect(transport).toHaveBeenCalledTimes(2);
      expect(seen).toEqual([
        { url: TARGET, method: "POST", body: "payload" },
        { url: `${BASE}next`, method: "POST", body: "payload" },
      ]);
    });

    it("accepts a native Request with an installed undici transport", async () => {
      const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        // This constructor performs the real undici brand check without opening a socket.
        const request = new UndiciRequest(input as never, init as never);
        expect(request.url).toBe(TARGET);
        expect(request.method).toBe("POST");
        expect(request.redirect).toBe("manual");
        expect(await request.text()).toBe("payload");
        return new Response("ok");
      });

      const response = await wrap(transport)(
        new Request(TARGET, { method: "POST", body: "payload" }),
      );
      expect(await response.text()).toBe("ok");
      expect(transport).toHaveBeenCalledOnce();
    });

    it("accepts an undici Request with a native-constructing transport", async () => {
      const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);
        expect(request.url).toBe(TARGET);
        expect(request.method).toBe("POST");
        expect(request.redirect).toBe("manual");
        expect(await request.text()).toBe("payload");
        return new Response("ok");
      });

      const response = await wrap(transport)(
        requestImplementations.undici(TARGET, { method: "POST", body: "payload" }),
      );
      expect(await response.text()).toBe("ok");
      expect(transport).toHaveBeenCalledOnce();
    });
  });
}

it("passes an undici keepalive POST Request through refuseRedirects to undici.fetch", async () => {
  const agent = new MockAgent();
  agent.disableNetConnect();
  agent
    .get("https://pod.example")
    .intercept({ path: "/alice/item", method: "POST", body: "payload" })
    .reply(200, "ok");
  const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new UndiciRequest(input as never, init as never);
    expect(input).toBeInstanceOf(UndiciRequest);
    expect(request.keepalive).toBe(true);
    expect(request.redirect).toBe("manual");
    return (await undiciFetch(request, { dispatcher: agent })) as unknown as Response;
  });

  try {
    const response = await refuseRedirects(transport)(
      requestImplementations.undici(TARGET, {
        method: "POST",
        body: "payload",
        keepalive: true,
      }),
    );
    expect(await response.text()).toBe("ok");
    expect(transport).toHaveBeenCalledOnce();
    agent.assertNoPendingInterceptors();
  } finally {
    await agent.close();
  }
});

for (const [implementation, makeRequest] of Object.entries(requestImplementations)) {
  for (const [name, wrap] of Object.entries(wrappers)) {
    it(`${name} ignores a shadowed ${implementation} Request URL at the transport`, async () => {
      const request = makeRequest(TARGET);
      const shadow = vi.fn(() => "https://127.0.0.1/shadow");
      Object.defineProperty(request, "url", { get: shadow });
      const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const effective =
          implementation === "native"
            ? new Request(input, init)
            : new UndiciRequest(input as never, init as never);
        expect(effective.url).toBe(TARGET);
        expect(effective.redirect).toBe("manual");
        return new Response("ok");
      });

      expect(await (await wrap(transport)(request)).text()).toBe("ok");
      expect(transport).toHaveBeenCalledOnce();
      expect(shadow).not.toHaveBeenCalled();
    });
  }

  for (const [name, wrap] of Object.entries(followingWrappers)) {
    it(`${name} validates a shadowed ${implementation} Request's internal URL`, async () => {
      const request = makeRequest("https://127.0.0.1/private");
      const shadow = vi.fn(() => TARGET);
      Object.defineProperty(request, "url", { get: shadow });
      const transport = vi.fn(async () => new Response("unexpected"));

      await expect(wrap(transport)(request)).rejects.toThrow();
      expect(transport).not.toHaveBeenCalled();
      expect(shadow).not.toHaveBeenCalled();
    });
  }
}

async function within<T>(pending: Promise<T>, milliseconds = 1_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("request remained pending")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe("node: cancellation of an inherited keepalive upload stream", () => {
  const server = createServer((request) => {
    // Drain the upload, but leave it and the response open until the client aborts.
    request.resume();
  });
  let target: string;

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    target = `http://127.0.0.1:${(server.address() as AddressInfo).port}/upload`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it.each([
    "caller abort",
    "timeout",
  ])("rejects promptly on %s while the body stays open", async (mode) => {
    const caller = new AbortController();
    let upload: ReadableStreamDefaultController<Uint8Array> | undefined;
    let started: (() => void) | undefined;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        upload = controller;
        controller.enqueue(new TextEncoder().encode("payload"));
      },
      pull() {
        started?.();
        // Deliberately never close: buffering this body would ignore abort and timeout.
      },
    });
    const streamingRequest = new Request(target, {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    // Fetch permits inheriting a stream when keepalive is set on a Request input.
    const request = new Request(streamingRequest, { keepalive: true, signal: caller.signal });
    expect(request.keepalive).toBe(true);
    expect(request.body).not.toBeNull();
    const fetch = createNodeGuardedFetch({
      allowLoopback: true,
      timeoutMs: mode === "timeout" ? 100 : 5_000,
    });
    const pending = fetch(request);
    // Attach a rejection handler immediately, including while awaiting the first body read.
    const outcome = pending.then(
      () => undefined,
      (error: unknown) => error,
    );

    try {
      if (mode === "caller abort") {
        await within(reading);
        caller.abort();
      }
      const error = await within(outcome);
      expect(error).toBeInstanceOf(SsrfError);
      expect(error).toMatchObject({ cause: { name: "AbortError" } });
      expect(caller.signal.aborted).toBe(mode === "caller abort");
    } finally {
      caller.abort();
      // Release any buffering read even when this regression test fails.
      try {
        upload?.close();
      } catch {
        // undici may already have cancelled the upload.
      }
      await within(outcome);
    }
  });
});
