// AUTHORED-BY Codex GPT-6.1-Sol
import { NamedNodeAs, NamedNodeFrom, SetFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory, Parser, Store, Writer } from "n3";
import { afterEach, expect, test, vi } from "vitest";
import { createPodAuth } from "./index.js";
import { createRegistration, RegistrationError, type RegistrationStep } from "./registration.js";
import { createMockOp } from "./testing.js";
import type { Identity, PodAuth } from "./types.js";

const base = "https://provider.example/";
const index = `${base}.account/`;
const pod = `${base}alice/`;
const webId = `${pod}profile/card#me`;
const identity: Identity = {
  webId,
  issuer: base,
  subject: webId,
  clientId: null,
  protocol: "solid-oidc",
  storages: [pod],
};
const request = { username: "alice", displayName: 'Alice "A"\n雪', password: "strong-password" };
const controls = {
  account: { create: "/create", pod: "/pod", webId: "/webid" },
  password: { create: "/password", login: "/login" },
};

function fixture() {
  const calls: Request[] = [];
  const responses = new Map<string, () => Response | Promise<Response>>();
  responses.set("/alice/", () => new Response(null, { status: 404 }));
  responses.set("/.account/", () => Response.json({ controls }));
  responses.set("/create", () => Response.json({ authorization: "account-secret" }));
  responses.set("/password", () => Response.json({}));
  responses.set("/login", () => Response.json({ authorization: "login-secret" }));
  responses.set("/pod", () => Response.json({ pod, webId }));
  responses.set("/webid", () => Response.json({ webIdLinks: { [webId]: "/unused-link" } }));
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const captured = new Request(input, init);
    calls.push(captured);
    return responses.get(new URL(captured.url).pathname)!();
  });
  const profileFetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(null, { status: 205 }),
  );
  const login = vi.fn(async () => identity);
  const podAuth = { fetch: profileFetch, login } as unknown as PodAuth;
  const client = createRegistration({ accountApi: index, podAuth, fetch });
  return { calls, responses, fetch, profileFetch, login, podAuth, client };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("follows CSS index controls, verifies its linked WebID, writes escaped RDF and returns the authenticated identity", async () => {
  const f = fixture();
  const steps: RegistrationStep[] = [];
  expect(await f.client.available()).toBe(true);
  expect(f.client.methods).toEqual(["password"]);
  expect(f.client.previewUrls("alice")).toEqual({ pod, webId });
  expect(await f.client.register(request, { onStep: (step) => steps.push(step) })).toEqual(
    identity,
  );
  expect(steps).toEqual(["account", "password", "pod", "webid", "profile", "sign-in"]);
  expect(f.login).toHaveBeenCalledWith({ issuer: base }, expect.anything());
  expect(f.calls.map((call) => call.url)).not.toContain("/unused-link");
  for (const call of f.calls) {
    expect(call.redirect).toBe("manual");
    expect(call.credentials).toBe("omit");
    expect(call.headers.has("cookie")).toBe(false);
    expect(call.url).not.toContain(request.password);
  }
  expect(f.calls.find((call) => call.url === `${base}create`)?.headers.has("authorization")).toBe(
    false,
  );
  expect(f.calls.find((call) => call.url === `${base}password`)?.headers.get("authorization")).toBe(
    "CSS-Account-Token account-secret",
  );
  expect(f.calls.find((call) => call.url === `${base}pod`)?.headers.get("authorization")).toBe(
    "CSS-Account-Token login-secret",
  );
  const [target, init] = f.profileFetch.mock.calls[0]!;
  expect(String(target)).toBe(webId.split("#")[0]);
  expect(init?.method).toBe("PATCH");
  const data = String(init?.body)
    .replace(/^INSERT DATA \{\n/, "")
    .replace(/\n\}$/, "");
  const quads = new Parser().parse(data);
  expect(quads).toHaveLength(2);
  expect(
    quads.every(
      (quad) => quad.subject.value === webId && quad.object.value === request.displayName,
    ),
  ).toBe(true);
});

