// AUTHORED-BY Codex GPT-6
import { expect, it } from "vitest";
import { jsonFailure, notFoundSignature, responsePageError } from "../src/response-evidence.js";

it.each([
  "status",
  "code",
  "error",
  "error_code",
  "type",
  "reason",
  "HTTP_Status",
  "errorCode",
  "failureReason",
])("keeps exact nested discriminator scalars in not-found signatures: %s", (key) => {
  const signature = (value: unknown) =>
    notFoundSignature(404, "application/json", JSON.stringify({ envelope: [{ [key]: value }] }));
  // error fields carrying nonempty values already fail the shared failure predicate.
  const values =
    key === "error" ? [false, null] : ["not-found", "missing", 404, "404", false, null];
  const signatures = values.map(signature);
  for (const value of signatures) expect(value).toBeDefined();
  expect(new Set(signatures.map((s) => s?.structure)).size).toBe(values.length);
});

it.each([
  "auth",
  "LoG-In",
  "SIGN_IN",
  "signin",
  "credential",
  "token",
  "forbidden",
  "permission",
  "denied",
  "unauthorized",
  "unauthenticated",
  "not_authenticated",
])("rejects authentication discriminators and HTML headings across separators: %s", (value) => {
  const body = JSON.stringify({ envelope: { ERROR_CODE: `resource_${value}_required` } });
  expect(jsonFailure({ ERROR_CODE: value })).toBe(true);
  expect(responsePageError(body, "application/json")).toBe(true);
  expect(notFoundSignature(404, "application/json", body)).toBeUndefined();
  for (const tag of ["title", "h1", "h3", "h6"]) {
    const html = `<main><${tag}>${value}</${tag}></main>`;
    expect(responsePageError(html, "text/html", false, true)).toBe(true);
    expect(notFoundSignature(404, "text/html", html)).toBeUndefined();
  }
});

it("retains HTML titles and headings while allowing incidental message text to vary", () => {
  const signature = (title: string, heading: string) =>
    notFoundSignature(404, "text/html", `<title>${title}</title><main><h1>${heading}</h1></main>`);
  const missing = signature("Missing widget", "Not found");
  expect(missing).toBeDefined();
  expect(signature("Other response", "Not found")?.structure).not.toBe(missing?.structure);
  expect(signature("Missing widget", "Missing product")?.structure).not.toBe(missing?.structure);
  const json = (message: string) =>
    notFoundSignature(404, "application/json", JSON.stringify({ status: "not-found", message }));
  expect(json("Missing widget")).toEqual(json("Missing another widget"));
});
