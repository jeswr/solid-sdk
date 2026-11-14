// AUTHORED-BY Codex GPT-6.1-Sol
import type { Operation, SiteModel } from "@jeswr/site-model";
import { describe, expect, it } from "vitest";
import {
  createApprovalGate,
  createExecutor,
  type ExecutorOptions,
  InMemorySessions,
  type WriteResponsePolicy,
} from "../src/index.js";
import { secretRedactor } from "../src/secrets.js";
import { actionRequest } from "./helpers.js";

const O = "https://shop.test",
  S = "https://schema.org/",
  X = "http://www.w3.org/2001/XMLSchema#";
const provenance = {
  learnedAt: "2026-11-13",
  method: "manual" as const,
  derivedFrom: [],
  confidence: 1,
};
function operation(id: string, effect: Operation["effect"] = "read"): Operation {
  return {
    id: `urn:${id}`,
    label: id,
    actionType: `${S}ViewAction`,
    inputs: [],
    effect,
    session: "none",
    provenance,
    request: { method: effect === "read" ? "GET" : "POST", urlTemplate: `${O}/${id}` },
  };
}
function model(operations: Operation[]): SiteModel {
  return {
    id: "urn:model",
    site: O,
    version: "1",
    generatedAt: provenance.learnedAt,
    operations,
    flows: [],
  };
}
const allow = { authorize: async () => ({ kind: "allow" as const }) };

describe("r9 summary identity", () => {
  it("shows the actual path ID next to an unmapped planner-supplied name", async () => {
    const op = operation("delete", "irreversible-write");
    op.actionType = `${S}DeleteAction`;
    op.inputs = [
      {
        name: "id",
        path: [`${S}object`, `${S}identifier`],
        range: `${X}string`,
        required: true,
        location: "path",
      },
    ];
    op.request.urlTemplate = `${O}/products/delete/id/{id}`;
    const result = await createExecutor({
      model: model([op]),
      sessions: new InMemorySessions(),
      fetch: async () => {
        throw new Error("no writes before approval");
      },
    }).execute(
      actionRequest(
        '[] a schema:DeleteAction; schema:object [schema:name "Example Widget 42"; schema:identifier "99"].',
      ),
    );
    expect(result.approval?.summary).toBe('Delete "Example Widget 42" ("id"="99") on shop.test');
  });
});

describe("r9 display money", () => {
  it.each([
    "product",
    "basket",
  ])("complete %s lists never turn display money into payment evidence", async (kind) => {
    for (const [price, currency] of [
      ["$12.00", "USD"],
      ["1.234 €", "EUR"],
      ["12,00", "EUR"],
    ]) {
      const read = operation("quote");
      read.extraction = {
        format: "json",
        itemPath: "/items",
        totalPath: "/total",
        itemType: `${S}${kind === "product" ? "Product" : "Order"}`,
        fields: [
          { property: `${S}identifier`, path: "/id" },
          { property: `${S}${kind === "product" ? "price" : "totalPrice"}`, path: "/price" },
          { property: `${S}priceCurrency`, path: "/currency" },
        ],
      };
      const pay = operation("pay", "payment");
      if (kind === "product") {
        pay.inputs = [
          {
            name: "id",
            path: [`${S}object`, `${S}identifier`],
            range: `${X}string`,
            required: true,
            location: "form",
            default: "42",
          },
        ];
        pay.request.contentType = "application/x-www-form-urlencoded";
      }
      const prepare = operation("prepare", "reversible-write");
      prepare.actionType = `${S}CreateAction`;
      const source = model([read, pay, prepare]);
      source.flows = [
        {
          id: "urn:buy",
          label: "Buy",
          actionType: `${S}BuyAction`,
          inputs: [],
          effect: "payment",
          provenance,
          steps: [
            ...(kind === "basket" ? [{ operation: prepare.id, bind: {} }] : []),
            { operation: read.id, bind: {} },
            { operation: pay.id, bind: {} },
          ],
        },
      ];
      const calls: string[] = [];
      const gate = createApprovalGate();
      gate.authorize = async (req) => {
        expect(req.target.id).not.toBe(pay.id);
        expect(req.effect).not.toBe("payment");
        return { kind: "allow" };
      };
      const result = await createExecutor({
        model: source,
        sessions: new InMemorySessions(),
        gate,
        fetch: async (input) => {
          const path = new URL(String(input)).pathname;
          calls.push(path);
          return path === "/quote"
            ? Response.json({ total: 1, items: [{ id: "42", price, currency }] })
            : Response.json({});
        },
      }).execute(
        actionRequest(
          `[] a schema:BuyAction; schema:amount [schema:value "20"; schema:currency "${currency}"].`,
        ),
      );
      expect(result.status, result.error).toBe("refused");
      expect(result.error).toContain("invalid site monetary amounts");
      expect(calls).not.toContain("/pay");
    }
  });
});