test("invalid usernames make no request; HEAD distinguishes absent and occupied pods", async () => {
  const f = fixture();
  for (const name of [
    "",
    "ab",
    "Aaa",
    "a_b",
    "a".repeat(31),
    "../",
    "a\nb",
    "abc\n",
    "abc\r",
    "abc\u2028",
    1 as never,
  ])
    expect(await f.client.checkUsername(name)).toBe("invalid");
  expect(f.fetch).not.toHaveBeenCalled();
  expect(await f.client.checkUsername("alice")).toBe("available");
  for (const status of [200, 204, 299]) {
    f.responses.set("/alice/", () => new Response(null, { status }));
    expect(await f.client.checkUsername("alice")).toBe("taken");
  }
  // CSS answers 401 for missing children of a non-public root, so these cannot mean "taken".
  for (const status of [401, 403]) {
    f.responses.set("/alice/", () => new Response(null, { status }));
    expect(await f.client.checkUsername("alice")).toBe("unknown");
  }
  for (const status of [300, 302, 400, 405, 500]) {
    f.responses.set("/alice/", () => new Response(null, { status }));
    await expect(f.client.checkUsername("alice")).rejects.toBeInstanceOf(RegistrationError);
  }
});

test("null account API disables registration without network, even with a pod host", async () => {
  const f = fixture();
  const client = createRegistration({ accountApi: null, podAuth: f.podAuth, fetch: f.fetch });
  expect(await client.available()).toBe(false);
  expect(() => client.previewUrls("alice")).toThrow(RegistrationError);
  await expect(client.register(request)).rejects.toMatchObject({
    code: "registration-closed",
    step: "account",
    created: {},
  });
  expect(f.fetch).not.toHaveBeenCalled();
});

test.each([
  null,
  [],
  {},
  { controls: null },
  { controls: { account: { create: "/create" } } },
  { controls: { account: { create: "" }, password: { login: "/login" } } },
])("missing public index controls fail availability closed: %j", async (document) => {
  const f = fixture();
  f.responses.set("/.account/", () => Response.json(document));
  expect(await f.client.available()).toBe(false);
  await expect(f.client.register(request)).rejects.toMatchObject({
    code: "registration-closed",
    created: {},
  });
});

test.each([
  "https://evil.example/create",
  "https://provider.example:444/create",
  "http://provider.example/create",
  "https://secret@provider.example/create",
  "https://:secret@provider.example/create",
  "//evil.example/create",
  "data:secret",
  "https://provider.example/create?secret",
  "/create#secret",
])("rejects unsafe public controls before any account is created: %s", async (create) => {
  const f = fixture();
  f.responses.set("/.account/", () =>
    Response.json({ controls: { ...controls, account: { ...controls.account, create } } }),
  );
  expect(await f.client.available()).toBe(false);
  await expect(f.client.register(request)).rejects.toMatchObject({
    code: "unsafe-control",
    step: "account",
    created: {},
  });
  expect(f.calls.every((call) => call.method !== "POST")).toBe(true);
});

test.each([
  "password",
  "pod",
  "webId",
])("validates the scoped %s control before sending the password", async (which) => {
  const f = fixture();
  let indexes = 0;
  f.responses.set("/.account/", () => {
    const next = structuredClone(controls);
    if (++indexes > 1) {
      if (which === "password") next.password.create = "https://evil.example/secret";
      else next.account[which as "pod" | "webId"] = "https://evil.example/secret";
    }
    return Response.json({ controls: next });
  });
  await expect(f.client.register(request)).rejects.toMatchObject({
    code: "unsafe-control",
    step: "account",
    created: { account: true, loginId: "alice@registration.invalid", signInHint: { issuer: base } },
  });
  expect(f.calls.filter((call) => call.method === "POST")).toHaveLength(1);
});

test.each([
  "invalid",
  "http://remote.example/",
  "https://user:secret@provider.example/",
  `${index}?query`,
  `${index}#fragment`,
])("rejects unsafe configuration without echoing it: %s", (accountApi) => {
  const f = fixture();
  expect(() => createRegistration({ accountApi, podAuth: f.podAuth })).toThrow(TypeError);
});

