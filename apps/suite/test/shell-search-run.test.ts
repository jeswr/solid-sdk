// AUTHORED-BY Claude Opus 5.5
import { describe, expect, it, vi } from "vitest";
import type { SearchResult, SearchSource } from "../src/shell/lib/search-results";
import { runSearch } from "../src/shell/lib/search-run";

const result = (title: string): SearchResult => ({
  id: title,
  title,
  type: "file",
  href: `/drive/f/${title}`,
  app: "drive",
});

function deferredSource() {
  const pending: Array<{ resolve: (r: SearchResult[]) => void; reject: (e: unknown) => void }> = [];
  const source: SearchSource = {
    search: () =>
      new Promise((resolve, reject) =>
        pending.push({
          resolve: (results) => resolve({ results, source: "local", serverSearch: false }),
          reject,
        }),
      ),
  };
  return { source, pending };
}

describe("runSearch", () => {
  it("drops a stale success that resolves after a newer search", async () => {
    const { source, pending } = deferredSource();
    const report = vi.fn();
    const first = new AbortController();
    const slow = runSearch(source, "bud", { signal: first.signal }, report);
    first.abort();
    const second = new AbortController();
    const fast = runSearch(source, "budget", { signal: second.signal }, report);
    pending[1]?.resolve([result("new")]);
    await fast;
    pending[0]?.resolve([result("old")]);
    await slow;
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith({ kind: "results", results: [result("new")] });
  });

  it("drops a stale failure and reports a live one", async () => {
    const { source, pending } = deferredSource();
    const report = vi.fn();
    const stale = new AbortController();
    const dropped = runSearch(source, "a", { signal: stale.signal }, report);
    stale.abort();
    pending[0]?.reject(new Error("aborted"));
    await dropped;
    expect(report).not.toHaveBeenCalled();
    const live = new AbortController();
    const reported = runSearch(source, "a", { scope: "drive", signal: live.signal }, report);
    pending[1]?.reject(new Error("offline"));
    await reported;
    expect(report).toHaveBeenCalledWith({ kind: "error" });
  });
});
