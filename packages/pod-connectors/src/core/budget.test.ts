// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it } from "vitest";
import { RunBudget, readJson } from "./budget.js";
import { IntegrationSyncError } from "./errors.js";
import { fixtureFetch, getJson } from "./fixture-fetch.js";

const stream = (parts: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
      controller.close();
    },
  });

describe("readJson", () => {
  it("parses a body split across chunks", async () => {
    expect(await readJson(new Response(stream(['{"a":', "[1,2]}"])), "x", "u")).toEqual({
      a: [1, 2],
    });
  });

  it("refuses a declared length over the cap without reading", async () => {
    const res = new Response("{}", { headers: { "content-length": "100" } });
    await expect(readJson(res, "x", "u", 10)).rejects.toThrow("too large");
  });

  it("stops reading once the streamed body passes the cap", async () => {
    await expect(
      readJson(new Response(stream(["[1,", "2,3,4,5,6]"])), "x", "u", 5),
    ).rejects.toThrow(IntegrationSyncError);
  });

  it("maps invalid JSON and parses an empty body as invalid", async () => {
    await expect(readJson(new Response("{"), "x", "u")).rejects.toThrow("invalid JSON");
    await expect(readJson(new Response(null), "x", "u")).rejects.toThrow("invalid JSON");
  });

  it("backs getJson", async () => {
    const api = fixtureFetch("x", [{ url: "https://api.test/a", json: { ok: true } }]);
    expect(await getJson("x", api, "https://api.test/a")).toEqual({ ok: true });
  });
});

describe("RunBudget", () => {
  it("throws once requests or items exceed the limits", () => {
    const budget = new RunBudget("x", { maxRequests: 2, maxItems: 3 });
    budget.request();
    budget.request();
    expect(() => budget.request()).toThrow("request budget");
    budget.items(3);
    expect(() => budget.items(1)).toThrow("item budget");
  });

  it("has generous defaults", () => {
    const budget = new RunBudget("x");
    for (let i = 0; i < 1000; i++) budget.request();
    budget.items(1_000_000);
  });

  it("counts response bytes against the run's data budget", async () => {
    const budget = new RunBudget("x", { maxRequests: 10, maxItems: 10, maxBytes: 8 });
    expect(await readJson(new Response("[1,2]"), "x", "u", undefined, budget)).toEqual([1, 2]);
    await expect(readJson(new Response("[1,2]"), "x", "u", undefined, budget)).rejects.toThrow(
      "data budget",
    );
    // Limits without maxBytes fall back to the default data budget.
    new RunBudget("x", { maxRequests: 1, maxItems: 1 }).bytes(1024);
  });
});
