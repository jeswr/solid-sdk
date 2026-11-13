// AUTHORED-BY Codex GPT-6.1-Sol
import {
  type ActionRequest,
  readSiteModel,
  type SiteModel,
  writeSiteModel,
} from "@jeswr/site-model";
import { describe, expect, it } from "vitest";
import {
  createApprovalGate,
  createExecutor,
  type ExecutorOptions,
  InMemorySessions,
} from "../src/index.js";
import { actionRequest } from "./helpers.js";

const s = "https://schema.org/",
  sab = "https://jeswr.org/ns/site-action#";
const provenance = {
  method: "manual" as const,
  learnedAt: "2026-11-13T00:00:00Z",
  derivedFrom: [],
  confidence: 1,
};
function model(): SiteModel {
  const search = {
    name: "search",
    path: [`${s}query`],
    range: "http://www.w3.org/2001/XMLSchema#string",
    required: true,
    location: "query" as const,
  };
  return {
    id: "urn:model",
    site: "https://shop.test",
    version: "1",
    generatedAt: provenance.learnedAt,
    operations: [
      {
        id: "urn:read",
        actionType: `${s}SearchAction`,
        label: "Search products",
        inputs: [search],
        request: { method: "GET", urlTemplate: "https://shop.test/products{?search}" },
        session: "none",
        effect: "read",
        provenance,
        extraction: {
          format: "json",
          itemPath: "/items",
          totalPath: "/total",
          itemType: `${s}Product`,
          fields: [
            { property: `${s}identifier`, path: "/id" },
            { property: `${s}sku`, path: "/sku" },
            { property: `${s}name`, path: "/name" },
          ],
        },
      },
      {
        id: "urn:write",
        actionType: `${s}DeleteAction`,
        label: "Delete product",
        inputs: [
          { ...search, location: "body" },
          { name: "witness", path: [], range: search.range, required: true, location: "body" },
        ],
        request: {
          method: "POST",
          urlTemplate: "https://shop.test/products/massDelete",
          contentType: "application/json",
          bodyTemplate: '{"search":"{search}","excluded":false}',
        },
        session: "none",
        effect: "irreversible-write",
        provenance,
      },
    ],
    flows: [
      {
        id: "urn:selection",
        actionType: `${s}DeleteAction`,
        label: "Delete product",
        inputs: [search],
        effect: "irreversible-write",
        provenance,
        steps: [
          { operation: "urn:read", bind: { search: "$input.search" } },
          {
            operation: "urn:write",
            bind: { search: "$input.search", witness: `$step0.${s}identifier` },
          },
        ],
      },
    ],
  };
}
const row = (id: string, name = `Example Widget ${id}`) => ({ id, sku: `EX-${id}`, name });
const request = (tail = ""): ActionRequest =>
  actionRequest(`[] a schema:DeleteAction; schema:query "EX" ${tail} .`);
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}
function rig(initial = [row("42")], total = initial.length, source = model()) {
  let rows = initial,
    count = total,
    writeStatus = 200,
    readCookie: string | undefined;
  const calls: string[] = [];
  const transport: NonNullable<ExecutorOptions["fetch"]> = async (input, init) => {
    const url = new URL(String(input));
    calls.push(init?.method ?? "GET");
    if (init?.method === "POST") {
      expect(JSON.parse(String(init.body))).toEqual({ search: "EX", excluded: false });
      return Response.json({}, { status: writeStatus });
    }
    expect(url.searchParams.get("search")).toBe("EX");
    return Response.json(
      { items: rows, total: count },
      { headers: readCookie ? { "set-cookie": readCookie } : {} },
    );
  };
  const gate = createApprovalGate();
  const sessions = new InMemorySessions();
  const executor = createExecutor({
    model: source,
    gate,
    sessions,
    fetch: transport,
  });
  return {
    executor,
    gate,
    calls,
    sessions,
    writeResponse(status: number) {
      writeStatus = status;
    },
    readCookies(cookie: string) {
      readCookie = cookie;
    },
    change(next: typeof rows, nextTotal = next.length) {
      rows = next;
      count = nextTotal;
    },
  };
}
async function approval(r: ReturnType<typeof rig>, req = request()) {
  const result = await r.executor.execute(req);
  expect(result.status).toBe("needs-approval");
  if (!result.approval) throw new Error("Expected approval");
  return result.approval;
}

