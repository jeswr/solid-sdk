// AUTHORED-BY Claude Opus 5.5
import { afterEach, expect, test, vi } from "vitest";
import { createBoundary } from "./boundary.js";
import {
  type AuthEvent,
  createPodAuth,
  type PodAuthOptions,
  type ResourceGrant,
  ResourceGrantError,
  withinResourceGrants,
} from "./index.js";
import { createMemoryStore, createMockOp } from "./testing.js";

const shared = "https://alice.example/shared/";
const sibling = "https://alice.example/shared-evil/";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function fixture(
  config: Parameters<typeof createMockOp>[0] = {},
  extra: Partial<PodAuthOptions> = {},
  route?: (request: Request) => Promise<Response> | undefined,
) {
  const op = createMockOp({
    protectedUrls: [shared, sibling, "https://alice.example/note", "https://op.example/bob/"],
    ...config,
  });
  const requests: Request[] = [];
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    requests.push(request.clone());
    return route?.(request) ?? op.fetch(request);
  });
  const ui = { getWebId: vi.fn(async () => op.webId!), getCode: vi.fn(op.getCode) };
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    ui,
    clock: () => 1_000,
    ...extra,
  });
  const credentialed = (prefix: string) =>
    requests.filter((r) => r.url.startsWith(prefix) && r.headers.has("authorization"));
  return { op, ui, auth, requests, credentialed };
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(ResourceGrantError);
  return (error as ResourceGrantError).reason;
}

test("without a grant a foreign storage never receives credentials", async () => {
  const f = fixture();
  await f.auth.login();
  expect((await f.auth.fetch(`${shared}budget`)).status).toBe(401);
  expect(f.credentialed("https://alice.example/")).toHaveLength(0);
  expect(f.auth.grants!()).toEqual([]);
  expect(f.auth.isWithinGrantedScope!(`${shared}budget`)).toBe(false);
});

test("a container grant authorizes reads and writes inside it with the login session only", async () => {
  const f = fixture();
  await f.auth.login();
  const events: AuthEvent[] = [];
  f.auth.on("grants", (event) => events.push(event));
  const grant = await f.auth.grantResource!(shared);
  expect(grant).toEqual({ root: shared, origin: "https://alice.example", created: 1_000 });
  expect(Object.isFrozen(grant)).toBe(true);
  expect(events).toHaveLength(1);
  expect(events[0]!.grants).toEqual([grant]);
  expect(events[0]!.identity?.webId).toBe(f.op.webId);

  expect((await f.auth.fetch(`${shared}budget/workbook.json`)).status).toBe(200);
  const put = await f.auth.fetch(`${shared}room/messages.ttl`, {
    method: "PUT",
    headers: { "content-type": "text/turtle", "if-match": '"1"' },
    body: "<#a> <#b> <#c> .",
  });
  expect(put.status).toBe(200);
  const patch = await f.auth.fetch(`${shared}room/`, {
    method: "PATCH",
    headers: { "content-type": "application/sparql-update" },
    body: "INSERT DATA { <#a> <#b> <#c> . }",
  });
  expect(patch.status).toBe(200);
  // One authorization: the grant shares the account's session instead of asking again.
  expect(f.ui.getCode).toHaveBeenCalledTimes(1);
  expect(f.op.stats.authorizations).toBe(1);
  expect(f.credentialed(shared).map((r) => r.method)).toEqual(["GET", "PUT", "PATCH"]);

  // A sibling sharing a prefix, the parent and another origin stay uncredentialed.
  expect((await f.auth.fetch(`${sibling}x`)).status).toBe(401);
  expect((await f.auth.fetch("https://alice.example/")).status).toBe(401);
  expect((await f.auth.fetch("https://alice.example/shared")).status).toBe(401);
  expect(f.credentialed(sibling)).toHaveLength(0);
  expect(f.credentialed("https://alice.example/").every((r) => r.url.startsWith(shared))).toBe(
    true,
  );
  // The grant is not a storage.
  expect((await f.auth.identity())?.storages).toEqual([f.op.root]);
  expect(f.auth.grants!()).toEqual([grant]);
  expect(f.auth.isWithinGrantedScope!(`${shared}a/b`)).toBe(true);
  expect(f.auth.isWithinGrantedScope!(new URL(`${shared}a?b#c`))).toBe(true);
  expect(f.auth.isWithinGrantedScope!(`${sibling}a`)).toBe(false);
  expect(f.auth.isWithinGrantedScope!(`${shared}%2e%2e/x`)).toBe(false);
  expect(f.auth.isWithinGrantedScope!("not a url")).toBe(false);
  expect(f.auth.isWithinGrantedScope!(f.op.root)).toBe(false);
});