test("requires explicit loopback HTTP outside production and derives path-mounted URLs", async () => {
  const f = fixture();
  for (const hostname of ["localhost", "127.0.0.1", "[::1]"]) {
    const accountApi = `http://${hostname}:3000/tenant/.account/`;
    expect(() => createRegistration({ accountApi, podAuth: f.podAuth })).toThrow();
    const client = createRegistration({
      accountApi,
      allowInsecureLoopback: true,
      podAuth: f.podAuth,
      fetch: f.fetch,
    });
    expect(client.previewUrls("alice")).toEqual({
      pod: `http://${hostname}:3000/tenant/alice/`,
      webId: `http://${hostname}:3000/tenant/alice/profile/card#me`,
    });
  }
  vi.stubEnv("NODE_ENV", "production");
  expect(() =>
    createRegistration({
      accountApi: "http://localhost/.account/",
      allowInsecureLoopback: true,
      podAuth: f.podAuth,
    }),
  ).toThrow();
  vi.stubEnv("NODE_ENV", "test");
  expect(() =>
    createRegistration({
      accountApi: "http://remote.example/.account/",
      allowInsecureLoopback: true,
      podAuth: f.podAuth,
    }),
  ).toThrow();
  expect(
    createRegistration({
      accountApi: index,
      podHost: "https://pods.example/prefix",
      podAuth: f.podAuth,
    }).previewUrls("abc"),
  ).toEqual({
    pod: "https://pods.example/prefix/abc/",
    webId: "https://pods.example/prefix/abc/profile/card#me",
  });
});

test.each([
  "short",
  "",
  " leading-space",
  "trailing-space ",
])("weak passwords fail locally without network: %j", async (password) => {
  const f = fixture();
  await expect(f.client.register({ ...request, password })).rejects.toMatchObject({
    code: "weak-password",
    step: "password",
    created: {},
  });
  expect(f.fetch).not.toHaveBeenCalled();
});

test.each([
  "",
  "  ",
  "unsafe\u001btext",
  "unsafe\u007ftext",
])("invalid display names fail locally: %j", async (displayName) => {
  const f = fixture();
  await expect(f.client.register({ ...request, displayName })).rejects.toMatchObject({
    code: "invalid-display-name",
    created: {},
  });
  expect(f.fetch).not.toHaveBeenCalled();
});

test("invalid registration usernames fail locally, including previews", async () => {
  const f = fixture();
  expect(() => f.client.previewUrls("../")).toThrow(RegistrationError);
  await expect(f.client.register({ ...request, username: "../" })).rejects.toMatchObject({
    code: "invalid-username",
    created: {},
  });
  expect(f.fetch).not.toHaveBeenCalled();
});

test("an occupied username never creates an account", async () => {
  const f = fixture();
  f.responses.set("/alice/", () => new Response(null, { status: 200 }));
  await expect(f.client.register(request)).rejects.toMatchObject({
    code: "username-taken",
    created: {},
  });
  expect(f.calls).toHaveLength(1);
});

test("a denied (unknown) username probe does not block registration", async () => {
  const f = fixture();
  f.responses.set("/alice/", () => new Response(null, { status: 401 }));
  expect(await f.client.register(request)).toEqual(identity);
});

test.each([
  ["/create", 403, "registration-closed", "account"],
  ["/create", 409, "username-taken", "account"],
  ["/password", 400, "weak-password", "password"],
  ["/login", 500, "registration-failed", "password"],
  ["/pod", 409, "username-taken", "pod"],
  ["/pod", 405, "registration-closed", "pod"],
  ["/webid", 503, "registration-failed", "webid"],
] as const)("%s HTTP %s has a typed %s error at %s with confirmed progress", async (path, status, code, step) => {
  const f = fixture();
  f.responses.set(path, () => new Response("password-and-token-must-not-leak", { status }));
  const error = await f.client.register(request).catch((error: RegistrationError) => error);
  expect(error).toBeInstanceOf(RegistrationError);
  expect(error).toMatchObject({ code, step });
  expect(JSON.stringify(error)).not.toContain("must-not-leak");
  expect(error).not.toHaveProperty("cause");
  expect(Object.isFrozen((error as RegistrationError).created)).toBe(true);
  expect((error as RegistrationError).created.account).toBe(path !== "/create" ? true : undefined);
  expect((error as RegistrationError).created.password).toBe(
    ["/login", "/pod", "/webid"].includes(path) ? true : undefined,
  );
});

