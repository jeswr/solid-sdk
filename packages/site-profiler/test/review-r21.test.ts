// AUTHORED-BY Claude Opus 5.5
// Round-21 regressions through the real profiler steps with the production cookie
// classification: the real `playwrightReplayer` (over a fake browser context and a stubbed
// fetch) classifies the context's cookies for the credentials-only control from the login
// evidence, then verify, the restore of dropped verification reads, the control probe,
// learning, a sidecar round trip and the executor run. Decision 1: the control drops only
// cookies with positive login evidence. Decision 2: a verified login route posts to the learned
// login operation's target, is never the site root, and is never served to the signed-in
// context as an ordinary page. Every site, account and item here is fictional.
import {
  type CookieSecretContext,
  createApprovalGate,
  createExecutor,
  type Gate,
  InMemorySessions,
} from "@jeswr/site-executor";
import { type Operation, readSiteModel, SCHEMA, writeSiteModel } from "@jeswr/site-model";
import { afterEach, expect, it, vi } from "vitest";
import { Recorder } from "../src/recorder.js";
import type { RecordedRequest } from "../src/types.js";
import { playwrightReplayer, verifyOperations } from "../src/verify.js";
import { probeLivenessReads, verifiedLoginRoutes } from "../src/write-liveness.js";
import { learnWriteResponses } from "../src/write-responses.js";

const origin = "https://shop.test";
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}
const provenance = {
  method: "demonstration" as const,
  learnedAt: "2026-11-14T00:00:00Z",
  confidence: 1,
  derivedFrom: [],
};
const json = (fields: string[]) =>
  fields.map((name) => ({
    property: `${SCHEMA}${name}`,
    path: `/${name === "identifier" ? "id" : name}`,
  }));

/** How the fictional site signs in: its sign-in page, the form's action and the cookies set. */
interface SignIn {
  page: string;
  action: string;
  post: string;
  setCookies: string[];
  /** The sign-in page itself, when its form is not the default `user`/`pw` form. */
  body?: string;
}
const shopSignIn: SignIn = {
  page: "/login",
  action: "/login_check",
  post: "/login_check",
  setCookies: ["session"],
};

