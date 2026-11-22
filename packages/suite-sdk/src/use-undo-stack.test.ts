// AUTHORED-BY Codex GPT-6.1-Sol
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { createUndoStack, type UndoItem, type UndoStack } from "./undo.js";
import { useUndoStack } from "./use-undo-stack.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let snapshot: ReadonlyArray<UndoItem>;
function Probe({ stack }: { stack: UndoStack }) {
  snapshot = useUndoStack(stack);
  return null;
}
async function render(stack: UndoStack) {
  root ??= createRoot(document.createElement("div"));
  const mounted = root;
  await act(() => mounted.render(createElement(StrictMode, null, createElement(Probe, { stack }))));
}
afterEach(async () => {
  const mounted = root;
  if (mounted) await act(() => mounted.unmount());
  root = undefined;
});
it("subscribes, keeps stable snapshots, replaces subscriptions and observes clear/undo/redo", async () => {
  const a = createUndoStack();
  const b = createUndoStack();
  await render(a);
  const empty = snapshot;
  await render(a);
  expect(snapshot).toBe(empty);
  await act(() => {
    a.push({ label: "Done", scope: "tasks", undo: async () => {}, redo: async () => {} });
  });
  expect(snapshot[0]?.label).toBe("Done");
  await act(() => a.undo("tasks"));
  expect(snapshot).toEqual([]);
  await act(() => a.redo("tasks"));
  expect(snapshot).toHaveLength(1);
  await render(b);
  expect(snapshot).toEqual([]);
  const before = snapshot;
  await act(() => a.clear());
  expect(snapshot).toBe(before);
  await act(() => {
    b.push({ label: "B", scope: "drive", undo: async () => {} });
  });
  expect(snapshot[0]?.label).toBe("B");
  await act(() => b.clear());
  expect(snapshot).toEqual([]);
});
it("uses an empty server snapshot for hydration", () => {
  const stack = createUndoStack();
  stack.push({ label: "private", scope: "tasks", undo: async () => {} });
  renderToString(createElement(Probe, { stack }));
  expect(snapshot).toEqual([]);
});