test("granting a covered URL again returns the covering grant without an event", async () => {
  const f = fixture();
  await f.auth.login();
  const grant = await f.auth.grantResource!(shared);
  const listener = vi.fn();
  f.auth.on("grants", listener);
  expect(await f.auth.grantResource!(shared)).toBe(grant);
  expect(await f.auth.grantResource!(`${shared}nested/`)).toBe(grant);
  expect(await f.auth.grantResource!(`${shared}nested/file`)).toBe(grant);
  expect(listener).not.toHaveBeenCalled();
  expect(f.auth.grants!()).toHaveLength(1);
});

test("an exact resource grant covers only that resource, ignoring its query", async () => {
  const f = fixture();
  await f.auth.login();
  await f.auth.grantResource!("https://alice.example/note");
  expect((await f.auth.fetch("https://alice.example/note?v=2")).status).toBe(200);
  expect((await f.auth.fetch("https://alice.example/note/child")).status).toBe(401);
  expect((await f.auth.fetch("https://alice.example/notes")).status).toBe(401);
  expect(f.credentialed("https://alice.example/").map((r) => r.url)).toEqual([
    "https://alice.example/note?v=2",
  ]);
});

test("revoking ends credentials on the next request and notifies observers", async () => {
  const f = fixture();
  await f.auth.login();
  const grant = await f.auth.grantResource!(shared);
  await f.auth.grantResource!("https://alice.example/note");
  const events: AuthEvent[] = [];
  f.auth.on("grants", (event) => events.push(event));
  expect(f.auth.revokeResource!(grant)).toBe(true);
  expect(f.auth.revokeResource!(grant)).toBe(false);
  expect(f.auth.revokeResource!("https://unknown.example/")).toBe(false);
  expect(events).toHaveLength(1);
  expect(events[0]!.grants!.map((g) => g.root)).toEqual(["https://alice.example/note"]);
  expect(f.auth.isWithinGrantedScope!(`${shared}x`)).toBe(false);
  expect((await f.auth.fetch(`${shared}x`)).status).toBe(401);
  expect(f.credentialed(shared)).toHaveLength(0);
  expect(f.auth.revokeResource!("https://alice.example/note")).toBe(true);
  expect(f.auth.grants!()).toEqual([]);
});

test("grants end at logout and dispose, with a grants event", async () => {
  const f = fixture();
  await f.auth.login();
  await f.auth.grantResource!(shared);
  const events: AuthEvent[] = [];
  f.auth.on("grants", (event) => events.push(event));
  await f.auth.logout();
  expect(events.map((e) => e.grants)).toEqual([[]]);
  expect(f.auth.grants!()).toEqual([]);
  expect(await refusal(f.auth.grantResource!(shared))).toBe("signed-out");
  await f.auth.login();
  expect((await f.auth.fetch(`${shared}x`)).status).toBe(401);
  await f.auth.grantResource!(shared);
  f.auth.dispose!();
  expect(f.auth.grants!()).toEqual([]);
  await expect(f.auth.grantResource!(shared)).rejects.toThrow("disposed");
});

test("grants belong to one account's core", async () => {
  const f = fixture();
  const other = createPodAuth({
    clientId: f.op.clientId,
    redirectUri: f.op.redirectUri,
    ui: f.ui,
    sessionScope: "second",
  });
  await f.auth.login();
  await other.login();
  await f.auth.grantResource!(shared);
  expect(other.grants!()).toEqual([]);
  expect(other.isWithinGrantedScope!(`${shared}x`)).toBe(false);
  const before = f.credentialed(shared).length;
  expect((await other.fetch(`${shared}x`)).status).toBe(401);
  expect(f.credentialed(shared)).toHaveLength(before);
  // Without a configured clock the grant is stamped with the current time.
  const own = await other.grantResource!("https://alice.example/note");
  expect(own.created).toBeGreaterThan(1_000);
  expect(f.auth.grants!().map((g) => g.root)).toEqual([shared]);
});

