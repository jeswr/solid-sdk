// AUTHORED-BY Claude Opus 5.5
// Round-20 regressions: the credentials-only liveness control, the pinned refusal kind and
// route, narrow refusal text and login documents, the login JSON envelope, and collection
// absence behind the liveness proof; round 21: the control drops only cookies with positive
// login evidence, and no verified login route is the site root. Every site, account and item
// here is fictional.
import { type Extraction, type Operation, SCHEMA } from "@jeswr/site-model";
import { expect, it } from "vitest";
import { createExecutor } from "../src/executor.js";
import { createApprovalGate } from "../src/gate.js";
import { InMemorySessions } from "../src/index.js";
import {
  type AnonymousAnswer,
  isLoginDocument,
  livenessSignature,
  type RefusalEvidence,
  refusalEvidence,
  sameRefusal,
} from "../src/liveness.js";
import { notFoundSignature } from "../src/response-evidence.js";
import { validateWriteResponsePolicy, type WriteResponsePolicy } from "../src/write-response.js";

const origin = "https://shop.test";
const routes = [`${origin}/login`, `${origin}/account/signin`];

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}

const classify = (answer: Partial<AnonymousAnswer>, learned = routes) =>
  refusalEvidence(
    { url: `${origin}/stores/main/listing`, status: 200, body: "", ...answer },
    learned,
    origin,
  );
const json = (body: unknown, status = 200): Partial<AnonymousAnswer> => ({
  status,
  contentType: "application/json",
  body: JSON.stringify(body),
});
const html = (body: string, status = 200): Partial<AnonymousAnswer> => ({
  status,
  contentType: "text/html; charset=utf-8",
  body,
});

// Decision 4: the login JSON envelope needs an explicit flag AND a login-route redirect.
it.each<[string, Partial<AnonymousAnswer>, RefusalEvidence | undefined]>([
  [
    "an ajaxExpired envelope redirecting to the login page",
    json({ ajaxExpired: 1, ajaxRedirect: `${origin}/login` }),
    { kind: "login-envelope", route: `${origin}/login` },
  ],
  [
    "a relative redirect with a string flag",
    json({ sessionExpired: "true", redirect: "/account/signin?next=%2Flisting" }),
    { kind: "login-envelope", route: `${origin}/account/signin` },
  ],
  [
    "authenticated: false with a login URL",
    json({ authenticated: false, loginUrl: "/login" }),
    { kind: "login-envelope", route: `${origin}/login` },
  ],
  [
    "an envelope in a 401",
    json({ ajaxExpired: true, ajaxRedirect: "/login" }, 401),
    { kind: "login-envelope", route: `${origin}/login` },
  ],
  ["a flag without a redirect", json({ ajaxExpired: 1 }), undefined],
  ["a redirect without a flag", json({ ajaxRedirect: `${origin}/login` }), undefined],
  ["a false flag", json({ ajaxExpired: 0, ajaxRedirect: `${origin}/login` }), undefined],
  ["a flag of another meaning", json({ expiredItems: 1, redirect: "/login" }), undefined],
  [
    "a redirect to a page that is no learned login route",
    json({ ajaxExpired: 1, ajaxRedirect: `${origin}/admin/` }),
    undefined,
  ],
  [
    "a redirect off the site",
    json({ ajaxExpired: 1, ajaxRedirect: "https://sso.test/login" }),
    undefined,
  ],
  [
    "two redirects to different places",
    json({ ajaxExpired: 1, ajaxRedirect: "/login", location: "/welcome" }),
    undefined,
  ],
  ["a non-string redirect", json({ ajaxExpired: 1, ajaxRedirect: { href: "/login" } }), undefined],
  [
    "a nested envelope",
    json({ data: { ajaxExpired: 1, ajaxRedirect: `${origin}/login` } }),
    undefined,
  ],
  [
    "an envelope in a 5xx",
    json({ ajaxExpired: 1, ajaxRedirect: `${origin}/login` }, 503),
    undefined,
  ],
])("classifies %s", (_name, answer, expected) => {
  expect(classify(answer)).toEqual(expected);
});

it("needs a learned login route for the login envelope", () => {
  expect(classify(json({ ajaxExpired: 1, ajaxRedirect: "/login" }), [])).toBeUndefined();
});

