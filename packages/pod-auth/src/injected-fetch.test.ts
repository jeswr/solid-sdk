// AUTHORED-BY Claude Sonnet 5.5
import { afterEach, expect, test, vi } from "vitest";
import { createAccountManager } from "./accounts.js";
import {
  createPodAuth,
  InjectedFetchError,
  InvalidInjectedResponseError,
  type PodAuthOptions,
} from "./index.js";
import { injectedFetchFailure, isPublicRequest, MAX_SUPPLIED_BYTES } from "./injected-fetch.js";
import { createMemoryStore, createMockOp } from "./testing.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The host's own typed refusal, as an origin gate would throw it. */
class OriginNotApproved extends Error {
  constructor(readonly origin: string) {
    super("origin not approved");
  }
}

interface Seen {
  url: string;
  method: string;
  credentials: RequestCredentials;
  redirect: RequestRedirect;
  headers: Record<string, string>;
  body: string;
}
const record = async (request: Request): Promise<Seen> => ({
  url: request.url,
  method: request.method,
  credentials: request.credentials,
  redirect: request.redirect,
  headers: Object.fromEntries(request.headers),
  body: await request.clone().text(),
});

function fixture(
  config: Parameters<typeof createMockOp>[0] = {},
  extra: Partial<PodAuthOptions> = {},
  tamper?: (request: Request) => Response | undefined,
  idTokenOnRefresh = false,
) {
  const op = createMockOp({ refreshTokens: true, ...config });
  const blocked = new Set<string>();
  const injected: Seen[] = [];
  const global: Seen[] = [];
  let idToken: string | undefined;
  const route = async (request: Request) => {
    const hijack = tamper?.(request);
    if (hijack !== undefined) return hijack;
    if (!idTokenOnRefresh || request.method !== "POST" || !request.url.includes("/token"))
      return await op.fetch(request);
    // Many OPs return an ID token from a refresh grant; the mock does not, so replay the login's.
    const form = new URLSearchParams(await request.clone().text());
    const response = await op.fetch(request);
    if (form.get("grant_type") !== "refresh_token") {
      idToken = ((await response.clone().json()) as { id_token?: string }).id_token;
      return response;
    }
    return Response.json({ ...(await response.json()), id_token: idToken });
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    global.push(await record(request));
    return await route(request);
  });
  const gate = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    injected.push(await record(request));
    const origin = new URL(request.url).origin;
    if (blocked.has(origin)) throw new OriginNotApproved(origin);
    return await route(request);
  });
  const sessions = createMemoryStore();
  const caches = createMemoryStore();
  const options: PodAuthOptions = {
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    storage: { sessions, caches },
    boundary: { roots: [op.root] },
    ui: { getWebId: vi.fn(async () => op.webId!), getCode: vi.fn(op.getCode) },
    fetch: gate,
    ...extra,
  };
  return {
    op,
    options,
    blocked,
    injected,
    global,
    gate,
    load: (override: Partial<PodAuthOptions> = {}) => createPodAuth({ ...options, ...override }),
  };
}

test("without the option every request uses the global transport, as before", async () => {
  const f = fixture({}, { fetch: undefined });
  await f.load().login({ issuer: f.op.issuer });
  expect(f.gate).not.toHaveBeenCalled();
  expect(f.global.some((r) => r.url.startsWith("https://id.example/"))).toBe(true);
});

test("the supplied fetch receives only unauthenticated reads and never a credential", async () => {
  const f = fixture();
  const auth = f.load();
  await auth.login({ issuer: f.op.issuer });
  expect((await auth.fetch(f.op.root + "private")).status).toBe(200);
  const urls = f.injected.map((r) => r.url);
  // Issuer discovery, the Client Identifier Document and the WebID profile (verification and learning).
  expect(urls.some((u) => u.startsWith("https://op.example/.well-known/"))).toBe(true);
  expect(urls).toContain(f.op.clientId);
  expect(urls.filter((u) => u.startsWith("https://id.example/")).length).toBeGreaterThan(0);
  for (const request of f.injected) {
    expect(["GET", "HEAD"]).toContain(request.method);
    expect(request.body).toBe("");
    for (const name of ["authorization", "dpop", "cookie", "proxy-authorization"])
      expect(request.headers).not.toHaveProperty(name);
    // Reads carry no query at all, so no code, state or token can ride in a URL.
    expect(new URL(request.url).search).toBe("");
    expect(request.credentials).toBe("omit");
  }
  // Token exchange and every pod request stay on the default transport.
  expect(urls.some((u) => u.startsWith("https://op.example/token"))).toBe(false);
  expect(urls.some((u) => u.startsWith(f.op.root))).toBe(false);
  const posts = f.global.filter((r) => r.method === "POST");
  expect(posts.length).toBeGreaterThan(0);
  expect(posts.some((r) => r.body.includes("code_verifier"))).toBe(true);
  expect(posts.some((r) => "dpop" in r.headers)).toBe(true);
  expect(f.global.some((r) => r.headers.authorization !== undefined)).toBe(true);
  const supplied = JSON.stringify(f.injected);
  expect(supplied).not.toContain("code_verifier");
  expect(supplied).not.toContain("DPoP");
});

