// AUTHORED-BY Codex GPT-6
import type { Flow, Operation, Parameter, SiteModel } from "@jeswr/site-model";
import { parseActionRequest } from "@jeswr/site-model";
import { describe, expect, it, vi } from "vitest";
import { compileOperation } from "../src/compile.js";
import { InMemorySessions, type SessionBundle, type SessionProvider } from "../src/cookies.js";
import { createExecutor } from "../src/executor.js";
import { extract } from "../src/extract.js";
import { createApprovalGate } from "../src/gate.js";
import { factsMoney } from "../src/money.js";

const actionRequest = (text: string) =>
  parseActionRequest(`@prefix schema: <https://schema.org/> . ${text}`);

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}
type Transport = NonNullable<Parameters<typeof createExecutor>[0]["fetch"]>;
const O = "https://shop.test";
const S = "https://schema.org/";
const X = "http://www.w3.org/2001/XMLSchema#";
const provenance = {
  derivedFrom: [],
  learnedAt: "2026-11-13",
  method: "manual" as const,
  confidence: 1,
};
const param = (name: string, path: string[], extra: Partial<Parameter> = {}): Parameter => ({
  name,
  path: path.map((p) => S + p),
  range: `${X}string`,
  required: true,
  location: "body",
  ...extra,
});
const product = (extra = {}) => ({
  url: `${O}/product/104`,
  productID: "104",
  price: "20",
  currency: "GBP",
  ...extra,
});
function fixture(priorWrite = false) {
  const read: Operation = {
    id: "urn:read",
    actionType: `${S}ViewAction`,
    label: "Read",
    effect: "read",
    session: "none",
    provenance,
    inputs: [],
    request: { method: "GET", urlTemplate: `${O}/quote` },
    extraction: {
      format: "json",
      itemPath: "/items",
      itemType: `${S}Product`,
      idField: `${S}url`,
      fields: [
        { property: `${S}url`, path: "/url", datatype: "iri" },
        { property: `${S}object`, path: "/object", datatype: "iri" },
        ...["productID", "identifier", "orderNumber", "price", "currency", "totalPaymentDue"].map(
          (p) => ({ property: S + p, path: `/${p}` }),
        ),
      ],
    },
  };
  const pay: Operation = {
    id: "urn:pay",
    actionType: `${S}PayAction`,
    label: "Pay",
    effect: "payment",
    session: "none",
    provenance,
    inputs: [param("item", ["object", "productID"])],
    request: { method: "POST", urlTemplate: `${O}/pay`, contentType: "application/json" },
  };
  const mutate: Operation = {
    ...pay,
    id: "urn:shipping",
    label: "Change shipping",
    effect: "irreversible-write",
    inputs: [],
    request: { method: "POST", urlTemplate: `${O}/shipping` },
  };
  const flow: Flow = {
    id: "urn:buy",
    label: "Buy",
    actionType: `${S}BuyAction`,
    effect: "payment",
    inputs: [],
    provenance,
    steps: [
      ...(priorWrite ? [{ operation: mutate.id, bind: {} }] : []),
      { operation: read.id, bind: {} },
      { operation: pay.id, bind: { item: "104" } },
    ],
  };
  const model: SiteModel = {
    id: "urn:model",
    site: O,
    version: "1",
    generatedAt: "2026-11-13",
    operations: [read, pay, mutate],
    flows: [flow],
  };
  const buy = () => actionRequest(`[] a schema:BuyAction; schema:object <${O}/product/104>.`);
  const transport =
    (items = [product()]): Transport =>
    async (_url, init) =>
      init?.method === "GET" ? Response.json({ items }) : Response.json({});
  const executor = (injected: Transport) =>
    createExecutor({
      model,
      fetch: injected,
      sessions: new InMemorySessions(),
      gate: { authorize: async () => ({ kind: "allow" }) },
    });
  return { model, read, pay, mutate, flow, buy, transport, executor };
}

