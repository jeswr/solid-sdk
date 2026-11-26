// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
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
  it("cancels and releases the reader on total-byte overflow, preserving the typed failure", async () => {
    const cancel = vi.fn(() => {
      throw new Error("Untrusted cancellation failure");
    });
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          controller.enqueue(new Uint8Array([32, 32, 32]));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    await expect(
      readJson(new Response(body), "x", "u", undefined, new RunBudget("x", { maxBytes: 2 })),
    ).rejects.toMatchObject({ name: "RunBudgetExceededError", resource: "bytes" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });
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
  it("snapshots caller limits and admits charges exactly at each allowance", () => {
    const limits = { maxRequests: 1, maxItems: 1, maxBytes: 1 };
    const budgets = [
      new RunBudget("x", limits),
      new RunBudget("x", limits),
      new RunBudget("x", limits),
    ];
    Object.assign(limits, { maxRequests: 100, maxItems: 100, maxBytes: 100 });
    const [requests, items, bytes] = budgets;
    requests?.request();
    items?.items(1);
    bytes?.bytes(1);
    expect(() => requests?.request()).toThrow("request budget");
    expect(() => items?.items(1)).toThrow("item budget");
    expect(() => bytes?.bytes(1)).toThrow("data budget");
  });
  it.each([-1, NaN, Infinity, 0.5])("refuses invalid item/byte charges (%s)", (charge) => {
    const budget = new RunBudget("x");
    expect(() => budget.items(charge)).toThrow(TypeError);
    expect(() => budget.bytes(charge)).toThrow(TypeError);
  });
  it.each([
    NaN,
    Infinity,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
  ])("refuses invalid limits (%s)", (limit) => {
    for (const key of ["maxRequests", "maxItems", "maxBytes", "maxDurationMs"])
      expect(() => new RunBudget("x", { maxRequests: 2, maxItems: 3, [key]: limit })).toThrow(
        TypeError,
      );
  });

  it("reports a typed partial-run error and keeps an exhausted budget exhausted", () => {
    const budget = new RunBudget("x", { maxRequests: 0, maxItems: 0, maxBytes: 0 });
    expect(() => budget.request()).toThrow(
      expect.objectContaining({ name: "RunBudgetExceededError", resource: "requests" }),
    );
    expect(() => budget.items(0)).toThrow("checkpoint is unchanged");
  });

  it("throws once requests or items exceed the limits", () => {
    const budget = new RunBudget("x", { maxRequests: 2, maxItems: 3 });
    budget.request();
    budget.request();
    expect(() => budget.request()).toThrow("request budget");
    const itemBudget = new RunBudget("x", { maxRequests: 2, maxItems: 3 });
    itemBudget.items(3);
    expect(() => itemBudget.items(1)).toThrow("item budget");
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

// AUTHORED-BY Codex GPT-6.1-Sol
it("aborts a stalled JSON body and cancels its reader without retaining a hostile reason", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  );
  const pending = readJson(
    response,
    "vesync",
    "https://smartapi.vesync.com/",
    100,
    undefined,
    controller.signal,
  );
  const check = expect(pending).rejects.toThrow("cancelled or timed out");
  controller.abort(new Error("private-hostile-reason"));
  await check;
  expect(cancelled).toBe(true);
});
