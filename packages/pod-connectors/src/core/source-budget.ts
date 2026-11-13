// AUTHORED-BY Codex GPT-6.1-Sol
import { snapshotFetchInput } from "@jeswr/guarded-fetch";
import { MAX_JSON_BYTES, type RunBudget } from "./budget.js";
import {
  during,
  registerSourceBodyLimit,
  SOURCE_RESPONSE_TIMEOUT_MS,
  SourceTimeoutError,
  sourceBodyTimeoutMs,
} from "./source-timeout.js";

export { SOURCE_RESPONSE_TIMEOUT_MS } from "./source-timeout.js";

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
    const combined = AbortSignal.any([runSignal, ...(effective ? [effective] : [])]);
    const controller = new AbortController();
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    let bodyTimer: ReturnType<typeof setTimeout> | undefined;
    const timeOut = () => controller.abort(new SourceTimeoutError(adapterId, snapshot.url));
    const armIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(timeOut, SOURCE_RESPONSE_TIMEOUT_MS);
    };
    const stop = () => controller.abort(combined.reason);
    combined.addEventListener("abort", stop, { once: true });
    if (combined.aborted) stop();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let settled = false;
    const cleanup = () => {
      combined.removeEventListener("abort", stop);
      controller.signal.removeEventListener("abort", cancel);
      active.delete(close);
      clearTimeout(idleTimer);
      clearTimeout(bodyTimer);
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
    armIdle();
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
      const bodyStarted = performance.now();
      const configure = (cap: number) => {
        clearTimeout(bodyTimer);
        const deadline = bodyStarted + sourceBodyTimeoutMs(cap, res.headers.get("content-length"));
        const armBody = () => {
          const remaining = deadline - performance.now();
          if (remaining <= 0) timeOut();
          else bodyTimer = setTimeout(armBody, Math.min(Math.ceil(remaining), 2_147_483_647));
        };
        armBody();
      };
      armIdle();
      configure(MAX_JSON_BYTES);
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
                armIdle();
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
      const response = new Response(body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });
      registerSourceBodyLimit(response, configure);
      return response;
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