// Decision 3: refusal text is read only from the title, headings outside chrome, the login
// form's labels and buttons and message-like JSON keys.
it.each<[string, Partial<AnonymousAnswer>, string | undefined]>([
  [
    "the review's 403 with a top-bar Log in link outside header and nav",
    html(
      '<html><body><div class="topbar"><a href="/">Example shop</a> <a href="/login">Log in</a></div><main><p>Request blocked. Please enable cookies.</p></main></body></html>',
      403,
    ),
    undefined,
  ],
  [
    "a 403 whose only sign-in heading sits in the navigation",
    html("<nav><h2>Sign in</h2></nav><main><p>Request blocked.</p></main>", 403),
    undefined,
  ],
  [
    "a 403 asking to sign in in body text",
    html("<main><p>You must sign in to see this.</p></main>", 403),
    undefined,
  ],
  ["a plain-text 401 asking to log in", { status: 401, body: "Please log in" }, undefined],
  ["an element-less HTML 401", html("Login required", 401), undefined],
  ["a 401 JSON code", json({ code: "login_required" }, 401), undefined],
  ["a 401 JSON array of strings", json(["Login required"], 401), undefined],
  ["a 403 title", html("<title>Sign in required</title><p>x</p>", 403), "authentication-status"],
  [
    "a 403 main heading",
    html("<main><h1>Authentication required</h1></main>", 403),
    "authentication-status",
  ],
  [
    "a 401 nested message",
    json({ error: { message: "Session expired" } }, 401),
    "authentication-status",
  ],
  [
    "a 403 with a login form's button",
    html('<main><form action="/login"><button>Log in</button></form></main>', 403),
    "authentication-status",
  ],
])("reads refusal wording narrowly: %s", (_name, answer, expected) => {
  expect(classify(answer)?.kind).toBe(expected);
});

// Decision 2: a login page is a login document, never a quick-login box beside other content.
const passwordForm =
  '<form method="post" action="/login_check"><label>User <input name="user"></label><input type="password" name="pw"><button>Log in</button></form>';
it.each<[string, string, boolean]>([
  ["a bare password form", passwordForm, true],
  [
    "a login page with navigation lists",
    `<header><nav><ul><li>Home</li><li>Forums</li><li>Wiki</li></ul></nav></header><main><h1>Log in</h1>${passwordForm}</main><footer><ul><li>About</li><li>Help</li><li>Terms</li></ul></footer>`,
    true,
  ],
  [
    "a login page with two help links",
    `<main>${passwordForm}<ul><li><a href="/reset">Forgot password</a></li><li><a href="/join">Join</a></li></ul></main>`,
    true,
  ],
  [
    "the review's quick-login home page",
    `<div class="quick-login">${passwordForm}</div><main><p>Latest products</p></main>`,
    false,
  ],
  [
    "a quick-login box in a sidebar",
    `<aside>${passwordForm}</aside><div><p>Hello</p></div>`,
    false,
  ],
  ["a quick-login box in the header", `<header>${passwordForm}</header><p>Hello</p>`, false],
  [
    "a password form beside item rows",
    `${passwordForm}<article><h2>Example widget</h2></article>`,
    false,
  ],
  [
    "a password form beside a table of data",
    `${passwordForm}<table><tr><th>Name</th></tr><tr><td>Example widget</td></tr></table>`,
    false,
  ],
  [
    "a password form beside a listing",
    `${passwordForm}<ul><li>Widget</li><li>Gadget</li><li>Gizmo</li></ul>`,
    false,
  ],
  [
    "a password form beside marked-up items",
    `${passwordForm}<div itemscope itemtype="https://schema.org/Product">Widget</div>`,
    false,
  ],
  ["a password control only in a template", `<template>${passwordForm}</template>`, false],
  ["no password control", '<form action="/search"><input name="q"></form>', false],
])("recognises a login document: %s", (_name, body, expected) => {
  expect(isLoginDocument(body, `${origin}/login`, routes, origin)).toBe(expected);
  expect(classify(html(body))?.kind).toBe(expected ? "login-page" : undefined);
});

