// AUTHORED-BY Claude Opus 5.5
// Round-20 regressions through the real profiler steps (verify, restore, control probe, learn,
// sidecar round trip, executor): the credentials-only control, pinned refusals, narrow login
// routes, the login JSON envelope and collection absence behind the liveness proof. Ported
// from the round-20 review probes. Every site, account and item here is fictional.
import {
  createApprovalGate,
  createExecutor,
  type Gate,
  InMemorySessions,
} from "@jeswr/site-executor";
import { type Operation, readSiteModel, SCHEMA, writeSiteModel } from "@jeswr/site-model";
import { expect, it } from "vitest";
import type { RecordedRequest } from "../src/types.js";
import { type Replayer, verifyOperations } from "../src/verify.js";
import {
  learnedLoginRoutes,
  probeLivenessReads,
  verifiedLoginRoutes,
} from "../src/write-liveness.js";
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

function fixture() {
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
    cookieNames: ["session"],
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
      url: `${origin}/login`,
      resourceType: "document",
      contentType: "text/html",
      cookieNames: [],
      bodySample:
        '<form method="post" action="/login_check"><input type="password" name="pw"></form>',
    }),
    record(-19, {
      phase: "login",
      demonstration: undefined,
      method: "POST",
      url: `${origin}/login_check`,
      resourceType: "document",
      cookieNames: [],
      status: 302,
      redirectedTo: `${origin}/`,
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
  ];
  return { write, read, live, row, liveBody, record, trace };
}

type Answer = { status: number; contentType?: string; body: string; location?: string };

/** Who sends a profiler replay: the signed-in context, a cookieless fetch, or the control. */
type Sender = "signed-in" | "cookieless" | "control";
/**
 * A replayer that records replays into the trace as the Playwright replayer does. The signed-in
 * context holds the session cookie and `contextCookies`; a cookieless replay holds nothing;
 * a credentials-only control holds `contextCookies` (the non-credential cookies) only.
 */
function recordingReplayer(
  trace: RecordedRequest[],
  answer: (url: URL, sender: Sender, cookies: string[]) => Answer | "timeout",
  contextCookies: string[] = [],
  sent: { url: string; sender: Sender }[] = [],
): Replayer {
  return {
    async get(url, { signedIn, headers, authorize, credentialsOnly, loginRouteProbe }) {
      await authorize?.(url);
      const sender: Sender = signedIn ? "signed-in" : credentialsOnly ? "control" : "cookieless";
      const cookies =
        sender === "signed-in"
          ? ["session", ...contextCookies]
          : sender === "control"
            ? contextCookies
            : [];
      sent.push({ url, sender });
      const out = answer(new URL(url), sender, cookies);
      if (out === "timeout") throw new Error("The operation was aborted due to timeout");
      trace.push({
        seq: 1000 + trace.length,
        completedAt: 1001 + trace.length,
        phase: "verify",
        method: "GET",
        url,
        resourceType: signedIn ? "replay" : "replay-anonymous",
        requestHeaders: headers ?? {},
        cookieNames: cookies,
        authenticationContext: signedIn ? "fictional-context" : `${sender}-context`,
        ...(sender === "control" ? { credentialsOnlyControl: true } : {}),
        ...(sender === "control" && loginRouteProbe
          ? {
              loginRouteProbe: true,
              ...(loginRouteProbe.hopOf !== undefined
                ? { loginRouteHopOf: loginRouteProbe.hopOf }
                : {}),
            }
          : {}),
        status: out.status,
        bodySample: out.body,
        ...(out.contentType ? { contentType: out.contentType } : {}),
        ...(out.location ? { redirectedTo: new URL(out.location, url).href } : {}),
      });
      return out;
    },
  };
}

/** The profiler's steps: verify, restore dropped verification reads, probe, learn. */
async function learn(
  f: ReturnType<typeof fixture>,
  ops: Operation[],
  replayer: Replayer,
  gate?: Gate,
) {
  const v = await verifyOperations(ops, {
    replayer,
    now: () => new Date(0),
    haveSession: true,
    recordedRequests: f.trace.slice(),
  });
  let verified = v.operations;
  // profile.ts: verification reads that verify dropped are restored as signed-in.
  const first = learnWriteResponses(ops, f.trace, origin);
  for (const op of ops)
    if (
      Object.values(first).some((p) => p.verification?.operation === op.id) &&
      !verified.some((o) => o.id === op.id)
    )
      verified = [...verified, { ...op, session: "signed-in" }];
  await probeLivenessReads(ops, verified, f.trace, origin, replayer, gate);
  return { verified, policy: learnWriteResponses(ops, f.trace, origin, verified)[f.write.id] };
}