test("a refusal surfaces as InjectedFetchError carrying the unchanged cause and no URL", async () => {
  for (const hint of [
    { issuer: "https://op.example/" },
    { webId: "https://id.example/alice#me" },
  ]) {
    const f = fixture();
    f.blocked.add("https://id.example");
    const auth = f.load();
    const failure = await auth.login(hint).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InjectedFetchError);
    const cause = (failure as InjectedFetchError).cause;
    expect(cause).toBeInstanceOf(OriginNotApproved);
    expect((cause as OriginNotApproved).origin).toBe("https://id.example");
    expect((failure as Error).message).not.toMatch(/example|https?:/);
    expect(await auth.identity()).toBeNull();
  }
});

test("a synchronously throwing transport is treated the same way", async () => {
  const boom = new Error("sync");
  const f = fixture(
    {},
    {
      fetch: () => {
        throw boom;
      },
    },
  );
  const failure = await f
    .load()
    .login({ issuer: f.op.issuer })
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(InjectedFetchError);
  expect((failure as InjectedFetchError).cause).toBe(boom);
});

test("a refused learn step after login keeps the failure typed", async () => {
  const f = fixture();
  const auth = f.load();
  // Verification passes (id.example allowed), then only the storage learning is gated.
  let calls = 0;
  const gated = f.gate.getMockImplementation()!;
  f.gate.mockImplementation(async (input, init) => {
    if (new Request(input, init).url.startsWith("https://id.example/") && ++calls > 1)
      throw new OriginNotApproved("https://id.example");
    return await gated(input, init);
  });
  const failure = await auth.login({ issuer: f.op.issuer }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(InjectedFetchError);
  expect(await auth.identity()).toBeNull();
});

test.each([
  // With the login's ID token replayed on refresh, a restore reads the WebID twice: the engine's issuer
  // verification first, then the boundary's storage discovery. Each row refuses exactly one of them.
  [1, "the engine's issuer verification"],
  [2, "the boundary's storage discovery"],
])("restore keeps the stored session when read %i of the WebID (%s) is refused, and succeeds once allowed", async (refused) => {
  const f = fixture({}, {}, undefined, true);
  await f.load().login({ issuer: f.op.issuer });
  const authorizations = f.op.stats.authorizations;
  const gated = f.gate.getMockImplementation()!;
  let reads = 0;
  f.gate.mockImplementation(async (input, init) => {
    if (new Request(input, init).url.startsWith("https://id.example/") && ++reads === refused)
      throw new OriginNotApproved("https://id.example");
    return await gated(input, init);
  });
  const rebuilt = f.load();
  const failure = await rebuilt.restore().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(InjectedFetchError);
  expect((failure as InjectedFetchError).cause).toBeInstanceOf(OriginNotApproved);
  expect(reads).toBe(refused);
  expect(await rebuilt.remembered()).toEqual([{ webId: f.op.webId, issuer: f.op.issuer }]);
  expect(await rebuilt.identity()).toBeNull();
  reads = -10;
  const again = f.load();
  expect((await again.restore())?.webId).toBe(f.op.webId);
  expect(f.op.stats.authorizations).toBe(authorizations);
  expect((await again.fetch(f.op.root + "private")).status).toBe(200);
});

test("a session dropped for a dead grant is reported as null, not as a refusal", async () => {
  const f = fixture();
  await f.load().login({ issuer: f.op.issuer });
  f.op.failRefresh("invalid_grant");
  f.blocked.add("https://app.example");
  const rebuilt = f.load();
  expect(await rebuilt.restore()).toBeNull();
  expect(await rebuilt.remembered()).toEqual([]);
});

test("restore after an unrelated transport failure still returns null as before", async () => {
  const f = fixture();
  await f.load().login({ issuer: f.op.issuer });
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline");
  });
  const rebuilt = f.load({ fetch: undefined });
  expect(await rebuilt.restore()).toBeNull();
  expect(await rebuilt.remembered()).toHaveLength(1);
});

