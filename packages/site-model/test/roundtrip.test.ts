// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { Parser } from "n3";
import { describe, expect, it } from "vitest";
import {
  canonicalSiteModel,
  type Operation,
  readSiteModel,
  type SiteModel,
  SiteModelError,
  validateSiteModel,
  writeSiteModel,
} from "../src/index.js";
import { M, model, S, search, X } from "./fixtures.js";

const roundTrip = async (m: SiteModel) => readSiteModel(await writeSiteModel(m));

const withOperation = (op: Operation): SiteModel => ({ ...model, operations: [op], flows: [] });

describe("writeSiteModel / readSiteModel round trip", () => {
  it("the fixture is structurally valid", () => {
    expect(validateSiteModel(model)).toEqual([]);
  });

  it("is lossless for a model that uses every contract field", async () => {
    expect(await roundTrip(model)).toEqual(model);
  });

  it("round-trips totalPath without changing optional extraction fields", async () => {
    const m = withOperation({
      ...search,
      extraction: {
        format: "json",
        itemPath: "/items",
        totalPath: "/totalRecords",
        itemType: `${S}Product`,
        fields: [],
      },
    });
    expect((await roundTrip(m)).operations[0]?.extraction?.totalPath).toBe("/totalRecords");
  });

  it("is a fixed point: writing what was read gives the same Turtle", async () => {
    const first = await writeSiteModel(model);
    const second = await writeSiteModel(readSiteModel(first));
    expect(second).toEqual(first);
    expect(await writeSiteModel(model)).toEqual(first);
  });

  it("writes prefixed Turtle with the model first and inline RDF lists", async () => {
    const ttl = await writeSiteModel(model);
    expect(ttl).toMatch(/^@prefix sab: <https:\/\/jeswr\.org\/ns\/site-action#>\./m);
    expect(ttl).toContain("@prefix schema: <https://schema.org/>.");
    const firstSubject = ttl.split("\n").find((line) => line.startsWith("<"));
    expect(firstSubject).toBe(`<${M}#model> a sab:SiteModel;`);
    expect(ttl).toContain('sab:option ("relevance" "price-asc" "price-desc")');
    expect(ttl).toContain("sab:valuePath (schema:object schema:additionalProperty)");
    expect(ttl).toContain("sab:valuePath schema:query");
    expect(ttl).toContain("sab:effect sab:Payment");
    expect(ttl).not.toContain("_:");
    expect(new Parser().parse(ttl).length).toBeGreaterThan(100);
  });

  const variants: [string, SiteModel][] = [
    [
      "no flows, no login, no optional fields",
      {
        id: "https://min.test/model",
        site: "https://min.test",
        version: "0.0.1",
        generatedAt: "2026-01-01T00:00:00.000Z",
        operations: [
          {
            id: "https://min.test/model/ops/home",
            actionType: `${S}ViewAction`,
            label: "Home",
            inputs: [],
            request: { method: "GET", urlTemplate: "https://min.test/" },
            session: "none",
            effect: "read",
            provenance: {
              derivedFrom: [],
              learnedAt: "2026-01-01T00:00:00.000Z",
              method: "fallback",
              confidence: 0,
            },
          },
        ],
        flows: [],
      },
    ],
    ["an empty model", { ...model, operations: [], flows: [], login: undefined }],
    [
      "empty options list kept distinct from no options",
      withOperation({
        ...search,
        inputs: [{ ...search.inputs[0], options: [] } as Operation["inputs"][number]],
      }),
    ],
    [
      "empty strings and multi-line text",
      withOperation({
        ...search,
        label: "",
        description: "line one\nline two\ttabbed",
        request: { ...search.request, bodyTemplate: "", headers: { "X-Empty": "" } },
      }),
    ],
    [
      "every effect, method and location",
      {
        ...model,
        flows: [],
        login: undefined,
        operations: (["read", "reversible-write", "irreversible-write", "payment"] as const).map(
          (effect, i) => ({
            ...search,
            id: `${M}#op${i}`,
            effect,
            request: {
              method: (["PUT", "PATCH", "DELETE", "POST"] as const)[i] as "PUT",
              urlTemplate: "https://shop.test/x",
            },
            inputs: (["path", "query", "body", "form", "header"] as const).map((location, j) => ({
              name: `p${j}`,
              path: [],
              range: `${X}string`,
              required: j % 2 === 0,
              location,
            })),
            extraction: undefined,
            provenance: {
              derivedFrom: [
                "https://shop.test/traces/1",
                "urn:uuid:aaaaaaaa-0000-4000-8000-000000000001",
              ],
              learnedAt: "2026-11-01T09:30:00.000Z",
              method: (["crawl", "form", "js-analysis", "manual"] as const)[i] as "crawl",
              confidence: [0, 0.25, 0.333, 1][i] as number,
              successes: 0,
              attempts: i,
            },
          }),
        ),
      },
    ],
    [
      "a flow step with no bindings",
      {
        ...model,
        flows: [
          {
            ...(model.flows[0] as SiteModel["flows"][number]),
            steps: [{ operation: `${M}#search`, bind: {} }],
          },
        ],
      },
    ],
    [
      "ids without fragments",
      {
        ...withOperation({ ...search, id: "https://shop.test/ops/search" }),
        id: "https://shop.test/model",
      },
    ],
  ];

  it.each(variants)("is lossless: %s", async (_name, variant) => {
    expect(await roundTrip(variant)).toEqual(canonicalSiteModel(variant));
  });
});

describe("canonical form", () => {
  it("normalises timestamps, set order and empty optional collections", async () => {
    const loose: SiteModel = {
      ...model,
      generatedAt: "2026-11-13T10:00:00Z",
      operations: [
        {
          ...search,
          request: { ...search.request, headers: {} },
          csrf: [],
          provenance: {
            ...search.provenance,
            derivedFrom: ["urn:b", "urn:a"],
            learnedAt: "2026-11-01T10:30:00+01:00",
            lastVerified: "2026-11-12T08:00:00Z",
          },
        },
      ],
      flows: [],
      login: [{ method: "password", operation: `${M}#search`, sessionCookies: ["z", "a"] }],
    };
    const back = await roundTrip(loose);
    expect(back.generatedAt).toBe("2026-11-13T10:00:00.000Z");
    const op = back.operations[0] as Operation;
    expect(op.request.headers).toBeUndefined();
    expect(op.csrf).toBeUndefined();
    expect(op.provenance.derivedFrom).toEqual(["urn:a", "urn:b"]);
    expect(op.provenance.learnedAt).toBe("2026-11-01T09:30:00.000Z");
    expect(op.provenance.lastVerified).toBe("2026-11-12T08:00:00.000Z");
    expect(back.login?.[0]?.sessionCookies).toEqual(["a", "z"]);
    expect(back).toEqual(canonicalSiteModel(loose));
    expect((await roundTrip({ ...model, login: [] })).login).toBeUndefined();
  });
});

describe("writeSiteModel refuses what it cannot write losslessly", () => {
  const cases: [string, SiteModel, RegExp][] = [
    [
      "a control character",
      withOperation({ ...search, label: "Search\u0007" }),
      /operations\[0\]\.label/,
    ],
    [
      "an unparsable timestamp",
      { ...model, generatedAt: "yesterday" },
      /generatedAt is not an ISO 8601/,
    ],
    [
      "a bad lastVerified",
      withOperation({ ...search, provenance: { ...search.provenance, lastVerified: "nope" } }),
      /lastVerified/,
    ],
    [
      "a relative operation id",
      withOperation({ ...search, id: "search" }),
      /cannot write Operation <search>/,
    ],
    [
      "a relative range",
      withOperation({
        ...search,
        inputs: [{ ...(search.inputs[0] as Operation["inputs"][number]), range: "string" }],
      }),
      /cannot write/,
    ],
    [
      "a confidence above 1",
      withOperation({ ...search, provenance: { ...search.provenance, confidence: 1.5 } }),
      /cannot write/,
    ],
    [
      "a negative attempt count",
      withOperation({ ...search, provenance: { ...search.provenance, attempts: -1 } }),
      /attempts/,
    ],
    [
      "a non-IRI path step",
      withOperation({
        ...search,
        inputs: [{ ...(search.inputs[0] as Operation["inputs"][number]), path: ["query"] }],
      }),
      /path step "query"/,
    ],
    ["duplicate ids", { ...model, operations: [search, search], flows: [] }, /share the IRI/],
    [
      "an unknown method",
      withOperation({ ...search, request: { ...search.request, method: "TRACE" as "GET" } }),
      /request/,
    ],
  ];
  it.each(cases)("%s", async (_name, bad, message) => {
    const attempt = writeSiteModel(bad);
    await expect(attempt).rejects.toBeInstanceOf(SiteModelError);
    await expect(writeSiteModel(bad)).rejects.toThrow(message);
  });
});
