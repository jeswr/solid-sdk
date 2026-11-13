// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { finalPage, mapResponse } from "../src/response.js";
import { STATUSES } from "../src/types.js";
import { trace } from "./helpers.js";

describe("FinalAgentResponse mapping (1.2.3 public schema)", () => {
  it.each([
    ['["Example item"]', ["Example item"]],
    ["[23.5]", [23.5]],
    ["[true]", [true]],
    ['[{"name":"Example","count":2}]', [{ name: "Example", count: 2 }]],
    ["42", [42]],
    ["Plain answer", ["Plain answer"]],
    ["[]", []],
  ])("preserves RETRIEVE types for %s", (text, expected) => {
    expect(mapResponse("RETRIEVE", trace(String(text)))).toEqual({
      task_type: "RETRIEVE",
      status: "SUCCESS",
      retrieved_data: expected,
      error_details: null,
    });
  });
  it.each(["MUTATE", "NAVIGATE"] as const)("returns null retrieved_data for %s", (type) => {
    expect(mapResponse(type, trace('{"status":"SUCCESS","retrieved_data":["ignored"]}'))).toEqual({
      task_type: type,
      status: "SUCCESS",
      retrieved_data: null,
      error_details: null,
    });
  });
  it.each(
    STATUSES.filter((s) => s !== "SUCCESS"),
  )("maps explicit failure %s without consulting expected answers", (status) => {
    expect(
      mapResponse("MUTATE", trace(JSON.stringify({ status, error_details: "Fixture reason" }))),
    ).toMatchObject({ status, error_details: "Fixture reason", retrieved_data: null });
  });
  it("maps exhaustion/clarification, malformed statuses and invalid public arrays to errors", () => {
    expect(mapResponse("RETRIEVE", trace("", "maxSteps")).status).toBe("UNKNOWN_ERROR");
    expect(mapResponse("NAVIGATE", trace("", "ask")).status).toBe("UNKNOWN_ERROR");
    for (const text of [
      '[["a"]]',
      "[1e400]",
      '[1,"a"]',
      '[{"a":1},{"b":2}]',
      '{"status":"invented"}',
      '{"status":"SUCCESS","task_type":"MUTATE"}',
    ])
      expect(mapResponse("RETRIEVE", trace(text)).status).toBe("DATA_VALIDATION_ERROR");
  });
  it("does not turn an incomplete write into success", () => {
    const input = trace("Done");
    input.steps.push({
      index: 1,
      kind: "act",
      status: "refused",
      statuses: ["refused"],
      observations: "",
      elapsedMs: 1,
      promptTokensEstimate: 2,
    });
    expect(mapResponse("MUTATE", input).status).toBe("UNKNOWN_ERROR");
  });
  it("uses only the agent-identified final page, never a task's expected URL", () => {
    expect(finalPage(trace('{"status":"SUCCESS","final_url":"https://shop.test/item/1"}'))).toBe(
      "https://shop.test/item/1",
    );
    expect(finalPage(trace("https://shop.test/item/1"))).toBe("https://shop.test/item/1");
    expect(finalPage(trace("I opened the correct page."))).toBeUndefined();
  });
});
