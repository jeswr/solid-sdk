// AUTHORED-BY Claude Opus 5.5
// Round-17 regressions: scalar JSON roots in not-found evidence and the shared HTML control
// classifier. Fixtures are fictional.
import { expect, it } from "vitest";
import { parseHtml, selectElements } from "../src/dom.js";
import {
  htmlAttribute,
  htmlControlType,
  isHtmlInputType,
  parseHtmlTag,
} from "../src/html-controls.js";
import { jsonRootFailure, notFoundSignature, responsePageError } from "../src/response-evidence.js";

const json = (value: unknown) => notFoundSignature(404, "application/json", JSON.stringify(value));

it("keeps the exact value of a scalar JSON root in a not-found signature", () => {
  const honest = json("not_found");
  expect(honest).toBeDefined();
  expect(json("not_found")).toEqual(honest);
  // Same JSON type, different value: never the same signature.
  for (const other of ["missing", "not_found ", "NOT_FOUND", 404, true, null])
    expect(json(other)?.structure).not.toBe(honest?.structure);
  expect(json(404)?.structure).not.toBe(json(410)?.structure);
  expect(json(true)?.structure).not.toBe(json(false)?.structure);
  // Elements of an array root are keyless scalars too.
  expect(json(["not_found"])?.structure).not.toBe(json(["missing"])?.structure);
});

it.each([
  "not_authenticated",
  "Forbidden",
  "unauthorized",
  "LOGIN_REQUIRED",
  "token-expired",
  "restricted",
  401,
  "403",
  " 407 ",
  419,
  440,
  ["Forbidden"],
  [[401]],
])("rejects an authentication scalar root and never signs it: %j", (value) => {
  const body = JSON.stringify(value);
  expect(jsonRootFailure(value)).toBe(true);
  expect(responsePageError(body, "application/json")).toBe(true);
  expect(responsePageError(body, "application/json", false, true)).toBe(true);
  expect(notFoundSignature(404, "application/json", body)).toBeUndefined();
  expect(notFoundSignature(410, "application/json; charset=utf-8", body)).toBeUndefined();
});

it.each([
  "not_found",
  "missing",
  404,
  false,
  null,
])("accepts an honest scalar root: %j", (value) => {
  expect(jsonRootFailure(value)).toBe(false);
  expect(responsePageError(JSON.stringify(value), "application/json", false, true)).toBe(false);
  expect(json(value)).toBeDefined();
});

it("applies the same scalar rules to a plain-text not-found body", () => {
  const text = (body: string) => notFoundSignature(404, "text/plain", body);
  for (const body of ["Forbidden", "not_authenticated", "401", '"Forbidden"', "Please log in"])
    expect(text(body)).toBeUndefined();
  expect(text("not_found")).toBeDefined();
  expect(text("not_found")?.structure).not.toBe(text("missing")?.structure);
  expect(text("")).toBeDefined();
});

it.each([
  ["hidden", "hidden"],
  ["HIDDEN", "hidden"],
  ["HiDdEn", "hidden"],
  ["Password", "password"],
  ["PASSWORD", "password"],
  ["Submit", "submit"],
  ["datetime-LOCAL", "datetime-local"],
  [undefined, "text"],
  ["", "text"],
  ["bogus", "text"],
  [" hidden", "text"],
  ["hidden ", "text"],
  // U+0131 (dotless i) and U+212A (Kelvin) are not ASCII case variants.
  ["hıdden", "text"],
  ["Keygen", "text"],
])("classifies <input type=%j> as %s with HTML semantics", (type, expected) => {
  const attribs: Record<string, string> = type === undefined ? {} : { type };
  const el = { name: "input", attribs };
  expect(htmlControlType(el)).toBe(expected);
  expect(isHtmlInputType(el, expected)).toBe(true);
});

it("reads attribute names ASCII-case-insensitively, first in source order", () => {
  expect(htmlControlType({ name: "INPUT", attribs: { TYPE: "Hidden" } })).toBe("hidden");
  expect(
    htmlAttribute({ name: "input", attribs: { Type: "password", type: "text" } }, "type"),
  ).toBe("password");
  expect(isHtmlInputType({ name: "meta", attribs: { type: "hidden" } }, "hidden")).toBe(false);
});

it.each([
  [undefined, "submit"],
  ["RESET", "reset"],
  ["Button", "button"],
  ["bogus", "submit"],
])("classifies <button type=%j> as %s", (type, expected) => {
  expect(htmlControlType({ name: "button", attribs: type === undefined ? {} : { type } })).toBe(
    expected,
  );
});

it("classifies select, textarea and non-controls", () => {
  expect(htmlControlType({ name: "select", attribs: { type: "hidden" } })).toBe("select");
  expect(htmlControlType({ name: "textarea", attribs: {} })).toBe("textarea");
  expect(htmlControlType({ name: "div", attribs: { type: "hidden" } })).toBeUndefined();
});

it("classifies parsed documents and raw tags the same way", () => {
  const doc = parseHtml(
    '<form><input TYPE="HIDDEN" name="a"><input type="HiDdEn" name="b"><input type=Password name="c"><input name="d"></form>',
  );
  expect(selectElements("input", doc).map((el) => htmlControlType(el))).toEqual([
    "hidden",
    "hidden",
    "password",
    "text",
  ]);
  const tag = parseHtmlTag("<INPUT Type=PASSWORD name=pw value=fictional>");
  expect(tag && isHtmlInputType(tag, "password")).toBe(true);
  expect(tag && htmlAttribute(tag, "NAME")).toBe("pw");
});

it.each([
  'type="password"',
  'type="Password"',
  "type=PASSWORD",
])("treats a %s field as a login page in the shared failure predicate", (type) => {
  expect(responsePageError(`<main><form><input ${type} name="p"></form></main>`, "text/html")).toBe(
    true,
  );
});
