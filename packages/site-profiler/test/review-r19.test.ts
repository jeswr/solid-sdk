// AUTHORED-BY Claude Opus 5.5
// Round-19 regressions: a liveness read is learned only with an anonymous replay of its exact URL
// refused for lack of authentication, and the executor's anonymous control must be refused too.
// Ported from the round-19 review probes. Every site, account and item here is fictional.
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
import { learnedLoginRoutes, probeLivenessReads } from "../src/write-liveness.js";
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

type Sent = {
  url: string;
  signedIn: boolean;
  headers?: Record<string, string>;
  credentialsOnly?: boolean;
};
/**
 * A replayer that records anonymous replays into the trace, as the Playwright replayer does:
 * a credentials-only control (round 20) is flagged, a plain cookieless replay is not.
 */
function recordingReplayer(
  trace: RecordedRequest[],
  answer: (url: URL, signedIn: boolean, control: boolean) => Answer | "timeout",
  sent: Sent[] = [],
): Replayer {
  return {
    async get(url, { signedIn, headers, authorize, credentialsOnly }) {
      await authorize?.(url);
      const control = !signedIn && credentialsOnly === true;
      sent.push({
        url,
        signedIn,
        ...(headers ? { headers } : {}),
        ...(control ? { credentialsOnly } : {}),
      });
      const out = answer(new URL(url), signedIn, control);
      if (out === "timeout") throw new Error("The operation was aborted due to timeout");
      trace.push({
        seq: 1000 + trace.length,
        completedAt: 1001 + trace.length,
        phase: "verify",
        method: "GET",
        url,
        resourceType: signedIn ? "replay" : "replay-anonymous",
        requestHeaders: headers ?? {},
        cookieNames: [],
        authenticationContext: signedIn ? "fictional-context" : "anonymous-context",
        ...(control ? { credentialsOnlyControl: true } : {}),
        status: out.status,
        bodySample: out.body,
        ...(out.contentType ? { contentType: out.contentType } : {}),
        ...(out.location ? { redirectedTo: new URL(out.location, url).href } : {}),
      });
      return out;
    },
  };
}

type Anonymous = "timeout" | "waf403" | "cookie-redirect" | "public200" | "login-redirect";
const anonymousListing = (mode: Anonymous): Answer | "timeout" =>
  mode === "timeout"
    ? "timeout"
    : mode === "waf403"
      ? {
          status: 403,
          contentType: "text/html",
          body: "<html><body><p>Request blocked.</p></body></html>",
        }
      : mode === "cookie-redirect"
        ? { status: 302, body: "", location: "/stores/main/listing?cookie_check=1" }
        : mode === "login-redirect"
          ? { status: 302, body: "", location: "/login" }
          : { status: 200, contentType: "application/json", body: "" };

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

/** Execute the approved deletion against a fictional site, counting what is sent. */
async function execute(
  f: ReturnType<typeof fixture>,
  verified: Operation[],
  policy: ReturnType<typeof learnWriteResponses>[string] | undefined,
  respond: (url: URL, method: string, cookie: boolean, gets: number) => Response,
) {
  const sessions = new InMemorySessions();
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
  });
  const gate = createApprovalGate();
  const calls: string[] = [];
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
      const cookie = new Headers(init?.headers).has("cookie");
      calls.push(`${method} ${url.pathname}${cookie ? "" : " (anonymous)"}`);
      if (method === "POST") posts++;
      if (method === "GET" && url.pathname.startsWith("/stores/main/products/")) itemGets++;
      return respond(url, method, cookie, itemGets);
    },
  });
  const request = { node: "urn:request", types: [f.write.actionType], values: () => [] };
  const pause = await executor.execute(request);
  expect(calls).toHaveLength(0);
  gate.approve(required(pause.approval).id);
  const result = await executor.execute(request, { approvalId: required(pause.approval).id });
  return { outcome: result.outcome?.status, committed: result.committed.length, posts, calls };
}

/** The session expired: the deletion is refused, the private item hides behind its 404, the listing is public. */
const signedOut =
  (f: ReturnType<typeof fixture>) =>
  (url: URL, method: string, _cookie: boolean, gets: number): Response => {
    if (method === "POST")
      return new Response(null, { status: 303, headers: { location: "/products" } });
    if (url.pathname === "/products")
      return new Response('<div role="alert">Unable to change product.</div>');
    if (url.pathname === "/stores/main/listing") return Response.json(f.liveBody());
    if (gets === 1) return Response.json(f.row("73"));
    return new Response("", {
      status: 404,
      headers: { "content-type": "text/plain;charset=UTF-8" },
    });
  };

