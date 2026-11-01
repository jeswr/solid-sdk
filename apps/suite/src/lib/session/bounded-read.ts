// AUTHORED-BY Codex GPT-6
import type { ExtensionWindow } from "./extension-session";

/** Stop waiting even when a bridge or fetch transport ignores cancellation. */
export async function boundedRead<T>(
  read: () => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
  win: Pick<ExtensionWindow, "setTimeout" | "clearTimeout"> = window,
): Promise<T> {
  signal?.throwIfAborted();
  let timer: unknown;
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = win.setTimeout(() => reject(new Error("Read timed out")), timeoutMs);
      onAbort = () => reject(signal?.reason);
      signal?.addEventListener("abort", onAbort, { once: true });
      // Attach both handlers so late replies/rejections are consumed after timeout or abort.
      read().then(resolve, reject);
    });
  } finally {
    win.clearTimeout(timer);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
