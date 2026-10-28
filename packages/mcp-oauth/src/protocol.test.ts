// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, it, vi } from "vitest";
import { MAX_BYTES, readBody, unique } from "./protocol.js";

it.each([
  false,
  true,
])("preserves size rejection when original stream cancellation fails (declared: %s)", async (declared) => {
  const cancel = vi.fn(async () => {
    throw new Error("fixture cancellation failure");
  });
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_BYTES + 1));
      },
      cancel,
    }),
    { headers: declared ? { "content-length": String(MAX_BYTES + 1) } : {} },
  );
  await expect(readBody(response)).rejects.toMatchObject({ status: 413 });
  expect(cancel).toHaveBeenCalledOnce();
});

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
