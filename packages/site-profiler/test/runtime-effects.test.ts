// AUTHORED-BY Codex GPT-6.1-Sol
import { createApprovalGate, createExecutor, InMemorySessions } from "@jeswr/site-executor";
import { type Operation, readSiteModel, SCHEMA, writeSiteModel } from "@jeswr/site-model";
import { expect, it } from "vitest";
import type { RecordedRequest } from "../src/types.js";
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
function fixture(type = "DeleteAction", list = false) {
  const write: Operation = {
    id: "urn:write",
    label: "Change example product",
    actionType: SCHEMA + type,
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
      ...(type === "UpdateAction"
        ? [
            {
              name: "name",
              path: [`${SCHEMA}object`, `${SCHEMA}name`],
              location: "form" as const,
              range: "http://www.w3.org/2001/XMLSchema#string",
              required: true,
              default: "Edited widget",
            },
          ]
        : []),
      ...(type === "VoteAction"
        ? [
            {
              name: "choice",
              path: [`${SCHEMA}ratingValue`],
              location: "form" as const,
              range: "http://www.w3.org/2001/XMLSchema#string",
              required: true,
              default: "1",
            },
          ]
        : []),
    ],
    request: {
      method: "POST",
      urlTemplate: `${origin}/stores/main/products/${type === "DeleteAction" ? "delete" : "save"}/id/{id}`,
      contentType: "application/x-www-form-urlencoded",
    },
  };
  const read: Operation = {
    ...write,
    id: "urn:read",
    label: "Read example product",
    actionType: `${SCHEMA}ViewAction`,
    effect: "read",
    inputs: [
      {
        ...required(write.inputs[0]),
        path: [],
        location: list ? "query" : "path",
        default: undefined,
      },
    ],
    request: {
      method: "GET",
      urlTemplate: list
        ? `${origin}/stores/main/products/rows{?id}`
        : `${origin}/stores/main/products/{id}`,
      headers: { "x-requested-with": "XMLHttpRequest" },
    },
    extraction: {
      format: "json",
      itemType: `${SCHEMA}Product`,
      ...(list ? { itemPath: "/items", totalPath: "/total" } : {}),
      fields: [
        { property: `${SCHEMA}identifier`, path: "/id" },
        { property: `${SCHEMA}url`, path: "/url", datatype: "iri" },
        { property: `${SCHEMA}name`, path: "/name", untrusted: true },
        { property: `${SCHEMA}ratingCount`, path: "/count" },
      ],
    },
  };
  const row = (
    id: string,
    name = "Original widget",
    count = 3,
    resource = "/stores/main/products/",
  ) => ({ id, url: origin + resource + id, name, count });
  const envelope = (item: ReturnType<typeof row>) => (list ? { total: 1, items: [item] } : item);
  const record = (seq: number, change: Partial<RecordedRequest>): RecordedRequest => ({
    seq,
    phase: "demonstration",
    demonstration: "example",
    method: "GET",
    url: read.request.urlTemplate.replace("{id}", "42").replace("{?id}", "?id=42"),
    resourceType: "xhr",
    requestHeaders: { "x-requested-with": "XMLHttpRequest" },
    cookieNames: ["session"],
    status: 200,
    contentType: "application/json",
    ...change,
  });
  const trace = [
    record(1, { bodySample: JSON.stringify(envelope(row("42"))) }),
    record(2, {
      method: "POST",
      url: write.request.urlTemplate.replace("{id}", "42"),
      postData:
        type === "UpdateAction" ? "name=Edited+widget" : type === "VoteAction" ? "choice=1" : "",
      requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
      status: 303,
      redirectedTo: `${origin}/products`,
    }),
    record(3, {
      url: `${origin}/products`,
      contentType: "text/html",
      redirectedFrom: 2,
      responsePageError: false,
      bodySample: '<div role="alert">Unable to change product.</div>',
    }),
    record(4, {
      bodySample: JSON.stringify(
        type === "DeleteAction"
          ? { total: 0, items: [], message: "Please sign in to view products" }
          : envelope(row("42", "Edited widget", 4)),
      ),
    }),
  ];
  return { write, read, trace, row, envelope };
}

