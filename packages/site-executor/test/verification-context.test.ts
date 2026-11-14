// AUTHORED-BY Codex GPT-6
import { type Operation, SCHEMA } from "@jeswr/site-model";
import { expect, it } from "vitest";
import { compileOperation } from "../src/compile.js";
import { readOnlyScopeConstants, verificationScopeMatches } from "../src/verification-context.js";

const origin = "https://shop.test";
type Surface = "query" | "header" | "form" | "json";
function scoped(surface: Surface, name = "namespace", value = "main", input = false): Operation {
  const op: Operation = {
    id: `urn:${surface}`,
    label: "Scoped item",
    actionType: `${SCHEMA}UpdateAction`,
    effect: "irreversible-write",
    session: "signed-in",
    provenance: {
      method: "demonstration",
      learnedAt: "2026-11-14T00:00:00Z",
      confidence: 1,
      derivedFrom: [],
    },
    request: {
      method: surface === "form" || surface === "json" ? "POST" : "GET",
      urlTemplate: `${origin}/products`,
    },
    inputs: [],
  };
  const wire = input ? `{${name}}` : value;
  if (surface === "query") op.request.urlTemplate += input ? `{?${name}}` : `?${name}=${value}`;
  if (surface === "header") op.request.headers = input ? {} : { [name]: value };
  if (surface === "form") {
    op.request.contentType = "application/x-www-form-urlencoded";
    op.request.bodyTemplate = new URLSearchParams([[name, wire]]).toString();
  }
  if (surface === "json") {
    op.request.contentType = "application/json";
    op.request.bodyTemplate = JSON.stringify({ [name]: wire });
  }
  if (input)
    op.inputs.push({
      name,
      path: [],
      location: surface === "json" ? "body" : surface,
      range: "http://www.w3.org/2001/XMLSchema#string",
      required: true,
      default: value,
    });
  return op;
}
function matches(
  a: Operation,
  b: Operation,
  bind?: Record<string, { input: string } | { value: string }>,
) {
  const compile = (op: Operation) =>
    compileOperation(
      op,
      Object.fromEntries(op.inputs.map((p) => [p.name, p.default ?? "main"])),
      origin,
    );
  return verificationScopeMatches(compile(a), a, compile(b), b, [], bind);
}
const surfaces: [Surface, Surface][] = ["query", "header", "form", "json"].flatMap((a) =>
  ["query", "header"].map((b) => [a, b] as [Surface, Surface]),
);
it.each(surfaces)("compares constant scope from %s to %s", (left, right) => {
  expect(matches(scoped(left), scoped(right))).toBe(true);
  expect(matches(scoped(left), scoped(right, "namespace", "other"))).toBe(false);
  const a = scoped(left),
    b = scoped(right);
  expect(
    readOnlyScopeConstants(compileOperation(a, {}, origin), compileOperation(b, {}, origin), b),
  ).toEqual([]);
});
it.each(surfaces)("requires the same bound input across %s and %s", (left, right) => {
  expect(
    matches(scoped(left, "namespace", "main", true), scoped(right, "namespace", "main", true), {
      namespace: { input: "namespace" },
    }),
  ).toBe(true);
  expect(
    matches(scoped(left, "namespace", "main", true), scoped(right, "namespace", "main", true), {
      namespace: { input: "different" },
    }),
  ).toBe(false);
  expect(matches(scoped(left), scoped(right, "namespace", "main", true))).toBe(false);
  expect(matches(scoped(left, "namespace", "main", true), scoped(right))).toBe(false);
});
it("normalizes only case and one leading x-, with no scope synonym table", () => {
  expect(matches(scoped("form", "STORE-ID"), scoped("header", "X-Store-Id"))).toBe(true);
  expect(matches(scoped("header", "X-Store-Id"), scoped("query", "store-id"))).toBe(true);
  expect(matches(scoped("form", "store_id"), scoped("header", "X-Store-Id"))).toBe(false);
  expect(matches(scoped("query", "namespace"), scoped("header", "X-Workspace"))).toBe(false);
});
it.each([
  "form",
  "json",
] as const)("refuses conflicting scope on query and %s surfaces of one request", (surface) => {
  const a = scoped(surface),
    b = scoped("query");
  a.request.urlTemplate += "?namespace=other";
  expect(matches(a, b)).toBe(false);
  a.request.urlTemplate = a.request.urlTemplate.replace("other", "main");
  expect(matches(a, b)).toBe(true);
  b.request.headers = { "X-Namespace": "other" };
  expect(matches(a, b)).toBe(false);
});
it("retains the round-14 namespace=other and X-Store-Id read-only refusals", () => {
  const write = scoped("form");
  write.request.bodyTemplate = "";
  expect(matches(write, scoped("query", "namespace", "other"))).toBe(false);
  expect(matches(write, scoped("header", "X-Store-Id", "other"))).toBe(false);
});
it("compares header and body parameters by their bound input, even with different parameter names", () => {
  const write = scoped("form", "namespace", "main", true);
  const read = scoped("header", "X-Namespace", "main", true);
  expect(matches(write, read, { "X-Namespace": { input: "namespace" } })).toBe(true);
  expect(matches(write, read, { "X-Namespace": { value: "main" } })).toBe(false);
});
it.each([
  "form",
  "json",
] as const)("keeps nested domain properties separate from request scope controls in %s", (surface) => {
  const write = scoped(surface),
    read = scoped("query");
  write.request.bodyTemplate =
    surface === "json"
      ? JSON.stringify({
          namespace: "main",
          product: { stock_data: { website_id: 0 }, current_store_id: 0, website_ids: [1] },
        })
      : new URLSearchParams({
          namespace: "main",
          "product[stock_data][website_id]": "0",
          "product[current_store_id]": "0",
          "product[website_ids][1]": "1",
        }).toString();
  expect(matches(write, read)).toBe(true);
  write.request.bodyTemplate =
    surface === "json"
      ? JSON.stringify({ namespace: "main", tenant: { id: "other" } })
      : "namespace=main&tenant%5Bid%5D=other";
  expect(matches(write, read)).toBe(false);
});
