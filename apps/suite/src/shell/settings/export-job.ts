// AUTHORED-BY Codex GPT-6.1-Sol
import {
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
}

/** Owns cancellation, stale settlements, and Blob URLs for one mounted account. */
export function createTakeoutJob(
  fetch: typeof globalThis.fetch,
  root: string,
  urls = {
    create: (blob: Blob) => URL.createObjectURL(blob),
    revoke: (url: string) => URL.revokeObjectURL(url),
  },
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
        if (!signal.aborted) publish({ phase: "ready", plan });
      } catch {
        if (!signal.aborted)
          publish({ phase: "error", error: "Could not estimate your export. Try again." });
      }
    },
    async start() {
      const plan = state.plan;
      if (!plan || state.phase !== "ready") return;
      const signal = begin();
      if (signal.aborted) return;
      publish({ phase: "exporting", plan });
      const chunks: BlobPart[] = [];
      try {
        const manifest = await exportPod({
          fetch,
          root,
          plan,
          signal,
          sink(chunk) {
            chunks.push(new Uint8Array(chunk));
          },
          onProgress(progress) {
            if (!signal.aborted) publish({ phase: "exporting", plan, progress });
          },
        });
        if (!signal.aborted)
          publish({
            phase: "complete",
            plan,
            manifest,
            download: urls.create(new Blob(chunks, { type: "application/zip" })),
          });
      } catch {
        if (!signal.aborted) publish({ phase: "error", error: "Export failed. Try again." });
      } finally {
        chunks.length = 0;
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