describe("r9 redirect identities", () => {
  function creation() {
    const op = operation("create", "irreversible-write");
    op.actionType = `${S}CreateAction`;
    op.inputs = [
      {
        name: "item",
        path: [`${S}object`],
        range: `${S}Product`,
        required: false,
        location: "form",
        default: "42",
      },
      {
        name: "name",
        path: [`${S}object`, `${S}name`],
        range: `${X}string`,
        required: false,
        location: "form",
        default: "Example widget",
      },
    ];
    op.request.contentType = "application/x-www-form-urlencoded";
    return op;
  }
  const pattern: WriteResponsePolicy = {
    createdLocationPattern: "/products/id/{id}",
    errorLocationPatterns: ["/errors/validation"],
    extraction: {
      format: "json",
      itemType: `${S}Product`,
      fields: [
        { property: `${S}identifier`, path: "/identifier" },
        { property: `${S}name`, path: "/name" },
      ],
    },
    inputEvidence: { input: "name", property: `${S}name` },
    success: { format: "json", path: "/saved", value: "true" },
  };
  it.each([
    "no declaration",
    "first hop wrong",
    "validation hop",
    "other resource",
    "failed success",
    "modelled error",
  ])("returns Uncertain without bindings for %s", async (mode) => {
    const create = creation();
    const update = operation("update", "reversible-write");
    update.inputs = [
      { name: "id", path: [], range: `${X}string`, required: true, location: "form" },
    ];
    update.request.contentType = "application/x-www-form-urlencoded";
    const source = model([create, update]);
    source.flows = [
      {
        id: "urn:create-flow",
        label: "Create",
        actionType: `${S}CreateAction`,
        effect: "irreversible-write",
        inputs: [],
        provenance,
        steps: [
          { operation: create.id, bind: {} },
          { operation: update.id, bind: { id: `$step0.${S}identifier` } },
        ],
      },
    ];
    const calls: string[] = [];
    const executor = createExecutor({
      model: source,
      gate: allow,
      sessions: new InMemorySessions(),
      writeResponses:
        mode === "no declaration"
          ? undefined
          : {
              [create.id]:
                mode === "modelled error"
                  ? { ...pattern, errorLocationPatterns: ["/products/id/{id}"] }
                  : pattern,
            },
      fetch: async (input, init) => {
        const path = new URL(String(input)).pathname;
        calls.push(`${init?.method} ${path}`);
        if (path === "/create")
          return new Response(null, {
            status: 302,
            headers: { location: mode === "first hop wrong" ? "/existing" : "/products/id/42" },
          });
        if (path === "/existing")
          return new Response(null, { status: 302, headers: { location: "/products/id/42" } });
        if (path === "/products/id/42" && ["validation hop", "other resource"].includes(mode))
          return new Response(null, {
            status: 302,
            headers: {
              location: mode === "validation hop" ? "/errors/validation" : "/products/id/43",
            },
          });
        return Response.json({
          saved: mode !== "failed success",
          identifier: "42",
          name: "Example widget",
        });
      },
    });
    const request = actionRequest("[] a schema:CreateAction.");
    const result = await executor.execute(request);
    expect(result.outcome).toMatchObject({ status: "uncertain" });
    expect(result.outcome?.result).toBeUndefined();
    expect(result.observations.map((o) => o.turtle).join(" ")).not.toContain("schema:identifier");
    expect(result.committed).toHaveLength(1);
    expect(calls.some((call) => call.includes("/update"))).toBe(false);
    expect(
      (
        await executor.execute(request, {
          excludeFingerprints: result.committed.map((c) => c.fingerprint),
        })
      ).errorKind,
    ).toBe("repeat");
  });
  it.each([
    301, 302, 303,
  ])("promotes only a declared and verified first-hop identity after %s", async (status) => {
    const create = creation();
    create.actionType = `${S}CreateAction`;
    const calls: string[] = [];
    const result = await createExecutor({
      model: model([create]),
      sessions: new InMemorySessions(),
      gate: allow,
      writeResponses: { [create.id]: pattern },
      fetch: async (_url, init) => {
        calls.push(init?.method ?? "GET");
        return init?.method === "POST"
          ? new Response(null, { status, headers: { location: "/products/id/42" } })
          : Response.json({ saved: true, identifier: "42", name: "Example widget" });
      },
    }).execute(actionRequest("[] a schema:CreateAction."));
    expect(result.outcome).toMatchObject({ status: "completed", result: `${O}/products/id/42` });
    expect(result.observations.at(-1)?.turtle).toContain('schema:identifier "42"');
    expect(calls).toEqual(["POST", "GET"]);
  });
  it("binds a verified created identifier after same-resource hops, never after contradictory final facts", async () => {
    for (const contradictory of [false, true]) {
      const create = creation();
      if (contradictory)
        create.extraction = {
          format: "json",
          itemType: `${S}Product`,
          fields: [{ property: `${S}identifier`, path: "/id" }],
        };
      const update = operation("update", "reversible-write");
      update.inputs = [
        { name: "id", path: [], range: `${X}string`, required: true, location: "form" },
      ];
      update.request.contentType = "application/x-www-form-urlencoded";
      const source = model([create, update]);
      source.flows = [
        {
          id: "urn:flow",
          label: "Create and update",
          actionType: `${S}CreateAction`,
          effect: "irreversible-write",
          inputs: [],
          provenance,
          steps: [
            { operation: create.id, bind: {} },
            { operation: update.id, bind: { id: `$step0.${S}identifier` } },
          ],
        },
      ];
      const writes: string[] = [];
      const result = await createExecutor({
        model: source,
        gate: allow,
        sessions: new InMemorySessions(),
        writeResponses: { [create.id]: pattern },
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (init?.method === "POST") writes.push(url.pathname);
          if (url.pathname === "/create")
            return new Response(null, { status: 303, headers: { location: "/products/id/42" } });
          if (url.pathname === "/products/id/42" && !url.search)
            return new Response(null, {
              status: 302,
              headers: { location: "/products/id/42?view=detail" },
            });
          if (url.pathname === "/update")
            expect(new URLSearchParams(String(init?.body)).get("id")).toBe("42");
          return Response.json({
            saved: true,
            id: contradictory ? "99" : "42",
            identifier: "42",
            name: "Example widget",
          });
        },
      }).execute(actionRequest("[] a schema:CreateAction."));
      // The identity binding still executes exactly once; the update has no verifier.
      expect(result.outcome?.status).toBe("uncertain");
      expect(writes).toEqual(contradictory ? ["/create"] : ["/create", "/update"]);
    }
  });
});