/** An honest deletion in a live session: the listing needs the session, anonymous visitors sign in. */
const honest =
  (f: ReturnType<typeof fixture>) =>
  (url: URL, method: string, cookie: boolean, gets: number): Response => {
    if (method === "POST")
      return new Response(null, { status: 303, headers: { location: "/products" } });
    if (url.pathname === "/products") return new Response("<p>Product list</p>");
    if (url.pathname === "/stores/main/listing")
      return cookie
        ? Response.json(f.liveBody())
        : new Response(null, { status: 302, headers: { location: "/login" } });
    if (gets === 1) return Response.json(f.row("73"));
    return new Response("", {
      status: 404,
      headers: { "content-type": "text/plain;charset=UTF-8" },
    });
  };

async function listingScenario(mode: Anonymous) {
  const f = fixture();
  f.trace.push(
    f.record(100, {
      url: `${origin}/stores/main/listing`,
      bodySample: JSON.stringify(f.liveBody()),
    }),
  );
  const replayer = recordingReplayer(f.trace, (url, signedIn) => {
    if (url.pathname === "/stores/main/listing")
      return signedIn
        ? { status: 200, contentType: "application/json", body: JSON.stringify(f.liveBody()) }
        : (() => {
            const answer = anonymousListing(mode);
            return answer !== "timeout" && mode === "public200"
              ? { ...answer, body: JSON.stringify(f.liveBody()) }
              : answer;
          })();
    // The demonstrated item was deleted: both replays answer the empty 404.
    return { status: 404, contentType: "text/plain", body: "" };
  });
  return { f, ...(await learn(f, [f.write, f.read, f.live], replayer)) };
}

it.each<Anonymous>([
  "timeout",
  "waf403",
  "cookie-redirect",
  "public200",
])("r19 learns no liveness read when the anonymous replay of the listing is %s, and the expired-session deletion is Uncertain", async (mode) => {
  const { f, verified, policy } = await listingScenario(mode);
  expect(policy?.verification?.notFound).toBeDefined();
  expect(policy?.verification?.liveness).toBeUndefined();
  const run = await execute(f, verified, policy, signedOut(f));
  expect(run.outcome).toBe("uncertain");
  expect(run.posts).toBe(1);
  expect(run.committed).toBe(1);
});

it("r19 learns the listing when its anonymous replay redirects to the learned login page", async () => {
  const { f, verified, policy } = await listingScenario("login-redirect");
  expect(policy?.verification?.liveness).toMatchObject({
    operation: "urn:liveness",
    anonymous: {
      refusal: "login-redirect",
      loginRoutes: [`${origin}/login`, `${origin}/login_check`],
      route: `${origin}/login`,
    },
  });
  // At runtime, an expired session reads the public listing with and without cookies alike:
  // the anonymous control is not refused, so the deletion is Uncertain.
  const out = await execute(f, verified, policy, signedOut(f));
  expect(out.outcome).toBe("uncertain");
  expect(out.calls.slice(-2)).toEqual([
    "GET /stores/main/listing",
    "GET /stores/main/listing (anonymous)",
  ]);
  // An honest deletion in a live session completes.
  const ok = await execute(f, verified, policy, honest(f));
  expect(ok.outcome).toBe("completed");
  expect(ok.calls.at(-1)).toBe("GET /stores/main/listing (anonymous)");
});