test.each([
  "/create",
  "/login",
])("missing or malformed %s authorization does not proceed or leak the response", async (path) => {
  for (const authorization of [undefined, null, 1, "", "secret\r\nheader", "secret\n"]) {
    const f = fixture();
    f.responses.set(path, () => Response.json({ authorization }));
    await expect(f.client.register(request)).rejects.toMatchObject({
      code: "invalid-response",
      created: { account: true },
    });
    expect(f.profileFetch).not.toHaveBeenCalled();
  }
});

test.each([
  { pod: "https://evil.example/", webId },
  { pod, webId: "https://evil.example/#me" },
  {},
])("mismatched pod results never become a write destination: %j", async (result) => {
  const f = fixture();
  f.responses.set("/pod", () => Response.json(result));
  await expect(f.client.register(request)).rejects.toMatchObject({
    code: "invalid-response",
    step: "pod",
    created: { account: true, password: true },
  });
  expect(f.profileFetch).not.toHaveBeenCalled();
});

test.each([
  "links",
  "no-links",
])("links a WebID only when it is not already in the %s view", async (kind) => {
  const f = fixture();
  let views = 0;
  f.responses.set("/webid", () =>
    ++views === 1
      ? Response.json(kind === "links" ? { webIdLinks: {} } : {})
      : Response.json({ webId, oidcIssuer: base }),
  );
  expect(await f.client.register(request)).toEqual(identity);
  const link = f.calls.filter((call) => new URL(call.url).pathname === "/webid");
  expect(link.map((call) => call.method)).toEqual(["GET", "POST"]);
  expect(await link[1]!.json()).toEqual({ webId });
});

test.each([
  { webId: "https://evil.example/#me", oidcIssuer: base },
  { webId, oidcIssuer: "https://evil.example/" },
])("rejects mismatched WebID linking results", async (linked) => {
  const f = fixture();
  let views = 0;
  f.responses.set("/webid", () => Response.json(++views === 1 ? {} : linked));
  await expect(f.client.register(request)).rejects.toMatchObject({
    code: "invalid-response",
    step: "webid",
    created: { podUrl: pod, webId },
  });
  expect(f.profileFetch).not.toHaveBeenCalled();
});

test.each([
  "profile",
  "sign-in",
])("rejects session mismatches at %s without partial success", async (phase) => {
  for (const mismatch of [
    { ...identity, webId: "https://other.example/#me" },
    { ...identity, issuer: "https://other.example/" },
  ]) {
    const f = fixture();
    if (phase === "sign-in") f.login.mockResolvedValueOnce(identity);
    f.login.mockResolvedValue(mismatch);
    await expect(f.client.register(request)).rejects.toMatchObject({
      code: "identity-mismatch",
      step: phase,
      created: { webId, podUrl: pod },
    });
    expect(f.profileFetch).toHaveBeenCalledTimes(phase === "profile" ? 0 : 1);
  }
});

test.each([
  "profile",
  "sign-in",
])("sanitizes login failure at %s and preserves confirmed progress", async (phase) => {
  const f = fixture();
  if (phase === "sign-in") f.login.mockResolvedValueOnce(identity);
  f.login.mockRejectedValue(new Error(request.password));
  await expect(f.client.register(request)).rejects.toMatchObject({
    code: "registration-failed",
    step: phase,
    created: { webId },
  });
});

test.each([
  401, 403, 412, 500,
])("authenticated profile HTTP %s cannot silently succeed", async (status) => {
  const f = fixture();
  f.profileFetch.mockResolvedValue(new Response("secret", { status }));
  await expect(f.client.register(request)).rejects.toMatchObject({
    step: "profile",
    code: "registration-failed",
    created: { webId, podUrl: pod },
  });
  expect(f.login).toHaveBeenCalledTimes(1);
});

test.each([
  "account",
  "password",
  "pod",
  "webid",
  "profile",
  "sign-in",
] as const)("cancellation at %s stops all subsequent work and reports partial progress", async (phase) => {
  const f = fixture();
  const controller = new AbortController();
  await expect(
    f.client.register(request, {
      signal: controller.signal,
      onStep: (step, created) => {
        expect(Object.isFrozen(created)).toBe(true);
        if (step === phase) controller.abort(new Error("password-must-not-leak"));
      },
    }),
  ).rejects.toMatchObject({ code: "registration-failed", step: phase });
});