type Jar = { name: string; value: string; httpOnly?: boolean }[];
async function execute(
  f: ReturnType<typeof fixture>,
  verified: Operation[],
  policy: ReturnType<typeof learnWriteResponses>[string] | undefined,
  respond: (url: URL, method: string, cookies: string, gets: number, headers: Headers) => Response,
  jar: Jar = [{ name: "session", value: "fixture-secret-session", httpOnly: true }],
  vaultHeaders?: Record<string, string>,
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
    ...(vaultHeaders ? { headers: vaultHeaders } : {}),
  });
  const gate = createApprovalGate();
  const calls: string[] = [];
  const wire: { url: string; cookie: string; headers: Record<string, string> }[] = [];
  let posts = 0;
  let itemGets = 0;
  const executor = createExecutor({
    model: readSiteModel(
      await writeSiteModel({
        id: "urn:model",
        site: origin,
        generatedAt: provenance.learnedAt,
        version: "1",
        operations: verified,
        flows: [],
      }),
    ),
    sessions,
    writeResponses: policy ? { [f.write.id]: policy } : {},
    gate,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const h = new Headers(init?.headers);
      const cookie = h.get("cookie") ?? "";
      wire.push({ url: url.href, cookie, headers: Object.fromEntries(h) });
      calls.push(
        `${method} ${url.pathname}${url.search}${/session=/.test(cookie) ? "" : " (control)"}`,
      );
      if (method === "POST") posts++;
      if (method === "GET" && url.pathname.startsWith("/stores/main/products")) itemGets++;
      return respond(url, method, cookie, itemGets, h);
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
    posts,
    calls,
    wire,
    sessions,
  };
}

const respondWith = (a: Answer): Response =>
  new Response(a.body || null, {
    status: a.status,
    headers: {
      ...(a.contentType ? { "content-type": a.contentType } : {}),
      ...(a.location ? { location: a.location } : {}),
    },
  });
const notFound = () =>
  new Response("", { status: 404, headers: { "content-type": "text/plain;charset=UTF-8" } });
const hasSession = (cookies: string) =>
  /(?:^|; )session=fixture-secret-session(?:;|$)/.test(cookies);
const sessionJar: Jar = [{ name: "session", value: "fixture-secret-session", httpOnly: true }];
const gatedJar: Jar = [...sessionJar, { name: "age_ok", value: "1" }];

// ---------------------------------------------------------------- decision 1 (review A1-A3)
type Gatekeeper = "splash-login-form" | "first-visit-login-redirect" | "bot-403-in-layout";
const gateAnswer = (mode: Gatekeeper): Answer =>
  mode === "splash-login-form"
    ? {
        status: 200,
        contentType: "text/html; charset=utf-8",
        body: '<html><body><main><h2>Welcome to the example shop</h2><p>Please confirm you are over 18, or sign in.</p><form method="post" action="/login_check"><input name="user"><input type="password" name="pw"><button>Continue</button></form><a href="/age?ok=1">I am over 18</a></main></body></html>',
      }
    : mode === "first-visit-login-redirect"
      ? { status: 302, body: "", location: "/login?first_visit=1" }
      : {
          status: 403,
          contentType: "text/html; charset=utf-8",
          body: '<html><body><div class="topbar"><a href="/">Example shop</a> <a href="/login">Log in</a></div><main><p>Request blocked. Please enable cookies.</p></main></body></html>',
        };

/**
 * The review's hostile shape: the listing renders for any visitor holding the first-visit
 * cookie `age_ok`, session or not, and shows a gate (with a login cue) to everyone else.
 */
async function gatekeeperScenario(mode: Gatekeeper, contextCookies: string[]) {
  const f = fixture();
  f.trace.push(
    f.record(100, {
      url: `${origin}/stores/main/listing`,
      bodySample: JSON.stringify(f.liveBody()),
    }),
  );
  const replayer = recordingReplayer(
    f.trace,
    (url, _sender, cookies) =>
      url.pathname !== "/stores/main/listing"
        ? { status: 404, contentType: "text/plain", body: "" }
        : cookies.includes("age_ok")
          ? { status: 200, contentType: "application/json", body: JSON.stringify(f.liveBody()) }
          : gateAnswer(mode),
    contextCookies,
  );
  return { f, ...(await learn(f, [f.write, f.read, f.live], replayer)) };
}

/** Runtime: the account session expired server-side; the vault still holds both cookies. */
const expiredButCookied =
  (
    f: ReturnType<typeof fixture>,
    mode: Gatekeeper,
    landing = "/products",
    landingBody = '<div role="alert">Unable to change product.</div>',
  ) =>
  (url: URL, method: string, cookies: string, gets: number): Response => {
    if (method === "POST")
      return new Response(null, { status: 303, headers: { location: landing } });
    if (url.pathname === landing)
      return new Response(landingBody, { headers: { "content-type": "text/html" } });
    if (url.pathname === "/stores/main/listing")
      return /age_ok=1/.test(cookies) ? Response.json(f.liveBody()) : respondWith(gateAnswer(mode));
    return gets === 1 ? Response.json(f.row("73")) : notFound();
  };