test("a grant reuses a session first established reactively through a non-first root", async () => {
  const f = fixture(
    { storages: [] },
    { boundary: { roots: ["https://first.example/", "https://pod.example/alice/"] } },
  );
  // No explicit login: the second configured root's 401 signs the user in.
  expect((await f.auth.fetch("https://pod.example/alice/private")).status).toBe(200);
  expect(f.ui.getCode).toHaveBeenCalledTimes(1);
  await f.auth.grantResource!(shared);
  expect((await f.auth.fetch(`${shared}a`)).status).toBe(200);
  // A granted upgrade never replaces the established session, so the next grant reuses it too.
  await f.auth.grantResource!("https://alice.example/note");
  expect((await f.auth.fetch("https://alice.example/note")).status).toBe(200);
  expect((await f.auth.fetch("https://pod.example/alice/other")).status).toBe(200);
  expect(f.ui.getCode).toHaveBeenCalledTimes(1);
  expect(f.op.stats.authorizations).toBe(1);
});

test("grants() snapshots are frozen and cannot alter policy", async () => {
  const f = fixture();
  await f.auth.login();
  const fake = { root: "https://evil.example/x/", origin: "https://evil.example", created: 0 };
  const initial = f.auth.grants!() as ResourceGrant[];
  expect(() => initial.push(fake)).toThrow(TypeError);
  await f.auth.grantResource!(shared);
  const later = f.auth.grants!() as ResourceGrant[];
  expect(() => later.push(fake)).toThrow(TypeError);
  expect(() => {
    (later[0] as { root: string }).root = "https://evil.example/";
  }).toThrow(TypeError);
  await f.auth.grantResource!("https://alice.example/note");
  expect(f.auth.grants!().map((g) => g.root)).toEqual([shared, "https://alice.example/note"]);
  expect(f.auth.isWithinGrantedScope!("https://evil.example/x/y")).toBe(false);
  expect((await f.auth.fetch("https://evil.example/x/y")).status).toBe(401);
  expect(f.credentialed("https://evil.example/")).toHaveLength(0);
});

test("a grant needs a signed-in account", async () => {
  const f = fixture();
  expect(await refusal(f.auth.grantResource!(shared))).toBe("signed-out");
  expect(f.requests).toHaveLength(0);
});

test.each([
  ["http://alice.example/shared/"],
  ["https://alice.example/shared/?q=1"],
  ["https://alice.example/shared/?"],
  ["https://alice.example/shared/#frag"],
  ["https://user:pw@alice.example/shared/"],
  ["https://alice.example/a/../shared/"],
  ["https://alice.example/./shared/"],
  ["https://ALICE.example/shared/"],
  ["https://alice.example:443/shared/"],
  ["https://alice.example\\shared/"],
  ["https://alice.example/a%2Fb/"],
  ["https://alice.example/a%2e%2e/"],
  ["https://alice.example/a%5Cb/"],
  ["https://alice.example//shared/"],
  ["https://alice.example/a//b/"],
  ["alice.example/shared/"],
  ["/shared/"],
  [""],
  ["javascript:alert(1)"],
  ["ftp://alice.example/shared/"],
  [42 as unknown as string],
])("malformed or ambiguous grant %s is refused before any network", async (url) => {
  const f = fixture();
  await f.auth.login();
  const before = f.requests.length;
  expect(await refusal(f.auth.grantResource!(url))).toBe("invalid-url");
  expect(f.requests).toHaveLength(before);
  expect(f.auth.grants!()).toEqual([]);
});

