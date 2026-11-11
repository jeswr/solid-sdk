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

import { assertSafeUrl, createGuardedFetch, SsrfError } from "../src/index.js";
import { createNodeGuardedFetch } from "../src/node.js";

beforeEach(() => {
  transport.mockReset();
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
  ])(`${entry}: handles non-default global %s dispatchers according to the entry policy`, async (kind) => {
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
      for (const host of ["pod.example", "1.1.1.1"]) {
        const request = factory()(`https://${host}/item`);
        if (entry === "root")
          await expect(request).rejects.toThrow(/requireDnsPinning: false.*pinningFetch/);
        else expect((await request).status).toBe(200);
      }
      await expect(
        assertSafeUrl("https://pod.example/", {
          dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
          requireDnsPinning: true,
        }),
      ).resolves.toBeUndefined();
      expect(transport).toHaveBeenCalledTimes(entry === "root" ? 0 : 2);
    } finally {
      setGlobalDispatcher(originalDispatcher);
      await dispatcher.close();
    }
  });

  it("accepts a pristine default dispatcher (undici upgrade canary)", async () => {
    // Also check Node's bundled dispatcher after native Fetch initializes it.
    expect(await (await globalThis.fetch("data:text/plain,ok")).text()).toBe("ok");
    expect((await factory()("https://pod.example/item")).status).toBe(200);
    const dispatcher = new Agent();
    setGlobalDispatcher(dispatcher);
    try {
      expect((await factory()("https://pod.example/item")).status).toBe(200);
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
    vi.stubEnv(name, "http://secret:credential@proxy.invalid:8080");
    expect((await factory()("https://pod.example/item")).status).toBe(200);
  });

  it.each([
    "HTTP_PROXY",
    "http_proxy",
    "HTTPS_PROXY",
    "https_proxy",
    "ALL_PROXY",
    "all_proxy",
  ])("refuses active %s for hostnames and IP literals", async (name) => {
    vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    vi.stubEnv(name, "http://secret:credential@proxy.invalid:8080");
    for (const host of ["pod.example", "1.1.1.1", "[2606:4700:4700::1111]"]) {
      await expect(factory()(`https://${host}/item`)).rejects.toThrow(
        /configured proxy|effective environment proxy/,
      );
    }
    expect(transport).not.toHaveBeenCalled();
  });

  it.each([
    "1.1.1.1:443",
    "[2606:4700:4700::1111]:443",
  ])("honours NO_PROXY=%s for IP literals", async (literal) => {
    vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    vi.stubEnv("HTTPS_PROXY", "http://proxy.invalid:8080");
    vi.stubEnv("NO_PROXY", literal);
    expect((await factory()(`https://${literal}/item`)).status).toBe(200);
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
    expect((await factory()("https://pod.example/item")).status).toBe(200);
  });

  it.each([
    "env",
    "options",
    "argv",
    "options=value",
    "argv=value",
  ])("refuses an effective proxy activated through %s before opening a socket", async (activation) => {
    vi.stubEnv("HTTP_PROXY", "http://secret:credential@proxy.invalid:8080");
    if (activation === "env") vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    else if (activation === "options") vi.stubEnv("NODE_OPTIONS", "--use-env-proxy");
    else if (activation === "options=value")
      vi.stubEnv("NODE_OPTIONS", "--max-old-space-size=64 --use-env-proxy=1");
    else
      vi.stubGlobal(
        "process",
        Object.assign(Object.create(process), {
          execArgv: [activation === "argv" ? "--use-env-proxy" : "--use-env-proxy=true"],
        }),
      );
    const count = transport.mock.calls.length;
    const error = await factory()("https://pod.example/item").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toMatch(/secret|credential/);
    expect(String(error)).toMatch(
      entry === "node" ? /Node entry.*root entry/ : /requireDnsPinning: false.*pinningFetch/,
    );
    expect(transport).toHaveBeenCalledTimes(count);
  });

  it.each([
    "*",
    "POD.EXAMPLE",
    ".example",
    "*.example",
    "other.test, pod.example",
    "other.test pod.example",
    "port",
  ])("honours NO_PROXY=%s for this target", async (exclusion) => {
    vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    vi.stubEnv("HTTP_PROXY", "http://secret:credential@proxy.invalid:8080");
    vi.stubEnv("NO_PROXY", exclusion === "port" ? "pod.example:443" : exclusion);
    expect((await factory()("https://pod.example/item")).status).toBe(200);
  });

  it.each([
    "other.test",
    "inned.test",
    "pod.example.invalid",
    "port",
  ])("does not bypass the proxy for NO_PROXY=%s", async (exclusion) => {
    vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    vi.stubEnv("HTTP_PROXY", "http://secret:credential@proxy.invalid:8080");
    vi.stubEnv("NO_PROXY", exclusion === "port" ? "pod.example:444" : exclusion);
    const count = transport.mock.calls.length;
    await expect(factory()("https://pod.example/item")).rejects.toBeInstanceOf(SsrfError);
    expect(transport).toHaveBeenCalledTimes(count);
  });

  it("honours lowercase no_proxy precedence", async () => {
    vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    vi.stubEnv("http_proxy", "http://secret:credential@proxy.invalid:8080");
    vi.stubEnv("NO_PROXY", "other.test");
    vi.stubEnv("no_proxy", "pod.example");
    expect((await factory()("https://pod.example/item")).status).toBe(200);
  });

  it("rechecks effective proxy configuration after the authority fence", async () => {
    const options = {
      dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
      resolveAll: async () => [{ address: "1.1.1.1", family: 4 }],
      beforeDispatch: () => {
        vi.stubEnv("NODE_USE_ENV_PROXY", "1");
        vi.stubEnv("HTTPS_PROXY", "http://proxy.invalid:8080");
      },
    };
    const guarded =
      entry === "node" ? createNodeGuardedFetch(options) : createGuardedFetch(options);
    await expect(guarded("https://pod.example/item")).rejects.toThrow(
      /configured proxy|effective environment proxy/,
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("rechecks NO_PROXY for each redirect target", async () => {
    vi.stubEnv("NODE_USE_ENV_PROXY", "1");
    vi.stubEnv("HTTP_PROXY", "http://secret:credential@proxy.invalid:8080");
    vi.stubEnv("NO_PROXY", "pod.example");
    transport.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "https://other.example/" },
      }),
    );
    const count = transport.mock.calls.length;
    await expect(factory()("https://pod.example/redirect")).rejects.toBeInstanceOf(SsrfError);
    expect(transport).toHaveBeenCalledTimes(count + 1);
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