test("observers cannot turn a failed registration into silent partial success; the client can be reused", async () => {
  const f = fixture();
  await expect(
    f.client.register(request, {
      onStep: () => {
        throw new Error(request.password);
      },
    }),
  ).rejects.toMatchObject({ code: "registration-failed", step: "account" });
  expect(await f.client.register(request)).toEqual(identity);
});

test("concurrent registration is refused and successful completion does not cache account credentials", async () => {
  const f = fixture();
  const release = Promise.withResolvers<Response>();
  f.responses.set("/create", () => release.promise);
  const first = f.client.register(request);
  await vi.waitFor(() => expect(f.calls.some((call) => call.url.endsWith("/create"))).toBe(true));
  await expect(f.client.register(request)).rejects.toMatchObject({
    code: "registration-in-progress",
    created: {},
  });
  release.resolve(Response.json({ authorization: "account-secret" }));
  await first;
  await f.client.available();
  expect(f.calls.at(-1)?.headers.has("authorization")).toBe(false);
});

test.each([
  "json",
  "network",
  "redirect",
  "opaque",
  "redirected",
  "foreign-url",
  "oversized",
])("account %s failures are sanitized, fail closed and never follow another endpoint", async (kind) => {
  const f = fixture();
  f.responses.set("/.account/", () => {
    if (kind === "network") throw new Error(request.password);
    if (kind === "json") return new Response(request.password);
    if (kind === "oversized") return new Response(" ".repeat(1024 * 1024 + 1));
    if (kind === "redirect")
      return new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/secret" },
      });
    const response = Response.json({ controls });
    if (kind === "opaque") Object.defineProperty(response, "type", { value: "opaqueredirect" });
    if (kind === "redirected") Object.defineProperty(response, "redirected", { value: true });
    if (kind === "foreign-url")
      Object.defineProperty(response, "url", { value: "https://evil.example/" });
    return response;
  });
  await expect(f.client.available()).rejects.toMatchObject({
    code: "registration-failed",
    step: "check",
  });
  await expect(f.client.register(request)).rejects.toMatchObject({ step: "account" });
  expect(f.calls.every((call) => new URL(call.url).origin === new URL(base).origin)).toBe(true);
  expect(f.calls.some((call) => call.method === "POST")).toBe(false);
});

test.each([
  "redirected",
  "foreign-url",
  "network",
])("username check refuses %s responses", async (kind) => {
  const f = fixture();
  f.responses.set("/alice/", () => {
    if (kind === "network") throw new Error("secret");
    const response = new Response(null, { status: 404 });
    if (kind === "redirected") Object.defineProperty(response, "redirected", { value: true });
    else Object.defineProperty(response, "url", { value: "https://evil.example/" });
    return response;
  });
  await expect(f.client.checkUsername("alice")).rejects.toMatchObject({
    step: "check",
    code: "registration-failed",
  });
});

test.each([
  "redirected",
  "foreign-url",
  "network",
  "redirect",
])("profile write refuses %s responses", async (kind) => {
  const f = fixture();
  f.profileFetch.mockImplementation(async () => {
    if (kind === "network") throw new Error(request.password);
    if (kind === "redirect")
      return new Response(null, { status: 302, headers: { location: "https://evil.example/" } });
    const response = new Response(null, { status: 205 });
    if (kind === "redirected") Object.defineProperty(response, "redirected", { value: true });
    else Object.defineProperty(response, "url", { value: "https://evil.example/" });
    return response;
  });
  await expect(f.client.register(request)).rejects.toMatchObject({
    step: "profile",
    code: "registration-failed",
  });
});

test("the default pristine transport is captured at construction", async () => {
  const f = fixture();
  vi.stubGlobal("fetch", f.fetch);
  const client = createRegistration({ accountApi: index, podAuth: f.podAuth });
  vi.stubGlobal("fetch", () => {
    throw new Error("must not recurse");
  });
  expect(await client.available()).toBe(true);
});

