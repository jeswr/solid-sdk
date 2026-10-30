// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSelection } from "../src/collections/use-selection.js";

const keys = ["a", "b", "c", "d", "e"];
describe("useSelection", () => {
  it("toggles independently and replaces on plain selection", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle("a"));
    act(() => result.current.toggle("c"));
    expect([...result.current.selectedKeys]).toEqual(["a", "c"]);
    act(() => result.current.toggle("a"));
    expect([...result.current.selectedKeys]).toEqual(["c"]);
    act(() => result.current.select("b", keys));
    expect([...result.current.selectedKeys]).toEqual(["b"]);
  });
  it("extends and shrinks in either direction using the displayed order", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle("c"));
    act(() => result.current.select("e", keys, { range: true }));
    expect([...result.current.selectedKeys]).toEqual(["c", "d", "e"]);
    act(() => result.current.select("b", keys, { range: true }));
    expect([...result.current.selectedKeys]).toEqual(["b", "c"]);
    act(() => result.current.select("a", ["e", "c", "a"], { range: true }));
    expect([...result.current.selectedKeys]).toEqual(["c", "a"]);
  });
  it("anchors Shift+Arrow at the previously focused item when nothing is selected", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.select("d", keys, { range: true }, "c"));
    expect([...result.current.selectedKeys]).toEqual(["c", "d"]);
  });
  it("preserves hidden selections when selecting and deselecting filtered results", () => {
    const { result } = renderHook(() => useSelection({ defaultSelectedKeys: ["e"] }));
    act(() => result.current.selectAll(["a", "c"]));
    expect([...result.current.selectedKeys]).toEqual(["e", "a", "c"]);
    act(() => result.current.toggleAll(["a", "c"]));
    expect([...result.current.selectedKeys]).toEqual(["e"]);
    act(() => result.current.toggleAll([]));
    expect([...result.current.selectedKeys]).toEqual(["e"]);
  });
  it("handles a filtered-out anchor and supports additive ranges", () => {
    const { result } = renderHook(() => useSelection());
    act(() => result.current.toggle("e"));
    act(() => result.current.select("b", ["a", "b"], { range: true, additive: true }));
    expect([...result.current.selectedKeys]).toEqual(["e", "b"]);
    act(() => result.current.clear());
    expect(result.current.selectedKeys.size).toBe(0);
  });
  it("supports a controlled model without mutating the supplied Set", () => {
    const selected = new Set(["a"]);
    let changed: ReadonlySet<string> = selected;
    const { result, rerender } = renderHook(
      (selectedKeys) =>
        useSelection({
          selectedKeys,
          onSelectionChange: (value) => {
            changed = value;
          },
        }),
      { initialProps: selected as ReadonlySet<string> },
    );
    act(() => result.current.toggle("b"));
    expect([...selected]).toEqual(["a"]);
    expect([...changed]).toEqual(["a", "b"]);
    rerender(changed);
    expect([...result.current.selectedKeys]).toEqual(["a", "b"]);
  });
});
