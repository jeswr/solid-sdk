// AUTHORED-BY Claude Sonnet 5.5
import { afterEach, expect, test, vi } from "vitest";
import { createPodAuth, InjectedFetchError, type PodAuthOptions } from "./index.js";
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
  headers: Record<string, string>;
  body: string;
}
const record = async (request: Request): Promise<Seen> => ({
  url: request.url,
  method: request.method,
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
    expect(request.url).not.toMatch(/code|verifier|token|state=/);
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
  [false, "the learn step"],
  [true, "the engine's issuer verification"],
])("restore with a refusing transport keeps the stored session and succeeds once allowed (%s refused: %s)", async (verify) => {
  const f = fixture({}, {}, undefined, verify);
  await f.load().login({ issuer: f.op.issuer });
  const authorizations = f.op.stats.authorizations;
  f.blocked.add("https://id.example");
  const rebuilt = f.load();
  const failure = await rebuilt.restore().catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(InjectedFetchError);
  expect((failure as InjectedFetchError).cause).toBeInstanceOf(OriginNotApproved);
  expect(await rebuilt.remembered()).toEqual([{ webId: f.op.webId, issuer: f.op.issuer }]);
  expect(await rebuilt.identity()).toBeNull();
  f.blocked.clear();
  const again = f.load();
  expect((await again.restore())?.webId).toBe(f.op.webId);
  expect(f.op.stats.authorizations).toBe(authorizations);
  expect((await again.fetch(f.op.root + "private")).status).toBe(200);
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
