// AUTHORED-BY Codex GPT-6.1-Sol
import type { Operation, SiteModel } from "@jeswr/site-model";
import { expect, it, vi } from "vitest";
import { compileOperation } from "../src/compile.js";
import { InMemorySessions } from "../src/cookies.js";
import { createExecutor, type ExecutorOptions } from "../src/executor.js";
import { createApprovalGate } from "../src/gate.js";
import { actionRequest } from "./helpers.js";

const origin = "https://forum.test";
const op: Operation = {
  id: "urn:m#comment",
  label: "Comment on discussion",
  actionType: "https://schema.org/CommentAction",
  effect: "irreversible-write",
  session: "none",
  inputs: [
    {
      name: "id",
      path: ["https://schema.org/object", "https://schema.org/identifier"],
      range: "http://www.w3.org/2001/XMLSchema#string",
      location: "path",
      required: true,
    },
    {
      name: "text",
      path: ["https://schema.org/text"],
      range: "http://www.w3.org/2001/XMLSchema#string",
      location: "form",
      required: true,
    },
  ],
  request: {
    method: "POST",
    urlTemplate: `${origin}/topics/{id}/comment`,
    contentType: "application/x-www-form-urlencoded",
    bodyTemplate: "reply_%7Bid%7D%5Btext%5D=%7Btext%7D",
  },
  csrf: [
    {
      source: {
        kind: "html",
        urlTemplate: `${origin}/topics/{id}`,
        selector: 'form input[name="reply_{id}[_token]"]',
        attribute: "value",
      },
      target: { kind: "form", name: "reply_{id}[_token]" },
    },
  ],
  provenance: {
    derivedFrom: [],
    learnedAt: "2026-11-13T10:00:00Z",
    method: "demonstration",
    confidence: 0.9,
  },
};
const model: SiteModel = {
  id: "urn:m",
  site: origin,
  version: "1",
  generatedAt: "2026-11-13T10:00:00Z",
  operations: [op],
  flows: [],
};
it("binds numeric field names, token selectors and approvals before sending one write; denial sends nothing", async () => {
  const transport = vi.fn<NonNullable<ExecutorOptions["fetch"]>>(async (input, init) => {
    const r = new Request(input, init);
    if (r.method === "GET")
      return new Response(
        '<form><input name="reply_42[_token]" value="fixture-long-token"></form>',
      );
    expect([...new URLSearchParams(await r.text())]).toEqual([
      ["reply_42[text]", "Hello & goodbye"],
      ["reply_42[_token]", "fixture-long-token"],
    ]);
    return new Response("ok");
  });
  const gate = createApprovalGate(),
    executor = createExecutor({ model, sessions: new InMemorySessions(), gate, fetch: transport });
  const request = actionRequest(
    '[] a schema:CommentAction; schema:object [schema:identifier "42"]; schema:text "Hello & goodbye".',
  );
  const first = await executor.execute(request);
  expect(first.status).toBe("needs-approval");
  expect(transport).not.toHaveBeenCalled();
  if (!first.approval) throw new Error("missing approval");
  gate.reject(first.approval.id);
  expect((await executor.execute(request, { approvalId: first.approval.id })).status).toBe(
    "denied",
  );
  expect(transport).not.toHaveBeenCalled();
  const second = await executor.execute(request);
  if (!second.approval) throw new Error("missing approval");
  gate.approve(second.approval.id);
  const result = await executor.execute(request, { approvalId: second.approval.id });
  expect(result.status).toBe("done");
  expect(result.committed).toHaveLength(1);
  expect(transport).toHaveBeenCalledTimes(2);
  const repeat = await executor.execute(request, {
    excludeFingerprints: result.committed.map((c) => c.fingerprint),
  });
  expect(repeat.errorKind).toBe("repeat");
  expect(transport).toHaveBeenCalledTimes(2);
});
it.each([
  "42][admin]",
  '42"], input[name="secret',
  "42&extra=yes",
  "%34%32",
  "../42",
  "-42",
  "42.0",
  "",
])("rejects syntax in a numeric identity name slot: %s", (id) => {
  expect(() => compileOperation(op, { id, text: "Hello" }, origin)).toThrow();
});
it("rejects missing or undeclared name slots, while leaving form values structural", () => {
  expect(() =>
    compileOperation(
      { ...op, request: { ...op.request, bodyTemplate: "reply_%7Bmissing%7D=x" } },
      { id: "42", text: "Hello" },
      origin,
    ),
  ).toThrow(/numeric/);
  expect(compileOperation(op, { id: "42", text: "x&role=admin" }, origin).body).toMatchObject({
    fields: [["reply_42[text]", "x&role=admin"]],
  });
});

it("accepts a witnessed context slug in CSRF selectors and refuses CSS syntax before the gate", () => {
  const scoped: Operation = {
    ...op,
    inputs: [
      ...op.inputs,
      {
        name: "group",
        path: ["https://schema.org/isPartOf"],
        range: "http://www.w3.org/2001/XMLSchema#string",
        location: "path",
        required: true,
      },
    ],
    request: { ...op.request, urlTemplate: `${origin}/groups/{group}/topics/{id}/comment` },
    csrf: [
      {
        source: {
          kind: "html",
          urlTemplate: `${origin}/groups/{group}/topics/{id}`,
          selector:
            'form[action="/groups/{group}/topics/{id}/comment"] input[name="reply_{id}[_token]"]',
          attribute: "value",
        },
        target: { kind: "form", name: "reply_{id}[_token]" },
      },
    ],
  };
  expect(
    compileOperation(scoped, { id: "42", group: "Example_group", text: "Hi" }, origin).csrf[0]
      ?.source,
  ).toMatchObject({
    selector:
      'form[action="/groups/Example_group/topics/42/comment"] input[name="reply_42[_token]"]',
  });
  for (const group of ['x"] input[name="secret', "x,y", "x y", "x\\ny", "%22", ""])
    expect(() => compileOperation(scoped, { id: "42", group, text: "Hi" }, origin)).toThrow();
});

it("retains response-bound names in a dry flow plan and validates them again at execution", () => {
  const values = { id: "$step0.identifier", text: "Hi" };
  expect(() =>
    compileOperation(op, values, origin, { placeholders: new Set(["id"]) }),
  ).not.toThrow();
  expect(() => compileOperation(op, values, origin)).toThrow();
});
