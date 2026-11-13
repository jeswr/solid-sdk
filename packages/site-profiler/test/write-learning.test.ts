// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it } from "vitest";
import { formFields } from "../src/form-body.js";
import { parseForms } from "../src/forms.js";
import { heuristicLabeller } from "../src/labeller.js";
import { buildOperation } from "../src/operations.js";
import { redactBody } from "../src/recorder.js";
import {
  candidateFromForm,
  clusterRequests,
  matchRequest,
  mergeCandidates,
} from "../src/templates.js";
import type { RecordedRequest } from "../src/types.js";
import { learnDemonstratedForm } from "../src/write-learning.js";

const origin = "https://shop.test";
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}
const request = (extra: Partial<RecordedRequest> = {}): RecordedRequest => ({
  seq: 1,
  phase: "demonstration",
  demonstration: "own-product",
  method: "POST",
  url: `${origin}/products/save`,
  resourceType: "document",
  requestHeaders: {
    "content-type": "application/x-www-form-urlencoded",
    referer: `${origin}/products/new`,
  },
  cookieNames: ["sid", "antiForgery"],
  bodyFromCookies: { form_key: "antiForgery" },
  postData: new URLSearchParams({
    "item[name]": "Example Widget",
    "item[sku]": "EX-42",
    "item[price]": "12.34",
    "item[stock][qty]": "5",
    "item[visibility]": "4",
    form_key: "[redacted]",
  }).toString(),
  status: 302,
  redirectedTo: `${origin}/products/edit/id/42`,
  ...extra,
});
it("decodes and redacts multipart text fields; refuses file uploads and malformed bodies", () => {
  const type = 'multipart/form-data; boundary="example-boundary"';
  const body =
    '--example-boundary\r\nContent-Disposition: form-data; name="name"\r\n\r\nExample\r\n--example-boundary\r\nContent-Disposition: form-data; name="form_key"\r\n\r\nsecret-token\r\n--example-boundary--\r\n';
  expect(formFields(body, type)).toEqual([
    ["name", "Example"],
    ["form_key", "secret-token"],
  ]);
  expect(redactBody(body, type)).not.toContain("secret-token");
  expect(
    formFields(body.replace('name="name"', 'name="name"; filename="private.txt"'), type),
  ).toBeUndefined();
  expect(redactBody("private-data", type)).toBe("[omitted: unsupported multipart]");
  expect(formFields(body, "multipart/form-data")).toBeUndefined();
});
it("learns semantic inputs and only witnessed fixed values, preferring cookie CSRF", async () => {
  const r = request();
  const c = learnDemonstratedForm(required(clusterRequests([r], origin)[0]));
  expect(c.params.map((p) => p.name)).toEqual(["name", "sku", "price", "quantity"]);
  expect(new URLSearchParams(c.bodyTemplate).get("item[visibility]")).toBe("4");
  expect(c.bodyTemplate).not.toContain("form_key");
  expect(c.csrf).toContainEqual({
    source: { kind: "cookie", name: "antiForgery" },
    target: { kind: "form", name: "form_key" },
  });
  const op = buildOperation(c, await heuristicLabeller.label(c), {
    modelId: "urn:model",
    learnedAt: "now",
    derivedFrom: [],
    method: "demonstration",
    usedIds: new Set(),
    sessionCookies: ["sid"],
  });
  expect(op.effect).toBe("irreversible-write");
  expect(op.inputs.find((p) => p.name === "quantity")?.path).toEqual([
    "https://schema.org/object",
    "https://schema.org/inventoryLevel",
  ]);
  expect(op.inputs.find((p) => p.name === "price")).toMatchObject({
    path: ["https://schema.org/object", "https://schema.org/price"],
    required: true,
  });
  expect(matchRequest(c, r)).toMatchObject({
    name: "Example Widget",
    price: "12.34",
    quantity: "5",
  });
});
it("does not learn writes from incomplete bodies", () => {
  expect(clusterRequests([request({ postDataTruncated: true })], origin)).toEqual([]);
  expect(clusterRequests([request({ postDataUnsupported: true })], origin)).toEqual([]);
});
it("classifies demonstrated POST edits and deletes conservatively", async () => {
  for (const [path, action] of [
    ["/products/save/id/42", "UpdateAction"],
    ["/products/delete/id/42", "DeleteAction"],
  ]) {
    const c = required(clusterRequests([request({ url: origin + path })], origin)[0]);
    expect(await heuristicLabeller.label(c)).toMatchObject({
      actionType: `https://schema.org/${action}`,
      effect: "irreversible-write",
    });
  }
});

