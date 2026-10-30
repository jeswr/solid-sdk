// AUTHORED-BY Codex GPT-6.1-Sol
/** Presentation state only. The transport owns aborting requests and durable storage. */
export type UploadStatus =
  | "queued"
  | "uploading"
  | "paused"
  | "waiting"
  | "done"
  | "failed"
  | "skipped";
export type UploadFailure = "quota" | "too-large" | "unreachable" | "forbidden" | "unknown";
export interface UploadItem {
  readonly id: string;
  readonly name: string;
  readonly total: number;
  readonly sent: number;
  readonly status: UploadStatus;
  /** Changes each time a transport starts; stale callbacks are ignored. */
  readonly attempt: number;
  readonly error?: UploadFailure;
}
export type UploadAction =
  | { type: "enqueue"; files: readonly { id: string; name: string; total: number }[] }
  | { type: "start" | "pause" | "resume" | "cancel" | "retry" | "wait"; id: string }
  | { type: "progress"; id: string; attempt: number; sent: number }
  | { type: "complete"; id: string; attempt: number }
  | { type: "fail"; id: string; attempt: number; error: UploadFailure };

export function uploadQueueReducer(
  items: readonly UploadItem[],
  action: UploadAction,
): readonly UploadItem[] {
  if (action.type === "enqueue") {
    const ids = new Set(items.map((item) => item.id));
    const added: UploadItem[] = [];
    for (const file of action.files) {
      if (ids.has(file.id) || !Number.isFinite(file.total) || file.total < 0) continue;
      ids.add(file.id);
      added.push({ ...file, sent: 0, status: "queued", attempt: 0 });
    }
    return [...items, ...added];
  }
  return items.map((item) => {
    if (item.id !== action.id) return item;
    switch (action.type) {
      case "start":
        return item.status === "queued" && items.filter((i) => i.status === "uploading").length < 3
          ? { ...item, status: "uploading", attempt: item.attempt + 1 }
          : item;
      case "pause":
        return ["queued", "uploading", "waiting"].includes(item.status)
          ? { ...item, status: "paused" }
          : item;
      case "resume":
        return item.status === "paused" || item.status === "waiting"
          ? { ...item, status: "queued" }
          : item;
      case "wait":
        return item.status === "queued" || item.status === "uploading"
          ? { ...item, status: "waiting" }
          : item;
      case "cancel":
        return ["queued", "uploading", "paused", "waiting", "failed"].includes(item.status)
          ? { ...item, status: "skipped" }
          : item;
      case "retry": {
        if (item.status !== "failed") return item;
        const { error: _error, ...rest } = item;
        return { ...rest, status: "queued", sent: 0 };
      }
      case "progress":
        return item.status === "uploading" &&
          item.attempt === action.attempt &&
          Number.isFinite(action.sent)
          ? { ...item, sent: Math.min(item.total, Math.max(item.sent, action.sent)) }
          : item;
      case "complete":
        return item.status === "uploading" && item.attempt === action.attempt
          ? { ...item, status: "done", sent: item.total }
          : item;
      case "fail":
        return item.status === "uploading" && item.attempt === action.attempt
          ? { ...item, status: "failed", error: action.error }
          : item;
    }
    return item;
  });
}
export function uploadSummary(items: readonly UploadItem[]): string {
  const count = (status: UploadStatus) => items.filter((item) => item.status === status).length;
  return `${items.length} files · ${count("done")} uploaded · ${count("uploading")} uploading · ${count("queued")} queued · ${count("paused")} paused · ${count("waiting")} waiting · ${count("failed")} failed · ${count("skipped")} cancelled`;
}
export const uploadFailureCopy: Record<UploadFailure, string> = {
  quota: "Your pod is full",
  "too-large": "This file is too large for your storage",
  unreachable: "Can't reach your storage",
  forbidden: "You don't have access to this",
  unknown: "Something went wrong",
};