test.each([
  ["supplied", true],
  ["global", false],
] as const)("a genuine verification failure on restore behaves identically (%s transport)", async (_name, useSupplied) => {
  let lying = false;
  const lie = (request: Request) =>
    lying && request.url.startsWith("https://id.example/")
      ? new Response(
          "<https://id.example/alice#me> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://evil.example/> .",
          { headers: { "content-type": "text/turtle" } },
        )
      : undefined;
  const f = fixture({}, useSupplied ? {} : { fetch: undefined }, lie, true);
  await f.load().login({ issuer: f.op.issuer });
  lying = true;
  const rebuilt = f.load();
  const failure = await rebuilt.restore().catch((error: unknown) => error);
  expect(failure).not.toBeInstanceOf(InjectedFetchError);
  expect(failure).toBeNull();
  expect(await rebuilt.identity()).toBeNull();
  const remembered = await rebuilt.remembered();
  expect(remembered).toHaveLength(1);
  expect(f.gate.mock.calls.length > 0).toBe(useSupplied);
});

test("pod-auth's own guards still run: a redirect to HTTP is refused before it is requested", async () => {
  const f = fixture({}, {}, (request) =>
    request.url.startsWith("https://id.example/")
      ? new Response(null, { status: 302, headers: { location: "http://evil.example/profile" } })
      : undefined,
  );
  const failure = await f
    .load()
    .login({ issuer: f.op.issuer })
    .catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(InjectedFetchError);
  expect(f.injected.some((r) => r.url.startsWith("http://"))).toBe(false);
});

test("a cancelled attempt reports the abort reason, not the transport error", async () => {
  const f = fixture();
  const reason = new Error("cancelled by the user");
  f.gate.mockImplementation(
    (input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const { signal } = new Request(input, init);
        signal.addEventListener("abort", () => reject(signal.reason));
      }),
  );
  const controller = new AbortController();
  const login = f.load().login({ issuer: f.op.issuer }, { signal: controller.signal });
  await vi.waitFor(() => expect(f.gate).toHaveBeenCalled());
  controller.abort(reason);
  await expect(login).rejects.toBe(reason);
});

test("the option is validated", () => {
  const f = fixture();
  expect(() => f.load({ fetch: "nope" as never })).toThrow("fetch must be a function");
  expect(() => f.load({ lws: { subject: { cid: { documentUrl: "", keyId: "" } } } })).toThrow(
    "fetch is not supported with a CID agent subject",
  );
});

test("issuer-only login refused at verification is retried after approval with a second authorization", async () => {
  const f = fixture();
  f.blocked.add("https://id.example");
  const auth = f.load();
  await expect(auth.login({ issuer: f.op.issuer })).rejects.toBeInstanceOf(InjectedFetchError);
  expect(await auth.remembered()).toEqual([]);
  f.blocked.clear();
  expect((await auth.login({ issuer: f.op.issuer })).webId).toBe(f.op.webId);
  expect(f.op.stats.authorizations).toBe(2);
});

test("a WebID-hinted login lets the host allow the WebID origin before authenticating", async () => {
  const f = fixture();
  f.blocked.add("https://id.example");
  const auth = f.load();
  await expect(auth.login({ webId: f.op.webId! })).rejects.toBeInstanceOf(InjectedFetchError);
  // Discovery stopped the attempt before any authorization request reached the OP.
  expect(f.op.stats.authorizations).toBe(0);
  f.blocked.clear();
  expect((await auth.login({ webId: f.op.webId! })).webId).toBe(f.op.webId);
  expect(f.op.stats.authorizations).toBe(1);
});

const chain = (error: unknown, type: new (...args: never[]) => Error): boolean => {
  for (let depth = 0; depth < 8 && error instanceof Error; depth++, error = error.cause)
    if (error instanceof type) return true;
  return false;
};
const withUrl = (response: Response, url: string, redirected = false) =>
  Object.defineProperties(response, { url: { value: url }, redirected: { value: redirected } });

/** Replace what the gate returns for the first matching request. */
function substitute(
  f: ReturnType<typeof fixture>,
  match: (request: Request) => boolean,
  make: (request: Request) => unknown,
) {
  const gated = f.gate.getMockImplementation()!;
  f.gate.mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (!match(request)) return await gated(input, init);
    f.injected.push(await record(request));
    return make(request) as Response;
  });
}
const discovery = (request: Request) => request.url.startsWith("https://op.example/.well-known/");

