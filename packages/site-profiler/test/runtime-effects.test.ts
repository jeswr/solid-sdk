// AUTHORED-BY Codex GPT-6
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
    authenticationContext: "fictional-context",
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
          ? list
            ? { total: 0, items: [] }
            : { total: 0, items: [], message: "Please sign in to view products" }
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
  if (mode.includes("scope") || mode === "shared selector conflict") {
    const header = mode.includes("header");
    const runtime = mode.startsWith("runtime");
    const readValue =
      runtime || mode === "matching query scope" || mode === "matching header scope"
        ? "main"
        : "other";
    const apply = (op: Operation, r: RecordedRequest, value: string) => {
      if (header) {
        op.request.headers = { ...op.request.headers, "X-Store-Id": value };
        r.requestHeaders["x-store-id"] = value;
      } else {
        const name = mode === "shared selector conflict" ? "viewMode" : "NaMeSpAcE";
        op.request.urlTemplate += `?${name}=${value}`;
        r.url += `?${name}=${value}`;
      }
    };
    apply(f.read, required(f.trace[0]), readValue);
    if (runtime || mode.startsWith("matching")) {
      if (header) required(f.trace[3]).requestHeaders["x-store-id"] = readValue;
      else required(f.trace[3]).url = required(f.trace[0]).url;
    }
    if (!mode.includes("missing write")) apply(f.write, required(f.trace[1]), "main");
    if (mode.includes("missing read")) {
      if (header) {
        delete f.read.request.headers?.["X-Store-Id"];
        delete required(f.trace[0]).requestHeaders["x-store-id"];
      } else {
        f.read.request.urlTemplate = f.read.request.urlTemplate.split("?")[0] ?? "";
        required(f.trace[0]).url = required(f.trace[0]).url.split("?")[0] ?? "";
      }
    }
  }
  if (mode.includes("state coverage")) {
    f.write.inputs.push({
      name: "inventory",
      path: [`${SCHEMA}object`, `${SCHEMA}inventoryLevel`],
      location: "form",
      required: true,
      range: "http://www.w3.org/2001/XMLSchema#integer",
      default: "9",
    });
    required(f.trace[1]).postData += "&inventory=9";
    if (mode !== "missing state coverage") {
      f.read.extraction?.fields.push({ property: `${SCHEMA}inventoryLevel`, path: "/inventory" });
      const row = f.row;
      f.row = (...args: Parameters<typeof row>) => ({
        ...row(...args),
        inventory: args[1] === "Edited widget" ? 9 : 3,
      });
      required(f.trace[0]).bodySample = JSON.stringify(f.envelope(f.row("42")));
      required(f.trace[3]).bodySample = JSON.stringify(f.envelope(f.row("42", "Edited widget")));
    }
  }
  if (mode.includes("constant")) {
    const header = mode.includes("header");
    if (header) f.read.request.headers = { ...f.read.request.headers, "X-Store-Id": "main" };
    else f.read.request.urlTemplate += "?namespace=main";
    for (const at of [0, 3]) {
      const r = required(f.trace[at]);
      if (header) r.requestHeaders["x-store-id"] = "main";
      else r.url += "?namespace=main";
    }
    if (mode.includes("never witnessed"))
      required(f.trace[3]).bodySample = JSON.stringify(f.envelope(f.row("42")));
    if (mode === "input constant") {
      f.read.inputs.push({
        name: "namespace",
        path: [],
        location: "query",
        range: "http://www.w3.org/2001/XMLSchema#string",
        required: true,
        default: "main",
      });
      f.read.request.urlTemplate = f.read.request.urlTemplate.replace(
        "?namespace=main",
        "{?namespace}",
      );
    }
  }
  if (mode.includes("carried field")) {
    f.write.request.bodyTemplate = "name=%7Bname%7D&product%5Binventory%5D=9";
    required(f.trace[1]).postData += "&product%5Binventory%5D=9";
    f.trace.unshift({
      ...required(f.trace[0]),
      seq: 0,
      contentType: "text/html",
      bodySample: `<form method="POST" action="${required(f.trace[1]).url}"><input name="product[inventory]" value="${mode.includes("unchanged") ? "9" : "3"}"></form>`,
    });
    if (mode.includes("literal-only")) {
      f.write.inputs = f.write.inputs.filter((p) => p.name !== "name");
      f.write.request.bodyTemplate = "product%5Binventory%5D=9";
      required(f.trace[2]).postData = "product%5Binventory%5D=9";
    }
    if (!mode.includes("uncovered") && !mode.includes("unchanged")) {
      const key = mode.includes("coincidental") ? "stock" : "inventory";
      f.read.extraction?.fields.push({ property: `${SCHEMA}inventoryLevel`, path: `/${key}` });
      const row = f.row;
      f.row = (...args: Parameters<typeof row>) => ({
        ...row(...args),
        ...(mode.includes("coincidental") ? { sku: "EX-42" } : {}),
        [key]:
          mode.includes("coincidental") ||
          (args[1] === "Edited widget" && !mode.includes("rejected"))
            ? 9
            : 3,
      });
      required(f.trace[1]).bodySample = JSON.stringify(f.envelope(f.row("42")));
      required(f.trace[4]).bodySample = JSON.stringify(f.envelope(f.row("42", "Edited widget")));
    }
    if (mode.includes("coincidental")) {
      const { clusterRequests } = await import("../src/templates.js");
      const { learnDemonstratedForm } = await import("../src/write-learning.js");
      const { proposeJsonExtraction } = await import("../src/extraction.js");
      const inferred = learnDemonstratedForm(
        required(clusterRequests([required(f.trace[2])], origin)[0]),
      );
      expect(inferred.params.map((p) => p.name)).not.toContain("inventory");
      expect(new URLSearchParams(inferred.bodyTemplate).get("product[inventory]")).toBe("9");
      f.write.request.bodyTemplate = inferred.bodyTemplate;
      f.read.extraction = required(
        proposeJsonExtraction(required(f.trace[1]).bodySample ?? "", required(f.trace[1]).url),
      );
      expect(f.read.extraction.fields.find((field) => field.path === "/stock")?.property).toBe(
        `${SCHEMA}inventoryLevel`,
      );
    }
  }
  // The demonstration fetches its deleted target; a generic status is never absence evidence.
  if (type === "DeleteAction" && !list && mode !== "no signature") {
    f.trace.push({
      ...required(f.trace[0]),
      seq: 5,
      status: mode === "gone" ? 410 : 404,
      bodySample: "",
      contentType: "text/plain;charset=UTF-8",
      ...(mode.startsWith("JSON signature")
        ? {
            contentType: "application/json",
            bodySample: JSON.stringify({
              status: mode.includes("numeric") ? 404 : "not-found",
              message: "Missing widget",
            }),
          }
        : {}),
      ...(mode.startsWith("HTML signature")
        ? {
            contentType: "text/html",
            bodySample:
              '<main><h1>Not found</h1><form action="/search"><button>Search</button></form></main>',
          }
        : {}),
    });
  }
  let policy = learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id];
  expect(policy?.successFlash).toBeUndefined();
  const unlearned =
    mode === "other tenant" ||
    mode === "shared selector conflict" ||
    mode === "missing state coverage" ||
    mode.includes("never witnessed") ||
    mode === "input constant" ||
    mode === "rejected carried field" ||
    mode === "coincidental carried field" ||
    mode.includes("uncovered carried field") ||
    (mode.includes("scope") && !mode.startsWith("matching") && !mode.startsWith("runtime"));
  if (unlearned) expect(policy?.verification).toBeUndefined();
  else expect(policy?.verification?.operation).toBe(f.read.id);
  if (mode === "runtime query scope conflict")
    f.read.request.urlTemplate = f.read.request.urlTemplate
      .replace("main", "main")
      .replace("NaMeSpAcE=main", "NaMeSpAcE=other");
  if (mode === "runtime header scope conflict")
    f.read.request.headers = { ...f.read.request.headers, "X-Store-Id": "other" };
  if (mode === "runtime query constant replaced")
    f.read.request.urlTemplate = f.read.request.urlTemplate.replace(
      "namespace=main",
      "namespace=other",
    );
  if (mode === "runtime header constant replaced")
    f.read.request.headers = { ...f.read.request.headers, "X-Store-Id": "other" };
  if (mode === "runtime input constant" && policy?.verification) {
    f.read.inputs.push({
      name: "namespace",
      path: [],
      location: "query",
      range: "http://www.w3.org/2001/XMLSchema#string",
      required: true,
      default: "main",
    });
    f.read.request.urlTemplate = f.read.request.urlTemplate.replace(
      "?namespace=main",
      "{?namespace}",
    );
    policy.verification.bind.namespace = { value: "main" };
  }
  if (mode === "runtime missing state coverage" && policy?.verification)
    policy.verification.changes = policy.verification.changes.filter(
      (c) => c.input !== "inventory",
    );
  if (mode.includes("token source"))
    f.read.csrf = [
      {
        source: {
          kind: "html",
          urlTemplate: `${origin}/token`,
          selector: "input",
          attribute: "value",
        },
        target: { kind: "query", name: "csrf" },
      },
    ];
  if (mode === "runtime broad collection filter" && policy?.verification) {
    f.read.request.urlTemplate = f.read.request.urlTemplate.replace("{?id}", "{?search}");
    required(f.read.inputs[0]).name = "search";
    policy.verification.bind = { search: { input: "id" } };
  }
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
  const calls: { method: string; url: string; headers: Headers; cache?: RequestCache }[] = [];
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
        if (
          (mode === "read denied" ||
            mode === "token source read denied" ||
            (mode === "token source denied" &&
              authorized.filter((effect) => effect === "read").length === 2) ||
            (mode === "token source redirect denied" &&
              authorized.filter((effect) => effect === "read").length === 3)) &&
          request.effect === "read"
        )
          return { kind: "deny", reason: "Fixture read denial" };
        return gate.authorize(request);
      },
    },
    fetch: async (input, init) => {
      const url = new URL(String(input)),
        headers = new Headers(init?.headers);
      const method = init?.method ?? "GET";
      calls.push({ method, url: url.href, headers, ...(init?.cache ? { cache: init.cache } : {}) });
      if (url.pathname === "/token" && mode.includes("redirect"))
        return new Response(null, { status: 302, headers: { location: "/token-final" } });
      if (url.pathname === "/token" || url.pathname === "/token-final")
        return new Response('<input value="fictional-token">', {
          headers: { "content-type": "text/html" },
        });
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
      if (mode.includes("verification body")) {
        const body = JSON.stringify({
          padding: "x".repeat(mode.includes("oversized") ? 8 * 1024 * 1024 : 6 * 1024 * 1024),
          ...f.row("73", reads === 1 ? "Original widget" : "Edited widget"),
        });
        if (reads > 1 && mode.includes("broken")) {
          let sent = false;
          return new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                if (sent) controller.error(new Error("fixture stream ended early"));
                else {
                  controller.enqueue(new TextEncoder().encode(body));
                  sent = true;
                }
              },
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        return new Response(body, {
          headers: {
            "content-type": "application/json",
            ...(reads > 1 && mode.includes("early")
              ? { "content-length": String(Buffer.byteLength(body) + 10) }
              : {}),
          },
        });
      }
      if (reads === 1) {
        if (mode === "baseline absent") return new Response("", { status: 404 });
        if (mode === "baseline unauthorized") return new Response("", { status: 403 });
        if (mode === "baseline login") return new Response('<form><input type="password"></form>');
        if (mode === "baseline session changed")
          return Response.json(f.envelope(f.row("73")), {
            headers: { "set-cookie": "session=different-session-secret; Path=/; Secure; HttpOnly" },
          });
        if (mode === "baseline two items")
          return Response.json({ total: 2, items: [f.row("73"), f.row("74")] });
        if (mode === "baseline missing target") return Response.json(f.envelope(f.row("74")));
        return Response.json(f.envelope(f.row("73")), {
          headers: mode === "baseline cached" ? { age: "2" } : {},
        });
      }
      if (mode === "login redirect")
        return new Response(null, { status: 302, headers: { location: "/login" } });
      if (url.pathname === "/login" || mode === "password 404")
        return new Response('<form><input type="password"></form>', { status: 404 });
      if (mode.startsWith("JSON signature"))
        return Response.json(
          {
            status: mode.includes("numeric")
              ? mode.includes("auth")
                ? 401
                : 404
              : mode.includes("not_authenticated")
                ? "not_authenticated"
                : mode.includes("forbidden")
                  ? "forbidden"
                  : mode.includes("auth")
                    ? "unauthenticated"
                    : "not-found",
            message: mode.includes("not_authenticated")
              ? "Authentication credentials were not provided."
              : mode.includes("auth")
                ? "Please sign in"
                : "Missing widget",
          },
          { status: 404 },
        );
      if (mode.startsWith("HTML signature"))
        return new Response(
          mode.includes("auth")
            ? '<main><h1>Continue</h1><form action="/oauth2/authorize"><button>Continue</button></form></main>'
            : '<main><h1>Not found</h1><form action="/search"><button>Search</button></form></main>',
          { status: 404, headers: { "content-type": "text/html" } },
        );
      if (mode === "authentication challenge")
        return new Response("", { status: 404, headers: { "www-authenticate": "Bearer" } });
      if (mode === "unauthenticated 404")
        return Response.json(
          { status: "unauthenticated", message: "Please sign in to view products" },
          { status: 404 },
        );
      if (mode === "numeric auth 404") return Response.json({ status: 401 }, { status: 404 });
      if (mode === "sso 404")
        return new Response(
          '<title>Single sign-on</title><h1>Sign in</h1><form action="/sso"><button>Continue</button></form>',
          { status: 404, headers: { "content-type": "text/html" } },
        );
      if (mode === "signature envelope changed")
        return Response.json({ status: "not-found", message: "Missing item" }, { status: 404 });
      if (mode === "signature content type changed")
        return new Response("", {
          status: 404,
          headers: { "content-type": "application/octet-stream" },
        });
      if (mode === "signature status changed") return new Response("", { status: 410 });
      if (mode === "unauthorized") return new Response("Denied", { status: 403 });
      if (mode === "failure marker") return Response.json({ ok: false, total: 0, items: [] });
      if (type === "DeleteAction") {
        if (mode === "header dependent 404")
          return headers.has("x-requested-with")
            ? Response.json(f.envelope(f.row("73")))
            : new Response("", { status: 404 });
        if (list)
          return Response.json(
            {
              total: 0,
              items: [],
              ...(mode === "changed envelope" ? { extra: {} } : {}),
              ...(mode === "authentication zero" ? { status: "unauthenticated" } : {}),
              ...(mode === "nonzero total" ? { total: 1 } : {}),
            },
            {
              headers:
                mode === "cached age"
                  ? { age: "600" }
                  : mode === "cache hit"
                    ? { "x-cache": "HIT" }
                    : {},
            },
          );
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
        {
          headers:
            mode === "cached age"
              ? { age: "600", "cache-control": "max-age=3600" }
              : mode === "cache hit"
                ? { "x-cache": "HIT" }
                : mode === "cache hit count"
                  ? { "x-cache-hits": "1" }
                  : {},
        },
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
  if (
    mode === "read denied" ||
    mode === "token source read denied" ||
    mode === "token source denied" ||
    mode === "token source redirect denied" ||
    mode.startsWith("runtime ") ||
    mode.startsWith("baseline ") ||
    mode.includes("oversized verification body")
  ) {
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
  "no signature",
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
  required(f.trace[3]).url = before.url;
  required(f.trace[3]).bodySample = JSON.stringify(
    f.row("42", "Edited widget", 3, "/main/stores/main/posts/51/products/"),
  );
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

it.each([
  "query scope conflict",
  "header scope conflict",
  "query scope missing write",
  "header scope missing write",
  "query scope missing read",
  "header scope missing read",
  "shared selector conflict",
])("r14 refuses learning from %s", async (mode) => {
  expect((await replay("UpdateAction", mode)).result.outcome?.status).toBe("uncertain");
});
it.each([
  "runtime query scope conflict",
  "runtime header scope conflict",
  "runtime missing state coverage",
])("r14 rechecks concrete %s before sending", async (mode) => {
  const { result, calls } = await replay("UpdateAction", mode);
  expect(result.outcome?.status).toBe("uncertain");
  expect(calls).toHaveLength(0);
});
it.each([
  "matching query scope",
  "matching header scope",
  "full state coverage",
])("verifies an update with %s", async (mode) => {
  const { result, calls } = await replay("UpdateAction", mode);
  expect(result.outcome?.status).toBe("completed");
  for (const call of calls.filter((c) => c.url !== `${origin}/products` && c.method === "GET")) {
    expect(call.cache).toBe("no-store");
    expect(call.headers.get("cache-control")).toBe("no-cache");
    expect(call.headers.get("pragma")).toBe("no-cache");
  }
});
it("r14 does not learn partial submitted-state coverage", async () => {
  expect((await replay("UpdateAction", "missing state coverage")).result.outcome?.status).toBe(
    "uncertain",
  );
});
it.each([
  "unauthenticated 404",
  "authentication challenge",
  "numeric auth 404",
  "sso 404",
  "signature envelope changed",
  "signature content type changed",
  "signature status changed",
])("r14 rejects %s as deletion evidence", async (mode) => {
  expect((await replay("DeleteAction", mode)).result.outcome?.status).toBe("uncertain");
});
it.each([
  "cached age",
  "cache hit",
  "cache hit count",
  "baseline cached",
])("r14 rejects verification from %s", async (mode) => {
  expect((await replay("UpdateAction", mode)).result.outcome?.status).toBe("uncertain");
});
it.each([
  "token source denied",
  "token source read denied",
])("r14 authorizes verification and preparation before transmission: %s", async (mode) => {
  const { result, calls } = await replay("UpdateAction", mode);
  expect(result.outcome?.status).toBe("uncertain");
  expect(calls).toHaveLength(0);
});
it("verifies an update with gated CSRF acquisition and fresh reads", async () => {
  const { result, calls } = await replay("UpdateAction", "token source allowed");
  expect(result.outcome?.status).toBe("completed");
  expect(calls[0]?.url).toBe(`${origin}/token`);
  expect(calls[0]?.cache).toBe("no-store");
});

it("picks the most detailed witnessed read covering every submitted state field", () => {
  const f = fixture("UpdateAction");
  f.write.inputs.push({
    name: "inventory",
    path: [`${SCHEMA}object`, `${SCHEMA}inventoryLevel`],
    location: "form",
    required: true,
    range: "http://www.w3.org/2001/XMLSchema#integer",
    default: "9",
  });
  required(f.trace[1]).postData += "&inventory=9";
  required(f.trace[0]).bodySample = JSON.stringify({ ...f.row("42"), inventory: 3 });
  required(f.trace[3]).bodySample = JSON.stringify({
    ...f.row("42", "Edited widget"),
    inventory: 9,
  });
  const detailed = structuredClone(f.read);
  detailed.id = "urn:detailed";
  detailed.extraction?.fields.push({ property: `${SCHEMA}inventoryLevel`, path: "/inventory" });
  const policy = learnWriteResponses([f.write, f.read, detailed], f.trace, origin)[f.write.id];
  expect(policy?.verification?.operation).toBe(detailed.id);
  expect(policy?.verification?.changes.map((change) => change.input)).toEqual([
    "name",
    "inventory",
  ]);
});

it.each([
  { status: "unauthenticated", message: "Please sign in to view products" },
  { status: "unauthorized" },
  { code: "unauthenticated" },
  { statusCode: 401 },
  { authenticated: false },
  { message: "Please authenticate" },
  { status: 401 },
  { status: "403" },
])("does not learn an authentication 404 as a missing-resource signature: %j", (body) => {
  const f = fixture();
  f.trace.push({ ...required(f.trace[0]), seq: 5, status: 404, bodySample: JSON.stringify(body) });
  expect(
    learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]?.verification?.notFound,
  ).toBeUndefined();
});

it.each([
  "application/json",
  "text/html",
])("learns a missing-resource %s structure only from the deleted target in its context", (contentType) => {
  const f = fixture();
  const absent = {
    ...required(f.trace[0]),
    seq: 5,
    status: 404,
    contentType,
    bodySample:
      contentType === "application/json"
        ? '{"status":"not-found","message":"Missing widget"}'
        : "<main><h1>Not found</h1></main>",
  };
  f.trace.push(absent);
  expect(
    learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]?.verification?.notFound,
  ).toMatchObject({ status: 404, contentType });
  absent.requestHeaders = { ...absent.requestHeaders, "x-store-id": "other" };
  expect(
    learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]?.verification?.notFound,
  ).toBeUndefined();
});