it("binds one selected array member as an item identity, never a demonstrated constant", () => {
  const r = request({
    url: `${origin}/products/massDelete`,
    postData: "selected%5B0%5D=42&form_key=%5Bredacted%5D&namespace=products",
  });
  const c = learnDemonstratedForm(required(clusterRequests([r], origin)[0]));
  expect(c.params.map((p) => p.name)).toEqual(["id"]);
  expect(new URLSearchParams(c.bodyTemplate).get("selected[0]")).toBe("{id}");
  expect(matchRequest(c, r)?.id).toBe("42");
});
it("uses a witnessed hidden source when no token cookie is available", () => {
  const r = request({ bodyFromCookies: undefined });
  const c = learnDemonstratedForm(required(clusterRequests([r], origin)[0]), [
    {
      url: `${origin}/products`,
      html: '<input type="hidden" name="form_key" value="example-form-token">',
    },
  ]);
  expect(c.csrf).toContainEqual({
    source: {
      kind: "html",
      urlTemplate: `${origin}/products`,
      selector: 'input[name="form_key"]',
      attribute: "value",
    },
    target: { kind: "form", name: "form_key" },
  });
});

it("keeps a demonstrated destructive search filter dynamic even when its value looks opaque", () => {
  const r = request({
    url: `${origin}/products/massDelete`,
    postData:
      "excluded=false&filters%5Bplaceholder%5D=true&search=sab-unique-example-12345&namespace=products&form_key=%5Bredacted%5D",
  });
  const c = learnDemonstratedForm(required(clusterRequests([r], origin)[0]));
  expect(c.params.map((p) => p.name)).toEqual(["search"]);
  expect(new URLSearchParams(c.bodyTemplate).get("search")).toBe("{search}");
  expect(c.params[0]?.required).toBe(true);
});

it("reports script-only CSRF instead of learning a redacted constant or inventing a source kind", () => {
  const c = learnDemonstratedForm(
    required(clusterRequests([request({ bodyFromCookies: undefined })], origin)[0]),
    [{ url: `${origin}/products`, html: '<script>var form_key="example-token-value"</script>' }],
  );
  expect(c.unsupported).toContain("CSRF source unavailable");
});

it("keeps a login page source to bootstrap cookies in a fresh host session", () => {
  const r = request({
    phase: "login",
    url: `${origin}/login`,
    postData: "username=example&password=%5Bredacted%5D&csrf_token=%5Bredacted%5D",
    bodyFromCookies: { csrf_token: "antiForgery" },
  });
  const form = required(
    parseForms(
      '<form id="login" method="POST"><input name="username"><input name="password" type="password"><input type="hidden" name="csrf_token" value="example-token"></form>',
      `${origin}/login`,
    )[0],
  );
  const c = required(
    mergeCandidates([
      ...clusterRequests([r], origin),
      candidateFromForm(form, `${origin}/login`),
    ])[0],
  );
  expect(c.csrf[0]?.source.kind).toBe("html");
});

it("preserves independently learned URL session decoration when scoping a demonstrated form token", () => {
  const r = request();
  const c = required(clusterRequests([r], origin)[0]);
  const decoration = {
    source: {
      kind: "html" as const,
      urlTemplate: `${origin}/account`,
      selector: 'input[name="ticket"]',
      attribute: "value",
    },
    target: { kind: "query" as const, name: "sessionPath" },
  };
  c.csrf.push(decoration);
  const learned = learnDemonstratedForm(c, [
    {
      url: `${origin}/products/new`,
      html: `<form action="/products/save" method="post"><input type="hidden" name="form_key" value="fixture-form-token"></form>`,
    },
  ]);
  expect(learned.csrf).toContainEqual(decoration);
});