test("a redirected discovery response cannot steer the token endpoint (regression)", async () => {
  const f = fixture();
  substitute(f, discovery, () =>
    withUrl(
      Response.json({
        issuer: "https://op.example/",
        token_endpoint: "https://evil.example/token",
      }),
      "https://evil.example/meta",
      true,
    ),
  );
  const failure = await f
    .load()
    .login({ issuer: f.op.issuer })
    .catch((error: unknown) => error);
  expect(chain(failure, InvalidInjectedResponseError)).toBe(true);
  expect([...f.global, ...f.injected].some((r) => r.url.startsWith("https://evil.example"))).toBe(
    false,
  );
});

test.each([
  [
    "a foreign final URL without the redirected flag",
    () => withUrl(Response.json({}), "https://evil.example/x"),
  ],
  ["an unparsable final URL", () => withUrl(Response.json({}), "not a url")],
  ["a non-Response", () => ({ ok: true })],
])("a response that is %s is rejected", async (_name, make) => {
  const f = fixture();
  substitute(f, discovery, make);
  const failure = await f
    .load()
    .login({ issuer: f.op.issuer })
    .catch((error: unknown) => error);
  expect(chain(failure, InvalidInjectedResponseError)).toBe(true);
  expect(failure).not.toBeInstanceOf(InjectedFetchError);
});

test("a redirect the request asked to follow is accepted, and its final URL is kept", async () => {
  const f = fixture();
  substitute(
    f,
    (request) => request.url === "https://id.example/alice" && request.method === "GET",
    (request) => {
      if (request.redirect !== "follow") {
        // A browser hides a manual redirect behind an opaque response and pod-auth re-issues it.
        return Object.defineProperty(new Response(null), "type", { value: "opaqueredirect" });
      }
      return withUrl(
        new Response(
          "<https://id.example/alice#me> <http://www.w3.org/ns/solid/terms#oidcIssuer> <https://op.example/> .",
          { headers: { "content-type": "text/turtle" } },
        ),
        "https://id.example/alice",
        true,
      );
    },
  );
  expect((await f.load().login({ webId: f.op.webId! })).webId).toBe(f.op.webId);
  expect(f.injected.some((r) => r.redirect === "follow")).toBe(true);
});

test.each([
  [
    "a declared length",
    () => new Response("x", { headers: { "content-length": String(MAX_SUPPLIED_BYTES + 1) } }),
  ],
  ["a streamed body", () => new Response(new Uint8Array(MAX_SUPPLIED_BYTES + 1))],
])("an oversized document (%s) is rejected", async (_name, make) => {
  const f = fixture();
  substitute(f, discovery, make);
  const failure = await f
    .load()
    .login({ issuer: f.op.issuer })
    .catch((error: unknown) => error);
  expect(chain(failure, InvalidInjectedResponseError)).toBe(true);
});

test("a body that fails mid-stream, or outlives the attempt, rejects the read", async () => {
  const f = fixture();
  const broken = new Error("stream failed");
  substitute(
    f,
    discovery,
    () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.error(broken);
          },
        }),
      ),
  );
  expect(
    chain(
      await f
        .load()
        .login({ issuer: f.op.issuer })
        .catch((e: unknown) => e),
      Error,
    ),
  ).toBe(true);
  const controller = new AbortController();
  const reason = new Error("stop");
  substitute(
    f,
    discovery,
    () =>
      new Response(
        new ReadableStream({
          pull(stream) {
            controller.abort(reason);
            stream.enqueue(new TextEncoder().encode("{}"));
          },
        }),
      ),
  );
  await expect(f.load().login({ issuer: f.op.issuer }, { signal: controller.signal })).rejects.toBe(
    reason,
  );
});

test("every request handed over is credential-free, whatever the engine asked for", async () => {
  const f = fixture();
  await f.load().login({ issuer: f.op.issuer });
  expect(f.injected.length).toBeGreaterThan(0);
  expect(f.injected.every((r) => r.credentials === "omit")).toBe(true);
});

test("classification does not read Request.body and fails closed for anything but GET/HEAD", () => {
  const headers = (init: Record<string, string> = {}) => new Headers(init);
  const bodiless = (method: string, init?: Record<string, string>) =>
    ({ method, headers: headers(init) }) as unknown as Request;
  expect(isPublicRequest(bodiless("GET"))).toBe(true);
  expect(isPublicRequest(bodiless("HEAD"))).toBe(true);
  expect(isPublicRequest(bodiless("POST"))).toBe(false);
  expect(isPublicRequest(bodiless("GET", { DPoP: "x" }))).toBe(false);
  expect(isPublicRequest(bodiless("GET", { Cookie: "a=b" }))).toBe(false);
});

