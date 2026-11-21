// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import {
  type Flow,
  type Operation,
  type SiteModel,
  templateVariables,
  validateSiteModel,
} from "../src/index.js";
import { addToCart, checkout, M, model, S, search, viewProduct, X } from "./fixtures.js";

const buy = model.flows[0] as Flow;
const problems = (m: SiteModel) => validateSiteModel(m).map((p) => `${p.path}: ${p.message}`);
const withOps = (...operations: Operation[]): SiteModel => ({
  ...model,
  operations,
  flows: [],
  login: undefined,
});

describe("validateSiteModel", () => {
  it("accepts the fixture", () => {
    expect(problems(model)).toEqual([]);
  });

  it("flags duplicate and relative ids", () => {
    expect(
      problems({
        ...withOps(search, { ...search }),
        flows: [{ ...buy, id: search.id, steps: [{ operation: search.id, bind: {} }] }],
      }),
    ).toEqual([
      `operations[1].id: duplicate id <${search.id}>`,
      `flows[0].id: duplicate id <${search.id}>`,
    ]);
    expect(problems({ ...withOps({ ...search, id: "search" }), id: "model" })).toEqual([
      "$.id: id must be an absolute IRI",
      "operations[0].id: id must be an absolute IRI",
    ]);
  });

  it("flags flow steps, binds and effects that do not line up", () => {
    const flow: Flow = {
      ...buy,
      effect: "reversible-write",
      steps: [
        {
          operation: addToCart.id,
          bind: { sku: "$input.nope", colour: "red", quantity: "$step0.https://schema.org/x" },
        },
        { operation: `${M}#missing`, bind: { cart: "$step1.https://schema.org/orderNumber" } },
        { operation: checkout.id, bind: { cart: "$step0.orderNumber" } },
      ],
    };
    expect(problems({ ...model, flows: [flow] })).toEqual([
      `flows[0].steps[0].bind.colour: "colour" is not a parameter of <${addToCart.id}>`,
      'flows[0].steps[0].bind.sku: "nope" is not an input of the flow',
      "flows[0].steps[0].bind.quantity: $step0.https://schema.org/x does not refer to an earlier step",
      `flows[0].steps[1].operation: <${M}#missing> is not an operation of this model`,
      "flows[0].steps[1].bind.cart: $step1.https://schema.org/orderNumber does not refer to an earlier step",
      "flows[0].steps[2].bind.cart: $step0.orderNumber must end in a property IRI",
      "flows[0].effect: effect reversible-write is weaker than its strongest step (payment)",
    ]);
    expect(problems({ ...model, flows: [{ ...buy, steps: [] }] })).toEqual([
      "flows[0].steps: a flow needs at least one step",
    ]);
  });

  it("flags templates and placeholders using undeclared variables", () => {
    const op: Operation = {
      ...search,
      request: {
        ...search.request,
        urlTemplate: "https://shop.test/api/{+base}/search{?q,limit*,sort:3}",
        bodyTemplate: '{"q": {q}, "n": {count}, "raw": {"a": 1}}',
      },
    };
    expect(problems(withOps(op))).toEqual([
      'operations[0].request.urlTemplate: template variable "base" is not a declared parameter',
      'operations[0].request.urlTemplate: template variable "limit" is not a declared parameter',
      'operations[0].request.bodyTemplate: placeholder "{count}" is not a declared parameter',
    ]);
    expect(
      problems(
        withOps({
          ...viewProduct,
          request: { method: "GET", urlTemplate: "https://shop.test/p/latest" },
        }),
      ),
    ).toEqual([
      'operations[0].inputs[0]: path parameter "slug" does not appear in the URL template',
    ]);
    expect(
      problems(
        withOps({ ...search, request: { method: "GET", urlTemplate: "https://shop.test/{q" } }),
      ),
    ).toContain("operations[0].request.urlTemplate: malformed URL template: unclosed '{'");
  });

  it("checks CSRF source templates, idField and confidence", () => {
    const op: Operation = {
      ...checkout,
      csrf: [
        {
          source: {
            kind: "json",
            urlTemplate: "https://shop.test/{tenant}/session",
            pointer: "/t",
          },
          target: { kind: "header", name: "X" },
        },
      ],
      extraction: {
        format: "json",
        itemType: `${S}Order`,
        idField: `${S}url`,
        fields: [{ property: `${S}name`, path: "/n" }],
      },
      provenance: { ...checkout.provenance, confidence: 1.2 },
    };
    expect(problems(withOps(op))).toEqual([
      'operations[0].csrf[0].source.urlTemplate: template variable "tenant" is not a declared parameter',
      `operations[0].extraction.idField: idField <${S}url> is not the property of a field rule`,
      "operations[0].provenance.confidence: confidence must be within 0..1",
    ]);
  });

  it("checks parameters", () => {
    const op: Operation = {
      ...search,
      inputs: [
        { name: "q", path: ["query"], range: "string", required: true, location: "query" },
        {
          name: "q",
          path: [],
          range: `${X}string`,
          required: false,
          location: "query",
          options: ["a"],
          default: "b",
        },
      ],
      request: { method: "GET", urlTemplate: "https://shop.test/api/search{?q}" },
    };
    expect(problems(withOps(op))).toEqual([
      "operations[0].inputs[0].range: range must be an absolute IRI",
      "operations[0].inputs[0].path[0]: path steps must be absolute IRIs",
      'operations[0].inputs[1]: duplicate parameter name "q"',
      'operations[0].inputs[1].default: default "b" is not one of the options',
    ]);
  });

  it("checks login routes", () => {
    expect(
      problems({
        ...model,
        login: [{ method: "password" }, { method: "sso:google", operation: `${M}#nope` }],
      }),
    ).toEqual([
      "login[0].operation: a password login route needs its form operation",
      `login[1].operation: <${M}#nope> is not an operation of this model`,
    ]);
  });
});