it("fetches a witnessed deleted identity using the profiling session, including for a public read", async () => {
  const { probeDeletedResources } = await import("../src/write-not-found.js");
  const f = fixture();
  f.read.session = "none";
  // A later unrelated singleton is not the identity the demonstration deleted.
  f.trace.push({
    ...required(f.trace[0]),
    seq: 1.5,
    url: required(f.trace[0]).url.replace("42", "99"),
    bodySample: JSON.stringify(f.row("99")),
  });
  let fetched = 0;
  await probeDeletedResources([f.write, f.read], f.trace, origin, {
    get: async (url, options) => {
      fetched++;
      expect(url).toBe(required(f.trace[0]).url);
      expect(options.signedIn).toBe(true);
      expect(options.headers?.["cache-control"]).toBe("no-cache");
      expect(options.headers?.pragma).toBe("no-cache");
      f.trace.push({
        ...required(f.trace[0]),
        phase: "verify",
        seq: 5,
        resourceType: "replay",
        status: 404,
        bodySample: '{"status":"not-found"}',
        requestHeaders: options.headers ?? {},
      });
      return { status: 404, body: '{"status":"not-found"}', contentType: "application/json" };
    },
  });
  expect(fetched).toBe(1);
  expect(
    learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]?.verification?.notFound,
  ).toMatchObject({ status: 404, contentType: "application/json" });
});

