// AUTHORED-BY Codex GPT-6.1-Sol
import {
  ExportLimitError,
  type ExportManifest,
  type ExportPlan,
  type ExportProgress,
  exportPod,
  planExport,
} from "@jeswr/pod-export";

export interface TakeoutState {
  phase: "idle" | "planning" | "ready" | "exporting" | "complete" | "cancelled" | "error";
  plan?: ExportPlan;
  progress?: ExportProgress;
  manifest?: ExportManifest;
  download?: string;
  error?: string;
  warning?: string;
  saved?: boolean;
}

export const MEMORY_EXPORT_LIMIT = 1024 ** 3;
interface SaveDestination {
  write(chunk: Uint8Array): Promise<void>;
  seek(offset: number): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
export type PickExportFile = () => Promise<{ createWritable(): Promise<SaveDestination> }>;
const browserPicker = (): PickExportFile | undefined => {
  const picker = (
    globalThis as typeof globalThis & {
      showSaveFilePicker?: (options: unknown) => ReturnType<PickExportFile>;
    }
  ).showSaveFilePicker;
  return picker
    ? () =>
        picker.call(globalThis, {
          suggestedName: exportFilename(),
          types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }],
        })
    : undefined;
};

/** Owns cancellation, stale settlements, and Blob URLs for one mounted account. */
export function createTakeoutJob(
  fetch: typeof globalThis.fetch,
  root: string,
  urls = {
    create: (blob: Blob) => URL.createObjectURL(blob),
    revoke: (url: string) => URL.revokeObjectURL(url),
  },
  pickFile: PickExportFile | undefined = browserPicker(),
) {
  let state: TakeoutState = { phase: "idle" };
  let controller = new AbortController();
  let disposed = false;
  const listeners = new Set<() => void>();
  const publish = (next: TakeoutState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const begin = () => {
    controller.abort();
    if (state.download) urls.revoke(state.download);
    controller = new AbortController();
    if (disposed) controller.abort();
    return controller.signal;
  };
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async plan(include?: readonly string[]) {
      const signal = begin();
      if (signal.aborted) return;
      publish({ phase: "planning" });
      try {
        const plan = await planExport({
          fetch,
          root,
          signal,
          ...(include === undefined ? {} : { include }),
        });
        if (!signal.aborted)
          publish({
            phase: "ready",
            plan,
            ...(plan.unknownSizes > 0
              ? {
                  warning:
                    "Some file sizes are unknown. The export may exceed the estimate; choose folders for a smaller download.",
                }
              : {}),
          });
      } catch (error) {
        if (!signal.aborted)
          publish({
            phase: "error",
            error:
              error instanceof ExportLimitError
                ? "This export exceeds the resource or depth limit. Choose folders or apps for a smaller export."
                : "Could not estimate your export. Try again.",
          });
      }
    },
    async start() {
      const plan = state.plan;
      if (!plan || state.phase !== "ready") return;
      const signal = begin();
      if (signal.aborted) return;
      if (!pickFile && plan.estimatedBytes >= MEMORY_EXPORT_LIMIT) {
        publish({
          phase: "error",
          error:
            "This browser holds downloads in memory and the estimate exceeds the 1 GiB limit. Choose folders or apps for a smaller export.",
        });
        return;
      }
      publish({ phase: "exporting", plan });
      const chunks: Uint8Array[] = [];
      const headers = new Map<number, Uint8Array>();
      let destination: SaveDestination | undefined;
      let written = 0;
      let lastProgress = -Infinity;
      try {
        // Invoke the picker synchronously from the button click, before any pod GET.
        if (pickFile) {
          const handle = await pickFile();
          if (signal.aborted) return;
          destination = await handle.createWritable();
          if (signal.aborted) return;
        }
        const manifest = await exportPod({
          fetch,
          root,
          plan,
          signal,
          async sink(chunk) {
            if (destination) await destination.write(chunk);
            else {
              if (written + chunk.byteLength >= MEMORY_EXPORT_LIMIT)
                throw new RangeError("memory-limit");
              headers.set(written, chunk);
              chunks.push(chunk);
            }
            written += chunk.byteLength;
          },
          async patch(offset, chunk) {
            if (destination) {
              await destination.seek(offset);
              await destination.write(chunk);
              await destination.seek(written);
            } else headers.get(offset)?.set(chunk);
          },
          onProgress(progress) {
            const now = Date.now();
            if (!signal.aborted && now - lastProgress >= 100) {
              lastProgress = now;
              publish({ phase: "exporting", plan, progress });
            }
          },
        });
        if (signal.aborted) return;
        if (destination) await destination.close();
        if (!signal.aborted)
          publish({
            phase: "complete",
            plan,
            manifest,
            ...(destination
              ? { saved: true }
              : {
                  download: urls.create(
                    new Blob(chunks as BlobPart[], { type: "application/zip" }),
                  ),
                }),
          });
      } catch (error) {
        const pickerCancelled =
          !destination && error instanceof DOMException && error.name === "AbortError";
        if (!signal.aborted)
          publish({
            phase: pickerCancelled ? "ready" : "error",
            ...(pickerCancelled ? { plan } : {}),
            error:
              error instanceof RangeError && error.message === "memory-limit"
                ? "The export reached this browser's 1 GiB memory limit. Choose folders or apps for a smaller export."
                : pickerCancelled
                  ? "No file was selected. Start export to try again."
                  : "Export failed. Try again.",
          });
      } finally {
        if (destination && (signal.aborted || state.phase !== "complete"))
          await destination.abort().catch(() => {});
        chunks.length = 0;
        headers.clear();
      }
    },
    cancel() {
      begin();
      if (!disposed) publish({ phase: "cancelled" });
    },
    dispose() {
      disposed = true;
      begin();
      listeners.clear();
    },
  };
}

export function exportFolders(plan: ExportPlan): { url: string; label: string }[] {
  const root = new URL(plan.root);
  return plan.resources
    .filter(
      (item) =>
        item.kind === "container" &&
        item.url !== plan.root &&
        new URL(item.url).pathname.slice(root.pathname.length).split("/").filter(Boolean).length ===
          1,
    )
    .map((item) => {
      const raw = new URL(item.url).pathname.slice(root.pathname.length).replace(/\/$/, "");
      let label = raw;
      try {
        label = decodeURIComponent(raw);
      } catch {}
      return { url: item.url, label: `${label}/` };
    });
}
export function exportFilename(date = new Date()): string {
  return `pod-export-${date.toISOString().slice(0, 10)}.zip`;
}
