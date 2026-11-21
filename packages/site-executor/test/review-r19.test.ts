// AUTHORED-BY Claude Opus 5.5
// Round-19 regressions: the anonymous liveness control and its refusal classifier, the learned
// evidence in the write-response sidecar, and the wider not-found authentication phrases.
// Every site, account and item here is fictional.
import { type Extraction, type Operation, SCHEMA } from "@jeswr/site-model";
import { expect, it } from "vitest";
import { createExecutor } from "../src/executor.js";
import { createApprovalGate } from "../src/gate.js";
import { InMemorySessions } from "../src/index.js";
import { type AnonymousAnswer, authenticationRefusal, livenessSignature } from "../src/liveness.js";
import { notFoundSignature } from "../src/response-evidence.js";
import { validateWriteResponsePolicy, type WriteResponsePolicy } from "../src/write-response.js";

const origin = "https://shop.test";
const login = [`${origin}/login`];

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}

const refusal = (answer: Partial<AnonymousAnswer>, routes = login) =>
  authenticationRefusal(
    { url: `${origin}/listing`, status: 200, body: "", ...answer },
    routes,
    origin,
  );

it.each<[string, Partial<AnonymousAnswer>, string | undefined]>([
  ["a redirect to the login page", { status: 302, location: "/login" }, "login-redirect"],
  [
    "an absolute redirect to the login page with a return path",
    { status: 303, location: `${origin}/login?next=%2Flisting` },
    "login-redirect",
  ],
  ["a 401 challenge", { status: 401, challenge: true }, "authentication-status"],
  // Round 20 (decision 3): refusal wording is read only from headings, the title, the login
  // form's labels and buttons and message-like JSON keys, never from body text or codes.
  [
    "a 403 heading asking to sign in",
    {
      status: 403,
      contentType: "text/html",
      body: "<main><h1>Please sign in to continue</h1></main>",
    },
    "authentication-status",
  ],
  [
    "a 401 JSON message asking to log in",
    { status: 401, contentType: "application/json", body: '{"message":"Login required"}' },
    "authentication-status",
  ],
  [
    "a 403 asking to sign in in body text",
    {
      status: 403,
      contentType: "text/html",
      body: "<main><p>Please sign in to continue.</p></main>",
    },
    undefined,
  ],
  [
    "a 401 JSON login_required code",
    { status: 401, contentType: "application/json", body: '{"error":"login_required"}' },
    undefined,
  ],
  [
    "a 401 NotAuthenticated code",
    { status: 401, contentType: "application/json", body: '{"code":"NotAuthenticated"}' },
    undefined,
  ],
  [
    "a 403 login page",
    { status: 403, contentType: "text/html", body: '<form><input type="password"></form>' },
    "authentication-status",
  ],
  [
    "a 200 password form",
    { contentType: "text/html", body: '<form><input type="PASSWORD" name="pw"></form>' },
    "login-page",
  ],
  [
    "a 200 form posting to the learned login route",
    { contentType: "text/html", body: '<form action="/login"><input name="user"></form>' },
    "login-page",
  ],
  // None of these is an authentication refusal.
  ["a redirect to a cookie check", { status: 302, location: "/listing?cookie_check=1" }, undefined],
  ["a redirect off the site", { status: 302, location: "https://sso.test/login" }, undefined],
  ["a redirect without a location", { status: 302 }, undefined],
  ["a bare 401", { status: 401 }, undefined],
  [
    "a plain 403 Request blocked",
    {
      status: 403,
      contentType: "text/html",
      body: "<html><body><p>Request blocked.</p></body></html>",
    },
    undefined,
  ],
  [
    "a plain 403 Forbidden",
    { status: 403, contentType: "text/html", body: "<h1>Forbidden</h1>" },
    undefined,
  ],
  [
    "a 403 CSRF token failure",
    { status: 403, contentType: "application/json", body: '{"error":"invalid csrf token"}' },
    undefined,
  ],
  ["a 5xx", { status: 503, contentType: "text/plain", body: "Please log in later" }, undefined],
  ["a 404", { status: 404, contentType: "text/plain", body: "Not Found" }, undefined],
  ["a 200 page saying sign in", { contentType: "text/html", body: "<p>Sign in</p>" }, undefined],
  [
    "a 200 form posting elsewhere",
    { contentType: "text/html", body: '<form action="/search"><input name="q"></form>' },
    undefined,
  ],
  ["a 200 JSON body", { contentType: "application/json", body: '{"items":[]}' }, undefined],
])("classifies %s", (_name, answer, expected) => {
  expect(refusal(answer)).toBe(expected);
});