describe("templateVariables", () => {
  it.each([
    [
      "https://a.test/{x}/{+y}{#z}{.e}{/p*}{;m}{?q,r}{&s:10}",
      ["x", "y", "z", "e", "p", "m", "q", "r", "s"],
    ],
    ["https://a.test/plain", []],
    ["https://a.test/{a.b}{pct%20}", ["a.b", "pct%20"]],
  ])("%s", (template, variables) => {
    expect(templateVariables(template)).toEqual({ variables });
  });

  it.each([
    ["https://a.test/}", "unmatched '}'"],
    ["https://a.test/{a}}", "unmatched '}'"],
    ["https://a.test/{", "unclosed '{'"],
    ["https://a.test/{a b}", 'invalid expression "{a b}"'],
    ["https://a.test/{}", 'invalid expression "{}"'],
  ])("rejects %s", (template, error) => {
    expect(templateVariables(template).error).toBe(error);
  });
});

describe("reserved CSRF path slots", () => {
  const tokenOperation = (suffix = "/key/{sessionPath}"): Operation => ({
    ...search,
    inputs: [],
    request: { method: "GET", urlTemplate: `https://shop.test${suffix}` },
    csrf: [
      { source: { kind: "cookie", name: "sid" }, target: { kind: "query", name: "sessionPath" } },
    ],
  });
  it("accepts one otherwise-unbound whole path segment named by a query CSRF rule", () => {
    expect(problems(withOps(tokenOperation()))).toEqual([]);
  });
  it.each([
    "/key/prefix{sessionPath}",
    "/key/{+sessionPath}",
    "/key/{sessionPath:3}",
    "/key/{sessionPath}/{sessionPath}",
    "/key/{sessionPath}{?sessionPath}",
    "/key{?sessionPath}",
  ])("keeps rejecting an undeclared non-slot variable in %s", (path) => {
    expect(problems(withOps(tokenOperation(path))).join(" ")).toContain("not a declared parameter");
  });
  it("does not reserve an undeclared authority variable as a path token", () => {
    const op = tokenOperation();
    op.request.urlTemplate = "https://{sessionPath}/items";
    expect(problems(withOps(op)).join(" ")).toContain("not a declared parameter");
  });
  it("does not declare other endpoint, body or CSRF source variables", () => {
    const op = tokenOperation("/key/{sessionPath}/{other}");
    op.request.bodyTemplate = '{"value":"{sessionPath}"}';
    op.csrf?.push({
      source: { kind: "json", urlTemplate: "https://shop.test/{sessionPath}", pointer: "/token" },
      target: { kind: "form", name: "token" },
    });
    const result = problems(withOps(op));
    expect(result).toHaveLength(3);
    expect(result.join(" ")).toContain('template variable "other"');
    expect(result.join(" ")).toContain('placeholder "{sessionPath}"');
    expect(result.join(" ")).toContain("csrf[1].source.urlTemplate");
  });
  it("does not reserve a slot for a header rule, missing rule or duplicate query rules", () => {
    for (const kind of ["header", "missing", "duplicate"] as const) {
      const op = tokenOperation();
      if (kind === "header")
        op.csrf = [
          {
            source: { kind: "cookie", name: "sid" },
            target: { kind: "header", name: "sessionPath" },
          },
        ];
      else if (kind === "missing") op.csrf = [];
      else if (op.csrf?.[0]) op.csrf.push(op.csrf[0]);
      expect(problems(withOps(op)).join(" ")).toContain("not a declared parameter");
    }
  });
});

// AUTHORED-BY Codex GPT-6.1-Sol
it.each([
  "Cache-Control",
  "pRaGmA",
])("reserves verification freshness header %s on every model surface", (name) => {
  for (const route of ["static", "parameter", "csrf"] as const) {
    const op = structuredClone(search);
    if (route === "static") op.request.headers = { [name]: "max-age=3600" };
    if (route === "parameter")
      op.inputs.push({ name, path: [], range: `${X}string`, required: false, location: "header" });
    if (route === "csrf")
      op.csrf = [{ source: { kind: "cookie", name: "token" }, target: { kind: "header", name } }];
    expect(problems(withOps(op)).some((message) => message.includes("executor-owned"))).toBe(true);
  }
});