function fixture(signIn: SignIn = shopSignIn) {
  const write: Operation = {
    id: "urn:write",
    label: "Delete example product",
    actionType: `${SCHEMA}DeleteAction`,
    effect: "irreversible-write",
    session: "signed-in",
    provenance,
    inputs: [
      {
        name: "id",
        path: [`${SCHEMA}object`, `${SCHEMA}identifier`],
        location: "path",
        range: "http://www.w3.org/2001/XMLSchema#string",
        required: true,
        default: "73",
      },
    ],
    request: {
      method: "POST",
      urlTemplate: `${origin}/stores/main/products/delete/id/{id}`,
      contentType: "application/x-www-form-urlencoded",
    },
  };
  const read: Operation = {
    ...write,
    id: "urn:read",
    label: "Read example product",
    actionType: `${SCHEMA}ViewAction`,
    effect: "read",
    inputs: [{ ...required(write.inputs[0]), path: [], default: undefined }],
    request: {
      method: "GET",
      urlTemplate: `${origin}/stores/main/products/{id}`,
      headers: { "x-requested-with": "XMLHttpRequest" },
    },
    extraction: {
      format: "json",
      itemType: `${SCHEMA}Product`,
      fields: [
        ...json(["identifier"]),
        { property: `${SCHEMA}url`, path: "/url", datatype: "iri" },
        { property: `${SCHEMA}name`, path: "/name", untrusted: true },
      ],
    },
  };
  const live: Operation = {
    ...read,
    id: "urn:liveness",
    label: "List example products",
    inputs: [],
    request: {
      method: "GET",
      urlTemplate: `${origin}/stores/main/listing`,
      headers: { "x-requested-with": "XMLHttpRequest" },
    },
    extraction: {
      format: "json",
      itemType: `${SCHEMA}Product`,
      itemPath: "/items",
      fields: json(["identifier"]),
    },
  };
  const row = (id: string) => ({
    id,
    url: `${origin}/stores/main/products/${id}`,
    name: "Original widget",
  });
  const liveBody = () => ({ total: 2, items: [row("80"), row("81")] });
  const record = (seq: number, change: Partial<RecordedRequest>): RecordedRequest => ({
    seq,
    phase: "demonstration",
    demonstration: "example",
    method: "GET",
    url: `${origin}/stores/main/products/42`,
    resourceType: "xhr",
    requestHeaders: { "x-requested-with": "XMLHttpRequest" },
    cookieNames: signIn.setCookies,
    authenticationContext: "fictional-context",
    status: 200,
    contentType: "application/json",
    ...change,
  });
  const trace: RecordedRequest[] = [
    // The sign-in page served during the profiler's login, and its form post.
    record(-20, {
      phase: "login",
      demonstration: undefined,
      url: `${origin}${signIn.page}`,
      resourceType: "document",
      contentType: "text/html",
      cookieNames: [],
      bodySample:
        signIn.body ??
        `<form method="post" action="${signIn.action}"><input name="user"><input type="password" name="pw"></form>`,
    }),
    record(-19, {
      phase: "login",
      demonstration: undefined,
      method: "POST",
      url: `${origin}${signIn.post}`,
      resourceType: "document",
      cookieNames: [],
      status: 302,
      redirectedTo: `${origin}/`,
      setCookieNames: signIn.setCookies,
      completedAt: -18,
    }),
    record(1, { bodySample: JSON.stringify(row("42")) }),
    record(2, {
      method: "POST",
      url: `${origin}/stores/main/products/delete/id/42`,
      postData: "",
      requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
      status: 303,
      redirectedTo: `${origin}/products`,
      completedAt: 3,
    }),
    record(3, {
      url: `${origin}/products`,
      contentType: "text/html",
      redirectedFrom: 2,
      responsePageError: false,
      bodySample: '<div role="alert">Unable to change product.</div>',
    }),
    // The deleted item's empty not-found answer, in the same context.
    record(5, { status: 404, contentType: "text/plain;charset=UTF-8", bodySample: "" }),
    record(100, { url: `${origin}/stores/main/listing`, bodySample: JSON.stringify(liveBody()) }),
  ];
  // The login evidence as the profile collects it: the cookies the sign-in POST set.
  const loginCookieNames = trace
    .filter((r) => r.phase === "login" && r.method === "POST")
    .flatMap((r) => r.setCookieNames ?? []);
  return { write, read, live, row, liveBody, trace, loginCookieNames };
}
type Fixture = ReturnType<typeof fixture>;

type Answer = { status: number; contentType?: string; body: string; location?: string };
type Server = (url: URL, cookie: string) => Answer;
type ContextCookie = {
  name: string;
  value: string;
  httpOnly: boolean;
  domain: string;
  path: string;
  secure: boolean;
  sameSite: "Lax";
  expires: number;
};
const cookie = (name: string, value: string, httpOnly: boolean): ContextCookie => ({
  name,
  value,
  httpOnly,
  domain: "shop.test",
  path: "/",
  secure: true,
  sameSite: "Lax",
  expires: -1,
});