it("needs a learned login route for a refusal redirect", () => {
  expect(refusal({ status: 302, location: "/login" }, [])).toBeUndefined();
  expect(refusal({ status: 302, location: "/account/signin" }, [`${origin}/account/signin`])).toBe(
    "login-redirect",
  );
  // A route of another origin is never a login route of this site.
  expect(
    refusal({ status: 302, location: "/login" }, ["https://other.test/login"]),
  ).toBeUndefined();
});

it("validates the learned anonymous evidence of a liveness read", () => {
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
    undefined,
    { refusal: "login-redirect", loginRoutes: login },
    { refusal: "authentication-status", loginRoutes: [] },
    { refusal: "login-page", loginRoutes: [`${origin}/account/signin`] },
  ])
    expect(() => validateWriteResponsePolicy(policy(anonymous), origin)).not.toThrow();
  for (const anonymous of [
    null,
    "login-redirect",
    { refusal: "redirect", loginRoutes: login },
    { refusal: "login-redirect", loginRoutes: [] },
    { refusal: "login-page" },
    { refusal: "login-page", loginRoutes: ["https://other.test/login"] },
    { refusal: "login-page", loginRoutes: [`${origin}/login?next=1`] },
    { refusal: "login-page", loginRoutes: [`${origin}/login#top`] },
    { refusal: "login-page", loginRoutes: ["/login"] },
    { refusal: "login-page", loginRoutes: [1] },
    { refusal: "login-page", loginRoutes: Array.from({ length: 17 }, (_, i) => `${origin}/l${i}`) },
  ])
    expect(
      () => validateWriteResponsePolicy(policy(anonymous), origin),
      JSON.stringify(anonymous),
    ).toThrow("invalid liveness read");
});

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
const rows = { items: [{ id: "80" }, { id: "81" }] };
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
const read: Operation = {
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
const live: Operation = {
  ...read,
  id: "urn:live",
  label: "List example products",
  inputs: [],
  request: { method: "GET", urlTemplate: `${origin}/listing` },
  extraction: listing,
};

function policy(
  anonymous: unknown = { refusal: "login-redirect", loginRoutes: login, route: login[0] },
) {
  // null: a legacy sidecar written before round 19, without anonymous evidence.
  return {
    createdLocationPattern: "/",
    completionOnly: true,
    verification: {
      operation: "urn:read",
      bind: { id: { input: "id" } },
      identityInput: "id",
      identityPattern: `${origin}/products/{id}`,
      changes: [],
      notFound: required(notFoundSignature(404, "text/plain", "Not Found")),
      liveness: {
        operation: "urn:live",
        bind: {},
        signature: required(
          livenessSignature(200, "application/json", JSON.stringify(rows), listing),
        ),
        ...(anonymous === null ? {} : { anonymous }),
      },
    },
  } as unknown as WriteResponsePolicy;
}

interface Call {
  method: string;
  path: string;
  headers: Headers;
  cache?: RequestInit["cache"];
}

async function deleteItem(
  anonymous: () => Response,
  options: {
    policy?: WriteResponsePolicy;
    liveOperation?: Operation;
    sessionHeaders?: Record<string, string>;
    deny?: (summary: string) => boolean;
  } = {},
) {
  const sessions = new InMemorySessions();
  const updates: unknown[] = [];
  const update = sessions.update.bind(sessions);
  sessions.update = async (...args) => {
    updates.push(args[2]);
    return update(...args);
  };
  sessions.set(origin, undefined, {
    // The vault declares the session cookie: positive login evidence for the control.
    credentialCookies: ["session"],
    cookies: [
      {
        name: "session",
        value: "fixture-secret-session",
        domain: "shop.test",
        path: "/",
        secure: true,
        httpOnly: true,
      },
    ],
    ...(options.sessionHeaders ? { headers: options.sessionHeaders } : {}),
  });
  const gate = createApprovalGate();
  const calls: Call[] = [];
  let itemReads = 0;
  const executor = createExecutor({
    model: {
      id: "urn:model",
      site: origin,
      generatedAt: provenance.learnedAt,
      version: "1",
      operations: [write, read, options.liveOperation ?? live],
      flows: [],
    },
    sessions,
    writeResponses: { [write.id]: options.policy ?? policy() },
    gate: {
      authorize: async (request) =>
        options.deny?.(request.summary)
          ? { kind: "deny", reason: "Fixture denial" }
          : gate.authorize(request),
    },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      const method = init?.method ?? "GET";
      calls.push({
        method,
        path: url.pathname,
        headers,
        ...(init?.cache ? { cache: init.cache } : {}),
      });
      if (method === "POST") return new Response(null, { status: 204 });
      if (url.pathname === "/listing")
        return headers.has("cookie") ? Response.json(rows) : anonymous();
      if (url.pathname === "/csrf") return Response.json({ token: "fictional-token-value" });
      itemReads++;
      return itemReads === 1
        ? Response.json({ id: "73", url: `${origin}/products/73` })
        : new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });
    },
  });
  const request = { node: "urn:request", types: [write.actionType], values: () => [] };
  const pause = await executor.execute(request);
  expect(calls).toHaveLength(0);
  gate.approve(required(pause.approval).id);
  const result = await executor.execute(request, { approvalId: required(pause.approval).id });
  const listed = calls.filter((c) => c.path === "/listing");
  return { result, calls, listed, updates, sessions };
}

