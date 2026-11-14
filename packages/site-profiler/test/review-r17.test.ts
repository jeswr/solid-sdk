// AUTHORED-BY Claude Opus 5.5
// Round-17: one HTML control classifier for credential discovery, selector witnessing and form
// learning. type="HIDDEN", type="HiDdEn" and type="Password" follow HTML semantics. Fictional data.
import { expect, it } from "vitest";
import { parseForms } from "../src/forms.js";
import { parseHtml, selectAll } from "../src/html.js";
import { discoverCredentialSources, discoverSessionTokens } from "../src/session-tokens.js";
import { clusterRequests } from "../src/templates.js";
import type { RecordedRequest } from "../src/types.js";
import { learnDemonstratedForm } from "../src/write-learning.js";

const origin = "https://shop.test";
const url = `${origin}/account`;
const token = "Fictional0Hidden0Credential0Value";

it.each([
  "hidden",
  "HIDDEN",
  "HiDdEn",
])("discovers and redacts a type=%s credential source", (type) => {
  for (const html of [
    `<input type="${type}" name="csrf_token" value="${token}">`,
    `<input TYPE=${type} name="csrf_token" value="${token}">`,
  ]) {
    const result = discoverCredentialSources([{ url, html }], []);
    expect(result.secrets).toContain(token);
    expect(result.tokens.get(token)).toEqual({
      kind: "html",
      urlTemplate: url,
      selector: 'input[name="csrf_token"]',
      attribute: "value",
    });
    // A URL session token is learned once two requests carry the hidden value.
    const requests = [1, 2].map(
      (seq): RecordedRequest => ({
        seq,
        phase: "crawl",
        method: "GET",
        url: `${origin}/portal/${token}/items`,
        resourceType: "xhr",
        requestHeaders: {},
        cookieNames: [],
      }),
    );
    expect(discoverSessionTokens([{ url, html }], [], requests).get(token)).toMatchObject({
      kind: "html",
    });
  }
});

it.each(["password", "Password", "PASSWORD"])("registers a type=%s value as a secret", (type) => {
  const html = `<form><input type="${type}" name="pw" value="fictional-password-value"></form>`;
  expect(discoverCredentialSources([{ url, html }], []).secrets).toContain(
    "fictional-password-value",
  );
  const [form] = parseForms(html, url);
  expect(form?.hasPassword).toBe(true);
  expect(form?.fields[0]?.type).toBe("password");
});

it("keeps non-hidden, invalid and whitespace-padded types as visible text controls", () => {
  for (const type of ["text", "bogus", " hidden", "hıdden"]) {
    const html = `<input type="${type}" name="csrf_token" value="${token}">`;
    expect(discoverCredentialSources([{ url, html }], []).tokens.has(token)).toBe(false);
  }
  const [form] = parseForms(
    `<form method="post"><input type="bogus" name="a" value="1"><input name="b"><button type="BOGUS">Save</button><button type="Button">Other</button></form>`,
    url,
  );
  expect(form?.fields.map((f) => [f.name, f.type, f.hidden])).toEqual([
    ["a", "text", false],
    ["b", "text", false],
  ]);
  expect(form?.submitLabels).toEqual(["Save"]);
});

it.each([
  "HIDDEN",
  "HiDdEn",
])("parses a type=%s form control as a hidden field and CSRF source", (type) => {
  const [form] = parseForms(
    `<form method="post" action="/save"><input type="${type}" name="form_key" value="${token}"><input type="SUBMIT" value="Go"></form>`,
    url,
  );
  expect(form?.fields).toEqual([
    { name: "form_key", type: "hidden", required: false, hidden: true, value: token },
  ]);
  expect(form?.submitLabels).toEqual(["Go"]);
});

it.each([
  "hidden",
  "HIDDEN",
  "HiDdEn",
])("witnesses a credential selector against a type=%s control", (type) => {
  const html = `<input type="${type}" name="form_key" value="${token}">`;
  for (const selector of ['input[name="form_key"]', 'input[type="hidden"][name="form_key"]']) {
    const page = `${html}<script>window.config={formKeyInputSelector:${JSON.stringify(selector)}};</script>`;
    const result = discoverCredentialSources([{ url, html: page }], []);
    expect(result.secrets).toContain(token);
    // A witnessed locator is not itself a credential.
    expect(result.secrets).not.toContain(selector);
  }
  // Selector matching follows HTML: [type=...] values are ASCII-case-insensitive.
  expect(selectAll(parseHtml(html), 'input[type="hidden"]')).toHaveLength(1);
  expect(selectAll(parseHtml(html), 'input[type="HIDDEN"]')).toHaveLength(1);
  expect(selectAll(parseHtml('<input type="hıdden">'), 'input[type="hidden"]')).toHaveLength(0);
});

it.each([
  "HIDDEN",
  "HiDdEn",
])("learns a standalone type=%s token source for a demonstrated form", (type) => {
  const sample: RecordedRequest = {
    seq: 1,
    phase: "demonstration",
    demonstration: "own-product",
    method: "POST",
    url: `${origin}/products/save`,
    resourceType: "document",
    requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
    cookieNames: ["sid"],
    postData: "item%5Bname%5D=Example+Widget&form_key=%5Bredacted%5D",
    status: 302,
    redirectedTo: `${origin}/products/edit/id/42`,
  };
  const cluster = clusterRequests([sample], origin)[0];
  if (!cluster) throw new Error("Missing cluster");
  const learned = learnDemonstratedForm(cluster, [
    { url: `${origin}/products/new`, html: `<input type="${type}" name="form_key" value="x">` },
  ]);
  expect(learned.csrf).toContainEqual({
    source: {
      kind: "html",
      urlTemplate: `${origin}/products/new`,
      selector: 'input[name="form_key"]',
      attribute: "value",
    },
    target: { kind: "form", name: "form_key" },
  });
});
