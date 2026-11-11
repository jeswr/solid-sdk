// AUTHORED-BY Codex GPT-6.1-Sol
import {
  Agent,
  getGlobalDispatcher,
  ProxyAgent,
  setGlobalDispatcher,
  FormData as UndiciFormData,
  Request as UndiciRequest,
} from "undici";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { transport } = vi.hoisted(() => ({ transport: vi.fn() }));
vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return {
    ...actual,
    fetch: async (input: string, init: RequestInit) => {
      // Exercise the installed undici Request constructor, whose brand differs
      // from Node's global Request, without opening a socket.
      const dispatcher = (init as RequestInit & { dispatcher: InstanceType<typeof actual.Agent> })
        .dispatcher;
      const optionsKey = Object.getOwnPropertySymbols(dispatcher).find(
        (key) => key.description === "options",
      );
      const options =
        optionsKey &&
        (
          dispatcher as unknown as Record<
            symbol,
            { connect: { lookup: (...args: unknown[]) => void } }
          >
        )[optionsKey];
      const hostname = new URL(input).hostname;
      if (!/^\[?[\d:]+(?:\.\d+)*\]?$/.test(hostname))
        await new Promise<void>((resolve, reject) => {
          options?.connect.lookup(hostname, { all: true }, (err: Error | null) =>
            err ? reject(err) : resolve(),
          );
        });
      const request = new actual.Request(input, init as never);
      return (await transport(request)) ?? new Response(await request.text());
    },
  };
});

import { assertSafeUrl, createGuardedFetch } from "../src/index.js";
import { createNodeGuardedFetch } from "../src/node.js";

beforeEach(() => {
  transport.mockReset();
});