it.each([
  "deny",
  "ask",
])("sends no deleted-resource probe or preparation when reads %s", async (kind) => {
  const { probeDeletedResources } = await import("../src/write-not-found.js");
  const f = fixture();
  let requests = 0;
  f.read.csrf = [
    {
      source: { kind: "json", urlTemplate: `${origin}/csrf`, pointer: "/token" },
      target: { kind: "query", name: "csrf" },
    },
  ];
  await probeDeletedResources(
    [f.write, f.read],
    f.trace,
    origin,
    {
      get: async () => {
        requests++;
        throw new Error("Must not reach replayer");
      },
    },
    {
      authorize: async (request) => {
        expect(request.effect).toBe("read");
        return kind === "deny"
          ? { kind: "deny", reason: "Denied" }
          : {
              kind: "ask",
              approval: {
                id: "fixture",
                site: origin,
                target: request.target,
                effect: "read",
                inputs: {},
                summary: "Read",
                digest: request.digest,
              },
            };
      },
    },
  );
  expect(requests).toBe(0);
});

it("gates each CSRF acquisition redirect before sending its next request", async () => {
  const { result, calls } = await replay("UpdateAction", "token source redirect denied");
  expect(result.outcome?.status).toBe("uncertain");
  expect(calls.map((call) => call.url)).toEqual([`${origin}/token`]);
});
it("preserves gated same-origin redirects while acquiring verification CSRF", async () => {
  const { result, calls } = await replay("UpdateAction", "token source redirect allowed");
  expect(result.outcome?.status).toBe("completed");
  expect(calls.slice(0, 2).map((call) => call.url)).toEqual([
    `${origin}/token`,
    `${origin}/token-final`,
  ]);
});