const respondWith = (a: Answer): Response =>
  new Response(a.body || null, {
    status: a.status,
    headers: {
      ...(a.contentType ? { "content-type": a.contentType } : {}),
      ...(a.location ? { location: a.location } : {}),
    },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The production profiler replayer over a fake browser context (signed in: every context
 * cookie) and a stubbed fetch (the credentials-only control and cookieless replays). `log`
 * records which cookie names each request carried.
 */
function realReplayer(f: Fixture, jar: ContextCookie[], server: Server, log: string[]) {
  const recorder = new Recorder(origin);
  for (const r of f.trace) recorder.trace.push(r);
  (f as { trace: RecordedRequest[] }).trace = recorder.trace;
  const names = (header: string) => header.replace(/=[^;]*/g, "");
  const toApi = (a: Answer) => {
    const headers: Record<string, string> = {
      ...(a.contentType ? { "content-type": a.contentType } : {}),
      ...(a.location ? { location: a.location } : {}),
    };
    return {
      status: () => a.status,
      headers: () => headers,
      headersArray: () => Object.entries(headers).map(([name, value]) => ({ name, value })),
      body: async () => Buffer.from(a.body),
      url: () => "",
    };
  };
  const context = {
    cookies: async () => jar,
    request: {
      get: async (url: string) => {
        const header = jar.map((k) => `${k.name}=${k.value}`).join("; ");
        log.push(`signed-in ${new URL(url).pathname}${new URL(url).search} [${names(header)}]`);
        return toApi(server(new URL(url), header));
      },
    },
  };
  vi.stubGlobal("fetch", async (input: string, init?: RequestInit) => {
    const header = new Headers(init?.headers).get("cookie") ?? "";
    log.push(`control ${new URL(input).pathname}${new URL(input).search} [${names(header)}]`);
    return respondWith(server(new URL(String(input)), header));
  });
  // The profile passes its login cookie names and learned model; here the sign-in POST's.
  const evidence = (): CookieSecretContext => ({ loginCookieNames: f.loginCookieNames });
  return playwrightReplayer(context as never, recorder, "verify", evidence);
}

/** The profiler's steps: verify, restore dropped verification reads, probe, learn. */
async function learn(f: Fixture, jar: ContextCookie[], server: Server, gate?: Gate) {
  const log: string[] = [];
  const replayer = realReplayer(f, jar, server, log);
  const ops = [f.write, f.read, f.live];
  const v = await verifyOperations(ops, {
    replayer,
    now: () => new Date(0),
    haveSession: true,
    recordedRequests: f.trace.slice(),
  });
  let verified = v.operations;
  const first = learnWriteResponses(ops, f.trace, origin);
  for (const op of ops)
    if (
      Object.values(first).some((p) => p.verification?.operation === op.id) &&
      !verified.some((o) => o.id === op.id)
    )
      verified = [...verified, { ...op, session: "signed-in" }];
  await probeLivenessReads(ops, verified, f.trace, origin, replayer, gate);
  vi.unstubAllGlobals();
  const policy = learnWriteResponses(ops, f.trace, origin, verified)[f.write.id];
  return { verified, policy, log, anonymous: policy?.verification?.liveness?.anonymous };
}

type Jar = { name: string; value: string; httpOnly?: boolean }[];
type Respond = (url: URL, method: string, cookies: string, gets: number) => Response;
/** Approve and run the deletion with the learned model, its login route and the vault jar. */
async function execute(
  f: Fixture,
  learned: Awaited<ReturnType<typeof learn>>,
  respond: Respond,
  jar: Jar,
) {
  const sessions = new InMemorySessions();
  sessions.set(origin, undefined, {
    cookies: jar.map((c) => ({
      domain: "shop.test",
      path: "/",
      secure: true,
      httpOnly: false,
      ...c,
    })),
  });
  const gate = createApprovalGate();
  const calls: string[] = [];
  const wire: { path: string; cookie: string }[] = [];
  let itemGets = 0;
  const executor = createExecutor({
    model: readSiteModel(
      await writeSiteModel({
        id: "urn:model",
        site: origin,
        generatedAt: provenance.learnedAt,
        version: "1",
        operations: learned.verified,
        flows: [],
        // profile.ts: the login route carries the cookies the sign-in set or changed.
        ...(f.loginCookieNames.length
          ? { login: [{ method: "password", sessionCookies: f.loginCookieNames }] }
          : {}),
      }),
    ),
    sessions,
    writeResponses: learned.policy ? { [f.write.id]: learned.policy } : {},
    gate,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const header = new Headers(init?.headers).get("cookie") ?? "";
      wire.push({ path: url.pathname, cookie: header.replace(/=[^;]*/g, "") });
      calls.push(`${method} ${url.pathname}${url.search}`);
      if (method === "GET" && url.pathname.startsWith("/stores/main/products")) itemGets++;
      return respond(url, method, header, itemGets);
    },
  });
  const request = { node: "urn:request", types: [f.write.actionType], values: () => [] };
  const pause = await executor.execute(request);
  expect(calls).toHaveLength(0);
  gate.approve(required(pause.approval).id);
  const result = await executor.execute(request, { approvalId: required(pause.approval).id });
  return {
    outcome: result.outcome?.status,
    committed: result.committed.length,
    calls,
    listing: wire.filter((w) => w.path === "/stores/main/listing").map((w) => w.cookie),
  };
}

const has =
  (name: string, value = "1") =>
  (cookies: string) =>
    new RegExp(`(?:^|; )${name}=${value}(?:;|$)`).test(cookies);

/** The runtime site: the deletion is refused or performed, the listing answers `listing`. */
const runtime =
  (
    f: Fixture,
    listing: (cookies: string) => Response,
    landing = '<div role="alert">Unable to change product.</div>',
  ): Respond =>
  (url, method, cookies, gets) => {
    if (method === "POST")
      return new Response(null, { status: 303, headers: { location: "/products" } });
    if (url.pathname === "/products")
      return new Response(landing, { headers: { "content-type": "text/html" } });
    if (url.pathname === "/stores/main/listing") return listing(cookies);
    // The item answers present, then the empty not-found the demonstration showed.
    return gets === 1
      ? Response.json(f.row("73"))
      : new Response("", { status: 404, headers: { "content-type": "text/plain;charset=UTF-8" } });
  };

// ---------------------------------------------------------------- decision 1 (review rows)
type Gatekeeper = "splash" | "first-visit-redirect" | "cookie-check-home";
const quickLoginHome =
  '<html><body><div class="top"><a href="/">Example shop</a></div><div class="quick-login"><h2>Sign in</h2><form method="post" action="/login_check"><input name="user"><input type="password" name="pw"><button>Sign in</button></form></div><div class="promo"><p>Welcome to the example shop. New arrivals every week.</p></div></body></html>';
const gateAnswer = (mode: Gatekeeper): Answer =>
  mode === "splash"
    ? {
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: '<html><body><main><h2>Welcome to the example shop</h2><p>Please confirm you are over 18, or sign in.</p><form method="post" action="/login_check"><input name="user"><input type="password" name="pw"><button>Continue</button></form><a href="/age?ok=1">I am over 18</a></main></body></html>',
      }
    : mode === "first-visit-redirect"
      ? { status: 302, body: "", location: "/login?first_visit=1" }
      : { status: 302, body: "", location: "/?cookie_check=1" };

/** The review's hostile site: the listing renders for any visitor holding the gate cookie. */
const gateServer =
  (f: Fixture, gate: string, mode: Gatekeeper): Server =>
  (url, cookies) =>
    url.pathname === "/"
      ? { status: 200, contentType: "text/html", body: quickLoginHome }
      : url.pathname !== "/stores/main/listing"
        ? { status: 404, contentType: "text/plain", body: "" }
        : has(gate)(cookies)
          ? { status: 200, contentType: "application/json", body: JSON.stringify(f.liveBody()) }
          : gateAnswer(mode);

it.each<[Gatekeeper, string, boolean]>([
  ["splash", "age_ok", true],
  ["first-visit-redirect", "age_ok", true],
  ["splash", "remember_age", false],
  ["splash", "visitor_token", false],
  ["cookie-check-home", "cc", true],
])("r21 the %s gate on cookie %s (httpOnly %s) is kept in the control: Uncertain", async (mode, gate, httpOnly) => {
  const f = fixture();
  const learned = await learn(
    f,
    [cookie("session", "fixture-secret-session", true), cookie(gate, "1", httpOnly)],
    gateServer(f, gate, mode),
  );
  // The control carried the gate cookie (no login evidence) and not the login-set session, so
  // the listing rendered and no liveness read was learned.
  expect(learned.log).toContain(`control /stores/main/listing [${gate}]`);
  expect(learned.log.filter((l) => l.startsWith("control") && l.includes("session"))).toEqual([]);
  expect(learned.anonymous).toBeUndefined();
  // The cookie-check redirect never made the quick-login home page a login route.
  expect(learned.log.some((l) => / \/\?cookie_check=1 /.test(l))).toBe(false);
  // Runtime: the account session expired server-side; the vault still holds both cookies.
  for (const landing of [
    '<div role="alert">Unable to change product.</div>',
    "<p>Product list</p>",
  ]) {
    const run = await execute(
      f,
      learned,
      runtime(
        f,
        (cookies) =>
          has(gate)(cookies) ? Response.json(f.liveBody()) : respondWith(gateAnswer(mode)),
        landing,
      ),
      [
        { name: "session", value: "fixture-secret-session", httpOnly: true },
        { name: gate, value: "1", httpOnly },
      ],
    );
    expect(run.outcome).toBe("uncertain");
    expect(run.committed).toBe(1);
  }
});

it("r21 learns no liveness read without login evidence: no control is sent", async () => {
  const f = fixture({ ...shopSignIn, setCookies: [] });
  const learned = await learn(
    f,
    [cookie("session", "fixture-secret-session", true)],
    (url, cookies) =>
      url.pathname !== "/stores/main/listing"
        ? { status: 404, contentType: "text/plain", body: "" }
        : has("session", "fixture-secret-session")(cookies)
          ? { status: 200, contentType: "application/json", body: JSON.stringify(f.liveBody()) }
          : { status: 302, body: "", location: "/login" },
  );
  expect(learned.log.filter((l) => l.startsWith("control /stores/main/listing [session]"))).toEqual(
    [],
  );
  expect(learned.anonymous).toBeUndefined();
  const run = await execute(
    f,
    learned,
    runtime(f, (cookies) =>
      has("session", "fixture-secret-session")(cookies)
        ? Response.json(f.liveBody())
        : new Response(null, { status: 302, headers: { location: "/login" } }),
    ),
    [{ name: "session", value: "fixture-secret-session", httpOnly: true }],
  );
  expect(run.outcome).toBe("uncertain");
  expect(run.committed).toBe(1);
});

// ---------------------------------------------------------------- honest sites complete
it("r21 the honest Postmill-style site completes: the login-set session is dropped, gate cookies kept", async () => {
  const f = fixture({ ...shopSignIn, setCookies: ["PHPSESSID"] });
  const live = has("PHPSESSID", "fixture-secret-session");
  const learned = await learn(
    f,
    [cookie("PHPSESSID", "fixture-secret-session", true), cookie("_cookie_check", "1", true)],
    (url, cookies) =>
      url.pathname !== "/stores/main/listing"
        ? { status: 404, contentType: "text/plain", body: "" }
        : live(cookies)
          ? { status: 200, contentType: "application/json", body: JSON.stringify(f.liveBody()) }
          : { status: 302, body: "", location: "/login" },
  );
  expect(learned.log).toContain("control /stores/main/listing [_cookie_check]");
  expect(learned.anonymous).toMatchObject({
    refusal: "login-redirect",
    route: `${origin}/login`,
  });
  const run = await execute(
    f,
    learned,
    runtime(
      f,
      (cookies) =>
        live(cookies)
          ? Response.json(f.liveBody())
          : new Response(null, { status: 302, headers: { location: "/login" } }),
      "<p>Product deleted.</p>",
    ),
    [
      { name: "PHPSESSID", value: "fixture-secret-session", httpOnly: true },
      { name: "_cookie_check", value: "1", httpOnly: true },
    ],
  );
  expect(run.outcome).toBe("completed");
  expect(run.listing).toEqual(["PHPSESSID; _cookie_check", "_cookie_check"]);
});

const adminLogin = (action: string, fields = "") =>
  `<html><body><header><a href="/admin">Example admin</a></header><form method="post" action="${action}" id="login-form">${
    fields ||
    '<input type="hidden" name="form_key" value="fixture-form-key"><label>User <input name="login[username]"></label><input type="password" name="login[password]">'
  }<button>Sign in</button></form></body></html>`;
// The admin sign-in page posts to itself (`/admin`); its form-key slot is the hidden form_key.
const adminSignIn: SignIn = {
  page: "/admin",
  action: "",
  post: "/admin",
  setCookies: ["admin"],
  body: adminLogin(""),
};
const expired = { ajaxExpired: 1, ajaxRedirect: `${origin}/admin/admin/` };
/**
 * A Magento-style admin: the listing answers a flagged login envelope redirecting to
 * `/admin/admin/` without the admin session; that page is a sign-in page whose form posts to
 * `formAction`, and the signed-in admin is redirected from it to the dashboard (or `signedIn`).
 */
const adminServer =
  (f: Fixture, formAction: string, signedIn?: Answer, fields?: string): Server =>
  (url, cookies) => {
    const live = has("admin", "fixture-secret-admin")(cookies);
    if (url.pathname === "/admin/admin/")
      return live
        ? (signedIn ?? { status: 302, body: "", location: "/admin/admin/dashboard/" })
        : { status: 200, contentType: "text/html", body: adminLogin(formAction, fields) };
    if (url.pathname !== "/stores/main/listing")
      return { status: 404, contentType: "text/plain", body: "" };
    return live
      ? { status: 200, contentType: "application/json", body: JSON.stringify(f.liveBody()) }
      : { status: 200, contentType: "application/json", body: JSON.stringify(expired) };
  };
const adminJar = [
  cookie("admin", "fixture-secret-admin", true),
  // Classed as credentials by the redaction heuristic, but not login evidence: kept.
  cookie("form_key", "fixture-form-key", false),
  cookie("mage-cache-sessid", "true", false),
];
async function adminRun(f: Fixture, learned: Awaited<ReturnType<typeof learn>>) {
  return execute(
    f,
    learned,
    runtime(
      f,
      (cookies) =>
        has("admin", "fixture-secret-admin")(cookies)
          ? Response.json(f.liveBody())
          : Response.json(expired),
      "<p>Product deleted.</p>",
    ),
    adminJar.map(({ name, value, httpOnly }) => ({ name, value, httpOnly })),
  );
}

it("r21 the honest Magento-style admin completes through a verified login route", async () => {
  const f = fixture(adminSignIn);
  const learned = await learn(f, adminJar, adminServer(f, "/admin"));
  expect(learned.log).toEqual(
    expect.arrayContaining([
      "control /stores/main/listing [form_key; mage-cache-sessid]",
      "control /admin/admin/ [form_key; mage-cache-sessid]",
      "signed-in /admin/admin/ [admin; form_key; mage-cache-sessid]",
    ]),
  );
  expect(learned.anonymous).toEqual({
    refusal: "login-envelope",
    loginRoutes: [`${origin}/admin`, `${origin}/admin/admin/`],
    route: `${origin}/admin/admin/`,
    verifiedRoutes: [{ route: `${origin}/admin/admin/`, url: `${origin}/admin/admin/` }],
  });
  const run = await adminRun(f, learned);
  expect(run.outcome).toBe("completed");
  expect(run.listing).toEqual([
    "admin; form_key; mage-cache-sessid",
    "form_key; mage-cache-sessid",
  ]);
});

// ---------------------------------------------------------------- decision 2 (routes)
// Owner decision: a self-posting form counts as the site's login form when its credential field
// names (username, password, declared form-key slot) are the learned login's and the signed-in
// fetch of the page redirects away. This is the real Magento shape (`action=""`).
it.each<[string, string]>([
  ["an empty action", ""],
  ["a self-referencing action", "/admin/admin/"],
])("r21 a self-posting sign-in page with %s, the learned field names and a signed-in redirect is verified", async (_name, action) => {
  const f = fixture(adminSignIn);
  const learned = await learn(f, adminJar, adminServer(f, action));
  expect(learned.anonymous).toEqual({
    refusal: "login-envelope",
    loginRoutes: [`${origin}/admin`, `${origin}/admin/admin/`],
    route: `${origin}/admin/admin/`,
    verifiedRoutes: [{ route: `${origin}/admin/admin/`, url: `${origin}/admin/admin/` }],
  });
  const run = await adminRun(f, learned);
  expect(run.outcome).toBe("completed");
});

const signedInLoginPage: Answer = { status: 200, contentType: "text/html", body: adminLogin("") };
it.each<[string, string, Answer | undefined, string | undefined]>([
  ["a sign-in page posting to a third URL", "/newsletter/subscribe", undefined, undefined],
  [
    "a self-posting sign-in page with other field names",
    "",
    undefined,
    '<input type="hidden" name="form_key" value="fixture-form-key"><input name="email"><input type="password" name="pass">',
  ],
  [
    "a self-posting sign-in page without the declared form-key slot",
    "",
    undefined,
    '<label>User <input name="login[username]"></label><input type="password" name="login[password]">',
  ],
  [
    "a self-posting sign-in page with an extra password field",
    "",
    undefined,
    '<input type="hidden" name="form_key" value="fixture-form-key"><input name="login[username]"><input type="password" name="login[password]"><input type="password" name="login[otp]">',
  ],
  // Rule (c): the signed-in fetch must redirect away, never answer 200.
  ["a self-posting sign-in page served signed in with 200", "", signedInLoginPage, undefined],
  [
    "a self-posting sign-in page whose signed-in fetch redirects to itself",
    "",
    { status: 302, body: "", location: "/admin/admin/?retry=1" },
    undefined,
  ],
  [
    "a page the signed-in admin is served as an ordinary page",
    "/admin",
    {
      status: 200,
      contentType: "text/html",
      body: "<html><body><main><h1>Dashboard</h1><p>Welcome back.</p></main></body></html>",
    },
    undefined,
  ],
])("r21 a redirect target that is %s is no verified login route", async (_name, action, signedIn, fields) => {
  const f = fixture(adminSignIn);
  const learned = await learn(f, adminJar, adminServer(f, action, signedIn, fields));
  expect(learned.log).toContain("control /admin/admin/ [form_key; mage-cache-sessid]");
  expect(learned.anonymous).toBeUndefined();
  const run = await adminRun(f, learned);
  expect(run.outcome).toBe("uncertain");
  expect(run.committed).toBe(1);
});

it("r21 the signed-in fetch of a redirect target goes through the read gate; denied, it is unverified", async () => {
  const f = fixture(adminSignIn);
  const summaries: string[] = [];
  const gate: Gate = {
    authorize: async (request) => {
      summaries.push(request.summary);
      return /signed-in session/.test(request.summary)
        ? { kind: "deny", reason: "Fixture denial" }
        : { kind: "allow" };
    },
  };
  const learned = await learn(f, adminJar, adminServer(f, "/admin"), gate);
  expect(summaries.some((s) => /signed-in session/.test(s))).toBe(true);
  expect(learned.log.filter((l) => l.startsWith("signed-in /admin/admin/"))).toEqual([]);
  expect(learned.anonymous).toBeUndefined();
});

it("r21 the quick-login home page is rejected as a route: the site root is never fetched or verified", async () => {
  // Without the session the listing redirects to the home page, which holds a quick-login box.
  const f = fixture();
  const live = has("session", "fixture-secret-session");
  const learned = await learn(
    f,
    [cookie("session", "fixture-secret-session", true)],
    (url, cookies) =>
      url.pathname === "/"
        ? { status: 200, contentType: "text/html", body: quickLoginHome }
        : url.pathname !== "/stores/main/listing"
          ? { status: 404, contentType: "text/plain", body: "" }
          : live(cookies)
            ? { status: 200, contentType: "application/json", body: JSON.stringify(f.liveBody()) }
            : { status: 302, body: "", location: "/?signin=1" },
  );
  expect(learned.log).toContain("control /stores/main/listing []");
  expect(learned.log.some((l) => / \/\?signin=1 /.test(l))).toBe(false);
  expect(learned.anonymous).toBeUndefined();
  const run = await execute(
    f,
    learned,
    runtime(f, (cookies) =>
      live(cookies)
        ? Response.json(f.liveBody())
        : new Response(null, { status: 302, headers: { location: "/?signin=1" } }),
    ),
    [{ name: "session", value: "fixture-secret-session", httpOnly: true }],
  );
  expect(run.outcome).toBe("uncertain");
});

it("r21 a non-root quick-login page served to the signed-in context as a home page is rejected", async () => {
  const f = fixture();
  const live = has("session", "fixture-secret-session");
  const learned = await learn(
    f,
    [cookie("session", "fixture-secret-session", true)],
    (url, cookies) =>
      url.pathname === "/welcome"
        ? live(cookies)
          ? {
              status: 200,
              contentType: "text/html",
              body: '<html><body><div class="promo"><p>Welcome back. New arrivals every week.</p></div></body></html>',
            }
          : { status: 200, contentType: "text/html", body: quickLoginHome }
        : url.pathname !== "/stores/main/listing"
          ? { status: 404, contentType: "text/plain", body: "" }
          : live(cookies)
            ? { status: 200, contentType: "application/json", body: JSON.stringify(f.liveBody()) }
            : { status: 302, body: "", location: "/welcome" },
  );
  expect(learned.log).toEqual(
    expect.arrayContaining(["control /welcome []", "signed-in /welcome [session]"]),
  );
  expect(learned.anonymous).toBeUndefined();
});

it("r21 a signed-in page of the target route anywhere in the trace withdraws a verified route", () => {
  const f = fixture();
  const signIn = f.trace.filter((r) => r.phase === "login");
  const at = (seq: number, change: Partial<RecordedRequest>): RecordedRequest => ({
    seq,
    phase: "verify",
    method: "GET",
    url: `${origin}/admin/`,
    resourceType: "replay",
    requestHeaders: {},
    cookieNames: [],
    authenticationContext: "fictional-context",
    ...change,
  });
  const control = at(60, {
    resourceType: "replay-anonymous",
    credentialsOnlyControl: true,
    loginRouteProbe: true,
    status: 200,
    contentType: "text/html",
    bodySample:
      '<form method="post" action="/login_check"><input type="password" name="pw"></form>',
  });
  const away = at(61, { loginRouteProbe: true, status: 302, redirectedTo: `${origin}/dashboard` });
  const page = {
    status: 200,
    contentType: "text/html",
    bodySample: "<main><p>Dashboard</p></main>",
  };
  const learned = [`${origin}/login`, `${origin}/login_check`];
  const verify = (...extra: RecordedRequest[]) =>
    verifiedLoginRoutes([...signIn, control, away, ...extra], origin, learned);
  expect(verify()).toEqual([{ route: `${origin}/admin/`, url: `${origin}/admin/` }]);
  // The signed-in crawl, or the page the sign-in landed on, served the route as an ordinary page.
  expect(verify(at(30, { phase: "crawl", resourceType: "document", ...page }))).toEqual([]);
  expect(verify(at(-17, { phase: "login", resourceType: "document", ...page }))).toEqual([]);
  // A page served before the sign-in POST, or to a control, is not the signed-in context.
  expect(verify(at(-25, { phase: "login", resourceType: "document", ...page }))).toEqual([
    { route: `${origin}/admin/`, url: `${origin}/admin/` },
  ]);
  expect(
    verify(at(62, { resourceType: "replay-anonymous", credentialsOnlyControl: true, ...page })),
  ).toEqual([{ route: `${origin}/admin/`, url: `${origin}/admin/` }]);
});
