// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { RunBudget, readBytes } from "./budget.js";
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

it.each([
  ["google-drive", "https://www.googleapis.com/drive/v3/files/file?alt=media", 25 * 1024 * 1024],
  [
    "gmail",
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/id?format=raw",
    48 * 1024 * 1024,
  ],
])("allows a healthy large %s body to take longer than 60 seconds", async (id, endpoint, cap) => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), ms);
    return controller.signal;
  });
  const source = budgetedFetch(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async pull(stream) {
            await new Promise((resolve) => setTimeout(resolve, 30_000));
            stream.enqueue(new Uint8Array([1]));
            if (++chunks === 3) stream.close();
          },
        }),
        { headers: { "content-length": String(cap) } },
      ),
    id,
    new RunBudget(id),
    new AbortController().signal,
  );
  let chunks = 0;
  try {
    const pending = (await source.api(endpoint)).arrayBuffer();
    const outcome = pending.then(
      (body) => ({ body }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(90_001);
    expect(await outcome).toEqual({ body: new Uint8Array([1, 1, 1]).buffer });
  } finally {
    source.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  }
});

it.each([
  true,
  false,
])("scales the body deadline with the reader cap (length header: %s)", async (declared) => {
  vi.useFakeTimers();
  let chunks = 0;
  const cap = 64 * 1024 * 1024;
  const source = budgetedFetch(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async pull(stream) {
            await new Promise((resolve) => setTimeout(resolve, 50_000));
            stream.enqueue(new Uint8Array([1]));
            if (++chunks === 5) stream.close();
          },
        }),
        { headers: declared ? { "content-length": String(cap) } : {} },
      ),
    "test",
    new RunBudget("test"),
    new AbortController().signal,
  );
  try {
    const pending = readBytes(await source.api(url), "test", url, cap);
    const outcome = pending.then(
      (body) => ({ body }),
      (error: unknown) => ({ error }),
    );
    await vi.advanceTimersByTimeAsync(250_001);
    expect(await outcome).toEqual({ body: new Uint8Array([1, 1, 1, 1, 1]) });
  } finally {
    source.close();
    vi.useRealTimers();
  }
});

it("stops endless trickles at the reader's size-scaled deadline", async () => {
  vi.useFakeTimers();
  let timer: ReturnType<typeof setInterval>;
  const cancel = vi.fn(() => clearInterval(timer));
  const source = budgetedFetch(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(stream) {
            timer = setInterval(() => stream.enqueue(new Uint8Array([32])), 1000);
          },
          cancel,
        }),
      ),
    "test",
    new RunBudget("test"),
    new AbortController().signal,
  );
  try {
    const pending = readBytes(await source.api(url), "test", url, 1024);
    const failure = expect(pending).rejects.toMatchObject({ name: "IntegrationSyncError" });
    await vi.advanceTimersByTimeAsync(61_001);
    await failure;
    expect(cancel).toHaveBeenCalledOnce();
  } finally {
    source.close();
    vi.useRealTimers();
  }
});
