// AUTHORED-BY Claude Sonnet 5.5
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSessionResource } from "../src/index.js";

describe("useSessionResource", () => {
  it("stays null without a session and never resolves", () => {
    const resolve = vi.fn(async () => "x");
    const { result } = renderHook(() => useSessionResource(null, resolve, () => "fb"));
    expect(result.current).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("resolves for a session, and resets to null on sign-out", async () => {
    let session: { id: string } | null = { id: "a" };
    const { result, rerender } = renderHook(() =>
      useSessionResource(
        session,
        async (s) => `resolved-${s.id}`,
        () => "fb",
      ),
    );
    await waitFor(() => expect(result.current).toBe("resolved-a"));
    session = null;
    rerender();
    expect(result.current).toBeNull();
  });

  it("falls back when resolution rejects", async () => {
    const session = { id: "a" };
    const { result } = renderHook(() =>
      useSessionResource(
        session,
        async () => {
          throw new Error("nope");
        },
        (s) => `fallback-${s.id}`,
      ),
    );
    await waitFor(() => expect(result.current).toBe("fallback-a"));
  });

  it("drops a stale resolution after the session changes", async () => {
    let release: (v: string) => void = () => {};
    const slow = new Promise<string>((r) => {
      release = r;
    });
    let session = { id: "old" };
    const { result, rerender } = renderHook(() =>
      useSessionResource(
        session,
        (s) => (s.id === "old" ? slow : Promise.resolve("new-value")),
        () => "fb",
      ),
    );
    session = { id: "new" };
    rerender();
    await waitFor(() => expect(result.current).toBe("new-value"));
    await act(async () => {
      release("old-value");
      await slow;
    });
    expect(result.current).toBe("new-value");
  });

  it("re-resolves when deps change", async () => {
    const session = { id: "a" };
    const resolve = vi.fn(async () => "v");
    const { rerender } = renderHook(
      ({ dep }) => useSessionResource(session, resolve, () => "fb", [dep]),
      { initialProps: { dep: 1 } },
    );
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    rerender({ dep: 2 });
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
  });
});
