// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it, vi } from "vitest";
import {
  createLocalOutbox,
  EMPTY_OUTBOX,
  outboxKey,
  parseOutbox,
  serializeOutbox,
} from "../src/shell/lib/outbox";

const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 12, minute));
const stored = {
  pending: [
    {
      id: "rename",
      label: "Rename project brief",
      where: "My Drive / Work",
      queuedAt: at(1).toISOString(),
      state: "pending",
    },
    {
      id: "save",
      label: "Save meeting notes",
      where: "My Drive",
      queuedAt: at(2).toISOString(),
      state: "failed",
      error: "Your storage could not save this change.",
    },
  ],
  conflicts: [
    {
      id: "brief",
      name: "Project brief",
      where: "My Drive / Work",
      summary: "You changed the title. Another device changed the introduction.",
      changedAt: at(3).toISOString(),
    },
  ],
  lastSyncedAt: at(0).toISOString(),
};

function memoryStorage(initial?: string) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(outboxKey("demo"), initial);
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

function setup(initial?: string) {
  const storage = memoryStorage(initial);
  let minute = 10;
  let id = 0;
  const outbox = createLocalOutbox({
    storage,
    key: outboxKey("demo"),
    now: () => at(minute++),
    newId: () => `change-${++id}`,
  });
  return { outbox, storage };
}

describe("outbox storage", () => {
  it("keys the outbox per account", () => expect(outboxKey("demo")).toBe("suite.outbox.v1.demo"));

  it("round-trips descriptions with dates and optional errors", () => {
    const snapshot = parseOutbox(JSON.stringify(stored));
    expect(snapshot.pending).toEqual([
      {
        id: "rename",
        label: "Rename project brief",
        where: "My Drive / Work",
        queuedAt: at(1),
        state: "pending",
      },
      {
        id: "save",
        label: "Save meeting notes",
        where: "My Drive",
        queuedAt: at(2),
        state: "failed",
        error: "Your storage could not save this change.",
      },
    ]);
    expect(snapshot.conflicts[0]?.changedAt).toEqual(at(3));
    expect(snapshot.lastSyncedAt).toEqual(at(0));
    expect(parseOutbox(serializeOutbox(snapshot))).toEqual(snapshot);
  });

  it.each([null, "", "{", "null", "[]", "7"])("treats unreadable state as empty: %j", (raw) =>
    expect(parseOutbox(raw)).toEqual(EMPTY_OUTBOX));

  it("drops malformed entries one by one and ignores a bad sync time", () => {
    const snapshot = parseOutbox(
      JSON.stringify({
        pending: [
          stored.pending[0],
          { ...stored.pending[0], id: "" },
          { ...stored.pending[0], queuedAt: "yesterday" },
          { ...stored.pending[0], state: "sent" },
          "nope",
        ],
        conflicts: "nope",
        lastSyncedAt: 5,
      }),
    );
    expect(snapshot.pending.map((item) => item.id)).toEqual(["rename"]);
    expect(snapshot.conflicts).toEqual([]);
    expect("lastSyncedAt" in snapshot).toBe(false);
  });
});

describe("local outbox", () => {
  it("reads persisted state and notifies subscribers of changes", async () => {
    const { outbox, storage } = setup(JSON.stringify(stored));
    const listener = vi.fn();
    const unsubscribe = outbox.subscribe(listener);
    const before = outbox.getSnapshot();
    expect(before.pending).toHaveLength(2);
    expect(outbox.getSnapshot()).toBe(before);
    const id = outbox.enqueue({ label: "Move holiday plans", where: "My Drive" });
    expect(id).toBe("change-1");
    expect(outbox.getSnapshot().pending.at(-1)).toEqual({
      id,
      label: "Move holiday plans",
      where: "My Drive",
      queuedAt: at(10),
      state: "pending",
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(parseOutbox(storage.getItem(outboxKey("demo")))).toEqual(outbox.getSnapshot());
    unsubscribe();
    await outbox.retryAll();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("a reconnect sends waiting changes; failed ones wait for Retry", async () => {
    const { outbox } = setup(JSON.stringify(stored));
    await outbox.reconnected();
    expect(outbox.getSnapshot().pending.map((item) => item.id)).toEqual(["save"]);
    expect(outbox.getSnapshot().lastSyncedAt).toEqual(at(10));
    const unchanged = outbox.getSnapshot();
    await outbox.reconnected();
    await outbox.retry("missing");
    expect(outbox.getSnapshot()).toBe(unchanged);
    await outbox.retry("save");
    expect(outbox.getSnapshot().pending).toEqual([]);
    expect(outbox.getSnapshot().lastSyncedAt).toEqual(at(11));
  });

  it("Retry all sends everything, and resolving a conflict removes it", async () => {
    const { outbox } = setup(JSON.stringify(stored));
    await outbox.retryAll();
    expect(outbox.getSnapshot().pending).toEqual([]);
    await outbox.resolve("missing", "mine");
    expect(outbox.getSnapshot().conflicts).toHaveLength(1);
    await outbox.resolve("brief", "both");
    expect(outbox.getSnapshot().conflicts).toEqual([]);
    expect(outbox.getSnapshot().lastSyncedAt).toEqual(at(11));
  });

  it("re-reads storage on reload", () => {
    const { outbox, storage } = setup();
    expect(outbox.getSnapshot()).toEqual(EMPTY_OUTBOX);
    const listener = vi.fn();
    outbox.subscribe(listener);
    storage.setItem(outboxKey("demo"), JSON.stringify(stored));
    outbox.reload();
    expect(listener).toHaveBeenCalledOnce();
    expect(outbox.getSnapshot().pending).toHaveLength(2);
  });

  it("keeps working in memory when storage is missing or throws", () => {
    const memory = createLocalOutbox({
      storage: null,
      key: "k",
      now: () => at(1),
      newId: () => "only",
    });
    memory.enqueue({ label: "Save notes", where: "" });
    expect(memory.getSnapshot().pending).toHaveLength(1);
    const broken = createLocalOutbox({
      storage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("full");
        },
      },
      key: "k",
      now: () => at(1),
      newId: () => "only",
    });
    expect(broken.getSnapshot()).toEqual(EMPTY_OUTBOX);
    broken.enqueue({ label: "Save notes", where: "" });
    expect(broken.getSnapshot().pending).toHaveLength(1);
  });
});