describe("r3 money evidence", () => {
  it.each([
    { orderNumber: "999" },
    { orderNumber: ["104", "999"] },
    { orderNumber: undefined },
  ])("#3 rejects mismatched or absent orderNumber rather than matching an empty identity list (%j)", async ({
    orderNumber,
  }) => {
    const f = fixture();
    const extraction = { ...required(f.read.extraction), itemType: `${S}Order` };
    const output = await extract(
      extraction,
      JSON.stringify({ items: [product({ orderNumber })] }),
      { baseUrl: `${O}/quote`, redact: (value) => value },
    );
    f.pay.inputs = [param("order", ["object", "orderNumber"])];
    const values = { order: "104" };
    expect(() =>
      factsMoney(
        O,
        [{ step: 1, operation: { ...f.read, extraction }, url: `${O}/quote`, items: output.items }],
        [
          {
            step: 2,
            operation: f.pay,
            values,
            sources: {},
            compiled: compileOperation(f.pay, values, O),
          },
        ],
        0,
      ),
    ).toThrow("order identity");
  });

  it("#1 rejects conflicting duplicate product records across reads", async () => {
    const f = fixture();
    const other = {
      ...f.read,
      id: "urn:other",
      request: { method: "GET" as const, urlTemplate: `${O}/other` },
    };
    f.model.operations.push(other);
    f.flow.steps.splice(1, 0, { operation: other.id, bind: {} });
    const transport = vi.fn<Transport>(async (url) =>
      Response.json({ items: [product({ price: String(url).endsWith("other") ? "1000" : "1" })] }),
    );
    const result = await f.executor(transport).execute(f.buy());
    expect(result.status).toBe("refused");
    expect(transport.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("#1 binds and revalidates every agreeing product record on retry", async () => {
    const f = fixture();
    let second = "20";
    const gate = createApprovalGate();
    const executor = createExecutor({
      model: f.model,
      sessions: new InMemorySessions(),
      gate,
      fetch: async () => Response.json({ items: [product(), product({ price: second })] }),
    });
    const first = await executor.execute(f.buy());
    expect(first.status).toBe("needs-approval");
    second = "2000";
    gate.approve(first.approval?.id ?? "");
    const retry = await executor.execute(f.buy(), { approvalId: first.approval?.id });
    expect(retry.status).toBe("refused");
    expect(retry.committed).toEqual([]);
  });

  it("#2 never borrows product identity from schema:object", async () => {
    const f = fixture();
    f.pay.inputs = [param("item", ["object"], { range: `${S}Product` })];
    f.flow.inputs = [param("item", ["object"], { range: `${S}Product` })];
    required(f.flow.steps.at(-1)).bind = { item: "$input.item" };
    const result = await f
      .executor(
        f.transport([
          product({
            url: `${O}/product/999`,
            productID: undefined,
            object: `${O}/product/104`,
            price: "1",
          }),
        ]),
      )
      .execute(f.buy());
    expect(result.status).toBe("refused");
  });

  it.each([
    "orderNumber",
    "identifier",
    "iri",
    "referencesOrder",
  ])("#3 rejects a total for a different bound order (%s)", async (identity) => {
    const f = fixture(true);
    f.read.extraction = { ...required(f.read.extraction), itemType: `${S}Order` };
    f.pay.inputs = [
      param(
        "order",
        identity === "iri"
          ? ["object"]
          : identity === "referencesOrder"
            ? ["referencesOrder"]
            : ["object", identity],
      ),
    ];
    required(f.flow.steps.at(-1)).bind = {
      order: identity === "iri" || identity === "referencesOrder" ? `${O}/order/104` : "104",
    };
    const result = await f
      .executor(
        f.transport([
          product({
            url: `${O}/order/999`,
            productID: undefined,
            orderNumber: "999",
            identifier: "999",
          }),
        ]),
      )
      .execute(actionRequest("[] a schema:BuyAction."));
    expect(result.status).toBe("refused");
    expect(result.committed).toHaveLength(1);
  });

  it("#4 never falls back to product pricing after a preceding write", async () => {
    const f = fixture();
    f.flow.steps.splice(1, 0, { operation: f.mutate.id, bind: {} });
    const result = await f.executor(f.transport()).execute(f.buy());
    expect(result.status).toBe("refused");
    expect(result.error).toContain("needs one fresh basket total");
  });

  it("accepts one fresh total after a write without demanding product quantity on the total", async () => {
    const f = fixture(true);
    f.pay.inputs = [];
    required(f.flow.steps.at(-1)).bind = {};
    const result = await f
      .executor(f.transport([product({ totalPaymentDue: "20" })]))
      .execute(f.buy());
    expect(result.status).toBe("done");
    expect(result.outcome).toMatchObject({ amount: "20", currency: "GBP" });
  });
});

describe("r3 uncertain writes and term kinds", () => {
  it.each([
    "500",
    "reset",
    "timeout",
  ])("#5 retains a fingerprint and Uncertain receipt after %s", async (mode) => {
    const f = fixture();
    f.model.flows = [];
    f.mutate.actionType = `${S}BuyAction`;
    const transport: Transport = async () => {
      if (mode === "reset") throw new Error("reset");
      if (mode === "timeout") return await new Promise(() => {});
      return new Response("charged", { status: 500 });
    };
    const executor = createExecutor({
      model: f.model,
      fetch: transport,
      maxExecutionMs: mode === "timeout" ? 200 : 5000,
      sessions: new InMemorySessions(),
      gate: { authorize: async () => ({ kind: "allow" }) },
    });
    const result = await executor.execute(f.buy());
    expect(result.status).toBe("error");
    expect(result.committed).toHaveLength(1);
    expect(result.observations[0]?.turtle).toContain("sab:Uncertain");
  });

  it("#5 treats only a 4xx response as a failed uncommitted write", async () => {
    const f = fixture();
    f.model.flows = [];
    f.mutate.actionType = `${S}BuyAction`;
    const result = await f
      .executor(async () => new Response("rejected", { status: 400 }))
      .execute(f.buy());
    expect(result.committed).toEqual([]);
    expect(result.observations[0]?.turtle).toContain("sab:Failed");
  });

  it("#6 rejects a blank node for a scalar input but preserves literal labels", async () => {
    const f = fixture();
    f.model.flows = [];
    f.mutate.actionType = `${S}BuyAction`;
    f.mutate.inputs = [param("item", ["object"])];
    const transport = vi.fn<Transport>(async () => Response.json({}));
    const executor = f.executor(transport);
    const result = await executor.execute(
      actionRequest("[] a schema:BuyAction; schema:object []."),
    );
    expect(result).toMatchObject({ status: "error", errorKind: "binding" });
    expect(transport).not.toHaveBeenCalled();
    expect(
      (await executor.execute(actionRequest('[] a schema:BuyAction; schema:object "_:literal".')))
        .status,
    ).toBe("done");
  });

  it("#6 normalizes IRI terms through scalar inputs before sending and fingerprinting", async () => {
    const f = fixture();
    f.model.flows = [];
    f.mutate.actionType = `${S}BuyAction`;
    f.mutate.inputs = [param("item", ["object"])];
    f.mutate.request.contentType = "application/json";
    const transport = vi.fn<Transport>(async () => Response.json({}));
    const executor = f.executor(transport);
    const first = await executor.execute(f.buy());
    const second = await executor.execute(
      actionRequest("[] a schema:BuyAction; schema:object <https://SHOP.test:443/product/104>."),
      { excludeFingerprints: first.committed.map((e) => e.fingerprint) },
    );
    expect(second).toMatchObject({ status: "refused", errorKind: "repeat" });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]?.[1]?.body).toBe('{"item":"https://shop.test/product/104"}');
  });
});

describe("session revision handoff", () => {
  it.each([
    true,
    false,
  ])("advances accepted revisions and stops persisting rejected updates (%s)", async (accepted) => {
    const f = fixture();
    f.model.flows = [];
    f.read.actionType = `${S}BuyAction`;
    f.read.extraction = undefined;
    const initial: SessionBundle = { cookies: [], revision: "r1" };
    const updates: SessionBundle[] = [];
    const sessions: SessionProvider = {
      get: async () => initial,
      update: async (_site, _persona, bundle) => {
        updates.push(bundle);
        return { accepted, revision: "r2" };
      },
    };
    const transport = vi.fn<Transport>(
      async (_url, init): Promise<Response> =>
        transport.mock.calls.length === 1
          ? new Response(null, {
              status: 302,
              headers: { location: "/next", "set-cookie": "a=1; Path=/" },
            })
          : new Response("ok", {
              headers: {
                "set-cookie": "b=2; Path=/",
                "x-seen-cookie": new Headers(init?.headers).get("cookie") ?? "",
              },
            }),
    );
    const result = await createExecutor({ model: f.model, sessions, fetch: transport }).execute(
      f.buy(),
    );
    expect(result.status).toBe("done");
    expect(updates.map((u) => u.revision)).toEqual(accepted ? ["r1", "r2"] : ["r1"]);
    expect(new Headers(transport.mock.calls[1]?.[1]?.headers).get("cookie")).toBe("a=1");
  });
});

it("InMemorySessions advances accepted revisions and reports rejected stale updates", async () => {
  const sessions = new InMemorySessions();
  sessions.set(O, undefined, { cookies: [] });
  const before = required(await sessions.get(O));
  const accepted = await sessions.update(O, undefined, before);
  expect(accepted.accepted).toBe(true);
  expect(accepted.revision).not.toBe(before.revision);
  expect((await sessions.get(O))?.revision).toBe(accepted.revision);
  expect(await sessions.update(O, undefined, before)).toEqual({ accepted: false });
});