it("pins the refusal kind and, for routed kinds, the route", () => {
  const redirect = { refusal: "login-redirect" as const, route: `${origin}/login` };
  expect(sameRefusal(redirect, { kind: "login-redirect", route: `${origin}/login` })).toBe(true);
  expect(sameRefusal(redirect, { kind: "login-redirect", route: `${origin}/account/signin` })).toBe(
    false,
  );
  expect(sameRefusal(redirect, { kind: "authentication-status" })).toBe(false);
  expect(sameRefusal(redirect, undefined)).toBe(false);
  // A legacy routed declaration without its route never matches.
  expect(sameRefusal({ refusal: "login-redirect" }, { kind: "login-redirect", route: "x" })).toBe(
    false,
  );
  expect(sameRefusal({ refusal: "login-page" }, { kind: "login-page" })).toBe(true);
  expect(sameRefusal({ refusal: "login-page" }, { kind: "login-redirect", route: "x" })).toBe(
    false,
  );
});

it("validates the pinned route of a liveness read", () => {
  const signature = { status: 200, contentType: "application/json", structure: "a".repeat(64) };
  const policy = (anonymous: unknown) =>
    ({
      createdLocationPattern: "/",
      completionOnly: true,
      verification: {
        operation: "urn:read",
        bind: {},
        identityInput: "id",
        identityPattern: `${origin}/products/{id}`,
        changes: [],
        liveness: { operation: "urn:list", bind: {}, signature, anonymous },
      },
    }) as never;
  for (const anonymous of [
    { refusal: "login-redirect", loginRoutes: routes, route: `${origin}/login` },
    { refusal: "login-envelope", loginRoutes: routes, route: `${origin}/account/signin` },
    // Legacy: accepted, but never completes at runtime.
    { refusal: "login-redirect", loginRoutes: routes },
    // Decision 5: a verified redirect-target route with its evidence (optionally one hop).
    {
      refusal: "login-envelope",
      loginRoutes: [...routes, `${origin}/admin/`],
      route: `${origin}/admin/`,
      verifiedRoutes: [
        { route: `${origin}/admin/`, url: `${origin}/admin/` },
        { route: `${origin}/admin/`, url: `${origin}/admin/?next=1`, via: `${origin}/login` },
      ],
    },
  ])
    expect(() => validateWriteResponsePolicy(policy(anonymous), origin)).not.toThrow();
  for (const anonymous of [
    { refusal: "login-envelope", loginRoutes: [] },
    { refusal: "login-redirect", loginRoutes: routes, route: `${origin}/welcome` },
    { refusal: "login-redirect", loginRoutes: routes, route: 1 },
    { refusal: "login-page", loginRoutes: routes, route: `${origin}/login` },
    { refusal: "authentication-status", loginRoutes: [], route: `${origin}/login` },
    ...[
      // Not a learned route, another origin, an evidence URL of another path, a hop to an
      // unlearned route or to the route itself, and malformed entries.
      [{ route: `${origin}/admin/`, url: `${origin}/admin/` }],
      [{ route: "https://other.test/login", url: "https://other.test/login" }],
      [{ route: `${origin}/login`, url: `${origin}/elsewhere` }],
      [{ route: `${origin}/login`, url: `${origin}/login`, via: `${origin}/welcome` }],
      [{ route: `${origin}/login`, url: `${origin}/login`, via: `${origin}/login` }],
      [{ route: `${origin}/login`, url: "https://other.test/login" }],
      [null],
      "not a list",
      Array.from({ length: 17 }, () => ({ route: `${origin}/login`, url: `${origin}/login` })),
    ].map((verifiedRoutes) => ({ ...redirectEvidence, verifiedRoutes })),
  ])
    expect(
      () => validateWriteResponsePolicy(policy(anonymous), origin),
      JSON.stringify(anonymous),
    ).toThrow("invalid liveness read");
});