it.each<[Gatekeeper, string]>([
  ["splash-login-form", "holds the gate cookie"],
  ["first-visit-login-redirect", "holds the gate cookie"],
  ["bot-403-in-layout", "holds the gate cookie"],
  ["splash-login-form", "lacks the gate cookie"],
  ["first-visit-login-redirect", "lacks the gate cookie"],
  ["bot-403-in-layout", "lacks the gate cookie"],
])("r20 A: a cookie gate %s where the profiler context %s never completes an expired-session deletion", async (mode, context) => {
  const { f, verified, policy } = await gatekeeperScenario(
    mode,
    context === "holds the gate cookie" ? ["age_ok"] : [],
  );
  expect(policy?.verification?.notFound).toBeDefined();
  if (context === "holds the gate cookie")
    // The control keeps age_ok, renders the listing and proves nothing: no liveness read.
    expect(policy?.verification?.liveness).toBeUndefined();
  for (const [landing, body] of [
    ["/products", '<div role="alert">Unable to change product.</div>'],
    ["/products", "<p>Product list</p>"],
  ] as const) {
    const run = await execute(
      f,
      verified,
      policy,
      expiredButCookied(f, mode, landing, body),
      gatedJar,
    );
    expect(run.outcome).toBe("uncertain");
    expect(run.posts).toBe(1);
    expect(run.committed).toBe(1);
  }
});

it("r20 A: the honest cookie-gated site whose control keeps the gate cookie completes", async () => {
  // The listing needs the session; without age_ok every visitor first sees the splash.
  const f = fixture();
  f.trace.push(
    f.record(100, {
      url: `${origin}/stores/main/listing`,
      bodySample: JSON.stringify(f.liveBody()),
    }),
  );
  const sent: { url: string; sender: Sender }[] = [];
  const replayer = recordingReplayer(
    f.trace,
    (url, sender, cookies) =>
      url.pathname !== "/stores/main/listing"
        ? { status: 404, contentType: "text/plain", body: "" }
        : !cookies.includes("age_ok")
          ? gateAnswer("splash-login-form")
          : sender === "signed-in"
            ? { status: 200, contentType: "application/json", body: JSON.stringify(f.liveBody()) }
            : { status: 302, body: "", location: "/login" },
    ["age_ok"],
    sent,
  );
  const { verified, policy } = await learn(f, [f.write, f.read, f.live], replayer);
  expect(sent.filter((s) => s.url.endsWith("/listing")).map((s) => s.sender)).toEqual([
    "cookieless",
    "signed-in",
    "control",
  ]);
  expect(policy?.verification?.liveness?.anonymous).toEqual({
    refusal: "login-redirect",
    loginRoutes: [`${origin}/login`, `${origin}/login_check`],
    route: `${origin}/login`,
  });
  const site =
    (live: boolean) =>
    (url: URL, method: string, cookies: string, gets: number): Response => {
      if (method === "POST")
        return new Response(null, { status: 303, headers: { location: "/products" } });
      if (url.pathname === "/products")
        return new Response("<p>Product list</p>", { headers: { "content-type": "text/html" } });
      if (url.pathname === "/stores/main/listing")
        return !/age_ok=1/.test(cookies)
          ? respondWith(gateAnswer("splash-login-form"))
          : (live ? hasSession(cookies) : true)
            ? Response.json(f.liveBody())
            : respondWith({ status: 302, body: "", location: "/login" });
      return gets === 1 ? Response.json(f.row("73")) : notFound();
    };
  const done = await execute(f, verified, policy, site(true), gatedJar);
  expect(done.outcome).toBe("completed");
  expect(done.calls.slice(-2)).toEqual([
    "GET /stores/main/listing",
    "GET /stores/main/listing (control)",
  ]);
  // The same policy with the session expired and the listing rendering for age_ok alone.
  const expired = await execute(f, verified, policy, site(false), gatedJar);
  expect(expired.outcome).toBe("uncertain");
  expect(expired.committed).toBe(1);
});

// ---------------------------------------------------------------- decision 2 (review A4)
it("r20 A4: a cookie-check redirect to a quick-login home page is no login redirect", async () => {
  const f = fixture();
  const home = f.record(-30, {
    phase: "login",
    demonstration: undefined,
    url: `${origin}/`,
    resourceType: "document",
    contentType: "text/html",
    cookieNames: [],
    bodySample:
      '<html><body><div class="quick-login"><form method="post" action="/login_check"><input name="user"><input type="password" name="pw"></form></div><main><p>Latest products</p></main></body></html>',
  });
  f.trace.unshift(home);
  f.trace.push(
    f.record(100, {
      url: `${origin}/stores/main/listing`,
      bodySample: JSON.stringify(f.liveBody()),
    }),
  );
  expect(learnedLoginRoutes([], f.trace, origin)).toEqual([
    `${origin}/login`,
    `${origin}/login_check`,
  ]);
  const redirect = { status: 302, body: "", location: "/?cookie_check=1" };
  const replayer = recordingReplayer(f.trace, (url, sender) =>
    url.pathname === "/stores/main/listing"
      ? sender === "signed-in"
        ? { status: 200, contentType: "application/json", body: JSON.stringify(f.liveBody()) }
        : redirect
      : { status: 404, contentType: "text/plain", body: "" },
  );
  const { verified, policy } = await learn(f, [f.write, f.read, f.live], replayer);
  expect(policy?.verification?.liveness).toBeUndefined();
  const run = await execute(f, verified, policy, (url, method, cookies, gets) => {
    if (method === "POST")
      return new Response(null, { status: 303, headers: { location: "/products" } });
    if (url.pathname === "/products")
      return new Response('<div role="alert">Unable to change product.</div>');
    if (url.pathname === "/stores/main/listing")
      return cookies ? Response.json(f.liveBody()) : respondWith(redirect);
    return gets === 1 ? Response.json(f.row("73")) : notFound();
  });
  expect(run.outcome).toBe("uncertain");
  expect(run.committed).toBe(1);
});

