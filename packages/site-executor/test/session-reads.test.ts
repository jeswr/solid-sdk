// AUTHORED-BY Codex GPT-6
import type { Operation, SiteModel } from "@jeswr/site-model";
import { describe, expect, it, vi } from "vitest";
import { applyCsrfToken, compileOperation } from "../src/compile.js";
import { InMemorySessions } from "../src/cookies.js";
import { createExecutor, type ExecutorOptions } from "../src/executor.js";
import { actionRequest } from "./helpers.js";

const origin = "https://shop.test";
const csrf = {
  source: { kind: "cookie" as const, name: "sid" },
  target: { kind: "query" as const, name: "sessionPath" },
};
const operation = (id = "view", type = "Product"): Operation => ({
  id: `urn:m#${id}`,
  label: id,
  actionType: "https://schema.org/ViewAction",
  inputs: [],
  request: { method: "GET", urlTemplate: `${origin}/portal/key/{sessionPath}/items` },
  session: "signed-in",
  effect: "read",
  csrf: [csrf],
  extraction: {
    format: "json",
    itemPath: "/items",
    itemType: `https://schema.org/${type}`,
    fields: [{ property: "https://schema.org/name", path: "/name" }],
  },
  provenance: { derivedFrom: [], learnedAt: "now", method: "crawl", confidence: 0.8 },
});
const model = (ops: Operation[]): SiteModel => ({
  id: "urn:m",
  site: origin,
  version: "1.0.0",
  generatedAt: "now",
  operations: ops,
  flows: [],
});
const sessions = () => {
  const s = new InMemorySessions();
  s.set(origin, undefined, {
    cookies: [
      {
        name: "sid",
        value: "fixture-session-12345",
        domain: "shop.test",
        path: "/portal",
        secure: true,
      },
    ],
  });
  return s;
};

describe("session tokens in URL paths", () => {
  it("decorates an unbound whole segment after approval and redacts token echoes", async () => {
    const transport = vi.fn<NonNullable<ExecutorOptions["fetch"]>>(async (input) => {
      expect(String(input)).toBe(`${origin}/portal/key/fixture-session-12345/items`);
      return Response.json({ items: [{ name: "fixture-session-12345 Example" }] });
    });
    const executor = createExecutor({
      model: model([operation()]),
      sessions: sessions(),
      fetch: transport,
    });
    const result = await executor.execute(actionRequest("[] a schema:ViewAction."));
    expect(result.status).toBe("done");
    expect(transport).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("fixture-session-12345");
  });
  it.each([
    "..",
    "%2e%2e",
    "%252fadmin",
    "a/b",
    "a\\b",
    "a?b",
    "a#b",
  ])("refuses a path token that can change routing: %s", (value) => {
    const compiled = compileOperation(operation(), {}, origin);
    expect(() => applyCsrfToken(compiled, csrf, value)).toThrow();
  });
  it("refuses collisions with approved inputs, embedded slots and repeated token slots", () => {
    const op = operation();
    op.inputs = [
      {
        name: "sessionPath",
        path: ["https://schema.org/name"],
        range: "http://www.w3.org/2001/XMLSchema#string",
        required: true,
        location: "path",
      },
    ];
    expect(() => compileOperation(op, { sessionPath: "approved" }, origin)).toThrow("unbound");
    for (const path of [
      "/prefix{sessionPath}/items",
      "/{sessionPath}/{sessionPath}/items",
      "/{sessionPath}/items{?sessionPath}",
      "/{+sessionPath}/items",
    ])
      expect(() =>
        compileOperation(
          { ...operation(), request: { method: "GET", urlTemplate: origin + path } },
          {},
          origin,
        ),
      ).toThrow();
  });
  it("preserves query decoration when a path token is resolved later", () => {
    const compiled = compileOperation(operation(), {}, origin);
    applyCsrfToken(
      compiled,
      { ...csrf, target: { kind: "query", name: "ticket" } },
      "ticket-value",
    );
    applyCsrfToken(compiled, csrf, "path-value");
    expect(compiled.url.href).toBe(`${origin}/portal/key/path-value/items?ticket=ticket-value`);
  });
  it("decodes percent-encoded bracket names when building forms", () => {
    const op: Operation = {
      ...operation(),
      csrf: [],
      session: "none",
      inputs: [
        {
          name: "account%5Busername%5D",
          path: [],
          range: "http://www.w3.org/2001/XMLSchema#string",
          required: true,
          location: "form",
        },
      ],
      request: {
        method: "POST",
        urlTemplate: `${origin}/portal`,
        contentType: "application/x-www-form-urlencoded",
      },
    };
    expect(compileOperation(op, { "account%5Busername%5D": "alex" }, origin).body).toEqual({
      kind: "form",
      fields: [["account[username]", "alex"]],
    });
  });
});