// ---------------------------------------------------------------- runtime
const provenance = {
  method: "demonstration" as const,
  learnedAt: "2026-11-14T00:00:00Z",
  confidence: 1,
  derivedFrom: [],
};
const listing: Extraction = {
  format: "json",
  itemType: `${SCHEMA}Product`,
  itemPath: "/items",
  fields: [{ property: `${SCHEMA}identifier`, path: "/id" }],
};
const liveRows = { items: [{ id: "80" }, { id: "81" }] };
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
    urlTemplate: `${origin}/products/delete/{id}`,
    contentType: "application/x-www-form-urlencoded",
  },
};
const item: Operation = {
  ...write,
  id: "urn:read",
  label: "Read example product",
  actionType: `${SCHEMA}ViewAction`,
  effect: "read",
  inputs: [{ ...required(write.inputs[0]), path: [], default: undefined }],
  request: { method: "GET", urlTemplate: `${origin}/products/{id}` },
  extraction: {
    format: "json",
    itemType: `${SCHEMA}Product`,
    fields: [
      { property: `${SCHEMA}identifier`, path: "/id" },
      { property: `${SCHEMA}url`, path: "/url", datatype: "iri" },
    ],
  },
};
const rowsRead: Operation = {
  ...item,
  id: "urn:rows",
  label: "Filter example products",
  inputs: [{ ...required(item.inputs[0]), location: "query" }],
  request: { method: "GET", urlTemplate: `${origin}/products/rows{?id}` },
  extraction: {
    format: "json",
    itemType: `${SCHEMA}Product`,
    itemPath: "/items",
    totalPath: "/total",
    fields: [
      { property: `${SCHEMA}identifier`, path: "/id" },
      { property: `${SCHEMA}url`, path: "/url", datatype: "iri" },
    ],
  },
};
const live: Operation = {
  ...item,
  id: "urn:live",
  label: "List example products",
  inputs: [],
  request: { method: "GET", urlTemplate: `${origin}/stores/main/listing` },
  extraction: listing,
};
const redirectEvidence = { refusal: "login-redirect", loginRoutes: routes, route: routes[0] };

function policy(
  anonymous: unknown = redirectEvidence,
  options: { collection?: boolean; liveness?: boolean } = {},
): WriteResponsePolicy {
  return {
    createdLocationPattern: "/",
    completionOnly: true,
    verification: {
      operation: options.collection ? rowsRead.id : item.id,
      bind: { id: { input: "id" } },
      identityInput: "id",
      identityPattern: `${origin}/products/{id}`,
      changes: [],
      ...(options.collection
        ? {}
        : { notFound: required(notFoundSignature(404, "text/plain", "Not Found")) }),
      ...(options.liveness === false
        ? {}
        : {
            liveness: {
              operation: live.id,
              bind: {},
              signature: required(
                livenessSignature(200, "application/json", JSON.stringify(liveRows), listing),
              ),
              // null: a legacy declaration without control evidence.
              ...(anonymous === null ? {} : { anonymous }),
            },
          }),
    },
  } as unknown as WriteResponsePolicy;
}

type Cookie = { name: string; value: string; httpOnly?: boolean };
interface Wire {
  method: string;
  path: string;
  cookie: string;
  headers: Headers;
}

/**
 * Run an approved deletion. `site` answers every GET of the listing from the wire request, so
 * a fixture can gate on any cookie; the item and rows reads answer present then absent.
 */
async function deleteItem(
  site: (wire: Wire) => Response,
  options: {
    policy?: WriteResponsePolicy;
    cookies?: Cookie[];
    headers?: Record<string, string>;
    credentialCookies?: string[];
    sessionCookies?: string[];
  } = {},
) {
  const sessions = new InMemorySessions();
  sessions.set(origin, undefined, {
    cookies: (options.cookies ?? [{ name: "session", value: "fixture-secret-session" }]).map(
      (c) => ({ httpOnly: false, domain: "shop.test", path: "/", secure: true, ...c }),
    ),
    ...(options.headers ? { headers: options.headers } : {}),
    ...(options.credentialCookies ? { credentialCookies: options.credentialCookies } : {}),
  });
  const gate = createApprovalGate();
  const wires: Wire[] = [];
  let reads = 0;
  const collection = options.policy?.verification?.operation === rowsRead.id;
  const executor = createExecutor({
    model: {
      id: "urn:model",
      site: origin,
      generatedAt: provenance.learnedAt,
      version: "1",
      operations: [write, item, rowsRead, live],
      flows: [],
      // The learned login route names the session cookie: positive login evidence for the
      // credentials-only control (round 21). `sessionCookies: []` leaves no login evidence.
      ...((options.sessionCookies ?? ["session"]).length
        ? {
            login: [
              {
                method: "password" as const,
                operation: write.id,
                sessionCookies: options.sessionCookies ?? ["session"],
              },
            ],
          }
        : {}),
    },
    sessions,
    writeResponses: { [write.id]: options.policy ?? policy() },
    gate,
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      const wire = {
        method: init?.method ?? "GET",
        path: url.pathname,
        cookie: headers.get("cookie") ?? "",
        headers,
      };
      wires.push(wire);
      if (wire.method === "POST") return new Response(null, { status: 204 });
      if (url.pathname === "/stores/main/listing") return site(wire);
      reads++;
      if (collection)
        return Response.json(
          reads === 1
            ? { total: 1, items: [{ id: "73", url: `${origin}/products/73` }] }
            : { total: 0, items: [] },
        );
      return reads === 1
        ? Response.json({ id: "73", url: `${origin}/products/73` })
        : new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });
    },
  });
  const request = { node: "urn:request", types: [write.actionType], values: () => [] };
  const pause = await executor.execute(request);
  expect(wires).toHaveLength(0);
  gate.approve(required(pause.approval).id);
  const result = await executor.execute(request, { approvalId: required(pause.approval).id });
  return {
    outcome: result.outcome?.status,
    committed: result.committed.length,
    listed: wires.filter((w) => w.path === "/stores/main/listing"),
    sessions,
  };
}