it.each([
  undefined,
  "changed-credential-context",
])("never learns missing-resource evidence from an unproven or changed session (%s)", (context) => {
  const f = fixture();
  f.trace.push({
    ...required(f.trace[0]),
    seq: 5,
    status: 404,
    bodySample: "",
    authenticationContext: context,
  });
  expect(
    learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]?.verification?.notFound,
  ).toBeUndefined();
});
it("keeps context equality opaque and specific to one recorder", async () => {
  const { Recorder } = await import("../src/recorder.js");
  const recorder = new Recorder(origin),
    other = new Recorder(origin);
  const headers = {
    cookie: "session=short-secret; view=1",
    authorization: "Bearer fictional-credential",
  };
  const tag = recorder.authenticationContext(headers);
  expect(tag).toMatch(/^[a-f0-9]{64}$/);
  expect(tag).not.toContain("short-secret");
  expect(
    recorder.authenticationContext({ ...headers, cookie: "view=1; session=short-secret" }),
  ).toBe(tag);
  expect(
    recorder.authenticationContext({ ...headers, cookie: "session=other-secret; view=1" }),
  ).not.toBe(tag);
  expect(
    recorder.authenticationContext({ ...headers, authorization: "Bearer changed-credential" }),
  ).not.toBe(tag);
  expect(other.authenticationContext(headers)).not.toBe(tag);
});

