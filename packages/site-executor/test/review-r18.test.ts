// AUTHORED-BY Claude Opus 5.5
// Round-18 regressions: element-less HTML not-found documents, wider authentication markers in
// the not-found context, and the session liveness signature. Fixtures are fictional.
import type { Extraction } from "@jeswr/site-model";
import { SCHEMA } from "@jeswr/site-model";
import { expect, it } from "vitest";
import { livenessSignature } from "../src/liveness.js";
import {
  authenticationText,
  isDiscriminatorKey,
  notFoundSignature,
  responsePageError,
} from "../src/response-evidence.js";
import { validateWriteResponsePolicy } from "../src/write-response.js";

const html = (body: string, contentType = "text/html; charset=utf-8") =>
  notFoundSignature(404, contentType, body);

it.each([
  ["Not Found", "Forbidden"],
  ["Not Found", "not_authenticated"],
  ["Not Found", "Unauthorized"],
  ["", "Forbidden"],
  ["", "401 Unauthorized"],
  ["<!DOCTYPE html>Not Found", "<!DOCTYPE html>Login required"],
  ["<!-- fictional -->Not Found", "<!-- fictional -->Please log in"],
])("an element-less HTML 404 %j is a scalar text document; %j never matches", (learned, runtime) => {
  const honest = html(learned);
  expect(honest).toBeDefined();
  expect(html(learned)).toEqual(honest);
  expect(html(runtime)).toBeUndefined();
});

it("keeps the exact normalised text of an element-less HTML document", () => {
  const honest = html("Not Found");
  expect(html("  Not \n Found ")?.structure).toBe(honest?.structure);
  expect(html("<!DOCTYPE html>Not Found")?.structure).toBe(honest?.structure);
  for (const other of ["Not found", "Gone", "", "No such widget"])
    expect(html(other)?.structure).not.toBe(honest?.structure);
  expect(html("")?.structure).not.toBe(html(" Nothing here ")?.structure);
  // An element-less body is not the structure of an empty element document.
  expect(html("<p></p>")?.structure).not.toBe(html("")?.structure);
  // Text beside top-level elements keeps its value too.
  expect(html("<p>Missing</p>Not Found")?.structure).not.toBe(
    html("<p>Missing</p>Gone away")?.structure,
  );
  expect(html("<p>Missing</p>Please log in")).toBeUndefined();
});

it.each([
  [
    "application/problem+json",
    { type: "about:blank", title: "Not Found", status: 404 },
    { type: "about:blank", title: "Forbidden", status: 404 },
  ],
  [
    "application/json",
    { detail: "Not found." },
    { detail: "Authentication credentials were not provided." },
  ],
  [
    "application/json",
    { detail: "Not found." },
    { detail: "You do not have permission to perform this action." },
  ],
  ["application/json", { message: "Not found" }, { message: "Access denied" }],
  ["application/json", { title: "Not Found" }, { title: "Unauthorized" }],
  ["application/json", { err: "not_found" }, { err: "not_authenticated" }],
  ["application/json", { message: "Not found" }, { message: "Session expired" }],
  [
    "application/json",
    { error_description: "no such item" },
    { error_description: "login required" },
  ],
  ["application/json", { msg: "No such widget" }, { msg: "Please log in" }],
  [
    "application/json",
    { status: "missing", hint: "Check the identifier" },
    { status: "missing", hint: "Please sign in first" },
  ],
  [
    "application/json",
    { data: null, meta: { description: "Nothing here" } },
    { data: null, meta: { description: "Credentials not provided" } },
  ],
  ["application/json", { errorMessage: "No such widget" }, { errorMessage: "Token not provided" }],
])("a %s not-found %j never matches the authentication variant %j", (type, learned, runtime) => {
  const honest = notFoundSignature(404, type, JSON.stringify(learned));
  expect(honest).toBeDefined();
  expect(notFoundSignature(404, type, JSON.stringify(runtime))).toBeUndefined();
});

it.each([
  [
    "<main><p>No such widget.</p></main>",
    "<main><p>Access denied: authentication required.</p></main>",
  ],
  ["<p>Not Found</p>", "<p>Please log in to continue</p>"],
  ["<main><p>Not here</p></main>", "<main><p>You do not have permission.</p></main>"],
  ["<div>Missing widget</div>", "<div>Sign in to see this widget</div>"],
])("an HTML not-found %j never matches main text %j", (learned, runtime) => {
  expect(html(learned)).toBeDefined();
  expect(html(runtime)).toBeUndefined();
});

it("excludes navigation chrome and non-rendered text from the main-text rule", () => {
  const page = (main: string) =>
    `<!DOCTYPE html><html><head><title>404 Not Found</title><style>.login{}</style></head><body><header><a href="/login">Log in</a></header><nav><a href="/signin">Sign in</a></nav><main>${main}</main><footer>Access denied? Contact support</footer><script>var token = 1;</script></body></html>`;
  expect(html(page("<h1>404 Not Found</h1><p>No such widget.</p>"))).toBeDefined();
  expect(
    html(page("<h1>404 Not Found</h1><p>Please log in to view this widget.</p>")),
  ).toBeUndefined();
});

it("matches prose by whole words and single tokens separator-insensitively", () => {
  for (const text of [
    "Please log in",
    "log-in required",
    "Access denied",
    "Not provided",
    "Authentication credentials were not provided.",
    "AccessDenied",
    "auth_required",
    "NotAuthenticated",
    "You must sign in",
    "Not authorised",
  ])
    expect(authenticationText(text), text).toBe(true);
  for (const text of ["No such blog in this forum", "Author not found", "Not found", "Gone", ""])
    expect(authenticationText(text), text).toBe(false);
});