const toLogin = (location = "/login") => new Response(null, { status: 302, headers: { location } });
/** An honest site: the listing needs the session cookie, whatever else the visitor holds. */
const sessionGated = (wire: Wire) =>
  /(?:^|; )session=fixture-secret-session(?:;|$)/.test(wire.cookie)
    ? Response.json(liveRows)
    : toLogin();

it("sends the control with every non-credential cookie and without the session credentials", async () => {
  const run = await deleteItem(sessionGated, {
    cookies: [
      { name: "session", value: "fixture-secret-session" },
      { name: "age_ok", value: "1" },
      { name: "theme", value: "dark" },
      // Round 21: the redaction heuristic would class these as credentials (httpOnly, a
      // credential-like name), but without login evidence the control keeps them.
      { name: "opaque", value: "gate-opaque", httpOnly: true },
      { name: "remember_me", value: "gate-remember" },
      // Positive login evidence: a vault-declared credential cookie and the learned login
      // route's session cookies.
      { name: "vault_marker", value: "fixture-secret-vault" },
      { name: "keeper", value: "fixture-secret-login" },
    ],
    headers: { authorization: "Bearer fixture-secret-bearer", "x-api-key": "fixture-secret-key" },
    credentialCookies: ["vault_marker"],
    sessionCookies: ["session", "keeper"],
  });
  expect(run.outcome).toBe("completed");
  const [signed, control] = run.listed.map(required);
  expect(signed?.cookie).toContain("session=fixture-secret-session");
  expect(signed?.headers.get("authorization")).toBe("Bearer fixture-secret-bearer");
  expect(control?.cookie.split("; ").sort()).toEqual([
    "age_ok=1",
    "opaque=gate-opaque",
    "remember_me=gate-remember",
    "theme=dark",
  ]);
  expect(control?.headers.has("authorization")).toBe(false);
  expect(control?.headers.has("x-api-key")).toBe(false);
  expect(JSON.stringify([...(control?.headers ?? [])])).not.toMatch(/fixture-secret/);
});

it("completes an honest cookie-gated deletion whose control keeps the gate cookie", async () => {
  // Without age_ok the site shows an age gate with a sign-in form; with it but without the
  // session it redirects to the login page. The control keeps age_ok, so it is refused for
  // lack of the credential alone.
  const site = (wire: Wire) =>
    !/age_ok=1/.test(wire.cookie)
      ? new Response(
          `<main><p>Confirm you are over 18, or sign in.</p><form action="/login_check"><input type="password" name="pw"></form></main>`,
          { headers: { "content-type": "text/html" } },
        )
      : sessionGated(wire);
  const run = await deleteItem(site, {
    cookies: [
      { name: "session", value: "fixture-secret-session", httpOnly: true },
      { name: "age_ok", value: "1" },
    ],
  });
  expect(run.outcome).toBe("completed");
  expect(run.listed.map((w) => w.cookie)).toEqual([
    "session=fixture-secret-session; age_ok=1",
    "age_ok=1",
  ]);
});

it("leaves an expired session Uncertain when the listing renders for the gate cookie alone", async () => {
  // The review's high: the session expired server-side, the listing renders for any visitor
  // holding age_ok. The control keeps age_ok, renders, and proves nothing.
  const site = (wire: Wire) => (/age_ok=1/.test(wire.cookie) ? Response.json(liveRows) : toLogin());
  for (const anonymous of [
    redirectEvidence,
    { refusal: "login-page", loginRoutes: routes },
    { refusal: "authentication-status", loginRoutes: routes },
  ]) {
    const run = await deleteItem(site, {
      policy: policy(anonymous),
      cookies: [
        { name: "session", value: "fixture-secret-session", httpOnly: true },
        { name: "age_ok", value: "1" },
      ],
    });
    expect(run.outcome).toBe("uncertain");
    expect(run.committed).toBe(1);
  }
});