async function replay(type = "DeleteAction", mode = "verified", list = false, legacy = false) {
  const f = fixture(type, list);
  if (mode === "other tenant") {
    const before = required(f.trace[0]);
    before.url = before.url.replace("/main/", "/other/");
    before.bodySample = before.bodySample?.replaceAll("/main/", "/other/");
    f.read.request.urlTemplate = f.read.request.urlTemplate.replace("/main/", "/other/");
  }
  if (mode === "formatted numeric" || mode === "wrong numeric") {
    f.write.inputs.push({
      name: "price",
      path: [`${SCHEMA}object`, `${SCHEMA}price`],
      range: "http://www.w3.org/2001/XMLSchema#decimal",
      required: true,
      default: "23.45",
      location: "form",
    });
    f.read.extraction?.fields.push({ property: `${SCHEMA}price`, path: "/price" });
    required(f.trace[1]).postData += "&price=23.45";
    const row = f.row;
    f.row = (...args: Parameters<typeof row>) => ({
      ...row(...args),
      price: args[1] === "Edited widget" && mode !== "wrong numeric" ? "$23.45" : "$12.34",
    });
    required(f.trace[0]).bodySample = JSON.stringify(
      f.envelope({ ...row("42"), price: "$12.34" } as ReturnType<typeof row>),
    );
    required(f.trace[3]).bodySample = JSON.stringify(
      f.envelope({ ...row("42", "Edited widget"), price: "$23.45" } as ReturnType<typeof row>),
    );
  }
  let policy = learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id];
  expect(policy?.successFlash).toBeUndefined();
  if (mode !== "other tenant") expect(policy?.verification?.operation).toBe(f.read.id);
  if (mode === "missing read") policy = undefined;
  if (legacy)
    policy = {
      createdLocationPattern: "/products",
      completionOnly: true,
      successFlash: ["a".repeat(64)],
    };
  const sessions = new InMemorySessions();
  sessions.set(origin, undefined, {
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
  const calls: { method: string; url: string; headers: Headers }[] = [];
  const authorized: string[] = [];
  let posts = 0,
    reads = 0;
  const executor = createExecutor({
    model: readSiteModel(
      await writeSiteModel({
        id: "urn:model",
        site: origin,
        generatedAt: provenance.learnedAt,
        version: "1",
        operations: [f.write, f.read],
        flows: [],
      }),
    ),
    sessions,
    writeResponses: policy ? { [f.write.id]: policy } : {},
    gate: {
      authorize: async (request) => {
        authorized.push(request.effect);
        if (mode === "read denied" && request.effect === "read")
          return { kind: "deny", reason: "Fixture read denial" };
        return gate.authorize(request);
      },
    },
    fetch: async (input, init) => {
      const url = new URL(String(input)),
        headers = new Headers(init?.headers);
      const method = init?.method ?? "GET";
      calls.push({ method, url: url.href, headers });
      expect(url.origin).toBe(origin);
      if (method === "POST") {
        posts++;
        return new Response(null, {
          status: 303,
          headers: {
            location: "/products",
            ...(mode === "cookie context changed"
              ? { "set-cookie": "view=hidden; Path=/; Secure" }
              : mode === "session cleared"
                ? { "set-cookie": "session=expired; Max-Age=0; Path=/; Secure" }
                : mode === "session changed"
                  ? { "set-cookie": "session=changed-session-secret; Path=/; Secure; HttpOnly" }
                  : {}),
          },
        });
      }
      if (url.pathname === "/products")
        return new Response('<div role="alert">Unable to change product.</div>');
      reads++;
      expect(authorized.at(-1)).toBe("read");
      expect(headers.get("x-requested-with")).toBe("XMLHttpRequest");
      if (reads === 1) {
        if (mode === "baseline absent") return new Response("", { status: 404 });
        if (mode === "baseline unauthorized") return new Response("", { status: 403 });
        if (mode === "baseline login") return new Response('<form><input type="password"></form>');
        if (mode === "baseline session changed")
          return Response.json(f.envelope(f.row("73")), {
            headers: { "set-cookie": "session=different-session-secret; Path=/; Secure; HttpOnly" },
          });
        return Response.json(f.envelope(f.row("73")));
      }
      if (mode === "login redirect")
        return new Response(null, { status: 302, headers: { location: "/login" } });
      if (url.pathname === "/login" || mode === "password 404")
        return new Response('<form><input type="password"></form>', { status: 404 });
      if (mode === "unauthorized") return new Response("Denied", { status: 403 });
      if (mode === "failure marker") return Response.json({ ok: false, total: 0, items: [] });
      if (type === "DeleteAction") {
        if (mode === "header dependent 404")
          return headers.has("x-requested-with")
            ? Response.json(f.envelope(f.row("73")))
            : new Response("", { status: 404 });
        if (list)
          return Response.json({
            total: 0,
            items: [],
            ...(mode === "changed envelope" ? { message: "Please sign in" } : {}),
          });
        return new Response("", { status: mode === "gone" ? 410 : 404 });
      }
      return Response.json(
        f.envelope(
          f.row(
            "73",
            mode === "wrong value" ? "Original widget" : "Edited widget",
            mode === "wrong value" ? 3 : 4,
            mode === "wrong resource" ? "/stores/other/products/" : "/stores/main/products/",
          ),
        ),
      );
    },
  });
  const request = { node: "urn:request", types: [f.write.actionType], values: () => [] };
  const pause = await executor.execute(request);
  expect(pause.status).toBe("needs-approval");
  expect(calls).toHaveLength(0);
  if (!pause.approval) throw new Error("Missing approval");
  gate.approve(pause.approval.id);
  const result = await executor.execute(request, { approvalId: pause.approval.id });
  if (mode === "read denied" || mode.startsWith("baseline ")) {
    expect(posts).toBe(0);
    expect(result.outcome?.status).toBe("uncertain");
    expect(result.committed).toEqual([]);
    return { result, calls, policy };
  }
  expect(posts).toBe(1);
  expect(result.committed).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("fixture-secret-session");
  expect(result.outcome?.result).toBeUndefined();
  const count = calls.length;
  // Reauthentication must not erase the retained repeat fingerprint.
  if (mode === "session cleared")
    sessions.set(origin, undefined, {
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
  const repeat = await executor.execute(request, {
    excludeFingerprints: result.committed.map((entry) => entry.fingerprint),
  });
  expect(repeat.errorKind).toBe("repeat");
  expect(calls).toHaveLength(count);
  return { result, calls, policy };
}

it.each([
  "verified",
  "gone",
])("verifies deletion with a baseline 200 and same-context %s absence", async (mode) => {
  const { result, calls } = await replay("DeleteAction", mode);
  expect(result.outcome?.status).toBe("completed");
  expect(calls.map((c) => c.method)).toEqual(["GET", "POST", "GET", "GET"]);
  expect(calls[0]?.url).toBe(calls[3]?.url);
  expect([...required(calls[0]).headers]).toEqual([...required(calls[3]).headers]);
});
it("verifies deletion with an explicitly empty identity-filtered list in the baseline success envelope", async () => {
  expect((await replay("DeleteAction", "verified", true)).result.outcome?.status).toBe("completed");
});
it("verifies an update by the submitted field on the same resource", async () => {
  expect((await replay("UpdateAction")).result.outcome?.status).toBe("completed");
});
it("verifies a vote by its learned paired count delta", async () => {
  const { result, policy } = await replay("VoteAction");
  expect(policy?.verification?.changes).toEqual([
    { input: "choice", property: `${SCHEMA}ratingCount`, mode: "delta" },
  ]);
  expect(result.outcome?.status).toBe("completed");
});
it.each([
  "header dependent 404",
  "session cleared",
  "session changed",
  "cookie context changed",
  "password 404",
  "login redirect",
  "unauthorized",
  "failure marker",
  "missing read",
  "read denied",
  "other tenant",
])("keeps a delete Uncertain with %s, preserving the one-write repeat guard", async (mode) => {
  expect((await replay("DeleteAction", mode)).result.outcome?.status).toBe("uncertain");
});
it("r13 changed JSON error envelope cannot verify deletion or teach a success flash", async () => {
  expect((await replay("DeleteAction", "changed envelope", true)).result.outcome?.status).toBe(
    "uncertain",
  );
});
it.each([
  "UpdateAction",
  "VoteAction",
])("keeps %s Uncertain for unchanged submitted state or another tenant", async (type) => {
  for (const mode of ["wrong value", "wrong resource"])
    expect((await replay(type, mode)).result.outcome?.status).toBe("uncertain");
});
it("does not accept a legacy learned flash or completion-only route as success evidence", async () => {
  expect((await replay("DeleteAction", "verified", false, true)).result.outcome?.status).toBe(
    "uncertain",
  );
});
it("denial before approval sends neither a baseline nor a write", async () => {
  const f = fixture();
  const executor = createExecutor({
    writeResponses: learnWriteResponses([f.write, f.read], f.trace, origin),
    model: {
      id: "urn:model",
      site: origin,
      generatedAt: provenance.learnedAt,
      version: "1",
      operations: [f.write, f.read],
      flows: [],
    },
    sessions: {
      get: async () => ({ cookies: [], headers: { authorization: "fixture-secret-session" } }),
      update: async () => {},
    },
    gate: { authorize: async () => ({ kind: "deny", reason: "Denied" }) },
    fetch: async () => {
      throw new Error("No transport allowed");
    },
  });
  expect(
    (await executor.execute({ node: "urn:request", types: [f.write.actionType], values: () => [] }))
      .status,
  ).toBe("denied");
});

it.each([
  false,
  true,
])("binds a witnessed parent/store context to the current target (conflicting parent=%s)", async (conflict) => {
  const f = fixture("UpdateAction");
  const parameter = required(f.write.inputs[0]);
  const context = [
    {
      ...parameter,
      name: "store",
      path: [`${SCHEMA}object`, `${SCHEMA}isPartOf`, `${SCHEMA}name`],
      default: "main",
    },
    {
      ...parameter,
      name: "parent",
      path: [`${SCHEMA}about`, `${SCHEMA}identifier`],
      default: "81",
    },
  ];
  f.write.inputs.push(...context);
  f.read.inputs.push(...context.map((p) => ({ ...p, path: [] })));
  f.write.request.urlTemplate = `${origin}/main/stores/{store}/posts/{parent}/products/save/id/{id}`;
  f.read.request.urlTemplate = `${origin}/main/stores/{store}/posts/{parent}/products/{id}`;
  const before = required(f.trace[0]),
    write = required(f.trace[1]);
  before.url = `${origin}/main/stores/main/posts/51/products/42`;
  before.bodySample = JSON.stringify(
    f.row("42", "Original widget", 3, "/main/stores/main/posts/51/products/"),
  );
  write.url = `${origin}/main/stores/main/posts/51/products/save/id/42`;
  const policy = learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id];
  expect(policy?.verification?.identityPattern).toBe(
    `${origin}/main/stores/{context_store}/posts/{context_parent}/products/{id}`,
  );
  expect(policy?.verification?.identityInput).toBe("id");
  let sent = false;
  const executor = createExecutor({
    model: {
      id: "urn:model",
      site: origin,
      generatedAt: provenance.learnedAt,
      version: "1",
      operations: [f.write, f.read],
      flows: [],
    },
    sessions: {
      get: async () => ({ cookies: [], headers: { authorization: "fictional-session-secret" } }),
      update: async () => {},
    },
    gate: { authorize: async () => ({ kind: "allow" }) },
    writeResponses: policy ? { [f.write.id]: policy } : {},
    fetch: async (input, init) => {
      const url = new URL(String(input));
      expect(url.pathname).toContain("/main/stores/main/posts/81/");
      if (init?.method === "POST") {
        sent = true;
        return Response.json({});
      }
      return Response.json(
        f.row(
          "73",
          sent ? "Edited widget" : "Original widget",
          3,
          `/main/stores/main/posts/${sent && conflict ? "82" : "81"}/products/`,
        ),
      );
    },
  });
  expect(
    (await executor.execute({ node: "urn:action", types: [f.write.actionType], values: () => [] }))
      .outcome?.status,
  ).toBe(conflict ? "uncertain" : "completed");
});

it("learns an identity-filtered read bound to a flow-only resolver identity", () => {
  const f = fixture("DeleteAction", true);
  f.write.inputs = [
    {
      ...required(f.write.inputs[0]),
      name: "resolvedIdentity",
      path: [],
      location: "body",
      default: undefined,
    },
    {
      ...required(f.write.inputs[0]),
      name: "search",
      path: [`${SCHEMA}query`],
      location: "form",
      default: undefined,
    },
  ];
  f.write.request.urlTemplate = `${origin}/stores/main/products/massDelete`;
  f.write.request.bodyTemplate = "search={search}";
  required(f.trace[1]).url = f.write.request.urlTemplate;
  required(f.trace[1]).postData = "search=EX-42";
  const policy = learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id];
  expect(policy?.verification).toMatchObject({
    identityInput: "resolvedIdentity",
    bind: { id: { input: "resolvedIdentity" } },
  });
});

it.each([
  "formatted numeric",
  "wrong numeric",
])("compares a typed update against its exact witnessed numeric presentation: %s", async (mode) => {
  const { result, policy } = await replay("UpdateAction", mode);
  expect(policy?.verification?.changes.find((change) => change.input === "price")?.format).toEqual({
    prefix: "$",
    suffix: "",
    scale: 2,
  });
  expect(result.outcome?.status).toBe(mode === "formatted numeric" ? "completed" : "uncertain");
  expect(result.observations.map((observation) => observation.turtle).join(" ")).not.toContain(
    "$23.45",
  );
});

it("r13 an already matching field in another tenant cannot verify a failed demonstrated update", async () => {
  expect((await replay("UpdateAction", "other tenant")).result.outcome?.status).toBe("uncertain");
});

it.each([
  "baseline absent",
  "baseline unauthorized",
  "baseline login",
  "baseline session changed",
])("requires a valid baseline before sending the approved write: %s", async (mode) => {
  const { result, calls } = await replay("DeleteAction", mode);
  expect(result.outcome?.status).toBe("uncertain");
  expect(result.committed).toEqual([]);
  expect(calls.map((call) => call.method)).toEqual(["GET"]);
});

it.each([
  false,
  true,
])("uses a resource alias only when its GET redirect was witnessed (linked=%s)", (linked) => {
  const f = fixture();
  const before = required(f.trace[0]);
  f.read.request.urlTemplate = `${origin}/catalogue/{id}`;
  before.url = `${origin}/catalogue/42`;
  before.bodySample = JSON.stringify(f.row("42", "Original widget", 3, "/catalogue/"));
  if (linked) {
    before.redirectedFrom = 0;
    f.trace.push({
      ...before,
      seq: 0,
      url: `${origin}/stores/main/products/42`,
      redirectedFrom: undefined,
      status: 302,
      redirectedTo: before.url,
      bodySample: undefined,
    });
  }
  const policy = learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id];
  if (linked)
    expect(policy?.verification?.identityAliases).toEqual([`${origin}/stores/main/products/{id}`]);
  else expect(policy).toBeUndefined();
});
