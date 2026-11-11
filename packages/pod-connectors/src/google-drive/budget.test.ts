// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { RunBudget } from "../core/budget.js";
import { download } from "./content.js";

describe("Drive download total bytes", () => {
  it("shares the byte allowance across downloads and already charged JSON", async () => {
    const budget = new RunBudget("google-drive", { maxBytes: 10 });
    budget.bytes(4);
    const api = vi.fn<typeof fetch>(async () => new Response("1234"));
    expect(await download(api, "https://drive.test/media", 100, false, budget)).toEqual({
      body: new TextEncoder().encode("1234"),
    });
    await expect(
      download(api, "https://drive.test/media", 100, false, budget),
    ).rejects.toMatchObject({ name: "RunBudgetExceededError", resource: "bytes" });
  });
  it.each([
    false,
    true,
  ])("charges chunks even when a local cap would omit the content (error body: %s)", async (errorBody) => {
    const budget = new RunBudget("google-drive", { maxBytes: 2 });
    const cancel = vi.fn();
    const api = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                controller.enqueue(new Uint8Array(8));
              },
              cancel,
            },
            { highWaterMark: 0 },
          ),
          { status: errorBody ? 403 : 200 },
        ),
    );
    await expect(
      download(api, "https://drive.test/media", 4, errorBody, budget),
    ).rejects.toMatchObject({ name: "RunBudgetExceededError", resource: "bytes" });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