it("treats err and errors as discriminator keys", () => {
  for (const key of ["err", "errors", "errMsg", "lastErr", "error_code", "HTTP_Status"])
    expect(isDiscriminatorKey(key), key).toBe(true);
  for (const key of ["referrer", "name", "items"]) expect(isDiscriminatorKey(key), key).toBe(false);
  // The exact discriminator value is part of the signature.
  expect(notFoundSignature(404, "application/json", '{"err":"not_found"}')?.structure).not.toBe(
    notFoundSignature(404, "application/json", '{"err":"missing"}')?.structure,
  );
});

it("applies the wider markers only in the not-found context; they never make a response verify", () => {
  const body = JSON.stringify({ items: [{ title: "Please log in to the event" }] });
  expect(responsePageError(body, "application/json", false)).toBe(false);
  expect(responsePageError(body, "application/json", false, true)).toBe(true);
  const page = "<main><p>Read the access denied report</p></main>";
  expect(responsePageError(page, "text/html", false)).toBe(false);
  expect(responsePageError(page, "text/html", false, true)).toBe(true);
  // A 2xx is never a not-found signature, whatever its text.
  expect(notFoundSignature(200, "text/html", "Not Found")).toBeUndefined();
});

const listing: Extraction = {
  format: "json",
  itemType: `${SCHEMA}Product`,
  itemPath: "/items",
  fields: [{ property: `${SCHEMA}identifier`, path: "/id" }],
};
const rows = { total: 2, items: [{ id: "80" }, { id: "81" }] };

it("learns a liveness signature only from a success with item-level data and no marker", () => {
  const honest = livenessSignature(200, "application/json", JSON.stringify(rows), listing);
  expect(honest).toMatchObject({ status: 200, contentType: "application/json" });
  // Different rows, same envelope: the same signature.
  expect(
    livenessSignature(
      200,
      "application/json; charset=utf-8",
      JSON.stringify({ total: 9, items: [{ id: "7" }] }),
      listing,
    ),
  ).toEqual(honest);
  for (const [status, type, body] of [
    [401, "application/json", JSON.stringify(rows)],
    [302, "application/json", JSON.stringify(rows)],
    [200, "application/json", JSON.stringify({ total: 0, items: [] })],
    [200, "application/json", JSON.stringify({ total: 0, items: [], message: "Please sign in" })],
    [200, "application/json", JSON.stringify({ ...rows, status: "unauthenticated" })],
    [200, "application/json", JSON.stringify({ ...rows, success: false })],
    [200, "application/json", JSON.stringify({ total: 1, items: [{ name: "No identity" }] })],
    [200, "application/json", JSON.stringify({ total: 1, items: [{ id: "" }] })],
    [200, "application/json", "not json"],
    [200, "text/html", '<form action="/login"><input type="password"></form>'],
    [200, "application/json", ""],
  ] as const)
    expect(livenessSignature(status, type, body, listing), `${status} ${body}`).toBeUndefined();
  // A changed envelope is a different structure.
  expect(
    livenessSignature(200, "application/json", JSON.stringify({ items: rows.items }), listing)
      ?.structure,
  ).not.toBe(honest?.structure);
});

it("learns an HTML liveness signature from the document paths to its rows", () => {
  const forums: Extraction = {
    format: "html",
    itemType: `${SCHEMA}CreativeWork`,
    itemPath: "select option",
    fields: [{ property: `${SCHEMA}identifier`, path: ":scope", attribute: "value" }],
  };
  const page = (options: string) =>
    `<html><body><main><form action="/submit" method="post"><select name="forum">${options}</select></form></main></body></html>`;
  const honest = livenessSignature(
    200,
    "text/html",
    page('<option value="1">Example</option>'),
    forums,
  );
  expect(honest).toBeDefined();
  expect(
    livenessSignature(
      200,
      "text/html",
      page('<option value="1">Example</option><option value="2">Other</option>'),
      forums,
    ),
  ).toEqual(honest);
  expect(livenessSignature(200, "text/html", page(""), forums)).toBeUndefined();
  expect(
    livenessSignature(
      200,
      "text/html",
      `<main><h1>Sign in</h1><form action="/login"><select><option value="1">x</option></select><input type="password"></form></main>`,
      forums,
    ),
  ).toBeUndefined();
  expect(
    livenessSignature(
      200,
      "text/html",
      '<div><select><option value="1">Example</option></select></div>',
      forums,
    )?.structure,
  ).not.toBe(honest?.structure);
  expect(
    livenessSignature(200, "application/json", page('<option value="1">x</option>'), forums),
  ).toBeUndefined();
});

it("validates a learned liveness read in the write-response sidecar", () => {
  const policy = (liveness: unknown) => ({
    createdLocationPattern: "/",
    completionOnly: true,
    verification: {
      operation: "urn:read",
      bind: {},
      identityInput: "id",
      identityPattern: "https://shop.test/products/{id}",
      changes: [],
      liveness,
    },
  });
  const signature = { status: 200, contentType: "application/json", structure: "a".repeat(64) };
  expect(() =>
    validateWriteResponsePolicy(
      policy({ operation: "urn:list", bind: { page: { value: "1" } }, signature }) as never,
      "https://shop.test",
    ),
  ).not.toThrow();
  for (const liveness of [
    { operation: "urn:list", bind: { page: { input: "id" } }, signature },
    { operation: "urn:list", bind: {}, signature: { ...signature, status: 404 } },
    { operation: "urn:list", bind: {}, signature: { ...signature, structure: "x" } },
    { operation: 1, bind: {}, signature },
    { operation: "urn:list", bind: {} },
  ])
    expect(() =>
      validateWriteResponsePolicy(policy(liveness) as never, "https://shop.test"),
    ).toThrow("invalid liveness read");
});