it("r19 a verification read restored as signed-in without anonymous evidence is no liveness read", async () => {
  // Two demonstrated deletions through the same item read, then a public item viewed afterwards.
  const f = fixture();
  const at = (seq: number, r: RecordedRequest) => ({ ...r, seq });
  const item = (id: string, seq: number, extra: Partial<RecordedRequest> = {}) =>
    f.record(seq, {
      url: `${origin}/stores/main/products/${id}`,
      bodySample: JSON.stringify(f.row(id)),
      ...extra,
    });
  const write = required(f.trace.find((r) => r.method === "POST" && r.phase === "demonstration"));
  const landing = required(f.trace.find((r) => r.redirectedFrom === write.seq));
  f.trace.push(
    item("43", 10),
    at(11, { ...write, url: `${origin}/stores/main/products/delete/id/43`, completedAt: 12 }),
    at(12, { ...landing, redirectedFrom: 11 }),
    item("43", 13, { status: 404, contentType: "text/plain;charset=UTF-8", bodySample: "" }),
    item("77", 20),
  );
  const sent: Sent[] = [];
  const replayer = recordingReplayer(
    f.trace,
    (url) =>
      url.pathname.endsWith("/77")
        ? { status: 200, contentType: "application/json", body: JSON.stringify(f.row("77")) }
        : { status: 404, contentType: "text/plain", body: "" },
    sent,
  );
  const { verified, policy } = await learn(f, [f.write, f.read], replayer);
  expect(verified.find((o) => o.id === f.read.id)?.session).toBe("signed-in");
  expect(policy?.verification?.notFound).toBeDefined();
  // The profiler replayed item 77 anonymously; it rendered for anonymous visitors.
  expect(sent).toContainEqual(
    expect.objectContaining({ url: `${origin}/stores/main/products/77`, signedIn: false }),
  );
  expect(policy?.verification?.liveness).toBeUndefined();
  const run = await execute(f, verified, policy, (url, method, _cookie, gets) => {
    if (method === "POST")
      return new Response(null, { status: 303, headers: { location: "/products" } });
    if (url.pathname === "/products")
      return new Response('<div role="alert">Unable to change product.</div>');
    if (url.pathname.endsWith("/77")) return Response.json(f.row("77"));
    if (gets === 1) return Response.json(f.row("73"));
    return new Response("", {
      status: 404,
      headers: { "content-type": "text/plain;charset=UTF-8" },
    });
  });
  expect(run.outcome).toBe("uncertain");
  expect(run.committed).toBe(1);
});

/** A Postmill-style submission form: its forum options render only for a signed-in member. */
function submitFixture() {
  const f = fixture();
  const submit: Operation = {
    ...f.live,
    id: "urn:submit",
    label: "Open the submission form",
    request: { method: "GET", urlTemplate: `${origin}/submit` },
    extraction: {
      format: "html",
      itemType: `${SCHEMA}CreativeWork`,
      itemPath: "select option",
      fields: [{ property: `${SCHEMA}identifier`, path: ":scope", attribute: "value" }],
    },
  };
  const page =
    '<html><body><main><form action="/submit" method="post"><select name="forum"><option value="1">Example forum</option><option value="2">Other forum</option></select></form></main></body></html>';
  f.trace.push(
    f.record(100, {
      url: `${origin}/submit`,
      resourceType: "document",
      requestHeaders: {},
      contentType: "text/html; charset=UTF-8",
      bodySample: page,
    }),
  );
  return { f, submit, page };
}

it("r19 the honest Postmill-style /submit liveness read completes the deletion", async () => {
  const { f, submit, page } = submitFixture();
  const sent: Sent[] = [];
  const replayer = recordingReplayer(
    f.trace,
    (url, signedIn) =>
      url.pathname === "/submit"
        ? signedIn
          ? { status: 200, contentType: "text/html", body: page }
          : { status: 302, body: "", location: `${origin}/login` }
        : { status: 404, contentType: "text/plain", body: "" },
    sent,
  );
  const { verified, policy } = await learn(f, [f.write, f.read, submit], replayer);
  expect(verified.find((o) => o.id === submit.id)?.session).toBe("signed-in");
  // verify replayed /submit without cookies, which is no liveness evidence (round 20), so the
  // profiler's probe sends one credentials-only control.
  expect(
    sent.filter((s) => s.url === `${origin}/submit` && !s.signedIn).map((s) => s.credentialsOnly),
  ).toEqual([undefined, true]);
  expect(policy?.verification?.liveness).toMatchObject({
    operation: "urn:submit",
    bind: {},
    anonymous: { refusal: "login-redirect", route: `${origin}/login` },
  });
  const respond =
    (anonymous: () => Response) =>
    (url: URL, method: string, cookie: boolean, gets: number): Response => {
      if (method === "POST") return new Response(null, { status: 302, headers: { location: "/" } });
      if (url.pathname === "/")
        return new Response("<p>Front page</p>", { headers: { "content-type": "text/html" } });
      if (url.pathname === "/submit")
        return cookie
          ? new Response(page, { headers: { "content-type": "text/html; charset=UTF-8" } })
          : anonymous();
      if (gets === 1) return Response.json(f.row("73"));
      return new Response("", {
        status: 404,
        headers: { "content-type": "text/plain;charset=UTF-8" },
      });
    };
  const done = await execute(
    f,
    verified,
    policy,
    respond(() => new Response(null, { status: 302, headers: { location: `${origin}/login` } })),
  );
  expect(done.outcome).toBe("completed");
  expect(done.calls.slice(-2)).toEqual(["GET /submit", "GET /submit (anonymous)"]);
  // The same deletion where the form also renders for anonymous visitors proves nothing.
  const inline = await execute(
    f,
    verified,
    policy,
    respond(() => new Response(page, { headers: { "content-type": "text/html; charset=UTF-8" } })),
  );
  expect(inline.outcome).toBe("uncertain");
  expect(inline.committed).toBe(1);
});

