// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { connectorState } from "../../node/state.js";
import { MAX_JSON_BYTES, RunBudget } from "../budget.js";
import { syncSourceFetch } from "./transport.js";

describe("sync source budget and abort boundaries", () => {
  it("charges streamed bytes even when adapters use Response.text directly", async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new Uint8Array(8));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
    const api = syncSourceFetch(
      async () => response,
      "test",
      new RunBudget("test", { maxRequests: 5, maxItems: 5, maxBytes: 7 }),
    );
    await expect((await api("https://fixture.test/")).text()).rejects.toThrow("budget");
    expect(cancelled).toBe(true);
  });
  it("refuses oversized declared bodies before reading", async () => {
    const response = new Response("", {
      headers: { "content-length": String(MAX_JSON_BYTES + 1) },
    });
    const api = syncSourceFetch(async () => response, "test", new RunBudget("test"));
    await expect(api("https://fixture.test/")).rejects.toThrow("too large");
  });
  it("preserves caller cancellation while composing the run signal", async () => {
    const run = new AbortController();
    const request = new AbortController();
    const source = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const api = syncSourceFetch(source, "test", new RunBudget("test"), run.signal);
    await api(new Request("https://fixture.test/", { signal: request.signal }));
    const signal = source.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    request.abort();
    expect(signal?.aborted).toBe(true);
    run.abort(new Error("stopped"));
    await expect(api("https://fixture.test/")).rejects.toThrow("stopped");
    expect(source).toHaveBeenCalledOnce();
  });
  it("persists only validated sync health counts in Node checkpoint projection", () => {
    const input = {
      connectedAt: "2026-01-01",
      lastOutcome: "success",
      counts: { documents: 1, items: 1, skipped: 0 },
      sync: { conflicts: 2, pendingDeletes: 3, token: "discard" },
    };
    expect(connectorState(input).sync).toEqual({ conflicts: 2, pendingDeletes: 3 });
    expect(() => connectorState({ ...input, sync: { conflicts: -1, pendingDeletes: 0 } })).toThrow(
      "count",
    );
  });
});