test.each([
  "index",
  "head",
  "profile",
])("rejected discarded %s body cancellation does not mask the result", async (kind) => {
  const f = fixture();
  const cancel = vi.fn(async () => {
    throw new Error("secret");
  });
  const response = () => new Response(new ReadableStream({ cancel }));
  if (kind === "index") {
    f.responses.set("/.account/", () => {
      const value = response();
      Object.defineProperty(value, "url", { value: "https://evil.example/" });
      return value;
    });
    await expect(f.client.available()).rejects.toMatchObject({ code: "registration-failed" });
  } else if (kind === "head") {
    f.responses.set("/alice/", response);
    expect(await f.client.checkUsername("alice")).toBe("taken");
  } else {
    f.profileFetch.mockImplementation(async () => response());
    expect(await f.client.register(request)).toEqual(identity);
  }
  expect(cancel).toHaveBeenCalledOnce();
});

test("a successfully created account remains in progress data if its JSON response is corrupt", async () => {
  const f = fixture();
  f.responses.set("/create", () => new Response("secret-not-json"));
  await expect(f.client.register(request)).rejects.toMatchObject({
    step: "account",
    code: "registration-failed",
    created: { account: true, loginId: "alice@registration.invalid" },
  });
});

test("snapshots registration input across awaits", async () => {
  const f = fixture();
  const release = Promise.withResolvers<Response>();
  f.responses.set("/alice/", () => release.promise);
  const mutable = { ...request };
  const pending = f.client.register(mutable);
  mutable.username = "mallory";
  mutable.displayName = "Mallory";
  mutable.password = "other-password";
  release.resolve(new Response(null, { status: 404 }));
  expect(await pending).toEqual(identity);
  expect(await f.calls.find((call) => call.url.endsWith("/pod"))?.json()).toEqual({
    name: "alice",
    settings: { linkStorage: true },
  });
  expect(await f.calls.find((call) => call.url.endsWith("/password"))?.json()).toEqual({
    email: "alice@registration.invalid",
    password: request.password,
  });
});

test.each([
  "password",
  "pod",
  "webId",
])("missing scoped %s controls preserve account progress", async (which) => {
  const f = fixture();
  let indexes = 0;
  f.responses.set("/.account/", () => {
    const scoped = structuredClone(controls);
    if (++indexes > 1) {
      if (which === "password") scoped.password.create = "";
      else scoped.account[which as "pod" | "webId"] = "";
    }
    return Response.json({ controls: scoped });
  });
  await expect(f.client.register(request)).rejects.toMatchObject({
    code: "registration-closed",
    created: { account: true },
  });
});

test("an unsafe login control is refused before account creation", async () => {
  const f = fixture();
  f.responses.set("/.account/", () =>
    Response.json({
      controls: { ...controls, password: { ...controls.password, login: "https://evil.example/" } },
    }),
  );
  expect(await f.client.available()).toBe(false);
  await expect(f.client.register(request)).rejects.toMatchObject({
    code: "unsafe-control",
    created: {},
  });
  expect(f.calls.some((call) => call.method === "POST")).toBe(false);
});

test.each([
  "/create",
  "/password",
  "/login",
  "/pod",
  "/webid",
])("credentialed redirects from %s never dispatch to the redirect destination", async (path) => {
  const f = fixture();
  f.responses.set(
    path,
    () =>
      new Response(null, { status: 307, headers: { location: "https://evil.example/password" } }),
  );
  const error = await f.client.register(request).catch((error) => error);
  expect(error).toMatchObject({ code: "registration-failed" });
  expect(f.calls.every((call) => new URL(call.url).origin === new URL(base).origin)).toBe(true);
  expect(f.calls.at(-1)?.redirect).toBe("manual");
  expect(JSON.stringify(error)).not.toContain(request.password);
  expect(f.profileFetch).not.toHaveBeenCalled();
});