it("r20 learns login routes only from login documents and their submitted form targets", () => {
  const f = fixture();
  const page = (seq: number, url: string, body: string, change: Partial<RecordedRequest> = {}) =>
    f.record(seq, {
      phase: "login",
      demonstration: undefined,
      url,
      resourceType: "document",
      contentType: "text/html",
      cookieNames: [],
      bodySample: body,
      ...change,
    });
  const form = (action: string) =>
    `<form method="post" action="${action}"><input name="user"><input type="password" name="pw"></form>`;
  const trace = [
    // A home page with a quick-login box beside a main listing is no login route, and the
    // target of its form is none either.
    page(
      -40,
      `${origin}/`,
      `<div>${form("/quick")}</div><main><ul><li>A</li><li>B</li><li>C</li></ul></main>`,
    ),
    page(-39, `${origin}/quick`, "", {
      method: "POST",
      contentType: undefined,
      bodySample: undefined,
    }),
    // A sign-in page with item rows beside its form is none either.
    page(-38, `${origin}/portal`, `${form("/portal/enter")}<article>Example news</article>`),
    page(-37, `${origin}/portal/enter`, "", {
      method: "POST",
      contentType: undefined,
      bodySample: undefined,
    }),
    // A truncated login page is no evidence.
    page(-36, `${origin}/partial`, form("/partial"), { bodyTruncated: true }),
    // The login page itself and the target its form posted to.
    page(-35, `${origin}/account/login?next=%2F`, `<main><h1>Sign in</h1>${form("")}</main>`),
    page(-34, `${origin}/account/login`, "", {
      method: "POST",
      contentType: undefined,
      bodySample: undefined,
    }),
    // A POST in the sign-in phase that no login form targets is no route.
    page(-33, `${origin}/analytics`, "", {
      method: "POST",
      contentType: undefined,
      bodySample: undefined,
    }),
  ];
  expect(learnedLoginRoutes([], trace, origin)).toEqual([`${origin}/account/login`]);
});

// ---------------------------------------------------------------- decision 4 (review B, B')
function rowsFixture(signedInRows: boolean) {
  const f = fixture();
  const rows: Operation = {
    ...f.read,
    id: "urn:rows",
    label: "Filter example products",
    inputs: [{ ...required(f.read.inputs[0]), location: "query" }],
    request: {
      method: "GET",
      urlTemplate: `${origin}/stores/main/products/rows{?id}`,
      headers: { "x-requested-with": "XMLHttpRequest" },
    },
    extraction: {
      format: "json",
      itemType: `${SCHEMA}Product`,
      itemPath: "/items",
      totalPath: "/total",
      fields: [
        ...json(["identifier"]),
        { property: `${SCHEMA}url`, path: "/url", datatype: "iri" },
        { property: `${SCHEMA}name`, path: "/name", untrusted: true },
      ],
    },
  };
  f.trace.splice(0, f.trace.length, ...f.trace.filter((r) => r.phase === "login"));
  f.trace.push(
    f.record(1, {
      url: `${origin}/stores/main/products/rows?id=42`,
      bodySample: JSON.stringify({ total: 1, items: [f.row("42")] }),
    }),
    f.record(2, {
      method: "POST",
      url: `${origin}/stores/main/products/delete/id/42`,
      postData: "",
      requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
      status: 303,
      redirectedTo: `${origin}/products`,
      completedAt: 3,
    }),
    f.record(3, {
      url: `${origin}/products`,
      contentType: "text/html",
      redirectedFrom: 2,
      responsePageError: false,
      bodySample: "<p>Product list</p>",
    }),
    f.record(4, {
      url: `${origin}/stores/main/products/rows?id=42`,
      bodySample: JSON.stringify({ total: 0, items: [] }),
    }),
  );
  // The review's site answers the empty envelope to anyone; an honest one asks for the session.
  // `pages` answers controls for other paths (redirect targets the profiler verifies).
  const replayer = (
    envelope?: unknown,
    pages: Record<string, Answer> = {},
    sent: { url: string; sender: Sender }[] = [],
  ) =>
    recordingReplayer(
      f.trace,
      (url, sender) =>
        sender !== "signed-in" && pages[url.pathname]
          ? (pages[url.pathname] as Answer)
          : url.pathname === "/stores/main/listing"
            ? sender === "signed-in"
              ? { status: 200, contentType: "application/json", body: JSON.stringify(f.liveBody()) }
              : envelope
                ? { status: 200, contentType: "application/json", body: JSON.stringify(envelope) }
                : { status: 302, body: "", location: "/login" }
            : signedInRows && sender !== "signed-in"
              ? { status: 302, body: "", location: "/login" }
              : {
                  status: 200,
                  contentType: "application/json",
                  body: JSON.stringify({ total: 0, items: [] }),
                },
      [],
      sent,
    );
  return { f, rows, replayer };
}

