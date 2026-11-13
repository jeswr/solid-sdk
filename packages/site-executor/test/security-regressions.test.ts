// AUTHORED-BY Codex GPT-6
import type { Flow, Operation, Parameter, SiteModel } from "@jeswr/site-model";
import { Parser, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { InMemorySessions } from "../src/cookies.js";
import { createExecutor, type ExecutorOptions } from "../src/executor.js";
import { extract } from "../src/extract.js";
import { approvalFor, createApprovalGate, type Gate } from "../src/gate.js";
import { actionRequest } from "./helpers.js";

const S = "https://schema.org/";
const X = "http://www.w3.org/2001/XMLSchema#";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const O = "https://shop.test";
const provenance = {
  derivedFrom: [],
  learnedAt: "2026-11-13",
  method: "manual" as const,
  confidence: 1,
};
const sessions = () => new InMemorySessions();
const allow: Gate = { authorize: async () => ({ kind: "allow" }) };
const p = (name: string, path: string[], extra: Partial<Parameter> = {}): Parameter => ({
  name,
  path: path.map((x) => S + x),
  range: `${X}string`,
  required: true,
  location: "body",
  ...extra,
});
const op = (extra: Partial<Operation> = {}): Operation => ({
  id: "urn:read",
  actionType: `${S}ViewAction`,
  label: "Read",
  inputs: [],
  request: { method: "GET", urlTemplate: `${O}/quote` },
  session: "none",
  effect: "read",
  provenance,
  ...extra,
});
const payment = (extra: Partial<Operation> = {}) =>
  op({
    id: "urn:pay",
    actionType: `${S}PayAction`,
    label: "Pay",
    effect: "payment",
    inputs: [
      p("item", ["object", "productID"], { default: "104", required: false }),
      p("charge", ["amount", "value"], { range: `${X}decimal` }),
      p("currency", ["amount", "currency"]),
    ],
    request: { method: "POST", urlTemplate: `${O}/pay`, contentType: "application/json" },
    ...extra,
  });
const model = (operations: Operation[], flows: Flow[] = []): SiteModel => ({
  id: "urn:model",
  site: O,
  version: "1",
  generatedAt: "2026-11-13",
  operations,
  flows,
});
const flow = (steps: Flow["steps"], extra: Partial<Flow> = {}): Flow => ({
  id: "urn:flow",
  actionType: `${S}BuyAction`,
  label: "Buy",
  effect: "payment",
  inputs: [],
  steps,
  provenance,
  ...extra,
});
const pay = (amount = "20", claims = "") =>
  actionRequest(
    `[] a schema:PayAction; schema:amount [ schema:value "${amount}"; schema:currency "GBP" ]; ${claims} schema:name "purchase" .`,
  );
const buy = () =>
  actionRequest('[] a schema:BuyAction; schema:price "20"; schema:priceCurrency "GBP" .');
const json = (value: unknown) =>
  new Response(
    JSON.stringify(
      value && typeof value === "object" && !Array.isArray(value)
        ? { productID: "104", ...value }
        : value,
    ),
    { headers: { "content-type": "application/json" } },
  );
const quote = () =>
  op({
    extraction: {
      format: "json",
      itemType: `${S}Product`,
      fields: [
        { property: `${S}productID`, path: "/productID" },
        { property: `${S}price`, path: "/amount" },
        { property: `${S}priceCurrency`, path: "/currency" },
      ],
    },
  });
const quotedFlow = () =>
  flow([
    { operation: "urn:read", bind: {} },
    {
      operation: "urn:pay",
      bind: { charge: "$step0.schema:price", currency: "$step0.schema:priceCurrency" },
    },
  ]);

describe("security review regressions", () => {
  it("F1 refuses conflicting planner money and wire-only charges without site evidence", async () => {
    const authorize = vi.fn<Gate["authorize"]>(async (req) =>
      Number(req.amount) <= 20 ? { kind: "allow" } : { kind: "deny", reason: "limit" },
    );
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({}));
    const ex = createExecutor({
      model: model([payment()]),
      sessions: sessions(),
      gate: { authorize },
      fetch,
    });
    const conflict = await ex.execute(pay("1000", 'schema:price "1";'));
    expect(conflict.status).toBe("error");
    expect(fetch).not.toHaveBeenCalled();
    expect((await ex.execute(pay("1000"))).status).toBe("refused");
    expect(authorize).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("F1 refuses payments with no bound monetary inputs", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({}));
    const ex = createExecutor({
      model: model([payment({ inputs: [] })]),
      sessions: sessions(),
      gate: allow,
      fetch,
    });
    expect((await ex.execute(pay())).status).toBe("refused");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("F2 authorizes reads separately and refuses a response-derived charge above the claim", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      json({ amount: 1000, currency: "GBP" }),
    );
    const authorize = vi.fn<Gate["authorize"]>(async (req) =>
      req.effect === "read" || Number(req.amount) <= 20
        ? { kind: "allow" }
        : { kind: "deny", reason: "limit" },
    );
    const ex = createExecutor({
      model: model([quote(), payment()], [quotedFlow()]),
      sessions: sessions(),
      gate: { authorize },
      fetch,
    });
    const r = await ex.execute(buy());
    expect(r.status).toBe("refused");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(authorize.mock.calls[0]?.[0].effect).toBe("read");
  });

  it("F2 approval binds concrete quote inputs and resumes without replaying reads or writes", async () => {
    let amount = 20;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ amount, currency: "GBP" }));
    const gate = createApprovalGate();
    const f = quotedFlow();
    f.steps.push({ operation: "urn:finish", bind: { note: "$step0.schema:price" } });
    const finish = op({
      id: "urn:finish",
      effect: "irreversible-write",
      inputs: [p("note", [])],
      request: { method: "POST", urlTemplate: `${O}/finish` },
    });
    const ex = createExecutor({
      model: model([quote(), payment(), finish], [f]),
      sessions: sessions(),
      gate,
      fetch,
    });
    const first = await ex.execute(buy());
    expect(first.requests).toBe(1);
    expect(Object.values(first.approval?.inputs ?? {})).toContain("20");
    gate.approve(first.approval?.id ?? "");
    amount = 1000;
    const second = await ex.execute(buy(), { approvalId: first.approval?.id ?? "" });
    expect(second.status).toBe("refused");
    expect(fetch.mock.calls.map((c) => String(c[0]))).toEqual([`${O}/quote`, `${O}/quote`]);
    expect(second.committed).toEqual([]);
  });

  it.each([
    "operation",
    "flow",
    "parameter",
    "missing-step",
  ])("F3 refuses malformed model at construction: %s", (kind) => {
    const m = model([op(), payment()], [quotedFlow()]);
    if (kind === "operation") m.operations.push(payment({ id: "urn:read" }));
    if (kind === "flow") m.flows.push(quotedFlow());
    if (kind === "parameter") m.operations[1]?.inputs.push(p("charge", ["price"]));
    if (kind === "missing-step") m.operations.pop();
    expect(() => createExecutor({ model: m, sessions: sessions() })).toThrow();
  });

  it.each([
    "..",
    ".",
    "%2e%2e",
    ".%2e",
    "../logout",
    "x/../../logout",
  ])("F4 refuses path traversal through reserved and simple slots: %s", async (category) => {
    for (const slot of ["{category}", "{+category}"]) {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => json({}));
      const ex = createExecutor({
        model: model([
          op({
            inputs: [p("category", ["category"], { location: "path" })],
            request: { method: "GET", urlTemplate: `${O}/products/${slot}/id` },
          }),
        ]),
        sessions: sessions(),
        fetch,
      });
      const r = await ex.execute(
        actionRequest(`[] a schema:ViewAction; schema:category ${JSON.stringify(category)} .`),
      );
      expect(r.status).toBe("error");
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  it("F5 untrusted IRI fields stay wrapped and cannot name subjects", async () => {
    const out = await extract(
      {
        format: "json",
        itemType: `${S}Thing`,
        idField: `${S}url`,
        fields: [{ property: `${S}url`, path: "/url", datatype: "iri", untrusted: true }],
      },
      '{"url":"/hostile"}',
      { baseUrl: O, redact: (x) => x },
    );
    const store = new Store(new Parser().parse(out.turtle));
    const value = store.getQuads(null, `${S}url`, null, null)[0];
    expect(value?.subject.termType).toBe("BlankNode");
    expect(value?.object.termType).toBe("BlankNode");
    expect(
      store.getQuads(
        value?.object ?? null,
        `${RDF}type`,
        "https://jeswr.org/ns/site-action#UntrustedText",
        null,
      ),
    ).toHaveLength(1);
    expect(out.items[0]?.iri).toBeUndefined();
  });

  it.each([
    "-100",
    "3",
  ])("F6 enforces flow input ranges and options before any authorization: %s", async (value) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({}));
    const authorize = vi.fn(allow.authorize);
    const f = flow([{ operation: "urn:read", bind: { q: "$input.q" } }], {
      effect: "read",
      inputs: [p("q", ["value"], { range: `${X}positiveInteger`, options: ["1", "2"] })],
    });
    const ex = createExecutor({
      model: model([op({ inputs: [p("q", [])] })], [f]),
      sessions: sessions(),
      fetch,
      gate: { authorize },
    });
    const r = await ex.execute(actionRequest(`[] a schema:BuyAction; schema:value "${value}" .`));
    expect(r).toMatchObject({ status: "error", errorKind: "binding" });
    expect(authorize).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("F7 redacts short, mixed percent-encoded and boundary-spanning secrets", async () => {
    const vault = sessions();
    const secret = "cookie-SECRET-long-token";
    vault.set(O, undefined, {
      cookies: [
        { name: "sid", value: secret, domain: "shop.test", path: "/" },
        { name: "small", value: "xyz", domain: "shop.test", path: "/" },
      ],
    });
    const fetch: typeof globalThis.fetch = async () =>
      json({
        url: "/%63ookie-SECRET-long-token",
        text: "a".repeat(3995) + secret,
        short: "xyz",
        nested: "%2563ookie-SECRET-long-token",
      });
    const ex = createExecutor({
      model: model([
        op({
          extraction: {
            format: "json",
            itemType: `${S}Thing`,
            fields: [
              { property: `${S}url`, path: "/url", datatype: "iri" },
              { property: `${S}name`, path: "/text" },
              { property: `${S}value`, path: "/short" },
              { property: `${S}text`, path: "/nested" },
            ],
          },
        }),
      ]),
      sessions: vault,
      fetch,
    });
    const r = await ex.execute(actionRequest("[] a schema:ViewAction ."));
    const turtle = r.observations[0]?.turtle ?? "";
    expect(turtle).not.toContain("cookie");
    expect(decodeURIComponent(decodeURIComponent(turtle))).not.toContain(secret);
    expect(turtle).not.toContain("xyz");
    expect(turtle).not.toContain("cooki");
    expect(turtle).toContain("[redacted]");
  });

  it.each([
    "done",
    "http-error",
    "denied",
    "ask",
  ])("F8 re-renders earlier observations with later secrets on %s", async (ending) => {
    const secret = "later-CSRF-secret";
    const read = op({
      extraction: {
        format: "json",
        itemType: `${S}Thing`,
        idField: `${S}url`,
        fields: [
          { property: `${S}url`, path: "/url", datatype: "iri" },
          { property: `${S}name`, path: "/text" },
        ],
      },
    });
    const write = op({
      id: "urn:write",
      effect: "reversible-write",
      request: { method: "POST", urlTemplate: `${O}/write` },
      csrf: [
        {
          source: { kind: "json", urlTemplate: `${O}/csrf`, pointer: "/token" },
          target: { kind: "header", name: "X-CSRF" },
        },
      ],
    });
    const end = op({
      id: "urn:end",
      effect: "reversible-write",
      request: { method: "POST", urlTemplate: `${O}/end` },
    });
    const fetch: typeof globalThis.fetch = async (url) =>
      String(url).endsWith("/csrf")
        ? json({ token: secret })
        : String(url).endsWith("/write") && ending === "http-error"
          ? new Response("", { status: 500 })
          : json({ url: `/${secret}`, text: "a".repeat(3995) + secret });
    const gate: Gate = {
      authorize: async (req) =>
        req.inputs.$step === "2" && ending === "denied"
          ? { kind: "deny", reason: secret }
          : req.inputs.$step === "2" && ending === "ask"
            ? { kind: "ask", approval: approvalFor(req) }
            : { kind: "allow" },
    };
    const ex = createExecutor({
      model: model(
        [read, write, end],
        [
          flow(
            [
              { operation: read.id, bind: {} },
              { operation: write.id, bind: {} },
              { operation: end.id, bind: {} },
            ],
            { effect: "reversible-write" },
          ),
        ],
      ),
      sessions: sessions(),
      fetch,
      gate,
    });
    const r = await ex.execute(actionRequest("[] a schema:BuyAction ."));
    expect(r.status).toBe(
      ending === "http-error" ? "error" : ending === "ask" ? "needs-approval" : ending,
    );
    expect(JSON.stringify(r)).not.toContain(secret);
    expect(JSON.stringify(r)).not.toContain("later");
    expect(r.observations.some((o) => o.turtle.includes("[redacted]"))).toBe(true);
  });

  it("F9 bounds per-field extraction amplification", async () => {
    await expect(
      extract(
        {
          format: "json",
          itemType: `${S}Thing`,
          fields: [{ property: `${S}review`, path: "/values", untrusted: true }],
        },
        JSON.stringify({ values: Array.from({ length: 10000 }, () => "a") }),
        { baseUrl: O, redact: (x) => x },
      ),
    ).rejects.toThrow(/limit|budget/);
  });

  it.each([
    "fetch",
    "body",
  ])("F10 absolute deadline aborts stalled %s and cancels readers", async (stage) => {
    let signal: AbortSignal | undefined;
    const cancel = vi.fn();
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      signal = init?.signal ?? undefined;
      if (stage === "fetch") return new Promise(() => {});
      return new Response(new ReadableStream({ pull: () => new Promise(() => {}), cancel }));
    };
    const options: ExecutorOptions & { maxExecutionMs: number } = {
      model: model([op()]),
      sessions: sessions(),
      fetch,
      maxExecutionMs: 20,
    };
    const execution = createExecutor(options).execute(actionRequest("[] a schema:ViewAction ."));
    const r = await Promise.race([
      execution,
      new Promise((resolve) => setTimeout(() => resolve({ status: "hung" }), 150)),
    ]);
    expect(r).toMatchObject({ status: "error", errorKind: "limit" });
    expect(signal?.aborted).toBe(true);
    if (stage === "body") expect(cancel).toHaveBeenCalled();
  });
  it("F1 enforces cumulative spending using fresh site totals", async () => {
    const authorize = vi.fn<Gate["authorize"]>(async (req) =>
      req.effect === "read" || Number(req.amount) <= 15
        ? { kind: "allow" }
        : { kind: "deny", reason: "limit" },
    );
    const total = quote();
    total.id = "urn:total";
    total.request.urlTemplate = `${O}/total`;
    if (!total.extraction) throw new Error("Missing extraction");
    total.extraction = { ...total.extraction, itemType: `${S}Order` };
    const f = flow([
      { operation: "urn:read", bind: {} },
      { operation: "urn:pay", bind: { charge: "10", currency: "GBP" } },
      { operation: "urn:total", bind: {} },
      { operation: "urn:pay", bind: { charge: "10", currency: "GBP" } },
    ]);
    const transport = vi.fn<NonNullable<ExecutorOptions["fetch"]>>(async () =>
      json({ amount: "10", currency: "GBP" }),
    );
    const executor = createExecutor({
      model: model([quote(), total, payment()], [f]),
      sessions: sessions(),
      gate: { authorize },
      fetch: transport,
    });
    expect((await executor.execute(actionRequest("[] a schema:BuyAction."))).status).toBe("denied");
    expect(authorize.mock.calls.at(-1)?.[0].amount).toBe("20");
    expect(transport.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("F1 refuses contradictory currencies and multiple monetary values", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({}));
    const ex = createExecutor({
      model: model([payment()]),
      sessions: sessions(),
      gate: allow,
      fetch,
    });
    for (const claims of ['schema:priceCurrency "EUR";', 'schema:price "20", "1000";']) {
      expect((await ex.execute(pay("20", claims))).status).toBe("error");
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("F2 refuses CSRF replacement of approved effectful inputs", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ token: "1000" }));
    const operation = payment({
      effect: "irreversible-write",
      csrf: [
        {
          source: { kind: "json", urlTemplate: `${O}/csrf`, pointer: "/token" },
          target: { kind: "form", name: "charge" },
        },
      ],
    });
    const ex = createExecutor({
      model: model([operation]),
      sessions: sessions(),
      gate: allow,
      fetch,
    });
    expect((await ex.execute(pay())).status).toBe("error");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("F3 retains an immutable model snapshot for matching, effects and execution", async () => {
    const m = model([payment({ effect: "irreversible-write" })]);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({}));
    const ex = createExecutor({ model: m, sessions: sessions(), fetch });
    if (m.operations[0]) m.operations[0].effect = "read";
    expect((await ex.execute(pay())).status).toBe("needs-approval");
    expect(fetch).not.toHaveBeenCalled();
    expect(Object.isFrozen(ex.model.operations[0])).toBe(true);
  });

  it("F4 preserves safe path values and allows dot segments in queries", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({}));
    const ex = createExecutor({
      model: model([
        op({
          inputs: [
            p("id", ["identifier"], { location: "path" }),
            p("q", ["query"], { location: "query" }),
          ],
          request: { method: "GET", urlTemplate: `${O}/products/{id}{?q}` },
        }),
      ]),
      sessions: sessions(),
      fetch,
    });
    expect(
      (
        await ex.execute(
          actionRequest(
            '[] a schema:ViewAction; schema:identifier "one.two"; schema:query "../search" .',
          ),
        )
      ).status,
    ).toBe("done");
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${O}/products/one.two?q=..%2Fsearch`);
  });

  it("F5 refuses untrusted fields as payment fact sources", async () => {
    const read = quote();
    const price = read.extraction?.fields.find((f) => f.property === `${S}price`);
    if (price) price.untrusted = true;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ amount: 20, currency: "GBP" }));
    const ex = createExecutor({
      model: model([read, payment()], [quotedFlow()]),
      sessions: sessions(),
      gate: allow,
      fetch,
    });
    expect((await ex.execute(buy())).status).toBe("error");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    "total-values",
    "quads",
    "bytes",
  ])("F9 enforces the %s extraction budget", async (which) => {
    const options = {
      baseUrl: O,
      redact: (x: string) => x,
      maxTotalValues: which === "total-values" ? 2 : 100,
      maxQuads: which === "quads" ? 3 : 100,
      maxOutputBytes: which === "bytes" ? 64 : 10000,
    };
    await expect(
      extract(
        {
          format: "json",
          itemType: `${S}Thing`,
          fields: [{ property: `${S}review`, path: "/values", untrusted: true }],
        },
        '{"values":["a","b","c"]}',
        options,
      ),
    ).rejects.toThrow(/limit/);
  });

  it("F9 limits items before reading overflowing fields in later items", async () => {
    const out = await extract(
      {
        format: "json",
        itemType: `${S}Thing`,
        fields: [{ property: `${S}name`, path: "/values" }],
      },
      JSON.stringify([
        { values: ["one"] },
        { values: Array.from({ length: 10000 }, () => "ignored") },
      ]),
      { baseUrl: O, redact: (x) => x, maxItems: 1 },
    );
    expect(out.items).toHaveLength(1);
    const html = await extract(
      {
        format: "html",
        itemType: `${S}Thing`,
        itemPath: "li",
        fields: [{ property: `${S}name`, path: ":scope" }],
      },
      `<ul>${"<li>item</li>".repeat(10000)}</ul>`,
      { baseUrl: O, redact: (x) => x, maxItems: 2 },
    );
    expect(html.items).toHaveLength(2);
  });

  it("F9 bounds HTML field values and the default output-byte budget", async () => {
    await expect(
      extract(
        { format: "html", itemType: `${S}Thing`, fields: [{ property: `${S}name`, path: "b" }] },
        "<b>many</b>".repeat(10000),
        { baseUrl: O, redact: (x) => x },
      ),
    ).rejects.toThrow(/limit/);
    await expect(
      extract(
        {
          format: "json",
          itemType: `${S}Thing`,
          fields: [{ property: `${S}name`, path: "/values" }],
        },
        JSON.stringify(
          Array.from({ length: 4 }, () => ({
            values: Array.from({ length: 100 }, () => "x".repeat(4000)),
          })),
        ),
        { baseUrl: O, redact: (x) => x },
      ),
    ).rejects.toThrow(/byte limit/);
  });

  it("F10 uses one deadline across redirects and cancels trickling bodies", async () => {
    let count = 0;
    const fetch: typeof globalThis.fetch = async (_url, init) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      await new Promise((resolve) => setTimeout(resolve, 8));
      return new Response(null, { status: 302, headers: { location: `/quote?n=${count++}` } });
    };
    const ex = createExecutor({
      model: model([op()]),
      sessions: sessions(),
      fetch,
      maxExecutionMs: 25,
      maxRedirects: 50,
    });
    expect(await ex.execute(actionRequest("[] a schema:ViewAction ."))).toMatchObject({
      status: "error",
      errorKind: "limit",
    });
    expect(count).toBeLessThan(10);
    let timer: ReturnType<typeof setInterval>;
    const cancel = vi.fn(() => clearInterval(timer));
    const trickle: typeof globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            timer = setInterval(() => controller.enqueue(new Uint8Array([65])), 5);
          },
          cancel,
        }),
      );
    const second = createExecutor({
      model: model([op()]),
      sessions: sessions(),
      fetch: trickle,
      maxExecutionMs: 25,
    });
    expect(await second.execute(actionRequest("[] a schema:ViewAction ."))).toMatchObject({
      status: "error",
      errorKind: "limit",
    });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("F1 refuses numeric monetary inputs that round during JSON compilation", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({}));
    const ex = createExecutor({
      model: model([payment()]),
      sessions: sessions(),
      gate: allow,
      fetch,
    });
    expect((await ex.execute(pay("9007199254740995"))).status).toBe("error");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    '{"charge":1000}',
    '{"charge":"1{charge}","currency":"{currency}"}',
  ])("F1 refuses unused or transformed monetary bindings: %s", async (bodyTemplate) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({}));
    const operation = payment({
      request: {
        method: "POST",
        urlTemplate: `${O}/pay`,
        contentType: "application/json",
        bodyTemplate,
      },
    });
    const ex = createExecutor({
      model: model([operation]),
      sessions: sessions(),
      fetch,
      gate: allow,
    });
    expect((await ex.execute(pay())).status).toBe("error");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("F1 refuses duplicate HTTP fields that shadow the mapped amount", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({}));
    for (const request of [
      {
        method: "POST" as const,
        urlTemplate: `${O}/pay?charge=1000&charge={charge}&currency={currency}`,
      },
      {
        method: "POST" as const,
        urlTemplate: `${O}/pay`,
        contentType: "application/x-www-form-urlencoded" as const,
        bodyTemplate: "charge=1000&charge={charge}&currency={currency}",
      },
    ]) {
      const ex = createExecutor({
        model: model([payment({ request })]),
        sessions: sessions(),
        fetch,
        gate: allow,
      });
      expect((await ex.execute(pay())).status).toBe("error");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