it("does not learn a passwordless OAuth 404 as missing-resource evidence", () => {
  const f = fixture();
  f.trace.push({
    ...required(f.trace[0]),
    seq: 5,
    status: 404,
    contentType: "text/html",
    bodySample:
      '<title>Continue</title><form action="/oauth2/authorize"><button>Continue</button></form>',
  });
  expect(
    learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]?.verification?.notFound,
  ).toBeUndefined();
});

it.each([
  "JSON signature",
  "JSON signature numeric",
  "HTML signature",
  "JSON signature auth",
  "JSON signature numeric auth",
  "JSON signature not_authenticated",
  "JSON signature forbidden",
  "HTML signature auth",
])("checks a concrete learned not-found structure and authentication together: %s", async (mode) => {
  const { result, policy } = await replay("DeleteAction", mode);
  expect(policy?.verification?.notFound).toBeDefined();
  expect(result.outcome?.status).toBe(
    mode.includes("auth") || mode.includes("forbidden") ? "uncertain" : "completed",
  );
  expect(result.committed).toHaveLength(1);
});

it.each([
  "query constant",
  "header constant",
])("pins a post-write witnessed read-only %s", async (mode) => {
  const { result, policy, calls } = await replay("UpdateAction", mode);
  expect(result.outcome?.status).toBe("completed");
  expect(policy?.verification?.scopeConstants).toEqual([
    {
      location: mode.startsWith("query") ? "query" : "header",
      name: mode.startsWith("query") ? "namespace" : "x-store-id",
      value: "main",
    },
  ]);
  for (const call of calls.filter((c) => c.method === "GET" && !c.url.endsWith("/products")))
    expect(
      mode.startsWith("query")
        ? new URL(call.url).searchParams.get("namespace")
        : call.headers.get("x-store-id"),
    ).toBe("main");
});
it.each([
  "query constant never witnessed",
  "header constant never witnessed",
  "input constant",
])("refuses a read-only constant without exact post-write reflection: %s", async (mode) => {
  expect((await replay("UpdateAction", mode)).result.outcome?.status).toBe("uncertain");
});
it.each([
  "runtime query constant replaced",
  "runtime header constant replaced",
  "runtime input constant",
])("refuses a substituted scope pin before sending: %s", async (mode) => {
  const { result, calls } = await replay("UpdateAction", mode);
  expect(result.outcome?.status).toBe("uncertain");
  expect(calls).toHaveLength(0);
});
it("excludes unchanged carried form values from coverage", async () => {
  const { result, policy } = await replay("UpdateAction", "unchanged carried field");
  expect(result.outcome?.status).toBe("completed");
  expect(policy?.verification?.constantChanges).toBeUndefined();
});
it.each([
  "changed carried field",
  "rejected carried field",
  "uncovered carried field",
  "coincidental carried field",
])("requires coverage and equality for demonstrated changes to literals: %s", async (mode) => {
  const { result, policy } = await replay("UpdateAction", mode);
  expect(result.outcome?.status).toBe(mode === "changed carried field" ? "completed" : "uncertain");
  if (mode === "changed carried field")
    expect(policy?.verification?.constantChanges).toEqual([
      { name: "product[inventory]", value: "9", property: `${SCHEMA}inventoryLevel` },
    ]);
  else expect(policy?.verification).toBeUndefined();
});

it("verifies complete fields beyond both BODY_LIMIT and the ordinary response cap", async () => {
  expect((await replay("UpdateAction", "large verification body")).result.outcome?.status).toBe(
    "completed",
  );
});
it.each([
  "oversized verification body",
  "early verification body",
  "broken verification body",
])("leaves oversized or incomplete verification Uncertain: %s", async (mode) => {
  const { result } = await replay("UpdateAction", mode);
  expect(result.outcome?.status).toBe("uncertain");
  expect(result.committed).toHaveLength(mode.startsWith("oversized") ? 0 : 1);
});

it("verifies a demonstrated literal state change even when identity is the only action input", async () => {
  const { result, policy } = await replay("UpdateAction", "literal-only carried field");
  expect(result.outcome?.status).toBe("completed");
  expect(policy?.verification?.changes).toEqual([]);
  expect(policy?.verification?.constantChanges).toHaveLength(1);
});

it("does not invent an empty-body not-found signature for an evidence-only GET", () => {
  const f = fixture();
  f.trace.push({
    ...required(f.trace[0]),
    seq: 5,
    phase: "verify",
    resourceType: "verification-evidence",
    status: 404,
    bodySample: undefined,
  });
  expect(
    learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]?.verification?.notFound,
  ).toBeUndefined();
});