const loginRedirect = () => new Response(null, { status: 302, headers: { location: "/login" } });

it("completes an honest deletion whose anonymous control is refused, and sends it with no credentials", async () => {
  const { result, listed } = await deleteItem(loginRedirect, {
    sessionHeaders: { authorization: "Bearer fictional-vault-token" },
  });
  expect(result.outcome?.status).toBe("completed");
  expect(listed).toHaveLength(2);
  const [signed, anonymous] = listed.map(required);
  expect(signed?.headers.get("cookie")).toContain("session=");
  expect(signed?.headers.get("authorization")).toBe("Bearer fictional-vault-token");
  expect(anonymous?.headers.has("cookie")).toBe(false);
  expect(anonymous?.headers.has("authorization")).toBe(false);
  // The same cache bypass as every verification read.
  expect(anonymous?.cache).toBe("no-store");
  expect(anonymous?.headers.get("cache-control")).toBe("no-cache");
  expect(anonymous?.headers.get("pragma")).toBe("no-cache");
  expect(anonymous?.headers.get("accept")).toBe("application/json");
});

const pinned = (refusal: string) => policy({ refusal, loginRoutes: login });
it.each<[string, () => Response, string, WriteResponsePolicy?]>([
  [
    "a 401 challenge",
    () => new Response("", { status: 401, headers: { "www-authenticate": "Bearer" } }),
    "completed",
    pinned("authentication-status"),
  ],
  [
    "a login page",
    () =>
      new Response('<form><input type="password"></form>', {
        headers: { "content-type": "text/html" },
      }),
    "completed",
    pinned("login-page"),
  ],
  // Round 20 (decision 2): the control must give the pinned kind.
  [
    "a 401 challenge where a login redirect was learned",
    () => new Response("", { status: 401, headers: { "www-authenticate": "Bearer" } }),
    "uncertain",
  ],
  [
    "a login page where a login redirect was learned",
    () =>
      new Response('<form><input type="password"></form>', {
        headers: { "content-type": "text/html" },
      }),
    "uncertain",
  ],
  ["the same rows", () => Response.json(rows), "uncertain"],
  ["a bare 401", () => new Response("", { status: 401 }), "uncertain"],
  [
    "a plain 403",
    () =>
      new Response("<p>Request blocked.</p>", {
        status: 403,
        headers: { "content-type": "text/html" },
      }),
    "uncertain",
  ],
  [
    "a redirect elsewhere",
    () => new Response(null, { status: 302, headers: { location: "/listing?cookie_check=1" } }),
    "uncertain",
  ],
  [
    "a redirect off the site",
    () => new Response(null, { status: 302, headers: { location: "https://sso.test/login" } }),
    "uncertain",
  ],
  ["a server error", () => new Response("", { status: 503 }), "uncertain"],
  [
    "a cached refusal",
    () => new Response(null, { status: 302, headers: { location: "/login", age: "30" } }),
    "uncertain",
  ],
  [
    "rows with a challenge",
    () => Response.json(rows, { headers: { "www-authenticate": "Bearer" } }),
    "uncertain",
  ],
])("an anonymous control answering %s leaves the deletion %s", async (_name, anonymous, outcome, learned) => {
  const { result, listed } = await deleteItem(anonymous, learned ? { policy: learned } : {});
  expect(result.outcome?.status).toBe(outcome);
  expect(result.committed).toHaveLength(1);
  expect(listed.map((c) => c.headers.has("cookie"))).toEqual([true, false]);
});

