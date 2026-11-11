// AUTHORED-BY Codex GPT-6
import {
  createShareInbox,
  isNativeApp,
  type ShareBatch,
  type ShareInbox,
  type ShareIntakePlugin,
} from "@jeswr/suite-native";
import type { UploadQueue, UploadTask } from "@/apps/drive/state/uploads";

export interface ShareProgress {
  status: "saving" | "saved" | "discarded" | "failed";
  task?: UploadTask;
  queue?: Pick<UploadQueue, "retry" | "resolve" | "cancel">;
}
export interface IntakeSnapshot {
  batches: readonly ShareBatch[];
  progress: Readonly<Record<string, Readonly<Record<number, ShareProgress>>>>;
  error: boolean;
}
const empty: IntakeSnapshot = { batches: [], progress: {}, error: false };

/** Keep claimed batches and receipts across route changes: the SDK hands each batch out once. */
export function createShareIntake(load: () => Promise<ShareInbox>) {
  let snapshot = empty;
  let inbox: Promise<ShareInbox> | undefined;
  const listeners = new Set<() => void>();
  const finishing = new Set<string>();
  const acknowledged = new Set<string>();
  const getInbox = () => {
    inbox ??= load().catch((error: unknown) => {
      inbox = undefined;
      throw error;
    });
    return inbox;
  };
  const publish = (next: IntakeSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const add = (batches: readonly ShareBatch[]) => {
    const byId = new Map(snapshot.batches.map((batch) => [batch.id, batch]));
    for (const batch of batches) if (!acknowledged.has(batch.id)) byId.set(batch.id, batch);
    publish({
      ...snapshot,
      error: false,
      batches: [...byId.values()].sort(
        (a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt),
      ),
    });
  };
  const acknowledge = async (batch: ShareBatch) => {
    if (finishing.has(batch.id) || acknowledged.has(batch.id)) return;
    finishing.add(batch.id);
    try {
      await (await getInbox()).acknowledge(batch);
      acknowledged.add(batch.id);
      const progress = { ...snapshot.progress };
      delete progress[batch.id];
      publish({
        batches: snapshot.batches.filter((pending) => pending.id !== batch.id),
        progress,
        error: false,
      });
    } catch {
      publish({ ...snapshot, error: true });
    } finally {
      finishing.delete(batch.id);
    }
  };
  const finish = async (batch: ShareBatch) => {
    if (
      batch.items.every((_, index) =>
        ["saved", "discarded"].includes(snapshot.progress[batch.id]?.[index]?.status ?? ""),
      )
    )
      await acknowledge(batch);
  };
  const update = (batch: ShareBatch, index: number, value: ShareProgress) => {
    if (!snapshot.batches.some((pending) => pending.id === batch.id)) return;
    publish({
      ...snapshot,
      progress: {
        ...snapshot.progress,
        [batch.id]: { ...snapshot.progress[batch.id], [index]: value },
      },
    });
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => empty,
    async refresh() {
      try {
        add(await (await getInbox()).takePending());
      } catch {
        publish({ ...snapshot, error: true });
      }
    },
    async listen() {
      return (await getInbox()).onReceived((batch) => add([batch]));
    },
    readFile: async (batch: ShareBatch, index: number) => (await getInbox()).readFile(batch, index),
    begin(batch: ShareBatch, index: number) {
      const before = snapshot.progress[batch.id]?.[index];
      if (before && before.status !== "failed") return false;
      update(batch, index, { status: "saving" });
      return true;
    },
    fail: (batch: ShareBatch, index: number) => update(batch, index, { status: "failed" }),
    async saved(batch: ShareBatch, index: number) {
      update(batch, index, { status: "saved" });
      await finish(batch);
    },
    async discardItem(batch: ShareBatch, index: number) {
      update(batch, index, { status: "discarded" });
      await finish(batch);
    },
    uploadChanged(batch: ShareBatch, index: number, task: UploadTask, queue: UploadQueue) {
      update(batch, index, {
        status:
          task.status === "done"
            ? "saved"
            : ["failed", "skipped"].includes(task.status)
              ? "failed"
              : "saving",
        task,
        queue,
      });
      if (task.status === "done") void finish(batch);
    },
    finish,
    discard: acknowledge,
  };
}
export type ShareIntake = ReturnType<typeof createShareIntake>;

async function loadNativeInbox(): Promise<ShareInbox> {
  if (!isNativeApp()) throw new Error("Native shares are unavailable");
  // Explicit fixture builds only. The ordinary production build eliminates this branch.
  if (process.env.NEXT_PUBLIC_DEV_FIXTURES === "1") {
    const fixture = (globalThis as { suiteShareIntakeFixture?: ShareIntakePlugin })
      .suiteShareIntakeFixture;
    if (fixture) return createShareInbox(fixture);
  }
  const { shareIntakePlugin } = await import("@jeswr/suite-native/capacitor");
  return createShareInbox(shareIntakePlugin);
}

export const nativeShareIntake = createShareIntake(loadNativeInbox);