it.each<[string, () => Response, unknown, string]>([
  ["the pinned redirect route", () => toLogin(), redirectEvidence, "completed"],
  ["another learned login route", () => toLogin("/account/signin"), redirectEvidence, "uncertain"],
  [
    "a 401 challenge where a redirect was learned",
    () => new Response("", { status: 401, headers: { "www-authenticate": "Bearer" } }),
    redirectEvidence,
    "uncertain",
  ],
  [
    "the pinned login envelope",
    () => Response.json({ ajaxExpired: 1, ajaxRedirect: `${origin}/account/signin` }),
    { refusal: "login-envelope", loginRoutes: routes, route: `${origin}/account/signin` },
    "completed",
  ],
  [
    "a login envelope with another route",
    () => Response.json({ ajaxExpired: 1, ajaxRedirect: `${origin}/login` }),
    { refusal: "login-envelope", loginRoutes: routes, route: `${origin}/account/signin` },
    "uncertain",
  ],
  [
    "an envelope without its flag",
    () => Response.json({ ajaxRedirect: `${origin}/account/signin` }),
    { refusal: "login-envelope", loginRoutes: routes, route: `${origin}/account/signin` },
    "uncertain",
  ],
  [
    "a redirect where a login envelope was learned",
    () => toLogin("/account/signin"),
    { refusal: "login-envelope", loginRoutes: routes, route: `${origin}/account/signin` },
    "uncertain",
  ],
  [
    "a legacy redirect declaration without its route",
    () => toLogin(),
    { refusal: "login-redirect", loginRoutes: routes },
    "uncertain",
  ],
])("a control answering %s pins the outcome", async (_name, answer, anonymous, outcome) => {
  const run = await deleteItem((wire) => (wire.cookie ? Response.json(liveRows) : answer()), {
    policy: policy(anonymous),
  });
  expect(run.outcome).toBe(outcome);
  expect(run.committed).toBe(1);
  expect(run.listed.map((w) => w.cookie !== "")).toEqual([true, false]);
});

// Decision 4: collection absence needs the liveness proof too.
it.each<[string, string, (wire: Wire) => Response, WriteResponsePolicy, number]>([
  [
    "a passing liveness proof",
    "completed",
    sessionGated,
    policy(redirectEvidence, { collection: true }),
    2,
  ],
  [
    "no learned liveness read",
    "uncertain",
    sessionGated,
    policy(redirectEvidence, { collection: true, liveness: false }),
    0,
  ],
  [
    "a legacy liveness read without control evidence",
    "uncertain",
    sessionGated,
    policy(null, { collection: true }),
    0,
  ],
  [
    "a liveness read that answers the login page",
    "uncertain",
    () => toLogin(),
    policy(redirectEvidence, { collection: true }),
    1,
  ],
  [
    "a control that renders the rows",
    "uncertain",
    () => Response.json(liveRows),
    policy(redirectEvidence, { collection: true }),
    2,
  ],
])("collection absence with %s is %s", async (_name, outcome, site, learned, listed) => {
  const run = await deleteItem(site, { policy: learned });
  expect(run.outcome).toBe(outcome);
  expect(run.committed).toBe(1);
  expect(run.listed).toHaveLength(listed);
});

it("never lets the control's answer change the session", async () => {
  const run = await deleteItem(
    (wire) =>
      /session=/.test(wire.cookie)
        ? Response.json(liveRows)
        : new Response(null, {
            status: 302,
            headers: [
              ["location", "/login"],
              ["set-cookie", "session=anonymous-visitor; Path=/; Secure; HttpOnly"],
              ["set-cookie", "age_ok=; Max-Age=0; Path=/"],
            ],
          }),
    {
      cookies: [
        { name: "session", value: "fixture-secret-session", httpOnly: true },
        { name: "age_ok", value: "1" },
      ],
    },
  );
  expect(run.outcome).toBe("completed");
  expect((await run.sessions.get(origin))?.cookies.map((c) => `${c.name}=${c.value}`)).toEqual([
    "session=fixture-secret-session",
    "age_ok=1",
  ]);
});