it.each([
  ["silent redirect back to the list", "/products", "<p>Product list</p>"],
  [
    "error flash on the list",
    "/products",
    '<div role="alert" class="message error">Unable to delete product.</div>',
  ],
  ["generic 'please sign in' notice", "/products", "<p>Please sign in to manage products.</p>"],
  [
    "redirect to the login page",
    "/login",
    '<form method="post" action="/login_check"><input name="user"><input type="password" name="pw"></form>',
  ],
])("r20 B: identity-filtered collection absence with an expired session landing on %s is Uncertain", async (_name, landing, landingBody) => {
  const { f, rows, replayer } = rowsFixture(false);
  const { verified, policy } = await learn(f, [f.write, rows], replayer());
  expect(policy?.verification?.operation).toBe("urn:rows");
  expect(policy?.verification?.notFound).toBeUndefined();
  expect(policy?.verification?.liveness).toBeUndefined();
  const run = await execute(f, verified, policy, (url, method, _cookies, gets) => {
    if (method === "POST")
      return new Response(null, { status: 303, headers: { location: landing } });
    if (url.pathname === landing)
      return new Response(landingBody, { headers: { "content-type": "text/html" } });
    return Response.json(gets === 1 ? { total: 1, items: [f.row("73")] } : { total: 0, items: [] });
  });
  expect(run.outcome).toBe("uncertain");
  expect(run.committed).toBe(1);
});

/** Runtime for a collection deletion with a liveness listing. */
const collectionSite =
  (f: ReturnType<typeof fixture>, listing: (cookies: string) => Response) =>
  (url: URL, method: string, cookies: string, gets: number): Response => {
    if (method === "POST")
      return new Response(null, { status: 303, headers: { location: "/products" } });
    if (url.pathname === "/products")
      return new Response("<p>Product list</p>", { headers: { "content-type": "text/html" } });
    if (url.pathname === "/stores/main/listing") return listing(cookies);
    return Response.json(gets === 1 ? { total: 1, items: [f.row("73")] } : { total: 0, items: [] });
  };

it("r20 collection absence completes with a passing liveness proof and is Uncertain without one", async () => {
  const { f, rows, replayer } = rowsFixture(true);
  // Without a witnessed liveness candidate no liveness read is learned.
  const bare = await learn(f, [f.write, rows, f.live], replayer());
  expect(bare.policy?.verification?.operation).toBe("urn:rows");
  expect(bare.policy?.verification?.liveness).toBeUndefined();
  const listing = (cookies: string) =>
    hasSession(cookies)
      ? Response.json(f.liveBody())
      : respondWith({ status: 302, body: "", location: "/login" });
  const unproven = await execute(f, bare.verified, bare.policy, collectionSite(f, listing));
  expect(unproven.outcome).toBe("uncertain");
  expect(unproven.committed).toBe(1);
  // With the listing witnessed in the demonstration, the probe learns it.
  f.trace.push(
    f.record(100, {
      url: `${origin}/stores/main/listing`,
      bodySample: JSON.stringify(f.liveBody()),
    }),
  );
  const { verified, policy } = await learn(f, [f.write, rows, f.live], replayer());
  expect(policy?.verification?.liveness?.anonymous).toMatchObject({
    refusal: "login-redirect",
    route: `${origin}/login`,
  });
  const done = await execute(f, verified, policy, collectionSite(f, listing));
  expect(done.outcome).toBe("completed");
  expect(done.calls.slice(-2)).toEqual([
    "GET /stores/main/listing",
    "GET /stores/main/listing (control)",
  ]);
  // An expired session whose listing renders anyway is Uncertain.
  const expired = await execute(
    f,
    verified,
    policy,
    collectionSite(f, () => Response.json(f.liveBody())),
  );
  expect(expired.outcome).toBe("uncertain");
});

it.each<[string, unknown, string | undefined]>([
  [
    "redirects to the learned login page",
    { ajaxExpired: 1, ajaxRedirect: `${origin}/login` },
    `${origin}/login`,
  ],
  [
    "redirects to a page that is no learned login route",
    { ajaxExpired: 1, ajaxRedirect: `${origin}/admin/` },
    undefined,
  ],
  ["carries no expiry flag", { ajaxRedirect: `${origin}/login` }, undefined],
])("r20 a login JSON envelope that %s", async (_name, envelope, route) => {
  const { f, rows, replayer } = rowsFixture(true);
  f.trace.push(
    f.record(100, {
      url: `${origin}/stores/main/listing`,
      bodySample: JSON.stringify(f.liveBody()),
    }),
  );
  const { verified, policy } = await learn(f, [f.write, rows, f.live], replayer(envelope));
  expect(policy?.verification?.liveness?.anonymous).toEqual(
    route
      ? {
          refusal: "login-envelope",
          loginRoutes: [`${origin}/login`, `${origin}/login_check`],
          route,
        }
      : undefined,
  );
  const listing = (cookies: string) =>
    hasSession(cookies) ? Response.json(f.liveBody()) : Response.json(envelope);
  const run = await execute(f, verified, policy, collectionSite(f, listing));
  expect(run.outcome).toBe(route ? "completed" : "uncertain");
  expect(run.committed).toBe(1);
});