it.each([
  "change",
  "leaf",
  "coincidence",
  "ambiguous",
])("pairs changed literals using witnessed values and wire leaves: %s", (mode) => {
  const f = fixture("UpdateAction");
  const before = required(f.trace[0]);
  const write = required(f.trace[1]);
  const after = required(f.trace[3]);
  f.write.request.bodyTemplate = "name=%7Bname%7D&product%5Binventory%5D=9";
  write.postData += "&product%5Binventory%5D=9";
  f.trace.unshift({
    ...before,
    seq: 0,
    contentType: "text/html",
    bodySample: `<form method="POST" action="${write.url}"><input name="product[inventory]" value="3"></form>`,
  });
  const key = mode === "leaf" ? "inventory" : "stock";
  // Deliberately unrelated semantic labels: labels cannot establish or prevent pairing.
  const property = mode === "coincidence" ? `${SCHEMA}inventoryLevel` : `${SCHEMA}numberOfItems`;
  f.read.extraction?.fields.push({ property, path: `/${key}` });
  before.bodySample = JSON.stringify({
    ...f.row("42"),
    [key]: mode === "change" || mode === "ambiguous" ? 3 : 9,
  });
  after.bodySample = JSON.stringify({ ...f.row("42", "Edited widget"), [key]: 9 });
  if (mode === "ambiguous") {
    f.read.extraction?.fields.push({ property: `${SCHEMA}inventoryLevel`, path: "/other_stock" });
    before.bodySample = JSON.stringify({ ...JSON.parse(before.bodySample), other_stock: 3 });
    after.bodySample = JSON.stringify({ ...JSON.parse(after.bodySample), other_stock: 9 });
  }
  const verification = learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]
    ?.verification;
  if (mode === "coincidence" || mode === "ambiguous") expect(verification).toBeUndefined();
  else
    expect(verification?.constantChanges).toEqual([
      { name: "product[inventory]", value: "9", property },
    ]);
});
it("learns a body-free opaque signature from a complete evidence GET", async () => {
  const { captureVerificationEvidence } = await import("../src/verification-evidence.js");
  const f = fixture();
  const missing = {
    ...required(f.trace[0]),
    seq: 5,
    phase: "verify" as const,
    resourceType: "verification-evidence",
    status: 404,
    contentType: "text/html",
    bodySample: undefined,
  };
  captureVerificationEvidence(missing, "<main><h1>Missing widget</h1></main>");
  f.trace.push(missing);
  expect(
    learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]?.verification?.notFound,
  ).toEqual(missing.notFoundEvidence);
  expect(missing.notFoundEvidence?.structure).toMatch(/^[a-f0-9]{64}$/);
  expect(missing.bodySample).toBeUndefined();
});

it.each([
  "same constant",
  "different constant",
  "multiple items",
  "another identity",
  "partial singleton",
  "another session",
  "another template",
  "intervening write",
])("admits an ID-filtered read using a same-template SKU-filtered scope witness: %s", (mode) => {
  const f = fixture("UpdateAction", true);
  const id = required(f.read.inputs[0]);
  id.name = "filters%5Bentity_id%5D";
  id.required = false;
  f.read.inputs.push({ ...id, name: "search" });
  f.read.request.urlTemplate = `${origin}/stores/main/products/rows?namespace=main{&filters%5Bentity_id%5D,search}`;
  required(f.trace[0]).url =
    `${origin}/stores/main/products/rows?namespace=main&filters%5Bentity_id%5D=42`;
  const follow = required(f.trace[3]);
  follow.url = `${origin}/stores/main/products/rows?namespace=${mode === "different constant" ? "other" : "main"}&search=EX-42`;
  if (mode === "multiple items")
    follow.bodySample = JSON.stringify({
      total: 2,
      items: [f.row("42", "Edited widget"), f.row("43", "Edited widget")],
    });
  if (mode === "another identity")
    follow.bodySample = JSON.stringify(f.envelope(f.row("43", "Edited widget")));
  if (mode === "partial singleton")
    follow.bodySample = JSON.stringify({ total: 2, items: [f.row("42", "Edited widget")] });
  if (mode === "another session") follow.authenticationContext = "different-session";
  if (mode === "another template") follow.url = follow.url.replace("/rows?", "/other-rows?");
  if (mode === "intervening write")
    f.trace.push({ ...required(f.trace[1]), seq: 3.5, url: `${origin}/unrelated` });
  const verification = learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]
    ?.verification;
  if (mode !== "same constant") expect(verification).toBeUndefined();
  else
    expect(verification).toMatchObject({
      operation: f.read.id,
      bind: { "filters%5Bentity_id%5D": { input: "id" } },
      scopeConstants: [{ location: "query", name: "namespace", value: "main" }],
      changes: [{ input: "name", property: `${SCHEMA}name` }],
    });
});

function quantityPairing(mode: string) {
  const f = fixture("UpdateAction");
  f.write.inputs = [
    required(f.write.inputs[0]),
    {
      name: "quantity",
      path: [`${SCHEMA}object`, `${SCHEMA}inventoryLevel`],
      range: "http://www.w3.org/2001/XMLSchema#integer",
      required: true,
      location: "form",
      default: "9",
    },
  ];
  f.write.request.bodyTemplate = "product%5Bquantity_and_stock_status%5D%5Bqty%5D=%7Bquantity%7D";
  required(f.trace[1]).postData = "product%5Bquantity_and_stock_status%5D%5Bqty%5D=9";
  const leaf = mode === "leaf" || mode === "ambiguous leaf" || mode === "numeric presentation";
  const property = `${SCHEMA}${mode === "coincidence" ? "inventoryLevel" : "orderQuantity"}`;
  const key = leaf ? "qty" : "available_units";
  f.read.extraction?.fields.push({ property, path: `/${key}` });
  const original =
    mode === "leaf" ||
    mode === "coincidence" ||
    mode === "marker collision" ||
    mode === "ambiguous leaf" ||
    mode === "numeric presentation"
      ? 9
      : 3;
  const before = { ...f.row("42"), [key]: original };
  const after = {
    ...f.row("42", "Edited widget"),
    [key]: mode === "numeric presentation" ? "9.0000" : 9,
  };
  if (mode === "marker collision") {
    f.write.request.bodyTemplate += "&available_units=sab_pairing_leaf_marker";
    required(f.trace[1]).postData += "&available_units=sab_pairing_leaf_marker";
  }
  if (mode === "ambiguous change" || mode === "ambiguous leaf") {
    f.read.extraction?.fields.push({
      property: `${SCHEMA}numberOfItems`,
      path: mode === "ambiguous leaf" ? "/other/qty" : "/other_units",
    });
    Object.assign(before, mode === "ambiguous leaf" ? { other: { qty: 9 } } : { other_units: 3 });
    Object.assign(after, mode === "ambiguous leaf" ? { other: { qty: 9 } } : { other_units: 9 });
  }
  if (mode === "change outranks leaf") {
    f.read.extraction?.fields.push({ property: `${SCHEMA}numberOfItems`, path: "/qty" });
    Object.assign(before, { qty: 9 });
    Object.assign(after, { qty: 9 });
  }
  required(f.trace[0]).bodySample = JSON.stringify(before);
  required(f.trace[3]).bodySample = JSON.stringify(after);
  return { ...f, property, key, before, after };
}