test.each([
  ["https://alice.example/"],
  ["https://alice.example"],
])("an origin-wide grant %s is refused", async (url) => {
  const f = fixture();
  await f.auth.login();
  const reason = await refusal(f.auth.grantResource!(url));
  // "https://alice.example" normalizes to a trailing slash, so it is not canonical.
  expect(reason).toBe(url.endsWith("/") ? "origin-wide" : "invalid-url");
});

test.each([
  ["https://pod.example/alice/"],
  ["https://pod.example/alice/notes/"],
  ["https://pod.example/alice/notes/a"],
])("the account's own storage %s needs no grant", async (url) => {
  const f = fixture();
  await f.auth.login();
  expect(await refusal(f.auth.grantResource!(url))).toBe("own-storage");
});

test("a grant cannot contain the account's own storage or a storage endpoint", async () => {
  const f = fixture(
    { storages: ["https://pod.example/users/alice/"], protectedUrls: [] },
    { boundary: { storageEndpoints: ["/account/domains"] } },
  );
  await f.auth.login();
  expect(await refusal(f.auth.grantResource!("https://pod.example/users/"))).toBe("own-storage");
  expect(await refusal(f.auth.grantResource!("https://pod.example/account/"))).toBe("own-storage");
  // A sibling user's container on the same server is someone else's storage.
  const grant = await f.auth.grantResource!("https://pod.example/users/bob/");
  expect(grant.root).toBe("https://pod.example/users/bob/");
});

test.each([
  ["https://op.example/token"],
  ["https://op.example/jwks"],
  ["https://op.example/authorize"],
  ["https://op.example/.well-known/"],
  ["https://op.example/.account/"],
  ["https://op.example/.oidc/"],
])("identity-provider endpoint %s is refused", async (url) => {
  const f = fixture();
  await f.auth.login();
  expect(await refusal(f.auth.grantResource!(url))).toBe("protocol-endpoint");
  expect(f.auth.grants!()).toEqual([]);
});

test("an issuer with a path refuses any grant containing it or its endpoints", async () => {
  const issuer = "https://idp.example/realms/x/";
  const f = fixture({ issuer, protectedUrls: [] });
  await f.auth.login();
  expect(await refusal(f.auth.grantResource!("https://idp.example/realms/"))).toBe(
    "protocol-endpoint",
  );
  expect(await refusal(f.auth.grantResource!("https://idp.example/realms/x/"))).toBe(
    "protocol-endpoint",
  );
  // Discovery documents in every well-known form, and dot segments at any depth.
  for (const url of [
    "https://idp.example/realms/x/.well-known/",
    "https://idp.example/realms/x/.well-known/openid-configuration",
    "https://idp.example/.well-known/openid-configuration/realms/x",
    "https://idp.example/.well-known/oauth-authorization-server/realms/x",
    "https://idp.example/.well-known/",
    "https://idp.example/pods/.hidden/",
    "https://idp.example/realms/x/account/",
    "https://idp.example/realms/x/protocol/",
  ])
    expect(await refusal(f.auth.grantResource!(url))).toBe("protocol-endpoint");
  // A container beside the issuer path on the same server is allowed.
  const grant = await f.auth.grantResource!("https://idp.example/pods/bob/");
  expect(grant.origin).toBe("https://idp.example");
});

test("a path-based server's other pods can be granted on the issuer's origin", async () => {
  const f = fixture();
  await f.auth.login();
  await f.auth.grantResource!("https://op.example/bob/");
  expect((await f.auth.fetch("https://op.example/bob/file")).status).toBe(200);
  // The token endpoint itself stays outside every grant.
  expect(f.credentialed("https://op.example/token")).toHaveLength(0);
});

test("browsers that report user activation require it", async () => {
  const f = fixture();
  await f.auth.login();
  vi.stubGlobal("navigator", { userActivation: { isActive: false } });
  expect(await refusal(f.auth.grantResource!(shared))).toBe("no-user-activation");
  vi.stubGlobal("navigator", { userActivation: { isActive: true } });
  expect((await f.auth.grantResource!(shared)).root).toBe(shared);
});