it.each([
  false,
  true,
])("adapts a native Request to undici with main's fields (keepalive %s)", async (keepalive) => {
  const controller = new AbortController();
  const request = new Request("https://pod.example/item", {
    method: "POST",
    body: "private body",
    headers: { authorization: "Bearer fixture" },
    credentials: "include",
    mode: "same-origin",
    cache: "no-store",
    integrity: "sha256-fixture",
    keepalive,
    referrer: "https://pod.example/referrer",
    referrerPolicy: "no-referrer",
    signal: controller.signal,
  });
  Object.defineProperty(request, "url", { value: "https://foreign.example/shadow" });
  const fetch = createNodeGuardedFetch({
    resolveAll: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  const response = await fetch(request);
  expect(await response.text()).toBe("private body");
  expect(transport).toHaveBeenCalledOnce();
  const effective = transport.mock.calls[0]?.[0];
  expect(effective.url).toBe("https://pod.example/item");
  expect(effective.method).toBe("POST");
  expect(effective.headers.get("authorization")).toBe("Bearer fixture");
  expect(effective.credentials).toBe("include");
  expect(effective.mode).toBe("cors");
  expect(effective.cache).toBe("default");
  expect(effective.integrity).toBe("");
  expect(effective.keepalive).toBe(false);
  expect(effective.referrer).toBe("about:client");
  expect(effective.referrerPolicy).toBe("");
  expect(effective.redirect).toBe("manual");
});

it("accepts a no-cors POST Request with main's URL-plus-init defaults", async () => {
  const fetch = createNodeGuardedFetch({
    resolveAll: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  const response = await fetch(
    new Request("https://pod.example/item", {
      method: "POST",
      mode: "no-cors",
      body: "payload",
    }),
  );
  expect(await response.text()).toBe("payload");
  expect(transport).toHaveBeenCalledOnce();
  expect(transport.mock.calls[0]?.[0].mode).toBe("cors");
});

it("replays a FormData override with matching boundaries after a consuming 307", async () => {
  const form = new UndiciFormData();
  form.set("message", "payload");
  transport.mockImplementation(async (request) => {
    expect(request.method).toBe("POST");
    expect(request.redirect).toBe("manual");
    expect([...(await request.formData()).entries()]).toEqual([["message", "payload"]]);
    return transport.mock.calls.length === 1
      ? new Response(null, { status: 307, headers: { location: "/next" } })
      : new Response("ok");
  });
  const fetch = createNodeGuardedFetch({
    resolveAll: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  const response = await fetch(new Request("https://pod.example/item"), {
    method: "POST",
    body: form as unknown as BodyInit,
  });
  expect(await response.text()).toBe("ok");
  expect(transport).toHaveBeenCalledTimes(2);
  expect(transport.mock.calls.map(([request]) => request.url)).toEqual([
    "https://pod.example/item",
    "https://pod.example/next",
  ]);
});

it("refuses a shadowed native Request to a private IP before the undici transport", async () => {
  const request = new Request("https://127.0.0.1/steal");
  Object.defineProperty(request, "url", { value: "https://pod.example/item" });
  await expect(createNodeGuardedFetch()(request)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});

for (const [name, RequestImpl] of Object.entries({ native: Request, undici: UndiciRequest })) {
  it.each([
    "fresh",
    "consumed",
    "locked",
  ] as const)(`${name}: the Node transport consumes a replacement stream for a %s POST without explicit duplex`, async (state) => {
    const input = new RequestImpl("https://pod.example/item", {
      method: "POST",
      body: "original",
    }) as unknown as Request;
    if (state === "consumed") await input.text();
    const reader = state === "locked" ? input.body?.getReader() : undefined;
    const wasUsed = input.bodyUsed;
    const wasLocked = input.body?.locked;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("replacement upload"));
        controller.close();
      },
    });
    const guarded = createNodeGuardedFetch({
      resolveAll: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    try {
      expect(await (await guarded(input, { body })).text()).toBe("replacement upload");
      expect(transport).toHaveBeenCalledOnce();
      expect(transport.mock.calls[0]?.[0]).toHaveProperty("duplex", "half");
      expect(input.bodyUsed).toBe(wasUsed);
      expect(input.body?.locked).toBe(wasLocked);
    } finally {
      reader?.releaseLock();
    }
    if (state !== "consumed") expect(await input.text()).toBe("original");
  });

  it.each([
    false,
    true,
  ])(`${name}: the Node transport matches main for a body-less stream override (explicit duplex %s)`, async (explicitDuplex) => {
    const input = new RequestImpl("https://pod.example/item", {
      method: "POST",
    }) as unknown as Request;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("replacement upload"));
        controller.close();
      },
    });
    const guarded = createNodeGuardedFetch({
      resolveAll: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    const pending = guarded(input, {
      body,
      ...(explicitDuplex ? { duplex: "half" } : {}),
    } as RequestInit);
    if (explicitDuplex) {
      expect(await (await pending).text()).toBe("replacement upload");
      expect(transport).toHaveBeenCalledOnce();
    } else {
      await expect(pending).rejects.toThrow(/duplex/i);
      expect(transport).not.toHaveBeenCalled();
    }
    expect(input.body).toBeNull();
    expect(input.bodyUsed).toBe(false);
  });
}

it("normalizes Node global FormData before installed undici serializes it", async () => {
  const form = new FormData();
  form.set("message", "native realm payload");
  transport.mockImplementation(async (request) => {
    expect(request.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    expect([...(await request.formData()).entries()]).toEqual([
      ["message", "native realm payload"],
    ]);
    return new Response("ok");
  });
  await createNodeGuardedFetch({ resolveAll: async () => [{ address: "1.1.1.1", family: 4 }] })(
    "https://pod.example/item",
    { method: "POST", body: form },
  );
});

const originalDispatcher = getGlobalDispatcher();
afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

for (const [entry, factory] of Object.entries({
  root: () => createGuardedFetch({ dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }] }),
  node: () =>
    createNodeGuardedFetch({ resolveAll: async () => [{ address: "1.1.1.1", family: 4 }] }),
})) {
  it.each([
    false,
    true,
  ])(`${entry}: native multipart is replayable across a consuming 307 with keepalive %s`, async (keepalive) => {
    const form = new FormData();
    form.append("message", "first");
    form.append("message", "second");
    form.append("file", new Blob(["file bytes"], { type: "text/plain" }), "fixture.txt");
    transport.mockImplementation(async (request) => {
      const parsed = await request.formData();
      expect(parsed.getAll("message")).toEqual(["first", "second"]);
      const file = parsed.get("file") as File;
      expect(file.name).toBe("fixture.txt");
      expect(file.type).toBe("text/plain");
      expect(await file.text()).toBe("file bytes");
      return transport.mock.calls.length === 1
        ? new Response(null, { status: 307, headers: { location: "/next" } })
        : new Response("ok");
    });
    await factory()("https://pod.example/item", { method: "POST", body: form, keepalive });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([
    "blob",
    "search",
    "stream",
  ])(`${entry}: installed undici serializes %s bytes and content type`, async (kind) => {
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
    transport.mockImplementation(async (request) => {
      expect(request.headers.get("content-type")).toBe(
        kind === "blob"
          ? "application/custom"
          : kind === "search"
            ? "application/x-www-form-urlencoded;charset=UTF-8"
            : null,
      );
      return new Response(await request.text());
    });
    expect(
      await (
        await factory()("https://pod.example/item", {
          method: "POST",
          body,
          ...(kind === "stream" ? { duplex: "half" } : {}),
        } as RequestInit)
      ).text(),
    ).toBe(payload);
  });

  it(`${entry}: preserves caller content-type during FormData normalization`, async () => {
    const form = new FormData();
    form.set("message", "value");
    transport.mockImplementation(async (request) => {
      expect(request.headers.get("content-type")).toBe("application/custom");
      expect(await request.text()).toContain('name="message"');
      return new Response("ok");
    });
    await factory()("https://pod.example/item", {
      method: "POST",
      body: form,
      headers: { "content-type": "application/custom" },
    });
  });

  it.each([
    "proxy",
    "tls",
    "factory",
  ])(`${entry}: refuses non-default global %s dispatchers before sending`, async (kind) => {
    const dispatcher =
      kind === "proxy"
        ? new ProxyAgent("http://proxy.invalid")
        : kind === "tls"
          ? new Agent({ connect: { ca: "custom CA" } })
          : new Agent({
              factory: () => {
                throw new Error("custom factory");
              },
            });
    setGlobalDispatcher(dispatcher);
    try {
      for (const host of ["pod.example", "1.1.1.1"])
        await expect(factory()(`https://${host}/item`)).rejects.toThrow(
          /requireDnsPinning: false.*pinningFetch/,
        );
      await expect(
        assertSafeUrl("https://pod.example/", {
          dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
          requireDnsPinning: true,
        }),
      ).resolves.toBeUndefined();
      expect(transport).not.toHaveBeenCalled();
    } finally {
      setGlobalDispatcher(originalDispatcher);
      await dispatcher.close();
    }
  });

  it.each([
    "HTTPS_PROXY",
    "https_proxy",
    "HTTP_PROXY",
    "http_proxy",
    "ALL_PROXY",
    "all_proxy",
    "NODE_USE_ENV_PROXY",
    "NODE_OPTIONS",
    "execArgv",
  ])(`${entry}: refuses proxy configuration through %s`, async (name) => {
    if (name === "execArgv")
      vi.stubGlobal("process", { ...process, execArgv: ["--use-env-proxy"] });
    else
      vi.stubEnv(
        name,
        name === "NODE_OPTIONS"
          ? "--use-env-proxy"
          : name === "NODE_USE_ENV_PROXY"
            ? "1"
            : "http://secret:credential@proxy.invalid",
      );
    await expect(factory()("https://pod.example/item")).rejects.toThrow(
      /requireDnsPinning: false.*pinningFetch/,
    );
    expect(transport).not.toHaveBeenCalled();
  });
}

it("rechecks proxy configuration after the synchronous authority fence", async () => {
  const dispatcher = new ProxyAgent("http://proxy.invalid");
  try {
    await expect(
      createGuardedFetch({
        dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
        beforeDispatch: () => setGlobalDispatcher(dispatcher),
      })("https://pod.example/item"),
    ).rejects.toThrow(/requireDnsPinning: false.*pinningFetch/);
    expect(transport).not.toHaveBeenCalled();
  } finally {
    setGlobalDispatcher(originalDispatcher);
    await dispatcher.close();
  }
});

it("root's attested pinningFetch can preserve a caller's proxy policy", async () => {
  const dispatcher = new ProxyAgent("http://proxy.invalid");
  setGlobalDispatcher(dispatcher);
  const pinningFetch = vi.fn(async () => new Response("caller pin"));
  try {
    await createGuardedFetch({
      pinningFetch,
      dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
    })("https://pod.example/item");
    expect(pinningFetch).toHaveBeenCalledOnce();
  } finally {
    setGlobalDispatcher(originalDispatcher);
    await dispatcher.close();
  }
});

it("refuses a custom Agent factory even when it has the default factory's name", async () => {
  function defaultFactory(): never {
    throw new Error("custom behavior");
  }
  const dispatcher = new Agent({ factory: defaultFactory });
  setGlobalDispatcher(dispatcher);
  try {
    await expect(
      createGuardedFetch({ dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }] })(
        "https://pod.example/item",
      ),
    ).rejects.toThrow(/requireDnsPinning: false.*pinningFetch/);
    expect(transport).not.toHaveBeenCalled();
  } finally {
    setGlobalDispatcher(originalDispatcher);
    await dispatcher.close();
  }
});

it("refuses an unrecognized global dispatcher without exposing its properties", async () => {
  const dispatcher = Object.create(null);
  dispatcher.dispatch = vi.fn();
  setGlobalDispatcher(dispatcher);
  await expect(
    createGuardedFetch({ dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }] })(
      "https://pod.example/item",
    ),
  ).rejects.toThrow(/requireDnsPinning: false.*pinningFetch/);
  expect(dispatcher.dispatch).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});