describe("read routing and expired sessions", () => {
  it("uses an explicit catalogue operation name or object class without resolving a tie arbitrarily", async () => {
    const a = {
      ...operation("people", "Person"),
      csrf: [],
      session: "none" as const,
      request: { method: "GET" as const, urlTemplate: `${origin}/people` },
    };
    const b = {
      ...operation("products"),
      csrf: [],
      session: "none" as const,
      request: { method: "GET" as const, urlTemplate: `${origin}/items` },
    };
    const transport = vi.fn<NonNullable<ExecutorOptions["fetch"]>>(async () =>
      Response.json({ items: [{ name: "Alex Example" }] }),
    );
    const e = createExecutor({
      model: model([a, b]),
      sessions: new InMemorySessions(),
      fetch: transport,
    });
    expect((await e.execute(actionRequest("[] a schema:ViewAction."))).status).toBe("ambiguous");
    expect(
      (await e.execute(actionRequest("[] a schema:ViewAction; schema:object [a schema:Person].")))
        .target?.label,
    ).toBe("people");
    expect(
      (
        await e.execute(
          actionRequest(
            '[] a schema:ViewAction; <https://jeswr.org/ns/site-action#operation> "products".',
          ),
        )
      ).target?.label,
    ).toBe("products");
    expect(
      (
        await e.execute(
          actionRequest(
            '[] a schema:ViewAction; <https://jeswr.org/ns/site-action#operation> "missing".',
          ),
        )
      ).status,
    ).toBe("no-path");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("refuses an expired session that receives a password form with HTTP 200", async () => {
    const transport = vi.fn<NonNullable<ExecutorOptions["fetch"]>>(
      async () => new Response('<html><form><input type="password"></form></html>'),
    );
    const op = {
      ...operation(),
      csrf: [],
      request: { method: "GET" as const, urlTemplate: `${origin}/portal/items` },
    };
    const result = await createExecutor({
      model: model([op]),
      sessions: sessions(),
      fetch: transport,
    }).execute(actionRequest("[] a schema:ViewAction."));
    expect(result).toMatchObject({ status: "error", errorKind: "no-session", observations: [] });
  });
  it("refuses a JSON authentication redirect instead of returning empty data", async () => {
    const transport = vi.fn<NonNullable<ExecutorOptions["fetch"]>>(async () =>
      Response.json({ ajaxRedirect: "/login", error: true }),
    );
    const op = {
      ...operation(),
      csrf: [],
      request: { method: "GET" as const, urlTemplate: `${origin}/portal/items` },
    };
    expect(
      await createExecutor({ model: model([op]), sessions: sessions(), fetch: transport }).execute(
        actionRequest("[] a schema:ViewAction."),
      ),
    ).toMatchObject({ status: "error", errorKind: "no-session" });
  });
  it("a selected write still asks for approval and never sends before consent", async () => {
    const transport = vi.fn<NonNullable<ExecutorOptions["fetch"]>>();
    const op: Operation = {
      ...operation(),
      csrf: [],
      session: "none",
      effect: "irreversible-write",
      request: { method: "POST", urlTemplate: `${origin}/items` },
    };
    const result = await createExecutor({
      model: model([op]),
      sessions: new InMemorySessions(),
      fetch: transport,
    }).execute(
      actionRequest('[] a schema:ViewAction; <https://jeswr.org/ns/site-action#operation> "view".'),
    );
    expect(result.status).toBe("needs-approval");
    expect(transport).not.toHaveBeenCalled();
  });
});