test("registration uses the real protocol engine and boundary for its profile write and subsequent private reads", async () => {
  const root = "https://pod.example/alice/";
  const newWebId = `${root}profile/card#me`;
  const op = createMockOp({ issuer: base, webId: newWebId, requireInteraction: true });
  const f = fixture();
  f.responses.set("/pod", () => Response.json({ pod: root, webId: newWebId }));
  f.responses.set("/webid", () =>
    Response.json({ webIdLinks: { [newWebId]: "https://never-follow.example/" } }),
  );
  const dataset = new Store();
  const person = new TermWrapper(newWebId, dataset, DataFactory);
  for (const [predicate, value] of [
    ["http://www.w3.org/ns/solid/terms#oidcIssuer", base],
    ["http://www.w3.org/ns/pim/space#storage", root],
  ])
    SetFrom.subjectPredicate(person, predicate!, NamedNodeAs.string, NamedNodeFrom.string).add(
      value!,
    );
  const transport: typeof fetch = async (input, init) => {
    const captured = new Request(input, init);
    const url = new URL(captured.url);
    if (captured.method === "HEAD" && captured.url === root)
      return new Response(null, { status: 404 });
    if (captured.url === newWebId.split("#")[0] && captured.method === "GET") {
      expect(captured.headers.has("authorization")).toBe(false);
      return new Response(new Writer().quadsToString([...dataset]), {
        headers: { "content-type": "text/turtle" },
      });
    }
    if (url.origin === new URL(base).origin && f.responses.has(url.pathname))
      return f.fetch(captured);
    return op.fetch(captured);
  };
  vi.stubGlobal("fetch", transport);
  const auth = createPodAuth({
    clientId: op.clientId,
    redirectUri: op.redirectUri,
    ui: { getWebId: async () => newWebId, getCode: op.getCode },
  });
  const client = createRegistration({
    accountApi: index,
    podHost: "https://pod.example/",
    podAuth: auth,
  });
  expect((await op.fetch(`${root}private`)).status).toBe(401);
  expect((await client.register(request)).webId).toBe(newWebId);
  expect(await (await auth.fetch(`${root}private`)).text()).toBe("protected Solid");
  expect(op.stats.authorizations).toBe(1);
  expect(op.stats.tokens).toBe(1);
  expect(op.stats.accepted).toBe(2); // Profile PATCH and the private read.
  const patch = op.requests.find(
    (call) => call.method === "PATCH" && call.headers.has("authorization"),
  );
  expect(patch?.url).toBe(newWebId.split("#")[0]);
  expect(patch?.headers.get("authorization")).toMatch(/^DPoP /);
  expect(patch?.headers.has("dpop")).toBe(true);
  await auth.logout();
});

test.each([
  404, 403, 401,
])("CSS's 400 pod conflict is re-probed rather than classified from its message (HEAD %s)", async (status) => {
  const f = fixture();
  let heads = 0;
  f.responses.set("/alice/", () => new Response(null, { status: ++heads === 1 ? 404 : status }));
  f.responses.set("/pod", () => new Response("secret", { status: 400 }));
  await expect(f.client.register(request)).rejects.toMatchObject({
    step: "pod",
    code: status === 404 ? "registration-failed" : "username-taken",
    created: { account: true, password: true },
  });
  expect(heads).toBe(2);
});

test("a password login rejection is not mistaken for a weak enrollment password", async () => {
  const f = fixture();
  f.responses.set("/login", () => new Response(null, { status: 400 }));
  await expect(f.client.register(request)).rejects.toMatchObject({
    code: "registration-failed",
    step: "password",
    created: { password: true },
  });
});

test("GET index 400 failures remain typed and sanitized", async () => {
  const f = fixture();
  f.responses.set("/.account/", () => new Response(null, { status: 400 }));
  await expect(f.client.available()).rejects.toMatchObject({ code: "registration-failed" });
});

test("throwing caller accessors cannot leak credentials or leave registration locked", async () => {
  const f = fixture();
  const bad = {
    ...request,
    get password(): string {
      throw new Error("private credential");
    },
  };
  await expect(f.client.register(bad)).rejects.toMatchObject({
    code: "registration-failed",
    message: "Registration failed (registration-failed) at account",
  });
  await expect(
    f.client.register(request, {
      get signal(): AbortSignal {
        throw new Error("private credential");
      },
    }),
  ).rejects.toMatchObject({ code: "registration-failed" });
  expect(await f.client.register(request)).toEqual(identity);
});