it("r19 the profiler replays liveness candidates anonymously through the read gate before learning", async () => {
  const f = fixture();
  f.trace.push(
    f.record(100, {
      url: `${origin}/stores/main/listing`,
      bodySample: JSON.stringify(f.liveBody()),
    }),
  );
  // Verified signed-in without any recorded anonymous replay (for example a restored read).
  const verified = [f.write, f.read, { ...f.live, session: "signed-in" as const }];
  const ops = [f.write, f.read, f.live];
  expect(
    learnWriteResponses(ops, f.trace, origin, verified)[f.write.id]?.verification?.liveness,
  ).toBeUndefined();
  const order: string[] = [];
  const sent: Sent[] = [];
  const replayer = recordingReplayer(
    f.trace,
    () => {
      order.push("sent");
      return { status: 401, contentType: "application/json", body: '{"message":"Login required"}' };
    },
    sent,
  );
  // A denying gate stops the replay before anything is transmitted.
  await probeLivenessReads(ops, verified, f.trace, origin, replayer, {
    authorize: async (request) => {
      order.push(`gate ${request.effect}`);
      return { kind: "deny", reason: "Fixture denial" };
    },
  });
  expect(sent).toHaveLength(0);
  expect(order).toEqual(["gate read"]);
  order.length = 0;
  await probeLivenessReads(ops, verified, f.trace, origin, replayer, {
    authorize: async (request) => {
      order.push(
        `gate ${request.effect} ${request.target.kind === "operation" ? request.target.id : ""}`,
      );
      return { kind: "allow" };
    },
  });
  expect(order[0]).toBe("gate read urn:liveness");
  expect(order).toContain("sent");
  expect(sent).toEqual([
    {
      url: `${origin}/stores/main/listing`,
      signedIn: false,
      credentialsOnly: true,
      headers: {
        "x-requested-with": "XMLHttpRequest",
        accept: "application/json",
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
    },
  ]);
  // A URL already replayed anonymously is not sent again.
  await probeLivenessReads(ops, verified, f.trace, origin, replayer);
  expect(sent).toHaveLength(1);
  expect(
    learnWriteResponses(ops, f.trace, origin, verified)[f.write.id]?.verification?.liveness,
  ).toMatchObject({
    operation: "urn:liveness",
    anonymous: { refusal: "authentication-status" },
  });
});

it.each([
  ["a bare 401", { status: 401, body: "" }],
  [
    "a 403 without authentication wording",
    { status: 403, contentType: "text/html", body: "<p>Forbidden</p>" },
  ],
  ["a 5xx", { status: 503, contentType: "text/html", body: "<p>Sign in later</p>" }],
  ["a redirect to another page", { status: 302, body: "", location: "/welcome" }],
  ["a redirect off the site", { status: 302, body: "", location: "https://sso.test/login" }],
  [
    "a page without a login form",
    { status: 200, contentType: "text/html", body: "<p>Please sign in</p>" },
  ],
])("r19 learns no liveness read when the anonymous replay is %s", async (_name, answer) => {
  const f = fixture();
  f.trace.push(
    f.record(100, {
      url: `${origin}/stores/main/listing`,
      bodySample: JSON.stringify(f.liveBody()),
    }),
  );
  const verified = [f.write, f.read, { ...f.live, session: "signed-in" as const }];
  const ops = [f.write, f.read, f.live];
  await probeLivenessReads(
    ops,
    verified,
    f.trace,
    origin,
    recordingReplayer(f.trace, () => answer),
  );
  expect(f.trace.some((r) => r.resourceType === "replay-anonymous")).toBe(true);
  expect(
    learnWriteResponses(ops, f.trace, origin, verified)[f.write.id]?.verification?.liveness,
  ).toBeUndefined();
});

it("r19 every anonymous replay of the exact URL must be refused, and a refusal that matches the signature is none", async () => {
  const f = fixture();
  f.trace.push(
    f.record(100, {
      url: `${origin}/stores/main/listing`,
      bodySample: JSON.stringify(f.liveBody()),
    }),
  );
  const verified = [f.write, f.read, { ...f.live, session: "signed-in" as const }];
  const ops = [f.write, f.read, f.live];
  const replay = (seq: number, change: Partial<RecordedRequest>) =>
    f.record(seq, {
      phase: "verify",
      demonstration: undefined,
      url: `${origin}/stores/main/listing`,
      resourceType: "replay-anonymous",
      credentialsOnlyControl: true,
      cookieNames: [],
      ...change,
    });
  const liveness = (trace: RecordedRequest[]) =>
    learnWriteResponses(ops, [...f.trace, ...trace], origin, verified)[f.write.id]?.verification
      ?.liveness;
  const refused = replay(300, { status: 302, redirectedTo: `${origin}/login`, bodySample: "" });
  expect(liveness([refused])).toBeDefined();
  // Round 20: a plain cookieless replay is no evidence, only a credentials-only control is.
  expect(liveness([{ ...refused, credentialsOnlyControl: undefined }])).toBeUndefined();
  // Every control must give one refusal kind and one route.
  expect(
    liveness([
      refused,
      replay(306, { status: 401, authenticationChallenge: true, bodySample: "" }),
    ]),
  ).toBeUndefined();
  // A second anonymous replay that rendered the listing withdraws the evidence.
  expect(
    liveness([refused, replay(301, { bodySample: JSON.stringify(f.liveBody()) })]),
  ).toBeUndefined();
  // Another URL (a different query) is not the exact bound URL.
  expect(
    liveness([
      replay(302, {
        url: `${origin}/stores/main/listing?view=all`,
        status: 302,
        redirectedTo: `${origin}/login`,
      }),
    ]),
  ).toBeUndefined();
  // A 2xx answer that carries a challenge header and still renders the rows is no refusal.
  expect(
    liveness([
      replay(303, {
        authenticationChallenge: true,
        bodySample: JSON.stringify(f.liveBody()),
      }),
    ]),
  ).toBeUndefined();
  // A truncated login page is no evidence.
  expect(
    liveness([
      replay(304, {
        contentType: "text/html",
        bodyTruncated: true,
        bodySample: '<form action="/login_check"><input type="password"></form>',
      }),
    ]),
  ).toBeUndefined();
  // A complete login page is.
  expect(
    liveness([
      replay(305, {
        contentType: "text/html",
        bodySample: '<form action="/login_check"><input type="text" name="user"></form>',
      }),
    ])?.anonymous,
  ).toEqual({ refusal: "login-page", loginRoutes: [`${origin}/login`, `${origin}/login_check`] });
});

it("r19 a token-decorated read is never a liveness candidate", async () => {
  const { f, verified } = await listingScenario("login-redirect");
  const live = required(verified.find((o) => o.id === f.live.id));
  live.csrf = [
    {
      source: { kind: "cookie", name: "csrf" },
      target: { kind: "query", name: "token" },
    },
  ];
  expect(
    learnWriteResponses([f.write, f.read, live], f.trace, origin, verified)[f.write.id]
      ?.verification?.liveness,
  ).toBeUndefined();
});

it("r19 learns login routes only from the sign-in session and the login operation", () => {
  const f = fixture();
  const routes = learnedLoginRoutes(
    [
      {
        ...f.read,
        id: "urn:login",
        actionType: "https://jeswr.org/ns/site-action#LoginAction",
        request: { method: "POST", urlTemplate: `${origin}/account/signin` },
      },
    ],
    [
      ...f.trace,
      // A crawled page with a password form is not the sign-in session.
      f.record(30, {
        phase: "crawl",
        url: `${origin}/register`,
        contentType: "text/html",
        bodySample: '<form><input type="password"></form>',
      }),
      // A sign-in page answer without a password form is no login page.
      f.record(-15, {
        phase: "login",
        url: `${origin}/welcome`,
        contentType: "text/html",
        bodySample: "<p>Welcome</p>",
      }),
      f.record(-14, { phase: "login", method: "POST", url: "https://other.test/login" }),
    ],
    origin,
  );
  expect(routes).toEqual([`${origin}/account/signin`, `${origin}/login`, `${origin}/login_check`]);
});
