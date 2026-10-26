// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { unique } from "./protocol.js";

it("validates many distinct parameter names without rescanning their values", () => {
  const params = new URLSearchParams();
  for (let index = 0; index < 5_000; index++) params.append(`parameter_${index}`, "value");
  const getAll = vi.spyOn(params, "getAll");
  expect(() => unique(params)).not.toThrow();
  expect(getAll).not.toHaveBeenCalled();
  params.append("parameter_0", "duplicate at the end");
  expect(() => unique(params)).toThrow("invalid_request");
  expect(getAll).not.toHaveBeenCalled();
});

it.each([
  "name=one&name=two",
  "name=one&name=one",
  "name=one&na%6De=two",
  "=one&=two",
])("rejects duplicate parameter names: %s", (query) => {
  expect(() => unique(new URLSearchParams(query))).toThrow("invalid_request");
});

it("accepts an empty parameter collection", () => {
  expect(() => unique(new URLSearchParams())).not.toThrow();
});
