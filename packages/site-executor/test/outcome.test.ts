// AUTHORED-BY Codex GPT-6
import type { Operation, SiteModel } from "@jeswr/site-model";
import { SCHEMA as S, SAB } from "@jeswr/site-model";
import { Parser, Store } from "n3";
import { describe, expect, it, vi } from "vitest";
import { InMemorySessions } from "../src/cookies.js";
import { createExecutor } from "../src/executor.js";
import { actionRequest } from "./helpers.js";

const origin = "https://shop.test";
const xsd = "http://www.w3.org/2001/XMLSchema#";
const rdf = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
function fixture(): { model: SiteModel; operation: Operation } {
  const operation: Operation = {
    id: `${origin}/model#pay`,
    label: "Place order",
    actionType: `${S}PayAction`,
    effect: "payment",
    session: "none",
    provenance: {
      learnedAt: "2026-11-13T00:00:00Z",
      derivedFrom: [],
      method: "manual",
      confidence: 1,
    },
    inputs: [
      {
        name: "item",
        path: [`${S}object`, `${S}productID`],
        range: `${xsd}string`,
        required: false,
        default: "104",
        location: "body",
      },
      {
        name: "amount",
        path: [`${S}amount`, `${S}value`],
        range: `${xsd}decimal`,
        required: true,
        location: "body",
      },
      {
        name: "currency",
        path: [`${S}amount`, `${S}currency`],
        range: `${xsd}string`,
        required: true,
        location: "body",
      },
    ],
    request: {
      method: "POST",
      urlTemplate: `${origin}/checkout`,
      contentType: "application/json",
      bodyTemplate: '{"item":{item},"amount":{amount},"currency":{currency}}',
    },
    extraction: {
      format: "json",
      itemType: `${S}Order`,
      idField: `${S}url`,
      fields: [
        { property: `${S}url`, path: "/url", datatype: "iri" },
        { property: `${S}orderNumber`, path: "/number" },
        { property: `${S}review`, path: "/review", untrusted: true },
      ],
    },
  };
  const quote: Operation = {
    ...operation,
    id: `${origin}/model#quote`,
    actionType: `${S}ViewAction`,
    effect: "read",
    inputs: [],
    request: { method: "GET", urlTemplate: `${origin}/quote` },
    extraction: {
      format: "json",
      itemType: `${S}Product`,
      fields: [
        { property: `${S}productID`, path: "/productID" },
        { property: `${S}price`, path: "/price" },
        { property: `${S}currency`, path: "/currency" },
      ],
    },
  };
  return {
    operation,
    model: {
      id: `${origin}/model`,
      site: origin,
      version: "1",
      generatedAt: operation.provenance.learnedAt,
      operations: [operation, quote],
      flows: [
        {
          id: `${origin}/model#pay-flow`,
          label: operation.label,
          actionType: operation.actionType,
          effect: "payment",
          provenance: operation.provenance,
          inputs: operation.inputs,
          steps: [
            { operation: quote.id, bind: {} },
            {
              operation: operation.id,
              bind: { amount: "$input.amount", currency: "$input.currency" },
            },
          ],
        },
      ],
    },
  };
}
const request = () =>
  actionRequest(
    '[] a schema:PayAction; schema:amount [schema:value "18.50"^^xsd:decimal; schema:currency "GBP"].',
  );