// ---------------------------------------------------------------- review C, D, E
async function honestListing() {
  const f = fixture();
  f.trace.push(
    f.record(100, {
      url: `${origin}/stores/main/listing`,
      bodySample: JSON.stringify(f.liveBody()),
    }),
  );
  const replayer = recordingReplayer(
    f.trace,
    (url, sender) =>
      url.pathname !== "/stores/main/listing"
        ? { status: 404, contentType: "text/plain", body: "" }
        : sender === "signed-in"
          ? { status: 200, contentType: "application/json", body: JSON.stringify(f.liveBody()) }
          : { status: 302, body: "", location: "/login" },
    ["age_ok"],
  );
  return { f, ...(await learn(f, [f.write, f.read, f.live], replayer)) };
}
const deletion =
  (f: ReturnType<typeof fixture>, control: (cookies: string) => Response) =>
  (url: URL, method: string, cookies: string, gets: number): Response => {
    if (method === "POST")
      return new Response(null, { status: 303, headers: { location: "/products" } });
    if (url.pathname === "/products")
      return new Response("<p>Product list</p>", { headers: { "content-type": "text/html" } });
    if (url.pathname === "/stores/main/listing")
      return hasSession(cookies) ? Response.json(f.liveBody()) : control(cookies);
    return gets === 1 ? Response.json(f.row("73")) : notFound();
  };

it("r20 C: the control carries no session credential and cannot change the session", async () => {
  const { f, verified, policy } = await honestListing();
  const vault = {
    authorization: "Bearer fixture-secret-bearer",
    "x-api-key": "fixture-secret-key",
  };
  const run = await execute(
    f,
    verified,
    policy,
    deletion(f, () => {
      const h = new Headers({ location: "/login" });
      h.append("set-cookie", "session=anon-replaced; Path=/; Secure; HttpOnly");
      h.append("set-cookie", "age_ok=; Max-Age=0; Path=/");
      h.append("set-cookie", "tracker=anon; Path=/");
      return new Response(null, { status: 302, headers: h });
    }),
    gatedJar,
    vault,
  );
  expect(run.outcome).toBe("completed");
  const control = run.wire.filter((w) => !hasSession(w.cookie));
  expect(control).toHaveLength(1);
  expect(control[0]?.cookie).toBe("age_ok=1");
  expect(Object.keys(control[0]?.headers ?? {})).not.toContain("authorization");
  expect(Object.keys(control[0]?.headers ?? {})).not.toContain("x-api-key");
  expect(JSON.stringify(control)).not.toMatch(/fixture-secret/);
  const after = await run.sessions.get(origin, undefined);
  expect(after?.cookies.map((c) => `${c.name}=${c.value}`).sort()).toEqual([
    "age_ok=1",
    "session=fixture-secret-session",
  ]);
  expect(after?.headers).toEqual(vault);
});

it.each<[string, () => Response]>([
  [
    "a cross-origin SSO redirect",
    () => respondWith({ status: 302, body: "", location: "https://sso.test/login" }),
  ],
  [
    "a cached refusal",
    () => new Response(null, { status: 302, headers: { location: "/login", age: "30" } }),
  ],
  [
    "a network error",
    () => {
      throw new TypeError("fetch failed");
    },
  ],
  [
    "a 401 challenge that still renders the rows (another kind than the pinned redirect)",
    () =>
      new Response(JSON.stringify({ total: 2, items: [{ id: "80" }, { id: "81" }] }), {
        status: 401,
        headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
      }),
  ],
  ["the public rows", () => Response.json({ total: 2, items: [{ id: "80" }, { id: "81" }] })],
  [
    "a redirect to another learned login route",
    () => respondWith({ status: 302, body: "", location: "/login_check" }),
  ],
])("r20 D: a control answering %s leaves the deletion Uncertain", async (_name, control) => {
  const { f, verified, policy } = await honestListing();
  const run = await execute(f, verified, policy, deletion(f, control), gatedJar);
  expect(run.outcome).toBe("uncertain");
  expect(run.committed).toBe(1);
});