test("a WebID without storages can still open a grant with its login session", async () => {
  const f = fixture({ storages: [] });
  await f.auth.login();
  expect((await f.auth.identity())?.storages).toEqual([]);
  await f.auth.grantResource!(shared);
  expect((await f.auth.fetch(`${shared}x`)).status).toBe(200);
  expect(f.ui.getCode).toHaveBeenCalledTimes(1);
});

test("runtimes without a navigator skip the activation check", async () => {
  const f = fixture();
  await f.auth.login();
  vi.stubGlobal("navigator", undefined);
  expect((await f.auth.grantResource!(shared)).root).toBe(shared);
});

test("a cancelled grant records nothing", async () => {
  const f = fixture();
  await f.auth.login();
  const controller = new AbortController();
  controller.abort(new Error("cancelled"));
  await expect(f.auth.grantResource!(shared, { signal: controller.signal })).rejects.toThrow(
    "cancelled",
  );
  expect(f.auth.grants!()).toEqual([]);
});

test("logout racing a grant leaves no grant", async () => {
  const f = fixture();
  await f.auth.login();
  const granting = f.auth.grantResource!(shared);
  const loggingOut = f.auth.logout();
  const [grant] = await Promise.allSettled([granting, loggingOut]);
  if (grant.status === "rejected") expect(grant.reason).toBeInstanceOf(ResourceGrantError);
  expect(f.auth.grants!()).toEqual([]);
  expect(f.auth.isWithinGrantedScope!(`${shared}x`)).toBe(false);
});

test("a grant made while logout is pending is refused", async () => {
  const f = fixture();
  await f.auth.login();
  const loggingOut = f.auth.logout();
  expect(await refusal(f.auth.grantResource!(shared))).toBe("signed-out");
  await loggingOut;
});

test("redirects out of a grant never carry credentials", async () => {
  const target = "https://attacker.example/collect";
  const f = fixture({}, {}, (request) =>
    request.url === `${shared}moved` && request.headers.has("authorization")
      ? Promise.resolve(new Response(null, { status: 302, headers: { location: target } }))
      : request.url === target
        ? Promise.resolve(
            new Response(null, { status: 401, headers: { "www-authenticate": "DPoP" } }),
          )
        : undefined,
  );
  await f.auth.login();
  await f.auth.grantResource!(shared);
  await expect(f.auth.fetch(`${shared}moved`)).rejects.toThrow(TypeError);
  expect(f.requests.filter((r) => r.url === target)).toHaveLength(0);
  // A Request input is confined too, and an unparsable URL still fails as before.
  await expect(f.auth.fetch(new Request(`${shared}moved`))).rejects.toThrow(TypeError);
  await expect(f.auth.fetch("relative/path")).rejects.toThrow(TypeError);
  // A caller's manual mode is kept: the redirect comes back as it is.
  const manual = await f.auth.fetch(`${shared}moved`, { redirect: "manual" });
  expect(manual.status).toBe(302);
  expect(f.credentialed("https://attacker.example/")).toHaveLength(0);
});

test("a grant's native redirect into own storage is never re-targeted with credentials", async () => {
  const own = "https://pod.example/alice/private/contacts.ttl";
  const f = fixture({}, {}, (request) => {
    if (request.url !== `${shared}room/index.ttl`) return undefined;
    // A browser follows a plain GET's redirect itself unless the mode forbids it.
    if (request.redirect === "error") return Promise.reject(new TypeError("redirect refused"));
    if (request.redirect === "manual")
      return Promise.resolve(new Response(null, { status: 302, headers: { location: own } }));
    const response = new Response(null, { status: 401, headers: { "www-authenticate": "DPoP" } });
    Object.defineProperties(response, { redirected: { value: true }, url: { value: own } });
    return Promise.resolve(response);
  });
  await f.auth.login();
  await f.auth.grantResource!(shared);
  await expect(f.auth.fetch(`${shared}room/index.ttl`)).rejects.toThrow(TypeError);
  expect(f.requests.filter((r) => r.url === own)).toHaveLength(0);
  // Own storage still follows its own redirects as before.
  expect((await f.auth.fetch("https://pod.example/alice/private")).status).toBe(200);
});