describe("r9 registered secrets", () => {
  function read() {
    const op = operation("read");
    op.extraction = {
      format: "json",
      itemPath: "/items",
      itemType: `${S}Product`,
      fields: [
        { property: `${S}name`, path: "/name" },
        { property: `${S}identifier`, path: "/id" },
        { property: `${S}description`, path: "/description", untrusted: true },
      ],
    };
    return op;
  }
  async function observe(
    cookies: Array<{ name: string; value: string; httpOnly?: boolean }>,
    echo: string,
    extra: Partial<ExecutorOptions> = {},
  ) {
    const sessions = new InMemorySessions();
    sessions.set(O, undefined, {
      cookies: cookies.map((c) => ({
        ...c,
        domain: "shop.test",
        path: "/",
        secure: true,
        httpOnly: c.httpOnly ?? true,
      })),
    });
    return createExecutor({
      model: model([read()]),
      sessions,
      fetch: async () => Response.json({ items: [{ id: "99", name: echo, description: echo }] }),
      ...extra,
    }).execute(actionRequest("[] a schema:ViewAction."));
  }
  it("redacts registered six-character CSRF and cookie values in trusted and untrusted observations", async () => {
    const op = read();
    op.csrf = [
      { source: { kind: "cookie", name: "csrf" }, target: { kind: "query", name: "csrf" } },
    ];
    const result = await observe(
      [
        { name: "csrf", value: "483921" },
        { name: "sid", value: "Ab7xQ2" },
      ],
      "483921 Ab7xQ2",
      { model: model([op]) },
    );
    expect(result.status).toBe("done");
    expect(JSON.stringify(result)).not.toMatch(/483921|Ab7xQ2/);
    expect(result.observations[0]?.turtle).toContain("UntrustedText");
    expect(result.observations[0]?.turtle).toContain("[redacted]");
  });
  it.each([
    true,
    false,
  ])("r10 sub-four-character cookies preserve facts regardless of classification: %s", async (httpOnly) => {
    const result = await observe([{ name: "preference", value: "1", httpOnly }], "item 1");
    expect(result.status).toBe("done");
    const turtle = result.observations[0]?.turtle ?? "";
    expect(turtle).toContain("item 1");
    expect(turtle).toContain("UntrustedText");
    expect(turtle).not.toContain("samplesSuppressed");
  });
  it("keeps item IDs and text with a one-character HttpOnly cookie check while redacting a six-character session", async () => {
    const result = await observe(
      [
        { name: "_cookie_check", value: "1", httpOnly: true },
        { name: "session", value: "Ab7xQ2", httpOnly: true },
      ],
      "item 1 /items/1 Ab7xQ2",
      {
        fetch: async (_input, init) => {
          expect(new Headers(init?.headers).get("cookie")).toBe("_cookie_check=1; session=Ab7xQ2");
          return Response.json({
            items: [
              { id: "1", name: "item 1 /items/1 Ab7xQ2", description: "item 1 /items/1 Ab7xQ2" },
            ],
          });
        },
      },
    );
    expect(result.status).toBe("done");
    const turtle = result.observations[0]?.turtle ?? "";
    expect(turtle).toContain('schema:identifier "1"');
    expect(turtle).toContain('schema:name "item 1 /items/1 [redacted]"');
    expect(turtle).toContain('rdf:value "item 1 /items/1 [redacted]"');
    expect(turtle).not.toContain("samplesSuppressed");
    expect(JSON.stringify(result)).not.toContain("Ab7xQ2");
  });
  it("still refuses off-origin redirects before forwarding a one-character cookie", async () => {
    let calls = 0;
    const result = await observe([{ name: "_cookie_check", value: "1", httpOnly: true }], "", {
      fetch: async (input, init) => {
        calls++;
        expect(new URL(String(input)).origin).toBe(O);
        expect(new Headers(init?.headers).get("cookie")).toBe("_cookie_check=1");
        return new Response(null, {
          status: 302,
          headers: { location: "https://attacker.test/items/1" },
        });
      },
    });
    expect(result.status).toBe("error");
    expect(result.errorKind).toBe("origin");
    expect(calls).toBe(1);
  });
  it("matches short secrets at token boundaries through every supported encoding", () => {
    for (const token of ["abcd", "abcdefg", "483921", "Ab7xQ2"]) {
      const redact = secretRedactor(new Set([token]));
      for (const echo of [
        token,
        Array.from(token, (c) => `%${c.charCodeAt(0).toString(16)}`).join(""),
        Array.from(token, (c) => `&#${c.charCodeAt(0)};`).join(""),
        Array.from(token, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join(""),
      ])
        expect(redact(`(${echo})`)).toBe("([redacted])");
      expect(redact(`x${token}9`)).toBe(`x${token}9`);
    }
  });
  it("retains free-text samples and structured facts for sub-four-character credentials", async () => {
    const result = await observe([{ name: "sid", value: "abc" }], "free text abc");
    const turtle = result.observations[0]?.turtle ?? "";
    expect(turtle).not.toContain("samplesSuppressed");
    expect(turtle).toContain("schema:description");
    expect(turtle).toContain("UntrustedText");
    expect(turtle).toContain('schema:identifier "99"');
    expect(turtle).toContain('schema:name "free text abc"');
  });
  it.each([
    '"q7P9m2V4r6S8t0N3"',
    "%717P9m2V4r6S8t0N3",
    '"%717P9m2V4r6S8t0N3"',
  ])("registers wire and logical cookie payloads: %s", async (cookie) => {
    const result = await observe([{ name: "sid", value: cookie }], "q7P9m2V4r6S8t0N3");
    expect(result.status).toBe("done");
    expect(JSON.stringify(result)).not.toContain("q7P9m2V4r6S8t0N3");
    expect(result.observations[0]?.turtle).toContain("[redacted]");
  });
  it("redacts mixed form plus/percent encodings in observations", async () => {
    const result = await observe(
      [{ name: "sid", value: "csrf one two secret" }],
      "%63srf+one%20two+secret",
    );
    expect(result.observations[0]?.turtle).not.toContain("%63srf");
    expect(result.observations[0]?.turtle).toContain("[redacted]");
    expect(
      secretRedactor(new Set(["csrf one two secret"]))(
        "csrf one two secret %63srf+one%20two+secret",
      ),
    ).toBe("[redacted] [redacted]");
  });
});
