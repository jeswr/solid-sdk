// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { RunBudget } from "../core/budget.js";
import { budgetedFetch } from "../core/source-budget.js";
import { download } from "./content.js";

const url = "https://www.googleapis.com/drive/v3/files/file/export?mimeType=application/pdf";

describe("Drive content budgets", () => {
  it("keeps successful per-file copies outside the JSON allowance", async () => {
    const budget = new RunBudget("google-drive", { maxBytes: 4 });
    budget.bytes(4);
    const source = budgetedFetch(
      async () => new Response("1234"),
      "google-drive",
      budget,
      new AbortController().signal,
    );
    for (let i = 0; i < 2; i++)
      expect(await download(source.api, url, 100, true)).toEqual({
        body: new TextEncoder().encode("1234"),
      });
    source.close();
  });
  it("retains the per-file cap and cancels oversized content", async () => {
    const cancel = vi.fn();
    const api: typeof fetch = async () =>
      new Response(
        new ReadableStream(
          {
            pull(controller) {
              controller.enqueue(new Uint8Array(8));
            },
            cancel,
          },
          { highWaterMark: 0 },
        ),
      );
    expect(await download(api, url, 4, true)).toEqual({ reason: "size-cap-exceeded" });
    expect(cancel).toHaveBeenCalledOnce();
  });
  it("charges inspected error bytes and preserves budget failures", async () => {
    const budget = new RunBudget("google-drive", { maxBytes: 2 });
    const cancel = vi.fn();
    const api: typeof fetch = async () =>
      new Response(
        new ReadableStream(
          {
            pull(controller) {
              controller.enqueue(new Uint8Array(8));
            },
            cancel,
          },
          { highWaterMark: 0 },
        ),
        { status: 403 },
      );
    const source = budgetedFetch(api, "google-drive", budget, new AbortController().signal);
    await expect(download(source.api, url, 4, true)).rejects.toMatchObject({
      name: "RunBudgetExceededError",
      resource: "bytes",
    });
    expect(cancel).toHaveBeenCalledOnce();
    source.close();
  });
  it("does not exempt Drive metadata even if the server calls it media", async () => {
    const source = budgetedFetch(
      async () => new Response("1234", { headers: { "content-type": "image/png" } }),
      "google-drive",
      new RunBudget("google-drive", { maxBytes: 2 }),
      new AbortController().signal,
    );
    await expect(
      (await source.api("https://www.googleapis.com/drive/v3/files")).text(),
    ).rejects.toMatchObject({ resource: "bytes" });
    source.close();
  });
});
