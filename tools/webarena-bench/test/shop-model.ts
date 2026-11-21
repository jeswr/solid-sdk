// AUTHORED-BY Claude Opus 5.5
// Fixed model fixture for test-shop's generic search/add/remove interaction, independent of tasks.
import type { Operation, SiteModel } from "@jeswr/site-model";
import { DataFactory, Writer } from "n3";

const schema = "https://schema.org/";
const xsd = "http://www.w3.org/2001/XMLSchema#";
export const login = { username: "alex@example.test", password: "correct-horse" };
export function shopModel(origin: string): SiteModel {
  const provenance = {
    derivedFrom: ["urn:fixture:generic-shop-recording"],
    learnedAt: "2026-01-01T00:00:00.000Z",
    method: "demonstration" as const,
    confidence: 1,
  };
  const operation = (
    name: string,
    action: string,
    method: Operation["request"]["method"],
    path: string,
  ): Operation => ({
    id: `urn:fixture:shop:${encodeURIComponent(name)}`,
    actionType: schema + action,
    label: name,
    inputs: [],
    request: { method, urlTemplate: origin + path },
    effect: method === "GET" ? "read" : "reversible-write",
    session: "signed-in",
    provenance,
  });
  const signIn = operation("login", "LoginAction", "POST", "/login");
  signIn.session = "none";
  signIn.inputs = ["username", "password"].map((name) => ({
    name,
    path: [],
    range: `${xsd}string`,
    required: true,
    location: "form",
  }));
  signIn.request.contentType = "application/x-www-form-urlencoded";
  signIn.csrf = [
    {
      source: {
        kind: "html",
        urlTemplate: `${origin}/login`,
        selector: 'input[name="csrf_token"]',
        attribute: "value",
      },
      target: { kind: "form", name: "csrf_token" },
    },
  ];
  const search = operation("Search products", "SearchAction", "GET", "/api/search{?q}");
  search.inputs = [
    {
      name: "q",
      path: [`${schema}query`],
      range: `${xsd}string`,
      required: true,
      location: "query",
    },
  ];
  search.extraction = {
    format: "json",
    itemPath: "/items",
    itemType: `${schema}Product`,
    idField: `${schema}url`,
    fields: [
      { property: `${schema}url`, path: "/url", datatype: "iri" },
      { property: `${schema}name`, path: "/name" },
      { property: `${schema}sku`, path: "/sku" },
    ],
  };
  const add = operation("Add to basket", "AddToCartAction", "POST", "/api/cart/items");
  add.inputs = [
    {
      name: "sku",
      path: [`${schema}object`, `${schema}sku`],
      range: `${xsd}string`,
      required: true,
      location: "body",
    },
  ];
  add.request.contentType = "application/json";
  add.request.bodyTemplate = '{"sku":"{sku}","qty":1}';
  add.csrf = [
    { source: { kind: "cookie", name: "csrf" }, target: { kind: "header", name: "X-CSRF-Token" } },
  ];
  const remove = operation("Remove from basket", "DeleteAction", "DELETE", "/api/cart/items/{sku}");
  remove.inputs = add.inputs.map((p) => ({ ...p, location: "path" }));
  remove.csrf = add.csrf;
  return {
    id: "urn:fixture:shop",
    site: origin,
    version: "0.1.0",
    generatedAt: provenance.learnedAt,
    operations: [signIn, search, add, remove],
    flows: [],
    login: [
      {
        method: "password",
        operation: signIn.id,
        sessionCookies: ["sid"],
        probeUrl: `${origin}/account`,
      },
    ],
  };
}

export async function action(type: string, sku?: string): Promise<string> {
  const { blankNode, namedNode, literal } = DataFactory;
  const node = blankNode("action");
  const object = blankNode("object");
  const writer = new Writer();
  writer.addQuad(
    node,
    namedNode("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"),
    namedNode(schema + type),
  );
  if (sku) {
    writer.addQuad(node, namedNode(`${schema}object`), object);
    writer.addQuad(object, namedNode(`${schema}sku`), literal(sku));
  } else writer.addQuad(node, namedNode(`${schema}query`), literal("trail"));
  return new Promise((resolve, reject) =>
    writer.end((error, text) => (error ? reject(error) : resolve(text))),
  );
}
