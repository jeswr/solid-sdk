// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { RunBudget } from "./budget.js";
import { budgetedFetch } from "./source-budget.js";

const url = "https://api.test/source";

describe("source signal composition and cleanup", () => {
  it.each(["Request", "init", "run"])("preserves cancellation from the %s signal", async (kind) => {
    const caller = new AbortController();
    const run = new AbortController();
    const transport = vi.fn<typeof fetch>(async () => new Promise<Response>(() => {}));
    const source = budgetedFetch(transport, "test", new RunBudget("test"), run.signal);
    const pending =
      kind === "Request"
        ? source.api(new Request(url, { signal: caller.signal }))
        : source.api(url, { signal: caller.signal });
    const failure = expect(pending).rejects.toThrow("source cancelled");
    await Promise.resolve();
    (kind === "run" ? run : caller).abort(new Error("source cancelled"));
    await failure;
    expect(transport.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    source.close();
  });
  it("lets an explicit init signal override a Request's signal", async () => {
    const ignored = new AbortController();
    ignored.abort();
    const effective = new AbortController();
    const source = budgetedFetch(
      async () => new Response("ok"),
      "test",
      new RunBudget("test"),
      new AbortController().signal,
    );
    expect(
      await (
        await source.api(new Request(url, { signal: ignored.signal }), { signal: effective.signal })
      ).text(),
    ).toBe("ok");
    source.close();
  });
  it("cancels a late response from a transport that ignores cancellation", async () => {
    const run = new AbortController();
    let resolve: ((res: Response) => void) | undefined;
    const cancel = vi.fn();
    const source = budgetedFetch(
      () =>
        new Promise<Response>((accept) => {
          resolve = accept;
        }),
      "test",
      new RunBudget("test"),
      run.signal,
    );
    const pending = source.api(url);
    const failure = expect(pending).rejects.toThrow("cancelled");
    await Promise.resolve();
    run.abort(new Error("cancelled"));
    await failure;
    resolve?.(new Response(new ReadableStream({ cancel })));
    await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce());
    source.close();
  });
  it("cancels a body left unread at run completion", async () => {
    const cancel = vi.fn();
    const source = budgetedFetch(
      async () => new Response(new ReadableStream({ cancel })),
      "test",
      new RunBudget("test"),
      new AbortController().signal,
    );
    await source.api(url);
    source.close();
    expect(cancel).toHaveBeenCalledOnce();
  });
});

it("does not dispatch when cancellation lands before the transport microtask", async () => {
  const controller = new AbortController();
  const transport = vi.fn<typeof fetch>(async () => new Response("unused"));
  const source = budgetedFetch(transport, "test", new RunBudget("test"), controller.signal);
  const pending = source.api(url);
  controller.abort(new Error("cancelled"));
  await expect(pending).rejects.toThrow("cancelled");
  expect(transport).not.toHaveBeenCalled();
  source.close();
});

it("releases the underlying reader and aborts its request on byte exhaustion", async () => {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      stream.enqueue(new Uint8Array(2));
    },
    cancel,
  });
  let signal: AbortSignal | null | undefined;
  const source = budgetedFetch(
    async (_input, init) => {
      signal = init?.signal;
      return new Response(body);
    },
    "test",
    new RunBudget("test", { maxBytes: 1 }),
    new AbortController().signal,
  );
  await expect((await source.api(url)).arrayBuffer()).rejects.toMatchObject({ resource: "bytes" });
  expect(signal?.aborted).toBe(true);
  expect(body.locked).toBe(false);
  expect(cancel).toHaveBeenCalledOnce();
  source.close();
});
