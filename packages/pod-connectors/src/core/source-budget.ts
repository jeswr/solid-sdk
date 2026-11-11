// AUTHORED-BY Codex GPT-6.1-Sol
import { snapshotFetchInput } from "@jeswr/guarded-fetch";
import type { RunBudget } from "./budget.js";
import { IntegrationSyncError } from "./errors.js";

/** Absolute response deadline, covering both headers and the entire body, including trickles. */
export const SOURCE_RESPONSE_TIMEOUT_MS = 60_000;

/** Reject even if a custom source transport/reader ignores its signal. Remove settled listeners. */
function during<T>(signal: AbortSignal, step: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) {
      signal.removeEventListener("abort", stop);
      reject(signal.reason);
      return;
    }
    Promise.resolve()
      .then(() => {
        signal.throwIfAborted();
        return step();
      })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
  });
}

/** Only successful Drive representations are written per-file instead of retained for a run. */
function driveContent(adapterId: string, url: string, response: Response): boolean {
  if (adapterId !== "google-drive" || !response.ok) return false;
  const parsed = new URL(url);
  return (
    parsed.origin === "https://www.googleapis.com" &&
    /^\/drive\/v3\/files\/[^/]+(?:\/export)?$/.test(parsed.pathname) &&
    (parsed.pathname.endsWith("/export") || parsed.searchParams.get("alt") === "media")
  );
}

/** Central source enforcement: adapters cannot omit request or streamed byte accounting. */
export function budgetedFetch(
  transport: typeof fetch,
  adapterId: string,
  budget: RunBudget,
  runSignal: AbortSignal,
): { api: typeof fetch; close(): void } {
  const active = new Set<() => void>();
  const api: typeof fetch = async (input, init) => {
    budget.request();
    runSignal.throwIfAborted();
    const snapshot = snapshotFetchInput(input, init, { forward: true, initSemantics: "direct" });
    const effective =
      snapshot.init && "signal" in snapshot.init
        ? snapshot.init.signal
        : typeof snapshot.input === "string"
          ? undefined
          : snapshot.input.signal;
    // The run deadline is shared; each response also gets an absolute deadline so a slow
    // trickle cannot keep a reader alive indefinitely. Preserve a caller's controller too.
    const responseTimeout = AbortSignal.timeout(SOURCE_RESPONSE_TIMEOUT_MS);
    const combined = AbortSignal.any([
      runSignal,
      responseTimeout,
      ...(effective ? [effective] : []),
    ]);
    const controller = new AbortController();
    const reason = () =>
      responseTimeout.aborted && !runSignal.aborted
        ? new IntegrationSyncError(adapterId, "The source response timed out.", {
            url: snapshot.url,
          })
        : combined.reason;
    const stop = () => controller.abort(reason());
    combined.addEventListener("abort", stop, { once: true });
    if (combined.aborted) stop();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let settled = false;
    const cleanup = () => {
      combined.removeEventListener("abort", stop);
      controller.signal.removeEventListener("abort", cancel);
      active.delete(close);
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      void reader?.cancel(controller.signal.reason).catch(() => undefined);
      reader?.releaseLock();
      cleanup();
    };
    const close = () => {
      controller.abort(new DOMException("Run finished", "AbortError"));
      cancel();
    };
    active.add(close);
    controller.signal.addEventListener("abort", cancel, { once: true });
    try {
      const res = await during(controller.signal, async () => {
        const response = await transport(snapshot.input, {
          ...snapshot.init,
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          void response.body?.cancel().catch(() => undefined);
          controller.signal.throwIfAborted();
        }
        return response;
      });
      if (!res.body) {
        cleanup();
        return res;
      }
      const bodyReader = res.body.getReader();
      reader = bodyReader;
      const charge = !driveContent(adapterId, snapshot.url, res);
      const body = new ReadableStream<Uint8Array>(
        {
          async pull(stream) {
            try {
              const chunk = await during(controller.signal, () => bodyReader.read());
              if (settled) {
                controller.signal.throwIfAborted();
                return;
              }
              if (chunk.done) {
                settled = true;
                cleanup();
                bodyReader.releaseLock();
                stream.close();
              } else {
                if (charge) budget.bytes(chunk.value.byteLength);
                stream.enqueue(chunk.value);
              }
            } catch (error) {
              controller.abort(error);
              cancel();
              stream.error(error);
            }
          },
          cancel() {
            close();
          },
        },
        { highWaterMark: 0 },
      );
      return new Response(body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
    } catch (error) {
      cleanup();
      throw error;
    }
  };
  return {
    api,
    close() {
      for (const stop of active) stop();
    },
  };
}