it("r20 E: a denied control is never sent and the deletion is Uncertain", async () => {
  const { f, verified, policy } = await honestListing();
  const sessions = new InMemorySessions();
  sessions.set(origin, undefined, {
    cookies: gatedJar.map((c) => ({
      domain: "shop.test",
      path: "/",
      secure: true,
      httpOnly: false,
      ...c,
    })),
  });
  const inner = createApprovalGate();
  const calls: string[] = [];
  const gate: Gate = {
    authorize: async (req) =>
      /without the session/.test(req.summary ?? "")
        ? { kind: "deny", reason: "Fixture denial" }
        : inner.authorize(req),
  };
  const respond = deletion(f, () => respondWith({ status: 302, body: "", location: "/login" }));
  let gets = 0;
  const executor = createExecutor({
    model: readSiteModel(
      await writeSiteModel({
        id: "urn:model",
        site: origin,
        generatedAt: provenance.learnedAt,
        version: "1",
        operations: verified,
        flows: [],
      }),
    ),
    sessions,
    writeResponses: policy ? { [f.write.id]: policy } : {},
    gate,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const cookie = new Headers(init?.headers).get("cookie") ?? "";
      calls.push(`${method} ${url.pathname}${hasSession(cookie) ? "" : " (control)"}`);
      if (method === "GET" && url.pathname.startsWith("/stores/main/products")) gets++;
      return respond(url, method, cookie, gets);
    },
  });
  const request = { node: "urn:request", types: [f.write.actionType], values: () => [] };
  const pause = await executor.execute(request);
  expect(calls).toHaveLength(0);
  inner.approve(required(pause.approval).id);
  const result = await executor.execute(request, { approvalId: required(pause.approval).id });
  expect(result.outcome?.status).toBe("uncertain");
  expect(result.committed).toHaveLength(1);
  expect(calls).toContain("GET /stores/main/listing");
  expect(calls).not.toContain("GET /stores/main/listing (control)");
});

it("r20 the profiler's control probe goes through the read gate and is sent once", async () => {
  const f = fixture();
  f.trace.push(
    f.record(100, {
      url: `${origin}/stores/main/listing`,
      bodySample: JSON.stringify(f.liveBody()),
    }),
  );
  const verified = [f.write, f.read, { ...f.live, session: "signed-in" as const }];
  const ops = [f.write, f.read, f.live];
  const sent: { url: string; sender: Sender }[] = [];
  const replayer = recordingReplayer(
    f.trace,
    () => ({ status: 302, body: "", location: "/login" }),
    ["age_ok"],
    sent,
  );
  await probeLivenessReads(ops, verified, f.trace, origin, replayer, {
    authorize: async () => ({ kind: "deny", reason: "Fixture denial" }),
  });
  expect(sent).toHaveLength(0);
  await probeLivenessReads(ops, verified, f.trace, origin, replayer);
  await probeLivenessReads(ops, verified, f.trace, origin, replayer);
  expect(sent).toEqual([{ url: `${origin}/stores/main/listing`, sender: "control" }]);
});

// ---------------------------------------------------------------- decision 5: verified routes
const loginDocument: Answer = {
  status: 200,
  contentType: "text/html; charset=utf-8",
  body: '<html><body><header><a href="/">Example admin</a></header><form method="post" action=""><label>User <input name="user"></label><input type="password" name="pw"><button>Sign in</button></form></body></html>',
};
const dashboard: Answer = {
  status: 200,
  contentType: "text/html; charset=utf-8",
  body: '<html><body><div class="quick-login"><form method="post" action="/login_check"><input type="password" name="pw"></form></div><main><ul><li>Widget</li><li>Gadget</li><li>Gizmo</li></ul></main></body></html>',
};
const expired = (redirect: string) => ({ ajaxExpired: 1, ajaxRedirect: redirect });

async function verifiedRouteScenario(
  envelope: unknown,
  pages: Record<string, Answer>,
  gate?: Gate,
) {
  const { f, rows, replayer } = rowsFixture(true);
  f.trace.push(
    f.record(100, {
      url: `${origin}/stores/main/listing`,
      bodySample: JSON.stringify(f.liveBody()),
    }),
  );
  const sent: { url: string; sender: Sender }[] = [];
  const learned = await learn(f, [f.write, rows, f.live], replayer(envelope, pages, sent), gate);
  const run = await execute(
    f,
    learned.verified,
    learned.policy,
    collectionSite(f, (cookies) =>
      hasSession(cookies) ? Response.json(f.liveBody()) : Response.json(envelope),
    ),
  );
  return { f, sent, run, policy: learned.policy };
}

it("r20 a login envelope redirecting to a verified login page is accepted and pinned", async () => {
  const { sent, run, policy } = await verifiedRouteScenario(expired(`${origin}/admin/`), {
    "/admin/": loginDocument,
  });
  expect(policy?.verification?.liveness?.anonymous).toEqual({
    refusal: "login-envelope",
    loginRoutes: [`${origin}/admin/`, `${origin}/login`, `${origin}/login_check`],
    route: `${origin}/admin/`,
    verifiedRoutes: [{ route: `${origin}/admin/`, url: `${origin}/admin/` }],
  });
  // The redirect target was fetched once, as a credentials-only control.
  expect(sent.filter((s) => s.url === `${origin}/admin/`)).toEqual([
    { url: `${origin}/admin/`, sender: "control" },
  ]);
  expect(run.outcome).toBe("completed");
  expect(run.calls.slice(-2)).toEqual([
    "GET /stores/main/listing",
    "GET /stores/main/listing (control)",
  ]);
});

it("r20 a verified route may follow one same-origin hop to an already-learned login route", async () => {
  const { policy, run } = await verifiedRouteScenario(expired("/admin/"), {
    "/admin/": { status: 302, body: "", location: "/login" },
    "/login": loginDocument,
  });
  expect(policy?.verification?.liveness?.anonymous?.verifiedRoutes).toEqual([
    { route: `${origin}/admin/`, url: `${origin}/admin/`, via: `${origin}/login` },
  ]);
  expect(run.outcome).toBe("completed");
});

