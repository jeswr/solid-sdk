// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it, vi } from "vitest";
import { createUndoStack, type UndoEntry } from "./undo.js";

const entry = (label: string, scope = "tasks"): UndoEntry & Required<Pick<UndoEntry, "redo">> => ({
  label,
  scope,
  undo: vi.fn(async () => {}),
  redo: vi.fn(async () => {}),
});
const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
describe("account undo history", () => {
  it("undoes latest in each scope, redoes in reverse undo order, and addresses toast IDs", async () => {
    const stack = createUndoStack();
    const a = entry("A"),
      b = entry("B"),
      c = entry("C", "drive");
    const id = stack.push(a);
    stack.push(b);
    stack.push(c);
    expect(stack.entries("tasks").map((item) => item.label)).toEqual(["A", "B"]);
    expect(stack.entries()).toBe(stack.entries());
    expect(stack.entries()[0]).toEqual({ id, label: "A", scope: "tasks", canRedo: true });
    expect(await stack.undo("tasks")).toEqual({ status: "done" });
    expect(b.undo).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(c.undo).not.toHaveBeenCalled();
    expect(await stack.undoById(id)).toEqual({ status: "done" });
    await stack.redo("tasks");
    expect(a.redo).toHaveBeenCalledOnce();
    await stack.redo("tasks");
    expect(b.redo).toHaveBeenCalledOnce();
    await stack.undo("drive");
    expect(c.undo).toHaveBeenCalledOnce();
    expect(await stack.undoById("missing")).toEqual({ status: "nothing" });
    expect(await stack.undoById(stack.entries()[0]?.id ?? "missing")).toEqual({ status: "done" });
  });
  it("consumes undo-only entries and clears redo only for the pushed scope", async () => {
    const stack = createUndoStack();
    const a = entry("A"),
      b = entry("B", "drive");
    stack.push(a);
    stack.push(b);
    await stack.undo("tasks");
    await stack.undo("drive");
    stack.push({ label: "C", scope: "tasks", undo: async () => {} });
    expect(stack.entries()[0]?.canRedo).toBe(false);
    expect(await stack.redo("tasks")).toEqual({ status: "nothing" });
    expect(await stack.redo("drive")).toEqual({ status: "done" });
    await stack.undo("tasks");
    expect(await stack.undo("tasks")).toEqual({ status: "nothing" });
    expect(await stack.redo("tasks")).toEqual({ status: "nothing" });
  });
  it("limits each scope independently, including default 50 and redo history", async () => {
    const stack = createUndoStack({ limit: 2 });
    stack.push(entry("A"));
    stack.push(entry("B"));
    await stack.undo("tasks");
    stack.push(entry("drive", "drive"));
    stack.push(entry("C"));
    stack.push(entry("D"));
    expect(stack.entries().map((item) => item.label)).toEqual(["drive", "C", "D"]);
    const defaults = createUndoStack();
    for (let i = 0; i < 51; i++) defaults.push(entry(String(i)));
    expect(defaults.entries()).toHaveLength(50);
    expect(defaults.entries()[0]?.label).toBe("1");
    for (const limit of [0, -1, 1.5, Infinity, NaN])
      expect(() => createUndoStack({ limit })).toThrow(RangeError);
  });
  it("drops expired entries at the boundary, skips them for the next live undo, and expires redo", async () => {
    let now = 10;
    const stack = createUndoStack({ now: () => now });
    const a = entry("live"),
      b = { ...entry("expires"), expiresAt: 20 };
    stack.push(a);
    const id = stack.push(b);
    now = 20;
    expect(await stack.undoById(id)).toEqual({ status: "expired" });
    expect(b.undo).not.toHaveBeenCalled();
    await stack.undo("tasks");
    expect(a.undo).toHaveBeenCalledOnce();
    const c = { ...entry("redo"), expiresAt: 30 };
    stack.push(c);
    await stack.undo("tasks");
    now = 30;
    expect(await stack.redo("tasks")).toEqual({ status: "expired" });
    expect(c.redo).not.toHaveBeenCalled();
    const d = { ...entry("drop on read"), expiresAt: 40 };
    stack.push(d);
    now = 40;
    expect(stack.entries()).toEqual([]);
    const e = { ...entry("expired push"), expiresAt: 0 };
    stack.push(e);
    expect(stack.entries()).toEqual([]);
    stack.push(entry("under expired"));
    stack.push({ ...entry("top expired"), expiresAt: 50 });
    now = 50;
    expect(await stack.undo("tasks")).toEqual({ status: "done" });
  });
  it("serializes undo, redo and toast calls across scopes, including reentrant subscribers", async () => {
    const stack = createUndoStack();
    const wait = deferred();
    const a = { ...entry("slow"), undo: vi.fn(() => wait.promise) };
    stack.push(a);
    let nested: Promise<unknown> | undefined;
    const stop = stack.subscribe(() => {
      nested ??= stack.undo("drive");
    });
    const running = stack.undo("tasks");
    expect(await nested).toEqual({ status: "busy" });
    expect(await stack.undo("drive")).toEqual({ status: "busy" });
    expect(await stack.undoById("missing")).toEqual({ status: "busy" });
    expect(await stack.redo("tasks")).toEqual({ status: "busy" });
    stop();
    wait.resolve();
    expect(await running).toEqual({ status: "done" });
    const redoWait = deferred();
    const b = { ...entry("redo slow"), redo: () => redoWait.promise };
    stack.push(b);
    await stack.undo("tasks");
    const redo = stack.redo("tasks");
    expect(await stack.undo("tasks")).toEqual({ status: "busy" });
    redoWait.resolve();
    await redo;
  });
  it.each([false, true])("keeps failed operations only when retryable = %s", async (retryable) => {
    const error = new Error("offline");
    const isRetryable = vi.fn(() => retryable);
    const stack = createUndoStack({ isRetryable });
    const a = entry("retry");
    vi.mocked(a.undo).mockRejectedValueOnce(error);
    stack.push(a);
    expect(await stack.undo("tasks")).toEqual({ status: "failed", error });
    expect(isRetryable).toHaveBeenCalledWith(error);
    expect(stack.entries()).toHaveLength(retryable ? 1 : 0);
    if (retryable) {
      await stack.undo("tasks");
      vi.mocked(a.redo).mockRejectedValueOnce(error);
      expect(await stack.redo("tasks")).toEqual({ status: "failed", error });
      expect(await stack.redo("tasks")).toEqual({ status: "done" });
    }
  });
  it("drops errors by default, including synchronous throws and failed redo", async () => {
    const stack = createUndoStack();
    const error = "failure";
    stack.push({
      ...entry("sync"),
      undo() {
        throw error;
      },
    });
    expect(await stack.undo("tasks")).toEqual({ status: "failed", error });
    expect(stack.entries()).toEqual([]);
    const a = entry("redo");
    vi.mocked(a.redo).mockRejectedValue(error);
    stack.push(a);
    await stack.undo("tasks");
    expect(await stack.redo("tasks")).toEqual({ status: "failed", error });
    expect(await stack.redo("tasks")).toEqual({ status: "nothing" });
  });
  it.each([
    "resolve",
    "reject",
  ] as const)("clear aborts and fences late %s without reviving history", async (settle) => {
    const stack = createUndoStack({ isRetryable: () => true });
    const wait = deferred();
    const undo = vi.fn(() => wait.promise);
    stack.push({ ...entry("old"), undo });
    const running = stack.undo("tasks");
    const signal = undo.mock.calls[0] as unknown as [AbortSignal];
    stack.clear();
    expect(signal[0].aborted).toBe(true);
    expect(stack.entries()).toEqual([]);
    stack.push(entry("new"));
    if (settle === "resolve") wait.resolve();
    else wait.reject(new Error("late"));
    expect(await running).toEqual({ status: "nothing" });
    expect(stack.entries().map((item) => item.label)).toEqual(["new"]);
    expect(await stack.redo("tasks")).toEqual({ status: "nothing" });
  });
  it("does not resurrect redo after a push during undo/redo, eviction, or expiry during execution", async () => {
    const stack = createUndoStack({ limit: 1 });
    const wait = deferred();
    stack.push({ ...entry("old"), undo: () => wait.promise });
    const run = stack.undo("tasks");
    stack.push(entry("new"));
    wait.resolve();
    await run;
    expect(await stack.redo("tasks")).toEqual({ status: "nothing" });
    const broader = createUndoStack();
    const hold = deferred();
    broader.push({ ...entry("old"), undo: () => hold.promise });
    const undo = broader.undo("tasks");
    broader.push(entry("new"));
    hold.resolve();
    await undo;
    expect(await broader.redo("tasks")).toEqual({ status: "nothing" });
    const redoHold = deferred();
    broader.push({ ...entry("redo"), redo: () => redoHold.promise });
    await broader.undo("tasks");
    const redo = broader.redo("tasks");
    broader.push(entry("branch"));
    redoHold.resolve();
    await redo;
    expect(broader.entries().map((item) => item.label)).toEqual(["new", "branch"]);
    let now = 0;
    const expiring = createUndoStack({ now: () => now });
    const last = deferred();
    expiring.push({ ...entry("expires"), expiresAt: 1, undo: () => last.promise });
    const pending = expiring.undo("tasks");
    now = 1;
    last.resolve();
    await pending;
    expect(expiring.entries()).toEqual([]);
  });
  it("notifies subscribers on changes and releases listeners", async () => {
    const stack = createUndoStack();
    const listener = vi.fn();
    const stop = stack.subscribe(listener);
    stack.push(entry("A"));
    expect(listener).toHaveBeenCalledOnce();
    await stack.undo("tasks");
    await stack.redo("tasks");
    stack.clear();
    expect(listener).toHaveBeenCalledTimes(6);
    stop();
    stack.push(entry("B"));
    expect(listener).toHaveBeenCalledTimes(6);
  });
});

it("never invokes callbacks expired or cleared by a start notification", async () => {
  let now = 0;
  const stack = createUndoStack({ now: () => now });
  const operation = { ...entry("deadline"), expiresAt: 10 };
  stack.push(operation);
  const unsubscribe = stack.subscribe(() => {
    now = 10;
  });
  expect(await stack.undo("tasks")).toEqual({ status: "expired" });
  expect(operation.undo).not.toHaveBeenCalled();
  unsubscribe();
  const cleared = entry("retired");
  stack.push(cleared);
  const stop = stack.subscribe(() => {
    stop();
    stack.clear();
  });
  expect(await stack.undo("tasks")).toEqual({ status: "nothing" });
  expect(cleared.undo).not.toHaveBeenCalled();
});