test.each([
  ["DELETE", 307],
  ["PUT", 308],
  ["GET", 302],
])("a grant's %s redirect (%i) after a 401 never reaches own storage", async (method, status) => {
  const own = "https://pod.example/alice/notes/important";
  const f = fixture({}, {}, (request) =>
    request.url === `${shared}room/x` && request.headers.has("authorization")
      ? Promise.resolve(new Response(null, { status, headers: { location: own } }))
      : undefined,
  );
  await f.auth.login();
  await f.auth.grantResource!(shared);
  await expect(
    f.auth.fetch(`${shared}room/x`, {
      method,
      ...(method === "PUT" ? { body: "data", headers: { "content-type": "text/plain" } } : {}),
    }),
  ).rejects.toThrow(TypeError);
  expect(f.requests.filter((r) => r.url === own)).toHaveLength(0);
});

test.each([
  `UMA as_uri="https://as.example/", ticket="ticket-for-alice-own-pod"`,
  `Bearer as_uri="https://as.example/", realm="${shared}"`,
])("a grant's server cannot borrow a trusted authorization server: %s", async (challenge) => {
  const f = fixture({}, { boundary: { roots: ["https://as.example/configured/"] } }, (request) =>
    request.url.startsWith(shared)
      ? Promise.resolve(
          new Response(null, { status: 401, headers: { "www-authenticate": challenge } }),
        )
      : request.url.startsWith("https://as.example/")
        ? Promise.resolve(Response.json({ error: "unexpected" }, { status: 400 }))
        : undefined,
  );
  await f.auth.login();
  await f.auth.grantResource!(shared);
  const outcome = await f.auth.fetch(`${shared}x`).then(
    (response) => response.status,
    (error: Error) => error.message,
  );
  expect(String(outcome)).toMatch(/^401$|not trusted/);
  expect(f.requests.filter((r) => r.url.startsWith("https://as.example/"))).toHaveLength(0);
  expect(f.op.stats.exchanges).toBe(0);
});

test("a grant's server cannot force the shared session to renew", async () => {
  const f = fixture({ refreshTokens: true }, {}, (request) =>
    request.url.startsWith(shared)
      ? Promise.resolve(
          new Response(null, { status: 401, headers: { "www-authenticate": "DPoP" } }),
        )
      : undefined,
  );
  await f.auth.login();
  await f.auth.grantResource!(shared);
  const before = { ...f.op.stats };
  for (let index = 0; index < 3; index++)
    expect((await f.auth.fetch(`${shared}x`)).status).toBe(401);
  expect(f.op.stats.refreshes).toBe(before.refreshes);
  expect(f.op.stats.tokens).toBe(before.tokens);
  expect(f.op.stats.authorizations).toBe(before.authorizations);
  expect(f.ui.getCode).toHaveBeenCalledTimes(1);
  // Own storage still renews a rejected token as before.
  expect((await f.auth.fetch("https://pod.example/alice/private")).status).toBe(200);
});

test("a granted sign-in remembers the established session, never the foreign URL", async () => {
  const writes: string[] = [];
  const sessions = createMemoryStore();
  const recording = {
    ...sessions,
    setItem: async (key: string, value: {}) => {
      writes.push(JSON.stringify(value));
      await sessions.setItem(key, value);
    },
  };
  const f = fixture({}, { storage: { sessions: recording, caches: createMemoryStore() } });
  await f.auth.login();
  await f.auth.grantResource!(shared);
  writes.length = 0;
  expect((await f.auth.fetch(`${shared}a`)).status).toBe(200);
  expect((await f.auth.fetch(f.op.root + "b")).status).toBe(200);
  expect(writes.some((value) => value.includes("alice.example"))).toBe(false);
});