it.each<[string, unknown, Record<string, Answer>]>([
  ["a page that is no login document", expired(`${origin}/admin/`), { "/admin/": dashboard }],
  [
    "a page that redirects to a route that is not learned",
    expired(`${origin}/admin/`),
    { "/admin/": { status: 302, body: "", location: "/welcome" }, "/welcome": loginDocument },
  ],
  [
    "a hop whose answer is no login document",
    expired(`${origin}/admin/`),
    { "/admin/": { status: 302, body: "", location: "/login" }, "/login": dashboard },
  ],
  ["another origin", expired("https://other.test/admin/"), {}],
  [
    "a truncated-looking empty page",
    expired(`${origin}/admin/`),
    { "/admin/": { status: 200, contentType: "text/html", body: "" } },
  ],
  [
    "a login page answered with an error status",
    expired(`${origin}/admin/`),
    { "/admin/": { ...loginDocument, status: 403 } },
  ],
])("r20 a login envelope redirecting to %s is rejected", async (_name, envelope, pages) => {
  const { sent, run, policy } = await verifiedRouteScenario(envelope, pages);
  expect(policy?.verification?.liveness).toBeUndefined();
  expect(sent.some((s) => !s.url.startsWith(origin))).toBe(false);
  // A same-origin target was fetched (as a control) and rejected on its answer.
  if (JSON.stringify(envelope).includes(origin))
    expect(sent).toContainEqual({ url: `${origin}/admin/`, sender: "control" });
  expect(run.outcome).toBe("uncertain");
  expect(run.committed).toBe(1);
});

it("r20 an unverified route is rejected: the redirect target's probe goes through the read gate first", async () => {
  const order: string[] = [];
  const gate: Gate = {
    authorize: async (request) => {
      order.push(request.summary);
      return /sign-in page/.test(request.summary)
        ? { kind: "deny", reason: "Fixture denial" }
        : { kind: "allow" };
    },
  };
  const { sent, run, policy } = await verifiedRouteScenario(
    expired(`${origin}/admin/`),
    { "/admin/": loginDocument },
    gate,
  );
  expect(order.some((summary) => /sign-in page/.test(summary))).toBe(true);
  // Denied before transmission: the target was never fetched, so it is no login route.
  expect(sent.filter((s) => s.url === `${origin}/admin/`)).toEqual([]);
  expect(policy?.verification?.liveness).toBeUndefined();
  expect(run.outcome).toBe("uncertain");
});

it("r20 verified login routes need every fetch of the target to be a login document", () => {
  const f = fixture();
  const probe = (seq: number, url: string, change: Partial<RecordedRequest>) =>
    f.record(seq, {
      phase: "verify",
      demonstration: undefined,
      url,
      resourceType: "replay-anonymous",
      credentialsOnlyControl: true,
      loginRouteProbe: true,
      cookieNames: [],
      ...change,
    });
  const page = { status: 200, contentType: "text/html", bodySample: loginDocument.body };
  const learned = [`${origin}/login`];
  expect(verifiedLoginRoutes([probe(1, `${origin}/admin/`, page)], origin, learned)).toEqual([
    { route: `${origin}/admin/`, url: `${origin}/admin/` },
  ]);
  // A second fetch that served something else withdraws it.
  expect(
    verifiedLoginRoutes(
      [
        probe(1, `${origin}/admin/`, page),
        probe(2, `${origin}/admin/`, { ...page, bodySample: dashboard.body }),
      ],
      origin,
      learned,
    ),
  ).toEqual([]);
  // A plain cookieless replay, or a control that was not a route probe, is no evidence.
  expect(
    verifiedLoginRoutes(
      [
        probe(1, `${origin}/admin/`, { ...page, credentialsOnlyControl: undefined }),
        probe(2, `${origin}/panel/`, { ...page, loginRouteProbe: undefined }),
      ],
      origin,
      learned,
    ),
  ).toEqual([]);
  // A truncated login page is no evidence.
  expect(
    verifiedLoginRoutes(
      [probe(1, `${origin}/admin/`, { ...page, bodyTruncated: true })],
      origin,
      learned,
    ),
  ).toEqual([]);
  // A hop counts only with its own login-document answer recorded for that target.
  const hop = probe(1, `${origin}/admin/`, {
    status: 302,
    redirectedTo: `${origin}/login`,
    bodySample: "",
  });
  expect(verifiedLoginRoutes([hop], origin, learned)).toEqual([]);
  expect(
    verifiedLoginRoutes(
      [hop, probe(2, `${origin}/login`, { ...page, loginRouteHopOf: `${origin}/other/` })],
      origin,
      learned,
    ),
  ).toEqual([]);
  expect(
    verifiedLoginRoutes(
      [hop, probe(2, `${origin}/login`, { ...page, loginRouteHopOf: `${origin}/admin/` })],
      origin,
      learned,
    ),
  ).toEqual([{ route: `${origin}/admin/`, url: `${origin}/admin/`, via: `${origin}/login` }]);
});