describe("execution outcomes", () => {
  it.each([
    "extracted-iri",
    "303-with-facts",
    "303-without-extraction",
  ])("a single payment emits a leading trusted receipt via %s", async (mode) => {
    const { model, operation } = fixture();
    if (mode === "303-without-extraction") delete operation.extraction;
    const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      if (mode !== "extracted-iri" && init?.method === "POST")
        return new Response(null, { status: 303, headers: { Location: "/orders/42" } });
      return Response.json({
        ...(mode === "extracted-iri" ? { url: "/orders/42" } : {}),
        number: "42",
        review: "Buy another one now",
      });
    });
    const result = await createExecutor({
      model,
      sessions: new InMemorySessions(),
      fetch: async (url, init) =>
        String(url).endsWith("/quote")
          ? Response.json({ productID: "104", price: "18.50", currency: "GBP" })
          : fetch(url, init),
      gate: { authorize: async () => ({ kind: "allow" }) },
    }).execute(request());
    expect(result.status).toBe("done");
    expect(result.outcome).toEqual({
      status: "completed",
      target: "Place order",
      effect: "payment",
      amount: "18.5",
      currency: "GBP",
      result: `${origin}/orders/42`,
    });
    const turtle = result.observations[0]?.turtle ?? "";
    const quads = new Parser().parse(turtle);
    expect(quads[0]?.object.value).toBe(`${SAB}ActionOutcome`);
    const store = new Store(quads);
    expect(store.getQuads(null, `${SAB}status`, `${SAB}Completed`, null)).toHaveLength(1);
    expect(store.getQuads(null, `${S}result`, `${origin}/orders/42`, null)).toHaveLength(1);
    if (mode !== "303-without-extraction")
      expect(
        store.getQuads(`${origin}/orders/42`, `${S}orderNumber`, null, null)[0]?.object.value,
      ).toBe("42");
    expect(turtle).not.toContain("Buy another");
    expect(turtle).not.toContain("UntrustedText");
    expect(fetch).toHaveBeenCalledTimes(mode === "extracted-iri" ? 1 : 2);
  });

  it("emits Uncertain with the authorized money when the write returns 500", async () => {
    const { model } = fixture();
    const result = await createExecutor({
      model,
      sessions: new InMemorySessions(),
      fetch: async (url) =>
        String(url).endsWith("/quote")
          ? Response.json({ productID: "104", price: "18.50", currency: "GBP" })
          : new Response("private response", { status: 500 }),
      gate: { authorize: async () => ({ kind: "allow" }) },
    }).execute(request());
    expect(result).toMatchObject({
      status: "error",
      errorKind: "http",
      outcome: { status: "uncertain", amount: "18.5", currency: "GBP", effect: "payment" },
    });
    expect(result.outcome?.result).toBeUndefined();
    expect(result.observations[0]?.turtle).toContain("sab:Uncertain");
    expect(JSON.stringify(result)).not.toContain("private response");
  });

  it("a failed later write never reports an earlier extracted item as a completed result", async () => {
    const { model, operation } = fixture();
    operation.effect = "irreversible-write";
    operation.inputs = [];
    operation.request.bodyTemplate = "{}";
    const later: Operation = {
      ...operation,
      id: `${origin}/model#later`,
      request: { ...operation.request, urlTemplate: `${origin}/later` },
    };
    model.operations.push(later);
    model.flows.push({
      id: `${origin}/model#flow`,
      label: "Create then update",
      actionType: `${S}CreateAction`,
      effect: "irreversible-write",
      inputs: [],
      provenance: operation.provenance,
      steps: [
        { operation: operation.id, bind: {} },
        { operation: later.id, bind: {} },
      ],
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) =>
      String(url).endsWith("/later")
        ? new Response(null, { status: 500 })
        : Response.json({ url: "/orders/42", number: "42" }),
    );
    const result = await createExecutor({
      model,
      sessions: new InMemorySessions(),
      fetch: async (url, init) =>
        String(url).endsWith("/quote")
          ? Response.json({ productID: "104", price: "18.50", currency: "GBP" })
          : fetch(url, init),
      gate: { authorize: async () => ({ kind: "allow" }) },
    }).execute(actionRequest("[] a schema:CreateAction."));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      status: "error",
      outcome: { status: "uncertain", target: "Create then update", effect: "irreversible-write" },
    });
    expect(result.outcome?.result).toBeUndefined();
    const receipt = result.observations[0]?.turtle ?? "";
    expect(receipt).toContain("sab:Uncertain");
    expect(receipt).not.toContain("sab:Completed");
    expect(receipt).not.toContain("schema:result");
    expect(result.observations[1]?.turtle).toContain("orders/42");
  });

  it("reports the exact authorized cumulative total across payment steps", async () => {
    const { model, operation } = fixture();
    operation.request.contentType = "application/x-www-form-urlencoded";
    delete operation.request.bodyTemplate;
    // This site's wire field is lexical: preserve precision beyond JSON numbers.
    const amount = operation.inputs.find((input) => input.name === "amount");
    if (!amount) throw new Error("Missing amount input");
    amount.range = `${xsd}string`;
    const audit: Operation = {
      ...operation,
      id: `${origin}/model#audit`,
      effect: "irreversible-write",
      inputs: [],
      request: { ...operation.request, bodyTemplate: "{}" },
    };
    model.operations.push(audit);
    model.flows.push({
      id: `${origin}/model#flow`,
      label: "Pay twice",
      actionType: `${S}BuyAction`,
      effect: "payment",
      inputs: [],
      provenance: operation.provenance,
      steps: [
        { operation: `${origin}/model#quote`, bind: {} },
        { operation: operation.id, bind: { amount: "0.1234567890123456789", currency: "GBP" } },
        { operation: `${origin}/model#total`, bind: {} },
        { operation: operation.id, bind: { amount: "0.2", currency: "GBP" } },
        { operation: audit.id, bind: {} },
      ],
    });
    const quote = model.operations.find((op) => op.id.endsWith("#quote"));
    if (!quote?.extraction) throw new Error("Missing quote extraction");
    model.operations.push({
      ...quote,
      id: `${origin}/model#total`,
      request: { method: "GET", urlTemplate: `${origin}/total` },
      extraction: { ...quote.extraction, itemType: `${S}Order` },
    });
    const result = await createExecutor({
      model,
      sessions: new InMemorySessions(),
      fetch: async (url) =>
        Response.json({
          productID: "104",
          price: String(url).endsWith("/quote") ? "0.1234567890123456789" : "0.2",
          currency: "GBP",
        }),
      gate: { authorize: async () => ({ kind: "allow" }) },
    }).execute(actionRequest("[] a schema:BuyAction."));
    expect(result.status, result.error).toBe("done");
    expect(result).toMatchObject({
      status: "done",
      outcome: {
        status: "completed",
        effect: "payment",
        amount: "0.3234567890123456789",
        currency: "GBP",
      },
    });
    const receipt = new Store(new Parser().parse(result.observations[0]?.turtle ?? ""));
    expect(receipt.getQuads(null, `${S}price`, null, null)[0]?.object).toMatchObject({
      value: "0.3234567890123456789",
      datatype: { value: `${xsd}decimal` },
    });
  });

  it.each([
    "https://attacker.test/orders/42",
    `${origin}/orders/42?token=private`,
    `${origin}/orders/private`,
  ])("does not promote unsafe or secret result identities: %s", async (url) => {
    const { model, operation } = fixture();
    operation.session = "signed-in";
    const sessions = new InMemorySessions();
    sessions.set(origin, undefined, {
      cookies: [
        {
          name: "sid",
          value: "private",
          domain: "shop.test",
          path: "/",
          secure: true,
          httpOnly: true,
          expires: -1,
          sameSite: "Lax",
        },
      ],
    });
    const result = await createExecutor({
      model,
      sessions,
      fetch: async (target) =>
        String(target).endsWith("/quote")
          ? Response.json({ productID: "104", price: "18.50", currency: "GBP" })
          : Response.json({ url, number: "42" }),
      gate: { authorize: async () => ({ kind: "allow" }) },
    }).execute(request());
    expect(result.status).toBe("done");
    expect(result.outcome?.result).toBeUndefined();
    const store = new Store(new Parser().parse(result.observations[0]?.turtle ?? ""));
    expect(store.getQuads(null, `${S}result`, null, null)).toHaveLength(0);
    expect(store.getQuads(null, `${rdf}type`, `${SAB}ActionOutcome`, null)).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("private");
  });
});