// ---------------------------------------------------------------- round 21, decision 1
// The control drops only cookies with positive login evidence (vault-declared, learned login
// routes' session cookies) and the session headers; the redaction heuristic plays no part.
const gateCookieSite = (gate: string) => (wire: Wire) =>
  // The review's hostile shape: the listing renders for anyone holding the gate cookie.
  new RegExp(`(?:^|; )${gate}=1(?:;|$)`).test(wire.cookie) ? Response.json(liveRows) : toLogin();

it.each<[string, Cookie]>([
  ["an HttpOnly age gate cookie", { name: "age_ok", value: "1", httpOnly: true }],
  ["a credential-named age cookie", { name: "remember_age", value: "1" }],
  ["a credential-named visitor cookie", { name: "visitor_token", value: "1" }],
  ["an HttpOnly cookie-check cookie", { name: "cc", value: "1", httpOnly: true }],
])("keeps %s in the control, so an expired session is Uncertain", async (_name, gate) => {
  const run = await deleteItem(gateCookieSite(gate.name), {
    cookies: [{ name: "session", value: "fixture-secret-session", httpOnly: true }, gate],
  });
  expect(run.outcome).toBe("uncertain");
  expect(run.committed).toBe(1);
  expect(run.listed.map((w) => w.cookie)).toEqual([
    `session=fixture-secret-session; ${gate.name}=1`,
    `${gate.name}=1`,
  ]);
});

it("sends no control without login evidence: no declared cookie, login cookie or session header", async () => {
  const run = await deleteItem(sessionGated, {
    cookies: [{ name: "session", value: "fixture-secret-session", httpOnly: true }],
    sessionCookies: [],
  });
  expect(run.outcome).toBe("uncertain");
  expect(run.committed).toBe(1);
  // The credentialed liveness read ran; the control, which would drop nothing, was never sent.
  expect(run.listed.map((w) => w.cookie)).toEqual(["session=fixture-secret-session"]);
});

it.each<[string, Parameters<typeof deleteItem>[1]]>([
  [
    "a vault-declared credential cookie",
    {
      cookies: [{ name: "sid_x", value: "fixture-secret-session" }],
      credentialCookies: ["sid_x"],
      sessionCookies: [],
    },
  ],
  [
    "a learned login route's session cookie",
    { cookies: [{ name: "sid_x", value: "fixture-secret-session" }], sessionCookies: ["sid_x"] },
  ],
])("drops %s as login evidence", async (_name, options) => {
  const site = (wire: Wire) =>
    /(?:^|; )sid_x=fixture-secret-session/.test(wire.cookie) ? Response.json(liveRows) : toLogin();
  const run = await deleteItem(site, options);
  expect(run.outcome).toBe("completed");
  expect(run.listed.map((w) => w.cookie)).toEqual(["sid_x=fixture-secret-session", ""]);
});

it("treats session headers alone as the credentials the control drops", async () => {
  const site = (wire: Wire) =>
    wire.headers.get("authorization") === "Bearer fixture-secret-bearer"
      ? Response.json(liveRows)
      : toLogin();
  const run = await deleteItem(site, {
    cookies: [{ name: "theme", value: "dark" }],
    headers: { authorization: "Bearer fixture-secret-bearer" },
    sessionCookies: [],
  });
  expect(run.outcome).toBe("completed");
  const [, control] = run.listed.map(required);
  expect(control?.cookie).toBe("theme=dark");
  expect(control?.headers.has("authorization")).toBe(false);
});

// ---------------------------------------------------------------- round 21, decision 2
it("rejects a verified login route at the site root", () => {
  const signature = { status: 200, contentType: "application/json", structure: "a".repeat(64) };
  const policy = (verifiedRoutes: unknown) =>
    ({
      createdLocationPattern: "/",
      completionOnly: true,
      verification: {
        operation: "urn:read",
        bind: {},
        identityInput: "id",
        identityPattern: `${origin}/products/{id}`,
        changes: [],
        liveness: {
          operation: "urn:list",
          bind: {},
          signature,
          anonymous: {
            refusal: "login-redirect",
            loginRoutes: [...routes, `${origin}/`],
            route: `${origin}/`,
            verifiedRoutes,
          },
        },
      },
    }) as never;
  expect(() =>
    validateWriteResponsePolicy(
      policy([{ route: `${origin}/`, url: `${origin}/?cookie_check=1` }]),
      origin,
    ),
  ).toThrow("invalid liveness read");
  // The same declaration without a verified root route stays valid (a learned root route).
  expect(() => validateWriteResponsePolicy(policy(undefined), origin)).not.toThrow();
});
