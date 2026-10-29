// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import type { guardedFetch } from "@jeswr/guarded-fetch";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { createHash } from "crypto";
// biome-ignore lint/style/useNodejsImportProtocol: agent layer uses bare builtins
import { createServer } from "http";
import { expect, it, vi } from "vitest";
import { createOriginScopedFetch } from "../src/origins.js";

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

it("checks string, URL and Request inputs and refuses redirects before forwarding credentials", async () => {
  const transport = vi.fn(async () => new Response("fixture"));
  const dnsLookup = vi.fn(async () => [{ address: "1.1.1.1", family: 4 as const }]);
  const origin = "https://allowed.example";
  const scoped = createOriginScopedFetch(new Set([origin]), { transport, dnsLookup });
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
    createOriginScopedFetch(new Set([origin]), { transport: redirect, dnsLookup })(origin, {
      redirect: "follow",
      headers: { authorization: "Bearer test-token" },
    }),
  ).rejects.toThrow();
  expect(redirect).toHaveBeenCalledTimes(1);
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
    transport,
    dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }],
  });
  expect(await (await scoped(input, init)).text()).toBe("policy fixture");
  expect(transport).toHaveBeenCalledTimes(1);
});

it("refuses same-origin and unlisted-origin redirects through the default transport", async () => {
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
    const scoped = createOriginScopedFetch(new Set([origin]), { allowLoopback: true });
    const expectedRequests: string[] = [];
    for (status of [301, 302, 303, 307, 308]) {
      for (const destination of ["same", "unlisted"]) {
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
    { transport, dnsLookup: async () => [{ address: "1.1.1.1", family: 4 }] },
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