it("pairs an unchanged HTML form leaf with a nested submitted wire name", () => {
  const f = quantityPairing("leaf");
  f.read.extraction = {
    format: "html",
    itemType: `${SCHEMA}Product`,
    fields: [
      { property: `${SCHEMA}identifier`, path: "span[data-id]", attribute: "data-id" },
      { property: `${SCHEMA}url`, path: "a", attribute: "href", datatype: "iri" },
      {
        property: `${SCHEMA}orderQuantity`,
        path: 'input[name="product[stock][qty]"]',
        attribute: "value",
      },
    ],
  };
  for (const at of [0, 3]) {
    const r = required(f.trace[at]);
    r.contentType = "text/html";
    r.bodySample = `<main><span data-id="42">Example</span><a href="${origin}/stores/main/products/42">Widget</a><input name="product[stock][qty]" value="9"></main>`;
  }
  expect(
    learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]?.verification?.changes,
  ).toEqual([{ input: "quantity", property: `${SCHEMA}orderQuantity` }]);
});

it.each([
  "change",
  "leaf",
  "numeric presentation",
  "change outranks leaf",
  "coincidence",
  "marker collision",
  "ambiguous change",
  "ambiguous leaf",
])("pairs submitted state by witnessed evidence without requiring term equality: %s", (mode) => {
  const f = quantityPairing(mode);
  const original = structuredClone([f.write, f.read]);
  const verification = learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]
    ?.verification;
  if (mode === "coincidence" || mode === "marker collision" || mode.startsWith("ambiguous"))
    expect(verification).toBeUndefined();
  else
    expect(verification?.changes).toEqual([
      {
        input: "quantity",
        property: f.property,
        ...(mode === "numeric presentation"
          ? { format: { prefix: "", suffix: "", scale: 4 } }
          : {}),
      },
    ]);
  expect([f.write, f.read]).toEqual(original);
});

it.each([
  false,
  true,
])("compares the learned differently-labelled field at runtime (wrong value=%s)", async (wrong) => {
  const f = quantityPairing("numeric presentation");
  const policy = learnWriteResponses([f.write, f.read], f.trace, origin);
  expect(policy[f.write.id]?.verification?.changes[0]?.property).toBe(`${SCHEMA}orderQuantity`);
  let posts = 0;
  const executor = createExecutor({
    model: {
      id: "urn:model",
      site: origin,
      generatedAt: provenance.learnedAt,
      version: "1",
      operations: [f.write, f.read],
      flows: [],
    },
    writeResponses: policy,
    sessions: {
      get: async () => ({ cookies: [], headers: { authorization: "fictional-session-secret" } }),
      update: async () => {},
    },
    gate: { authorize: async () => ({ kind: "allow" }) },
    fetch: async (input, init) => {
      if (init?.method === "POST") {
        posts++;
        return new Response(null, { status: 303, headers: { location: "/products" } });
      }
      if (new URL(String(input)).pathname === "/products")
        return new Response("<main>Products</main>");
      return Response.json({
        ...f.row("73"),
        [f.key]: posts ? (wrong ? "8.0000" : "9.0000") : "9.0000",
      });
    },
  });
  const request = { node: "urn:request", types: [f.write.actionType], values: () => [] };
  const result = await executor.execute(request);
  expect(posts).toBe(1);
  expect(result.outcome?.status).toBe(wrong ? "uncertain" : "completed");
  expect(result.committed).toHaveLength(1);
  expect(
    (
      await executor.execute(request, {
        excludeFingerprints: result.committed.map((c) => c.fingerprint),
      })
    ).errorKind,
  ).toBe("repeat");
  expect(posts).toBe(1);
});

function deletionCollectionFixture(filter = "range") {
  const f = fixture("DeleteAction", true);
  const names =
    filter === "range" || filter === "broader" || filter === "lower only"
      ? [
          "filters%5Bid%5D%5Bfrom%5D",
          ...(filter === "lower only" ? [] : ["filters%5Bid%5D%5Bto%5D"]),
        ]
      : filter === "equality"
        ? ["filters%5Bid%5D"]
        : filter === "eq"
          ? ["filters%5Bid%5D%5Beq%5D"]
          : filter === "search"
            ? ["search"]
            : [];
  const base = required(f.read.inputs[0]);
  f.read.inputs = names.map((name) => ({ ...base, name }));
  f.read.request.urlTemplate = `${origin}/stores/main/products/rows${names.length ? `{?${names.join(",")}}` : ""}`;
  const query = new URLSearchParams(
    names.map((name, i) => [
      decodeURIComponent(name),
      filter === "broader" && i === 1 ? "99" : "42",
    ]),
  );
  for (const r of [required(f.trace[0]), required(f.trace[3])])
    r.url = `${origin}/stores/main/products/rows${query.size ? `?${query}` : ""}`;
  f.write.request.bodyTemplate = "namespace=main";
  required(f.trace[1]).postData = "namespace=main";
  f.read.request.urlTemplate = f.read.request.urlTemplate.replace("{?", "?namespace=main{&");
  if (!names.length) f.read.request.urlTemplate += "?namespace=main";
  for (const r of [required(f.trace[0]), required(f.trace[3])])
    r.url += `${query.size ? "&" : "?"}namespace=main`;
  return f;
}
it.each([
  "range",
  "equality",
  "eq",
])("learns collection deletion from singleton-to-empty evidence with an exact %s filter and body/query scope", (filter) => {
  const f = deletionCollectionFixture(filter);
  const verification = learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]
    ?.verification;
  expect(verification?.identityInput).toBe("id");
  expect(verification?.scopeConstants).toBeUndefined();
  expect(Object.values(required(verification).bind)).toEqual(
    f.read.inputs.map(() => ({ input: "id" })),
  );
});
it.each([
  "broader",
  "lower only",
  "search",
  "unfiltered",
])("does not learn collection deletion from a %s filter", (filter) => {
  const f = deletionCollectionFixture(filter);
  expect(
    learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]?.verification,
  ).toBeUndefined();
});
it.each([
  "envelope mismatch",
  "two baseline items",
  "baseline missing target",
  "authentication zero",
  "cached zero",
  "cached baseline",
  "different session",
  "zero before write",
  "nonzero total",
  "missing root",
  "no post-write evidence",
])("does not learn collection absence with %s", (mode) => {
  const f = deletionCollectionFixture();
  const before = required(f.trace[0]),
    after = required(f.trace[3]);
  if (mode === "envelope mismatch") after.bodySample = '{"total":0,"items":[],"extra":{}}';
  if (mode === "two baseline items")
    before.bodySample = JSON.stringify({ total: 2, items: [f.row("42"), f.row("43")] });
  if (mode === "baseline missing target")
    before.bodySample = JSON.stringify({ total: 1, items: [f.row("43")] });
  if (mode === "authentication zero") {
    before.bodySample = JSON.stringify({ ...JSON.parse(before.bodySample ?? ""), status: "ok" });
    after.bodySample = '{"total":0,"items":[],"status":"unauthenticated"}';
  }
  if (mode === "cached zero") after.responsePageFailure = true;
  if (mode === "cached baseline") before.responsePageFailure = true;
  if (mode === "different session") after.authenticationContext = "other-context";
  if (mode === "zero before write") after.seq = 0;
  if (mode === "nonzero total") after.bodySample = '{"total":1,"items":[]}';
  if (mode === "missing root") after.bodySample = '{"total":0,"other":[]}';
  if (mode === "no post-write evidence") f.trace.pop();
  expect(
    learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]?.verification,
  ).toBeUndefined();
});
it("learns zero-item absence without a declared total", () => {
  const f = deletionCollectionFixture();
  delete required(f.read.extraction).totalPath;
  for (const r of [required(f.trace[0]), required(f.trace[3])]) {
    const body = JSON.parse(r.bodySample ?? "");
    delete body.total;
    r.bodySample = JSON.stringify(body);
  }
  expect(
    learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]?.verification
      ?.identityInput,
  ).toBe("id");
});