describe("filter selection approvals", () => {
  it("one match names the target, binds its identity and re-resolves before sending", async () => {
    const source = readSiteModel(await writeSiteModel(model()));
    const r = rig([row("42")], 1, source);
    const a = await approval(r);
    expect(a.summary).toBe('Delete "Example Widget 42 [42]" on shop.test');
    expect(r.calls).toEqual(["GET"]);
    const other = await approval(rig([row("43", "Example Widget 42")]));
    expect(a.digest).not.toBe(other.digest);
    r.gate.approve(a.id);
    const done = await r.executor.execute(request(), { approvalId: a.id });
    expect(done.status).toBe("done");
    expect(done.committed).toHaveLength(1);
    expect(r.calls).toEqual(["GET", "GET", "POST"]);
  });
  it.each([
    ["two matches", [row("42"), row("43")], 2],
    ["zero matches", [], 0],
    ["partial selection", [row("42")], 2],
    ["extraction item cap", Array.from({ length: 201 }, (_, i) => row(String(i))), 201],
  ])("refuses %s before write approval", async (_name, rows, count) => {
    const r = rig(rows, count);
    const result = await r.executor.execute(request());
    expect(result).toMatchObject({
      status: "refused",
      errorKind: "ambiguous-target",
      committed: [],
    });
    expect(r.calls).toEqual(["GET"]);
    expect(r.gate.pending()).toHaveLength(0);
  });
  it("refuses a selection changed between approval and retry", async () => {
    const r = rig();
    const a = await approval(r);
    r.gate.approve(a.id);
    r.change([row("43")]);
    // A permissive host gate cannot bypass selection revalidation.
    r.gate.authorize = async () => ({ kind: "allow" });
    expect(await r.executor.execute(request(), { approvalId: a.id })).toMatchObject({
      status: "refused",
      errorKind: "ambiguous-target",
      error: expect.stringContaining("selection changed"),
      committed: [],
    });
    expect(r.calls).toEqual(["GET", "GET"]);
  });
  it("explicit all allows a complete set, names five and N more, and tolerates reordered identities", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => row(String(i + 10)));
    const r = rig(rows);
    const req = request(`; <${sab}all> true`);
    const a = await approval(r, req);
    expect(a.summary).toContain('"Example Widget 10 [10]"');
    expect(a.summary).toContain('"Example Widget 14 [14]" and 2 more');
    r.gate.approve(a.id);
    r.change([...rows].reverse());
    // Response order cannot change the selection digest.
    expect((await r.executor.execute(req, { approvalId: a.id })).status).toBe("done");
    expect(r.calls).toEqual(["GET", "GET", "POST"]);
  });
  it.each([
    `; <${sab}all> true; schema:object [schema:name "EX"]`,
    `; <${sab}all> false`,
    `; <${sab}all> "yes"`,
  ])("does not broaden an object request or infer all from %s", async (tail) => {
    const r = rig([row("42"), row("43")]);
    expect((await r.executor.execute(request(tail))).errorKind).toBe("ambiguous-target");
    expect(r.calls).toEqual(["GET"]);
  });
  it("all still refuses partial and zero selections", async () => {
    for (const r of [rig([], 0), rig([row("42")], 2)])
      expect((await r.executor.execute(request(`; <${sab}all> true`))).status).toBe("refused");
  });
  it("cannot invoke the mass write directly or forge its witness binding", async () => {
    const r = rig();
    expect((await r.executor.execute(request(`; <${sab}operation> "urn:write"`))).status).toBe(
      "no-path",
    );
    expect(r.calls).toEqual([]);
    const source = model();
    required(required(source.flows[0]).steps[1]).bind.witness = "$input.search";
    expect(() => rig([], 0, source)).toThrow("earlier trusted identity read");
  });
  it("rejects a resolver with different filters or untrusted identities", () => {
    const source = model();
    required(required(source.flows[0]).steps[0]).bind.search = "different";
    expect(() => rig([], 0, source)).toThrow("share every filter binding");
    const untrusted = model();
    required(required(required(untrusted.operations[0]).extraction).fields[0]).untrusted = true;
    expect(() => rig([], 0, untrusted)).toThrow("earlier trusted identity read");
  });
  it("rejects a selection read made stale by an intervening flow write", () => {
    const source = model();
    const middle = {
      ...required(source.operations[1]),
      id: "urn:middle",
      inputs: [],
      request: { method: "POST" as const, urlTemplate: "https://shop.test/intermediate" },
    };
    source.operations.push(middle);
    required(source.flows[0]).steps.splice(1, 0, { operation: middle.id, bind: {} });
    expect(() => rig([], 0, source)).toThrow("selection read must follow every preceding write");
  });
  it("keeps the repeat guard at the resolved boundary", async () => {
    const r = rig();
    const a = await approval(r);
    r.gate.approve(a.id);
    const done = await r.executor.execute(request(), { approvalId: a.id });
    const fingerprints = done.committed.map((entry) => entry.fingerprint);
    expect(fingerprints).toHaveLength(1);
    expect(
      await r.executor.execute(request(), { excludeFingerprints: fingerprints }),
    ).toMatchObject({ status: "refused", errorKind: "repeat" });
    expect(r.calls.filter((method) => method === "POST")).toHaveLength(1);
  });
  it("retains an uncertain write and its repeat fingerprint after a server failure", async () => {
    const r = rig();
    const a = await approval(r);
    r.gate.approve(a.id);
    r.writeResponse(503);
    const result = await r.executor.execute(request(), { approvalId: a.id });
    expect(result.status).toBe("error");
    expect(result.outcome?.status).toBe("uncertain");
    expect(result.committed).toHaveLength(1);
    expect(
      (
        await r.executor.execute(request(), {
          excludeFingerprints: result.committed.map((c) => c.fingerprint),
        })
      ).errorKind,
    ).toBe("repeat");
    expect(r.calls.filter((method) => method === "POST")).toHaveLength(1);
  });
  it("refuses extra concrete read filters even when the shared search binding agrees", async () => {
    const source = model();
    required(source.operations[0]).request.urlTemplate += "&filters%5Bstatus%5D=active";
    const r = rig([row("42")], 1, source);
    expect(await r.executor.execute(request())).toMatchObject({
      status: "refused",
      errorKind: "ambiguous-target",
      error: expect.stringContaining("wire filters differ"),
    });
    expect(r.calls).toEqual(["GET"]);
  });
  it("redacts complete resolved names before quoting, escaping controls and truncating", async () => {
    const secret = "example-session-secret";
    const r = rig([row("42", `Quoted "Widget"\n${secret} ${"x".repeat(150)}`)]);
    r.sessions.set("https://shop.test", undefined, {
      cookies: [],
      headers: { "X-Session": secret },
    });
    const a = await approval(r);
    expect(a.summary).toContain("[redacted]");
    expect(a.summary).not.toContain(secret);
    expect(a.summary).toContain("\\\\u000a");
    expect(a.summary).toContain('\\"Widget\\"');
    expect(a.summary).toContain("(truncated)");
    expect(a.summary.length).toBeLessThan(160);
  });
  it("authorizes the resolver read before transmission and respects read denial on retry", async () => {
    const calls: string[] = [];
    const gate = createApprovalGate({ allowReads: false });
    const transport: NonNullable<ExecutorOptions["fetch"]> = async () => {
      calls.push("GET");
      return Response.json({ items: [row("42")], total: 1 });
    };
    const executor = createExecutor({
      model: model(),
      sessions: new InMemorySessions(),
      gate,
      fetch: transport,
    });
    const first = await executor.execute(request());
    expect(first.approval?.effect).toBe("read");
    expect(calls).toEqual([]);
    gate.reject(required(first.approval).id);
    expect((await executor.execute(request(), { approvalId: first.approval?.id })).status).toBe(
      "denied",
    );
    expect(calls).toEqual([]);
  });
  it("general write summaries use bound item names, or the operation and concrete ID", async () => {
    const source = model();
    const write = required(source.operations[1]);
    write.inputs = [
      {
        name: "id",
        path: [`${s}object`, `${s}identifier`],
        location: "body",
        required: true,
        range: "http://www.w3.org/2001/XMLSchema#string",
      },
    ];
    write.request.bodyTemplate = '{"id":"{id}"}';
    required(required(source.flows[0]).steps[1]).bind = { id: `$step0.${s}identifier` };
    const bound = await approval(rig([row("42")], 1, source));
    expect(bound.summary).toBe('Delete "Example Widget 42" on shop.test');
    const r = rig([row("42")], 1, { ...source, flows: [] });
    const result = await r.executor.execute(
      actionRequest('[] a schema:DeleteAction; schema:object [schema:identifier "42"].'),
    );
    expect(result.approval?.summary).toBe('"Delete product" ("id"="42") on shop.test');
    expect(r.calls).toEqual([]);
  });
  it("permits executor-owned resolver reads to renew cookie metadata without consuming another approval", async () => {
    const r = rig();
    r.readCookies("sid=example-session-credential; Path=/; Max-Age=600; Secure; HttpOnly");
    const a = await approval(r);
    const before = await r.sessions.get("https://shop.test");
    r.gate.approve(a.id);
    expect((await r.executor.execute(request(), { approvalId: a.id })).status).toBe("done");
    expect((await r.sessions.get("https://shop.test"))?.revision).not.toBe(before?.revision);
    expect(r.calls).toEqual(["GET", "GET", "POST"]);
  });
  it.each([
    "external vault revision",
    "resolver credential change",
  ])("requires new consent after %s", async (change) => {
    const r = rig();
    r.readCookies("sid=example-session-credential; Path=/; Secure; HttpOnly");
    const a = await approval(r);
    r.gate.approve(a.id);
    if (change === "external vault revision")
      r.sessions.set(
        "https://shop.test",
        undefined,
        required(await r.sessions.get("https://shop.test")),
      );
    else r.readCookies("sid=different-session-credential; Path=/; Secure; HttpOnly");
    expect((await r.executor.execute(request(), { approvalId: a.id })).status).toBe(
      "needs-approval",
    );
    expect(r.calls).toEqual(["GET", "GET"]);
  });
});