test.each([
  `UMA as_uri="https://alice.example/", ticket="t"`,
  `Bearer as_uri="https://alice.example/", realm="${shared}"`,
  `Bearer resource_metadata="https://alice.example/.well-known/oauth-protected-resource/shared/"`,
])("a grant never makes its server an authorization-server trust anchor: %s", async (challenge) => {
  const f = fixture({}, {}, (request) =>
    request.url.startsWith(shared)
      ? Promise.resolve(
          new Response(null, { status: 401, headers: { "www-authenticate": challenge } }),
        )
      : undefined,
  );
  await f.auth.login();
  await f.auth.grantResource!(shared);
  const tokens = f.op.stats.tokens;
  // UMA and LWS refuse the untrusted server outright; nothing is exchanged either way.
  const outcome = await f.auth.fetch(`${shared}x`).then(
    (response) => response.status,
    (error: Error) => error.message,
  );
  expect(String(outcome)).toMatch(/^401$|not trusted/);
  expect(f.op.stats.exchanges).toBe(0);
  expect(f.op.stats.tokens).toBe(tokens);
  expect(
    f.requests.filter((r) => r.url.startsWith("https://alice.example/") && r.method === "POST"),
  ).toHaveLength(0);
  expect(f.credentialed("https://alice.example/")).toHaveLength(0);
});

test("a failing grants observer does not interrupt the grant or other observers", async () => {
  const f = fixture();
  await f.auth.login();
  const after = vi.fn();
  f.auth.on("grants", () => {
    throw new Error("observer");
  });
  f.auth.on("grants", after);
  await f.auth.grantResource!(shared);
  expect(after).toHaveBeenCalledTimes(1);
});

test("withinResourceGrants matches like the boundary and fails closed", () => {
  const grants = [{ root: shared }, { root: "https://alice.example/note" }];
  expect(withinResourceGrants(grants, `${shared}a/b`)).toBe(true);
  expect(withinResourceGrants(grants, "https://alice.example/note?x")).toBe(true);
  expect(withinResourceGrants(grants, "https://alice.example/note/x")).toBe(false);
  expect(withinResourceGrants(grants, `${sibling}a`)).toBe(false);
  expect(withinResourceGrants(grants, "http://alice.example/shared/a")).toBe(false);
  expect(withinResourceGrants(grants, `${shared}%2e%2e/secret`)).toBe(false);
  expect(withinResourceGrants([{ root: "not a url" }], `${shared}a`)).toBe(false);
  expect(withinResourceGrants([], `${shared}a`)).toBe(false);
});

test("the boundary refuses a consent recorded after it was cleared", () => {
  const boundary = createBoundary({}, { fetch: async () => new Response(null) });
  const started = boundary.generation();
  boundary.clear();
  const live = new AbortController();
  const protocol = { issuer: "https://op.example/", endpoints: [] };
  expect(() => boundary.consent(shared, 1, protocol, started, live.signal)).toThrow(
    ResourceGrantError,
  );
  expect(() =>
    boundary.consent(shared, 1, protocol, boundary.generation(), AbortSignal.abort()),
  ).toThrow(ResourceGrantError);
  expect(boundary.grants()).toEqual([]);
  const grant = boundary.consent(
    shared,
    1,
    { issuer: "https://op.example/", endpoints: ["https://op.example/token"] },
    boundary.generation(),
    live.signal,
  );
  expect(boundary.allows(`${shared}x`)).toBe(true);
  expect(
    boundary.trustAuthorizationServer({
      authorizationServer: new URL("https://alice.example/"),
      resource: new URL(`${shared}x`),
    }),
  ).toBe(false);
  expect(boundary.storages()).toEqual([]);
  expect(boundary.roots()).toEqual([]);
  expect(boundary.consented(grant.root)).toBe(true);
  // A later grant in a new session generation moves the lifetime; the old one no longer ends it.
  const next = new AbortController();
  boundary.consent("https://alice.example/note", 2, protocol, boundary.generation(), next.signal);
  live.abort();
  expect(boundary.grants()).toHaveLength(2);
  // Session supersession ends every grant, even without learned roots.
  next.abort();
  expect(boundary.grants()).toEqual([]);
  expect(boundary.allows(`${shared}x`)).toBe(false);
  // Revoked grants leave nothing for a later supersession to end, so observers hear nothing.
  const last = new AbortController();
  const observer = vi.fn();
  boundary.onGrants(observer);
  boundary.consent(shared, 3, protocol, boundary.generation(), last.signal);
  boundary.revoke(shared);
  last.abort();
  expect(observer).toHaveBeenCalledTimes(2);
});