it.each([
  "runtime broad collection filter",
  "baseline two items",
  "baseline missing target",
  "authentication zero",
  "cached age",
  "cache hit",
  "nonzero total",
])("keeps runtime collection deletion Uncertain with %s", async (mode) => {
  const { result, calls } = await replay("DeleteAction", mode, true);
  expect(result.outcome?.status).toBe("uncertain");
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(
    mode.startsWith("baseline") || mode.startsWith("runtime broad") ? 0 : 1,
  );
});

it.each([
  "range",
  "equality",
  "eq",
  "no total",
  "root array",
  "header scope",
  "query substitution",
  "header substitution",
])("replays learned collection absence with cross-surface scope: %s", async (mode) => {
  const f = deletionCollectionFixture(["equality", "eq"].includes(mode) ? mode : "range");
  if (mode === "no total" || mode === "root array") delete required(f.read.extraction).totalPath;
  if (mode === "root array") {
    required(f.read.extraction).itemPath = "";
    for (const r of [required(f.trace[0]), required(f.trace[3])])
      r.bodySample = JSON.stringify(JSON.parse(r.bodySample ?? "").items);
  }
  if (mode.startsWith("header")) {
    f.write.request.bodyTemplate = "store-id=main";
    required(f.trace[1]).postData = "store-id=main";
    f.read.request.urlTemplate = f.read.request.urlTemplate.replace("?namespace=main{&", "{?");
    f.read.request.headers = { ...f.read.request.headers, "X-Store-Id": "main" };
    for (const r of [required(f.trace[0]), required(f.trace[3])]) {
      r.url = r.url.replace("&namespace=main", "");
      r.requestHeaders["x-store-id"] = "main";
    }
  }
  const policies = learnWriteResponses([f.write, f.read], f.trace, origin);
  expect(policies[f.write.id]?.verification).toBeDefined();
  if (mode === "query substitution")
    f.read.request.urlTemplate = f.read.request.urlTemplate.replace(
      "namespace=main",
      "namespace=other",
    );
  if (mode === "header substitution")
    f.read.request.headers = { ...f.read.request.headers, "X-Store-Id": "other" };
  const calls: string[] = [];
  const executor = createExecutor({
    model: await readSiteModel(
      await writeSiteModel({
        id: "urn:model",
        site: origin,
        generatedAt: provenance.learnedAt,
        version: "1",
        operations: [f.write, f.read],
        flows: [],
      }),
    ),
    writeResponses: policies,
    sessions: {
      get: async () => ({ cookies: [], headers: { authorization: "fictional-session-secret" } }),
      update: async () => {},
    },
    gate: { authorize: async () => ({ kind: "allow" }) },
    fetch: async (_url, init) => {
      const method = init?.method ?? "GET";
      calls.push(method);
      return Response.json(
        method === "POST"
          ? {}
          : calls.length === 1
            ? mode === "root array"
              ? [f.row("73")]
              : f.envelope(f.row("73"))
            : mode === "root array"
              ? []
              : { total: 0, items: [] },
      );
    },
  });
  const result = await executor.execute({
    node: "urn:request",
    types: [f.write.actionType],
    values: () => [],
  });
  expect(result.outcome?.status).toBe(mode.endsWith("substitution") ? "uncertain" : "completed");
  expect(calls).toEqual(mode.endsWith("substitution") ? [] : ["GET", "POST", "GET"]);
});

it("refuses collection learning from old body-free evidence without its envelope shape", () => {
  const f = deletionCollectionFixture();
  const before = required(f.trace[0]);
  before.verificationEvidence = {
    extraction: required(f.read.extraction),
    items: [
      { [`${SCHEMA}identifier`]: ["42"], [`${SCHEMA}url`]: [`${origin}/stores/main/products/42`] },
    ],
    trustedItems: [
      { [`${SCHEMA}identifier`]: ["42"], [`${SCHEMA}url`]: [`${origin}/stores/main/products/42`] },
    ],
    total: 1,
  };
  delete before.bodySample;
  expect(
    learnWriteResponses([f.write, f.read], f.trace, origin)[f.write.id]?.verification,
  ).toBeUndefined();
});
