// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { createGuardedFetch, type guardedFetch } from "@jeswr/guarded-fetch";
import { createNodeGuardedFetch } from "@jeswr/guarded-fetch/node";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { createHash } from "crypto";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { createServer } from "http";
import { expect, it, vi } from "vitest";
import { createOriginScopedFetch, type OriginFetchOptions } from "../src/origins.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it("refuses an undeclared local origin before connecting, and permits listed loopback only in tests", async () => {
  let requests = 0;
  let cacheControl: string | undefined;
  const server = createServer((req, res) => {
    requests++;
    cacheControl = req.headers["cache-control"];
    res.end("local fixture");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no local fixture address");
  const origin = `http://127.0.0.1:${address.port}`;
  try {
    const allowed = new Set(["https://allowed.example"]);
    const scoped = createOriginScopedFetch(allowed);
    allowed.add(origin);
    await expect(scoped(`${origin}/blocked`)).rejects.toThrow("ORIGINS");
    expect(requests).toBe(0);
    await expect(createOriginScopedFetch(new Set([origin]))(origin)).rejects.toThrow();
    expect(requests).toBe(0);
    const local = createOriginScopedFetch(new Set([origin]), { allowLoopback: true });
    expect(await (await local(new URL(`${origin}/listed`), { cache: "no-store" })).text()).toBe(
      "local fixture",
    );
    expect(requests).toBe(1);
    expect(cacheControl).toBe("no-cache");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it.each([
  "keepalive",
  "no-cors",
] as const)("transports body-bearing %s requests with effective bodies and content types", async (policy) => {
  const requests: Array<{
    method: string | undefined;
    body: string;
    contentType: string | undefined;
  }> = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    requests.push({
      method: req.method,
      body: Buffer.concat(chunks).toString("utf8"),
      contentType: req.headers["content-type"],
    });
    res.end("body fixture");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no local fixture address");
    const origin = `http://127.0.0.1:${address.port}`;
    const scoped = createOriginScopedFetch(new Set([origin]), { allowLoopback: true });
    const init = {
      method: "POST",
      body: "body fixture ✓",
      keepalive: policy === "keepalive",
      mode: policy === "no-cors" ? ("no-cors" as const) : ("cors" as const),
    };
    const inputs: Array<Parameters<typeof scoped>> = [
      [origin, init],
      [new URL(origin), init],
      [new Request(origin, init)],
      [new Request(origin, { ...init, keepalive: false }), { keepalive: true }],
      [new Request(origin, { ...init, mode: "cors" }), { mode: init.mode }],
      [new Request(origin, { ...init, body: "replaced fixture" }), init],
      [origin, { ...init, keepalive: false, mode: "cors" }],
    ];
    for (const input of inputs) {
      expect(await (await scoped(...input)).text()).toBe("body fixture");
      expect(requests.at(-1)).toEqual({
        method: "POST",
        body: init.body,
        contentType: "text/plain;charset=UTF-8",
      });
    }
    const form = new URLSearchParams({ fixture: "body form ✓" });
    expect(await (await scoped(origin, { ...init, body: form })).text()).toBe("body fixture");
    expect(requests.at(-1)).toEqual({
      method: "POST",
      body: form.toString(),
      contentType: "application/x-www-form-urlencoded;charset=UTF-8",
    });
    expect(requests).toHaveLength(inputs.length + 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it.each([
  "keepalive",
  "no-cors",
] as const)("bounds buffered %s bodies and cancels overflow before transport", async (policy) => {
  const origin = "https://allowed.example";
  const cap = 1024 * 1024;
  const transport = vi.fn<typeof guardedFetch>(async (_input, init) => {
    const bytes = Buffer.from(await new Response(init?.body).arrayBuffer());
    expect(bytes.equals(Buffer.alloc(cap))).toBe(true);
    return new Response("bounded fixture");
  });
  const scoped = createOriginScopedFetch(new Set([origin]), {
    createTransport: () => transport,
    dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
  });
  const init: RequestInit = {
    method: "POST",
    keepalive: policy === "keepalive",
    mode: policy === "no-cors" ? "no-cors" : "cors",
  };
  expect(
    await (await scoped(new Request(origin, { ...init, body: new Uint8Array(cap) }))).text(),
  ).toBe("bounded fixture");
  transport.mockClear();
  // A small Blob's stream can be arbitrarily large; never trust its declared size.
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  let chunk = 0;
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>(
    {
      pull(controller) {
        if (chunk < 2) controller.enqueue(new Uint8Array(chunk++ === 0 ? cap : 1));
        else controller.close();
      },
      cancel,
    },
    { highWaterMark: 0 },
  );
  const blob = new Blob(["fixture"]);
  vi.spyOn(blob, "stream").mockReturnValue(stream);
  await expect(scoped(origin, { ...init, body: blob })).rejects.toThrow(/request body.*cap/i);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(stream.locked).toBe(false);
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  "keepalive",
  "no-cors",
] as const)("includes DNS time in the deadline while buffering a stalled %s body", async (policy) => {
  vi.useFakeTimers();
  try {
    const origin = "https://allowed.example";
    const lookupStarted = deferred<void>();
    const lookup = deferred<Array<{ address: string; family: 4 }>>();
    const reading = deferred<void>();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>(
      { pull: () => reading.resolve(), cancel },
      { highWaterMark: 0 },
    );
    const blob = new Blob(["fixture"]);
    vi.spyOn(blob, "stream").mockReturnValue(stream);
    const transport = vi.fn<typeof guardedFetch>(async () => new Response("unexpected"));
    const scoped = createOriginScopedFetch(new Set([origin]), {
      createTransport: () => transport,
      dnsLookup: () => {
        lookupStarted.resolve();
        return lookup.promise;
      },
    });
    const result = expect(
      scoped(origin, {
        method: "POST",
        body: blob,
        keepalive: policy === "keepalive",
        mode: policy === "no-cors" ? "no-cors" : "cors",
      }),
    ).rejects.toThrow(/timed out/i);
    await lookupStarted.promise;
    await vi.advanceTimersByTimeAsync(6_000);
    lookup.resolve([{ address: "1.1.1.1", family: 4 }]);
    await reading.promise;
    await vi.advanceTimersByTimeAsync(3_999);
    expect(cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(stream.locked).toBe(false);
    expect(transport).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  { policy: "keepalive", stage: "before" },
  { policy: "keepalive", stage: "during" },
  { policy: "no-cors", stage: "before" },
  { policy: "no-cors", stage: "during" },
])("cancels $policy buffering when aborted $stage reading", async ({ policy, stage }) => {
  const origin = "https://allowed.example";
  const controller = new AbortController();
  const reading = deferred<void>();
  const pull = vi.fn(() => reading.resolve());
  const cancel = vi.fn(async () => {
    throw new Error("fixture cancellation failure");
  });
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>(
    { pull, cancel },
    { highWaterMark: 0 },
  );
  const blob = new Blob(["fixture"]);
  vi.spyOn(blob, "stream").mockReturnValue(stream);
  const transport = vi.fn<typeof guardedFetch>(async () => new Response("unexpected"));
  const scoped = createOriginScopedFetch(new Set([origin]), {
    createTransport: () => transport,
    dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
  });
  if (stage === "before") controller.abort();
  const result = expect(
    scoped(origin, {
      method: "POST",
      body: blob,
      keepalive: policy === "keepalive",
      mode: policy === "no-cors" ? "no-cors" : "cors",
      signal: controller.signal,
    }),
  ).rejects.toThrow(/timed out|aborted/i);
  if (stage === "during") {
    await reading.promise;
    controller.abort();
  }
  await result;
  expect(pull).toHaveBeenCalledTimes(stage === "before" ? 0 : 1);
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(stream.locked).toBe(false);
  expect(transport).not.toHaveBeenCalled();
});

it("refuses a failed buffered body without sending a partial request", async () => {
  const origin = "https://allowed.example";
  const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.error(new Error("fixture body failure"));
    },
  });
  const blob = new Blob(["fixture"]);
  vi.spyOn(blob, "stream").mockReturnValue(stream);
  const transport = vi.fn<typeof guardedFetch>(async () => new Response("unexpected"));
  const scoped = createOriginScopedFetch(new Set([origin]), {
    createTransport: () => transport,
    dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
  });
  await expect(scoped(origin, { method: "POST", body: blob, keepalive: true })).rejects.toThrow(
    "fixture body failure",
  );
  expect(stream.locked).toBe(false);
  expect(transport).not.toHaveBeenCalled();
});

it("checks string, URL and Request inputs and refuses redirects before forwarding credentials", async () => {
  const transport = vi.fn(async () => new Response("fixture"));
  const createTransport = vi.fn<NonNullable<OriginFetchOptions["createTransport"]>>(
    () => transport,
  );
  const dnsLookup = vi.fn(async () => [{ address: "1.1.1.1", family: 4 as const }]);
  const origin = "https://allowed.example";
  const scoped = createOriginScopedFetch(new Set([origin]), { createTransport, dnsLookup });
  expect(createTransport).toHaveBeenCalledExactlyOnceWith({
    maxRedirects: 0,
    allowLoopback: false,
  });
  expect(Object.isFrozen(createTransport.mock.calls[0]?.[0])).toBe(true);
  for (const input of [origin, new URL(`${origin}/url`), new Request(`${origin}/request`)])
    expect(await (await scoped(input)).text()).toBe("fixture");
  expect(transport).toHaveBeenCalledTimes(3);
  await expect(
    scoped("https://other.example/private", { headers: { authorization: "Bearer test-token" } }),
  ).rejects.toThrow("ORIGINS");
  expect(transport).toHaveBeenCalledTimes(3);
  expect(dnsLookup).toHaveBeenCalledTimes(3);
  const redirect = vi.fn(
    async () => new Response(null, { status: 302, headers: { location: "https://other.example" } }),
  );
  await expect(
    createOriginScopedFetch(new Set([origin]), { createTransport: () => redirect, dnsLookup })(
      origin,
      {
        redirect: "follow",
        headers: { authorization: "Bearer test-token" },
      },
    ),
  ).rejects.toThrow();
  expect(redirect).toHaveBeenCalledTimes(1);
});

it.each([
  301, 302, 303, 307, 308,
])("refuses injected guard redirects (%s) before contacting the target", async (status) => {
  const origin = "https://allowed.example";
  const source = `${origin}/source`;
  const dnsLookup = vi.fn(async () => [{ address: "1.1.1.1", family: 4 as const }]);
  for (const location of [`${origin}/target`, "https://other.example/target"]) {
    const pinningFetch = vi.fn<typeof guardedFetch>(async (input) =>
      input === source
        ? new Response(null, { status, headers: { location } })
        : new Response("redirect target"),
    );
    const scoped = createOriginScopedFetch(new Set([origin]), {
      createTransport: (options) =>
        createGuardedFetch({ ...options, pinningFetch, dnsLookup, requireDnsPinning: true }),
      dnsLookup,
    });
    expect(await (await scoped(`${origin}/target`)).text()).toBe("redirect target");
    expect(pinningFetch).toHaveBeenCalledTimes(1);
    pinningFetch.mockClear();
    await expect(
      scoped(new Request(source, { redirect: "follow" }), {
        redirect: "follow",
        headers: { authorization: "Bearer test-token" },
      }),
    ).rejects.toThrow(/redirect/i);
    expect(pinningFetch).toHaveBeenCalledTimes(1);
    expect(pinningFetch.mock.calls[0]?.[0]).toBe(source);
  }
});

it("enforces effective response integrity from Request inputs and init overrides", async () => {
  const body = "local integrity fixture";
  const integrity = `sha256-${createHash("sha256").update(body).digest("base64")}`;
  const mismatch = `sha256-${createHash("sha256").update("different fixture").digest("base64")}`;
  let requests = 0;
  const server = createServer((_req, res) => {
    requests++;
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no local fixture address");
    const origin = `http://127.0.0.1:${address.port}`;
    const scoped = createOriginScopedFetch(new Set([origin]), { allowLoopback: true });
    const inputs: Array<(policy: string) => Parameters<typeof scoped>> = [
      (policy) => [origin, { integrity: policy }],
      (policy) => [new URL(origin), { integrity: policy }],
      (policy) => [new Request(origin, { integrity: policy })],
      (policy) => [new Request(origin, { integrity: mismatch }), { integrity: policy }],
    ];
    for (const input of inputs) {
      expect(await (await scoped(...input(integrity))).text()).toBe(body);
      await expect(scoped(...input(mismatch))).rejects.toThrow();
    }
    expect(
      await (await scoped(new Request(origin, { integrity: mismatch }), { integrity: "" })).text(),
    ).toBe(body);
    expect(requests).toBe(inputs.length * 2 + 1);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

it.each([
  "string",
  "URL",
  "Request",
  "partial",
  "override",
  "clear",
] as const)("preserves effective fetch policies for %s inputs", async (kind) => {
  const origin = "https://allowed.example";
  const policy: RequestInit = {
    cache: "no-store",
    mode: "same-origin",
    keepalive: true,
    referrer: "https://referrer.example/source",
    referrerPolicy: "no-referrer",
    integrity: "sha256-dGVzdA==",
    credentials: "include",
  };
  const replacement: RequestInit =
    kind === "clear"
      ? {
          cache: "default",
          mode: "cors",
          keepalive: false,
          referrer: "",
          referrerPolicy: "",
          integrity: "",
          credentials: "same-origin",
        }
      : {
          cache: "reload",
          mode: "no-cors",
          keepalive: false,
          referrer: "https://referrer.example/replacement",
          referrerPolicy: "origin",
          integrity: "sha256-b3ZlcnJpZGU=",
          credentials: "omit",
        };
  const input =
    kind === "string" ? origin : kind === "URL" ? new URL(origin) : new Request(origin, policy);
  const init =
    kind === "Request"
      ? undefined
      : kind === "partial"
        ? { cache: policy.cache, referrer: undefined, referrerPolicy: undefined }
        : kind === "override" || kind === "clear"
          ? replacement
          : policy;
  const expected = kind === "override" || kind === "clear" ? replacement : policy;
  const transport = vi.fn<typeof guardedFetch>(async (target, effectiveInit) => {
    const received = new Request(target, effectiveInit);
    expect(received).toMatchObject(expected);
    expect(received.redirect).toBe("manual");
    return new Response("policy fixture");
  });
  const scoped = createOriginScopedFetch(new Set([origin]), {
    createTransport: () => transport,
    dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
  });
  expect(await (await scoped(input, init)).text()).toBe("policy fixture");
  expect(transport).toHaveBeenCalledTimes(1);
});

it.each([
  "default",
  "injected",
] as const)("refuses same-origin and unlisted-origin redirects through the %s Node transport", async (kind) => {
  const requests: string[] = [];
  let targetRequests = 0;
  let status = 301;
  let location = "";
  const target = createServer((_req, res) => {
    targetRequests++;
    res.end("unlisted redirect target");
  });
  const source = createServer((req, res) => {
    requests.push(req.url ?? "");
    if (req.url === "/target") res.end("same-origin redirect target");
    else res.writeHead(status, { location }).end();
  });
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => source.listen(0, "127.0.0.1", resolve));
  try {
    const sourceAddress = source.address();
    const targetAddress = target.address();
    if (
      !sourceAddress ||
      typeof sourceAddress === "string" ||
      !targetAddress ||
      typeof targetAddress === "string"
    )
      throw new Error("no local fixture address");
    const origin = `http://127.0.0.1:${sourceAddress.port}`;
    const createTransport = vi.fn(createNodeGuardedFetch);
    const scoped = createOriginScopedFetch(new Set([origin]), {
      allowLoopback: true,
      createTransport: kind === "injected" ? createTransport : undefined,
    });
    if (kind === "injected")
      expect(createTransport).toHaveBeenCalledExactlyOnceWith({
        maxRedirects: 0,
        allowLoopback: true,
      });
    expect(await (await scoped(`${origin}/target`)).text()).toBe("same-origin redirect target");
    const expectedRequests: string[] = ["/target"];
    for (status of [301, 302, 303, 307, 308]) {
      for (const destination of ["unlisted", "same"]) {
        location =
          destination === "same" ? "/target" : `http://127.0.0.1:${targetAddress.port}/target`;
        const path = `/redirect-${status}-${destination}`;
        expectedRequests.push(path);
        await expect(
          scoped(`${origin}${path}`, {
            redirect: "follow",
            headers: { authorization: "Bearer test-token" },
          }),
        ).rejects.toThrow(/redirect/i);
        expect(requests).toEqual(expectedRequests);
        expect(targetRequests).toBe(0);
      }
    }
  } finally {
    await Promise.all(
      [source, target].map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
    );
  }
});

it("refuses malformed origins, userinfo, unsupported schemes and unsafe destinations", async () => {
  for (const origin of [
    "!",
    "https://allowed.example/path",
    "https://user:pass@allowed.example",
    "file://",
    "ftp://allowed.example",
    "https://allowed.example/",
    "https://allowed.example#fragment",
  ])
    expect(() => createOriginScopedFetch(new Set([origin]))).toThrow();
  const transport = vi.fn(async () => new Response("unexpected"));
  const scoped = createOriginScopedFetch(
    new Set(["https://allowed.example", "https://127.0.0.1", "http://allowed.example"]),
    {
      createTransport: () => transport,
      dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
    },
  );
  for (const input of [
    "!",
    "https://user:pass@allowed.example",
    "https://127.0.0.1",
    "http://allowed.example",
  ])
    await expect(scoped(input)).rejects.toThrow();
  expect(transport).not.toHaveBeenCalled();
});

it.each([
  "https://fixture-user:fixture-password@allowed.example/private",
  "https://fixture-user@allowed.example/private",
  "https://:fixture-password@allowed.example/private",
  new URL("https://fixture-user:fixture-password@allowed.example/private"),
  "https://fixture-user:fixture-password@ho st.example/private",
  "ht!tp://fixture-user:fixture-password@allowed.example/private",
  "//fixture-user:fixture-password@allowed.example/private",
])("sanitizes credential-bearing request URL errors (%s)", async (input) => {
  const transport = vi.fn<typeof guardedFetch>(async () => new Response("unexpected"));
  const dnsLookup = vi.fn(async () => [{ address: "1.1.1.1", family: 4 as const }]);
  const scoped = createOriginScopedFetch(new Set(["https://allowed.example"]), {
    createTransport: () => transport,
    dnsLookup,
  });
  const result = scoped(input);
  await expect(result).rejects.toThrow(/userinfo|request URL/i);
  await expect(result).rejects.not.toThrow(/fixture-user|fixture-password/);
  await expect(result).rejects.not.toHaveProperty("cause");
  expect(dnsLookup).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it("rejects URL userinfo before Request construction reads init", async () => {
  const readMethod = vi.fn(() => "POST");
  const scoped = createOriginScopedFetch(new Set(["https://allowed.example"]));
  await expect(
    scoped("https://fixture-user:fixture-password@allowed.example", {
      get method() {
        return readMethod();
      },
    }),
  ).rejects.toThrow(/userinfo/i);
  expect(readMethod).not.toHaveBeenCalled();
});

it.each([
  "string",
  "URL",
  "Request",
] as const)("sanitizes Request normalization failures for %s inputs", async (kind) => {
  const origin = "https://allowed.example";
  const input = kind === "string" ? origin : kind === "URL" ? new URL(origin) : new Request(origin);
  const transport = vi.fn<typeof guardedFetch>(async () => new Response("unexpected"));
  const dnsLookup = vi.fn(async () => [{ address: "1.1.1.1", family: 4 as const }]);
  const scoped = createOriginScopedFetch(new Set([origin]), {
    createTransport: () => transport,
    dnsLookup,
  });
  const result = scoped(input, {
    referrer: "ht!tp://fixture-user:fixture-password@referrer.example/private",
  });
  await expect(result).rejects.toThrow("invalid binding request");
  await expect(result).rejects.not.toThrow(/fixture-user|fixture-password/);
  await expect(result).rejects.not.toHaveProperty("cause");
  expect(dnsLookup).not.toHaveBeenCalled();
  expect(transport).not.toHaveBeenCalled();
});

it("sanitizes malformed binding origin errors", () => {
  expect(() =>
    createOriginScopedFetch(new Set(["https://fixture-user:fixture-password@ho st.example"])),
  ).toThrow("invalid binding origin");
  expect(() =>
    createOriginScopedFetch(new Set(["https://fixture-user:fixture-password@ho st.example"])),
  ).not.toThrow(/fixture-user|fixture-password/);
});