test("injectedFetchFailure finds a refusal in causes and aggregates, and stops on cycles", () => {
  const refusal = new InjectedFetchError(new Error("no"));
  expect(injectedFetchFailure(new Error("outer", { cause: refusal }))).toBe(refusal);
  expect(injectedFetchFailure(new AggregateError([new Error("a"), refusal]))).toBe(refusal);
  expect(injectedFetchFailure(new AggregateError([new Error("a")]))).toBeUndefined();
  expect(injectedFetchFailure("text")).toBeUndefined();
  const loop = new Error("loop");
  loop.cause = loop;
  expect(injectedFetchFailure(loop)).toBeUndefined();
});

test("a rejection after the attempt's own timeout is still the host's refusal; its own reason passes", async () => {
  const f = fixture();
  const controller = new AbortController();
  f.gate.mockImplementation(
    (input, init) =>
      new Promise<Response>((_resolve, reject) => {
        const { signal } = new Request(input, init);
        // A host that finishes prompting only after the attempt was cut short, then refuses.
        signal.addEventListener("abort", () =>
          setTimeout(() => reject(new OriginNotApproved("late")), 0),
        );
      }),
  );
  const login = f.load().login({ issuer: f.op.issuer }, { signal: controller.signal });
  await vi.waitFor(() => expect(f.gate).toHaveBeenCalled());
  controller.abort(new Error("timed out"));
  const failure = await login.catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(InjectedFetchError);
  expect((failure as InjectedFetchError).cause).toBeInstanceOf(OriginNotApproved);
});

const descriptionFixture = (blockedPods: (request: Request) => boolean) => {
  const f = fixture({ storages: ["https://pod.example/storage"] }, { boundary: {} });
  const gated = f.gate.getMockImplementation()!;
  f.gate.mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url.startsWith("https://pod.example/") && blockedPods(request)) {
      f.injected.push(await record(request));
      throw new OriginNotApproved("https://pod.example");
    }
    return await gated(input, init);
  });
  return f;
};

test.each([
  ["description GET", (request: Request) => request.method === "GET"],
  ["confirming HEAD", (request: Request) => request.method === "HEAD"],
])("a refused storage %s fails login typed and the WebID is retried once allowed", async (_name, refuse) => {
  let refusing = true;
  const f = descriptionFixture((request) => refusing && refuse(request));
  const auth = f.load();
  const failure = await auth.login({ issuer: f.op.issuer }).catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(InjectedFetchError);
  expect((failure as InjectedFetchError).cause).toBeInstanceOf(OriginNotApproved);
  expect(await auth.identity()).toBeNull();
  expect(f.injected.some((r) => r.url === "https://pod.example/storage")).toBe(true);
  refusing = false;
  const identity = await auth.login({ issuer: f.op.issuer });
  expect(identity.storages).toEqual(
    expect.arrayContaining(["https://pod.example/storage", f.op.root]),
  );
  expect((await auth.fetch(f.op.root + "private")).status).toBe(200);
});

test("the account manager reports a refused restore and restores once allowed", async () => {
  const f = fixture();
  const options = { ...f.options, boundary: { roots: [f.op.root] } };
  const first = createAccountManager(options);
  await first.add({ issuer: f.op.issuer });
  first.dispose();
  f.blocked.add("https://id.example");
  const second = createAccountManager(options);
  const refused = vi.fn();
  second.on("refused", refused);
  expect(await second.restoreAll()).toEqual([]);
  expect(refused).toHaveBeenCalledOnce();
  expect(refused.mock.calls[0]![0].webId).toBe(f.op.webId);
  expect(refused.mock.calls[0]![0].error).toBeInstanceOf(InjectedFetchError);
  f.blocked.clear();
  const accounts = await second.restoreAll();
  expect(accounts.map((a) => a.webId)).toEqual([f.op.webId]);
  second.dispose();
});

test("the account manager does not report other restore failures as refusals", async () => {
  const f = fixture();
  const options = { ...f.options, fetch: undefined };
  const first = createAccountManager(options);
  await first.add({ issuer: f.op.issuer });
  first.dispose();
  vi.stubGlobal("fetch", async () => {
    throw new Error("offline");
  });
  const second = createAccountManager(options);
  const refused = vi.fn();
  second.on("refused", refused);
  await second.restoreAll();
  expect(refused).not.toHaveBeenCalled();
  second.dispose();
});