it("never lets the anonymous answer change the session", async () => {
  const { result, updates, sessions } = await deleteItem(
    () =>
      new Response(null, {
        status: 302,
        headers: {
          location: "/login",
          "set-cookie": "session=anonymous-visitor; Path=/; Secure; HttpOnly",
        },
      }),
  );
  expect(result.outcome?.status).toBe("completed");
  expect(updates).toHaveLength(0);
  expect((await sessions.get(origin))?.cookies.map((c) => c.value)).toEqual([
    "fixture-secret-session",
  ]);
});

it("authorizes the anonymous control through the read gate before sending it", async () => {
  const { result, listed } = await deleteItem(loginRedirect, {
    deny: (summary) => summary.includes("without the session"),
  });
  expect(result.outcome?.status).toBe("uncertain");
  expect(result.committed).toHaveLength(1);
  expect(listed.map((c) => c.headers.has("cookie"))).toEqual([true]);
});

it("treats a liveness read without learned anonymous evidence as no proof", async () => {
  const { result, listed } = await deleteItem(loginRedirect, { policy: policy(null) });
  expect(result.outcome?.status).toBe("uncertain");
  expect(result.committed).toHaveLength(1);
  expect(listed).toHaveLength(0);
});

it("refuses a token-decorated liveness read before sending anything for it", async () => {
  const { result, calls } = await deleteItem(loginRedirect, {
    liveOperation: {
      ...live,
      csrf: [
        {
          source: { kind: "json", urlTemplate: `${origin}/csrf`, pointer: "/token" },
          target: { kind: "query", name: "token" },
        },
      ],
    },
  });
  expect(result.outcome?.status).toBe("uncertain");
  expect(result.committed).toHaveLength(1);
  expect(calls.filter((c) => c.path === "/listing" || c.path === "/csrf")).toHaveLength(0);
});

// Decision 3: the round-19 review's not-found rows. Each authentication wording now gets no
// signature, so it can never match the learned one.
it.each([
  ["text/html", "<p>Not Found</p>", "<p>Session expired</p>"],
  ["text/html", "<p>Not Found</p>", "<p>Your session has ended. Please sign up or register.</p>"],
  ["text/html", "<p>Not Found</p>", "<p>Members only</p>"],
  ["text/html", "<p>Not Found</p>", "<p>This content is private.</p>"],
  [
    "text/html",
    "<main><p>No such widget.</p></main>",
    "<main><p>You must be logged in.</p></main>",
  ],
  ["text/html", "<main><p>No such widget.</p></main>", "<main><p>Logged out.</p></main>"],
  ["text/html", "<p>Not Found</p>", "<p>Your session timed out.</p>"],
  ["text/html", "<p>Not Found</p>", "<p>Please log in.</p>"],
  ["text/html", "<p>Not Found</p>", "<p>Sign up to see this widget.</p>"],
  ["text/plain", "Not Found", "Session expired"],
  ["text/plain", "Not Found", "Logged out"],
  ["text/plain", "Not Found", "Session ended"],
  ["application/json", '{"message":"Not found"}', '{"message":"You must be logged in"}'],
  ["application/json", '{"message":"Not found"}', '{"message":"Members only"}'],
  ["application/json", '{"message":"Not found"}', '{"message":"Logged in users only"}'],
  [
    "application/json",
    '{"data":{"message":"Not found"}}',
    '{"data":{"message":"Session expired"}}',
  ],
  ["text/html", "Not Found", "Logged out"],
  ["text/html", "", "Session expired"],
  ["text/html", "Not Found", "Register to continue"],
])("a learned %s not-found %j never matches %j", (contentType, learned, runtime) => {
  expect(notFoundSignature(404, contentType, learned)).toBeDefined();
  expect(notFoundSignature(404, contentType, runtime)).toBeUndefined();
});

it("keeps whole-word matching for the round-19 phrases", () => {
  for (const body of [
    "<p>No such privateer.</p>",
    "<p>Unknown registry entry.</p>",
    "<p>The sessions list is empty.</p>",
    "<p>No member found.</p>",
  ])
    expect(notFoundSignature(404, "text/html", body), body).toBeDefined();
});
