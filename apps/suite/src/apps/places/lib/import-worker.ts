// AUTHORED-BY Codex (GPT-6.1 Sol)
import { IMPORT_LIMITS, type TimelineImport } from "@jeswr/solid-places/timeline";
/** A dedicated worker keeps JSON parsing cancellable without freezing the page. */
export function readTimeline(
  file: File,
  signal: AbortSignal,
  makeWorker = () => new Worker(new URL("./timeline.worker.ts", import.meta.url)),
) {
  return new Promise<TimelineImport>((resolve, reject) => {
    if (file.size > IMPORT_LIMITS.bytes) {
      reject(new RangeError("Choose a file smaller than 32 MiB."));
      return;
    }
    if (!file.name.toLowerCase().endsWith(".json")) {
      reject(new TypeError("Extract the JSON files from your Takeout zip first."));
      return;
    }
    if (signal.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    let worker: Worker;
    try {
      worker = makeWorker();
    } catch {
      reject(new Error("Your browser could not open the import worker."));
      return;
    }
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ data?: TimelineImport; error?: string }>) => {
      cleanup();
      if (event.data.data) resolve(event.data.data);
      else reject(new Error(event.data.error ?? "Could not read this Timeline file."));
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error("Could not read this Timeline file."));
    };
    worker.postMessage(file);
  });
}
