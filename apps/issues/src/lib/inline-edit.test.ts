// AUTHORED-BY Claude Opus 4.8
import { describe, it, expect, vi } from "vitest";
import {
  applyEdit,
  currentValue,
  customFieldSlug,
  makeInlineEditController,
  normalizeTitle,
  optimisticEdit,
  patchForEdit,
  revertEditIfCurrent,
  type InlineEditSeam,
} from "./inline-edit";
import { ConflictError } from "./errors";
import { DEFAULT_WORKFLOW, type WorkflowDef } from "./issue";
import type { IssueRecord, IssuePatch, Repository } from "./repository";

const base: IssueRecord = {
  url: "https://pod.example/issues/a.ttl",
  title: "Original",
  state: "open",
  status: "todo",
  issueType: "task",
  priority: "low",
  assignee: undefined,
  labels: [],
  blockedBy: [],
  relatesTo: [],
  attachments: [],
  comments: [],
  worklog: [],
  loggedSeconds: 0,
  canWrite: true,
  fields: {},
};
const mk = (p: Partial<IssueRecord>): IssueRecord => ({ ...base, ...p });

// todo (initial) → in-progress → done (terminal).
const WF: WorkflowDef = DEFAULT_WORKFLOW;

describe("inline-edit (#75 P1-6)", () => {
  describe("customFieldSlug", () => {
    it("extracts the slug from a field: cell, undefined for core fields", () => {
      expect(customFieldSlug("field:severity")).toBe("severity");
      expect(customFieldSlug("title")).toBeUndefined();
      expect(customFieldSlug("status")).toBeUndefined();
    });
  });

  describe("currentValue", () => {
    it("reads core fields as their slug/string value", () => {
      const i = mk({ title: "T", status: "in-progress", priority: "high", assignee: "https://x/me" });
      expect(currentValue(i, "title")).toBe("T");
      expect(currentValue(i, "status")).toBe("in-progress");
      expect(currentValue(i, "priority")).toBe("high");
      expect(currentValue(i, "assignee")).toBe("https://x/me");
    });

    it("reads a custom field value (and undefined when unset)", () => {
      const i = mk({ fields: { severity: "sev-1" } });
      expect(currentValue(i, "field:severity")).toBe("sev-1");
      expect(currentValue(i, "field:missing")).toBeUndefined();
    });
  });

  describe("applyEdit (optimistic, immutable)", () => {
    it("does not mutate the input record", () => {
      const i = mk({ title: "Original" });
      const out = applyEdit(i, "title", "New", WF);
      expect(i.title).toBe("Original");
      expect(out).not.toBe(i);
      expect(out.title).toBe("New");
    });

    it("couples state=closed when editing into a terminal status", () => {
      const i = mk({ status: "in-progress", state: "open" });
      const out = applyEdit(i, "status", "done", WF);
      expect(out.status).toBe("done");
      expect(out.state).toBe("closed");
    });

    it("couples state=open when editing into a non-terminal status", () => {
      const i = mk({ status: "done", state: "closed" });
      const out = applyEdit(i, "status", "in-progress", WF);
      expect(out.status).toBe("in-progress");
      expect(out.state).toBe("open");
    });

    it("clears an optional field with undefined (priority, assignee, custom)", () => {
      expect(applyEdit(mk({ priority: "high" }), "priority", undefined, WF).priority).toBeUndefined();
      expect(applyEdit(mk({ assignee: "https://x/me" }), "assignee", undefined, WF).assignee).toBeUndefined();
      const cleared = applyEdit(mk({ fields: { sev: "x" } }), "field:sev", undefined, WF);
      expect("sev" in cleared.fields).toBe(false);
    });

    it("sets a custom field value without touching the others", () => {
      const out = applyEdit(mk({ fields: { a: "1", b: "2" } }), "field:b", "9", WF);
      expect(out.fields).toEqual({ a: "1", b: "9" });
    });
  });

  describe("optimisticEdit", () => {
    it("replaces only the edited row and returns the original for revert", () => {
      const a = mk({ url: "a", title: "A" });
      const b = mk({ url: "b", title: "B" });
      const { next, original } = optimisticEdit([a, b], "a", "title", "A2", WF);
      expect(next.find((i) => i.url === "a")!.title).toBe("A2");
      expect(next.find((i) => i.url === "b")).toBe(b); // untouched reference
      expect(original).toBe(a);
    });

    it("is a no-op when the value is unchanged (no Saving…, no write)", () => {
      const a = mk({ url: "a", priority: "high" });
      const list = [a];
      const { next, original } = optimisticEdit(list, "a", "priority", "high", WF);
      // No change → the original list reference is returned and there is no
      // `original` to revert to (so the caller never persists or shows Saving…).
      expect(next).toBe(list);
      expect(original).toBeUndefined();
      expect(next.find((i) => i.url === "a")!.priority).toBe("high");
    });

    it("is a no-op when the url is not present", () => {
      const a = mk({ url: "a" });
      const { next, original } = optimisticEdit([a], "missing", "title", "X", WF);
      expect(next).toEqual([a]);
      expect(original).toBeUndefined();
    });
  });

  describe("revertEditIfCurrent", () => {
    it("rolls back ONLY the edited field onto the current record", () => {
      const original = mk({ url: "a", priority: "low" });
      const optimistic = applyEdit(original, "priority", "high", WF);
      // The current list carries the optimistic value AND an unrelated concurrent
      // edit (a title change) that must be preserved on revert.
      const current = { ...optimistic, title: "Concurrently renamed" };
      const out = revertEditIfCurrent([current], "priority", original, optimistic);
      const row = out.find((i) => i.url === "a")!;
      expect(row.priority).toBe("low"); // rolled back
      expect(row.title).toBe("Concurrently renamed"); // concurrent edit preserved
    });

    it("rolls back BOTH status and the coupled state for a status edit", () => {
      const original = mk({ url: "a", status: "in-progress", state: "open" });
      const optimistic = applyEdit(original, "status", "done", WF); // closes it
      const out = revertEditIfCurrent([optimistic], "status", original, optimistic);
      const row = out.find((i) => i.url === "a")!;
      expect(row.status).toBe("in-progress");
      expect(row.state).toBe("open");
    });

    it("drops a STALE failure when a newer edit of the same field superseded it", () => {
      const original = mk({ url: "a", priority: "low" });
      const optimistic = applyEdit(original, "priority", "high", WF);
      // While the failed write was in flight, the user re-edited to medium.
      const newer = applyEdit(optimistic, "priority", "medium", WF);
      const out = revertEditIfCurrent([newer], "priority", original, optimistic);
      // The newer edit owns the cell — the stale revert is a no-op.
      expect(out.find((i) => i.url === "a")!.priority).toBe("medium");
    });

    it("restores an unset custom field to absent on revert", () => {
      const original = mk({ url: "a", fields: {} });
      const optimistic = applyEdit(original, "field:sev", "sev-1", WF);
      const out = revertEditIfCurrent([optimistic], "field:sev", original, optimistic);
      expect("sev" in out.find((i) => i.url === "a")!.fields).toBe(false);
    });

    it("is a no-op when the row was deleted while the write was pending", () => {
      const original = mk({ url: "a", priority: "low" });
      const optimistic = applyEdit(original, "priority", "high", WF);
      const out = revertEditIfCurrent([], "priority", original, optimistic);
      expect(out).toEqual([]);
    });
  });

  describe("patchForEdit (persistence shape — same repository.update path)", () => {
    it("builds a core-field patch", () => {
      expect(patchForEdit("title", "New")).toEqual({ title: "New" });
      expect(patchForEdit("priority", "high")).toEqual({ priority: "high" });
      expect(patchForEdit("priority", undefined)).toEqual({ priority: undefined });
      expect(patchForEdit("assignee", "https://x/me")).toEqual({ assignee: "https://x/me" });
      expect(patchForEdit("assignee", undefined)).toEqual({ assignee: undefined });
    });

    it("builds a custom-field patch keyed by slug", () => {
      expect(patchForEdit("field:severity", "sev-1")).toEqual({ fields: { severity: "sev-1" } });
      expect(patchForEdit("field:severity", undefined)).toEqual({ fields: { severity: undefined } });
    });

    it("returns undefined for status (routed through the guarded setStatus)", () => {
      expect(patchForEdit("status", "done")).toBeUndefined();
    });
  });

  describe("normalizeTitle", () => {
    it("trims and returns the title, undefined for blank", () => {
      expect(normalizeTitle("  Fix it  ")).toBe("Fix it");
      expect(normalizeTitle("   ")).toBeUndefined();
      expect(normalizeTitle("")).toBeUndefined();
    });
  });

  it("date custom fields round-trip and are no-op when unchanged", () => {
    const d = new Date("2026-06-17T00:00:00Z");
    const i = mk({ url: "a", fields: { due: d } });
    const sameMoment = new Date("2026-06-17T00:00:00Z");
    // Editing to an equal Date is a no-op (value equality is by time).
    const { original } = optimisticEdit([i], "a", "field:due", sameMoment, WF);
    expect(original).toBeUndefined();
    // Editing to a different Date applies.
    const d2 = new Date("2026-07-01T00:00:00Z");
    const { next, original: orig2 } = optimisticEdit([i], "a", "field:due", d2, WF);
    expect(orig2).toBe(i);
    expect((next.find((x) => x.url === "a")!.fields.due as Date).getTime()).toBe(d2.getTime());
  });
});

/**
 * The inline-edit controller: the optimistic apply → persist via the EXISTING
 * repository path → revert-on-failure / ETag-conflict-reconcile flow, plus the
 * status-edit dependency/workflow guard. Exercised with a fake optimistic seam so
 * the whole flow is unit-tested without React.
 */
describe("makeInlineEditController", () => {
  // A fake seam whose `issues` reflects the optimistic edits applied to it, and a
  // `persist` whose resolution/rejection the test controls.
  function makeSeam(initial: IssueRecord[]): {
    seam: InlineEditSeam;
    persistArg?: (repo: Repository) => Promise<void>;
    persistResult: { resolve: () => void; reject: (e: unknown) => void };
    refresh: ReturnType<typeof vi.fn>;
    get: () => IssueRecord[];
  } {
    let list = initial;
    let resolveFn!: () => void;
    let rejectFn!: (e: unknown) => void;
    const refresh = vi.fn(async () => undefined);
    const holder: { persistArg?: (repo: Repository) => Promise<void> } = {};
    const seam: InlineEditSeam = {
      getIssues: () => list,
      setIssuesLocal: (updater) => {
        list = updater(list);
      },
      persist: (write) => {
        holder.persistArg = write;
        return new Promise<void>((resolve, reject) => {
          resolveFn = resolve;
          rejectFn = reject;
        });
      },
      refresh,
    };
    return {
      seam,
      get persistArg() {
        return holder.persistArg;
      },
      persistResult: { resolve: () => resolveFn(), reject: (e) => rejectFn(e) },
      refresh,
      get: () => list,
    };
  }

  /** A repo stub recording the calls the controller routes through it. */
  function repoStub() {
    const update = vi.fn<(url: string, patch: IssuePatch) => Promise<void>>(async () => undefined);
    const setStatus = vi.fn<(url: string, status: string) => Promise<void>>(async () => undefined);
    return { update, setStatus } as unknown as Repository & {
      update: typeof update;
      setStatus: typeof setStatus;
    };
  }

  const passThroughGuard = vi.fn((_i: IssueRecord, _s: string, _v: string, proceed: () => void) => proceed());
  const toast = { error: vi.fn() };

  it("applies a non-status edit optimistically and persists via repository.update", async () => {
    const issue = mk({ url: "a", priority: "low" });
    const h = makeSeam([issue]);
    const { edit } = makeInlineEditController(h.seam, WF, toast, passThroughGuard);

    edit(issue, "priority", "high");

    // Optimistic update applied IMMEDIATELY (before the write resolves).
    expect(h.get().find((i) => i.url === "a")!.priority).toBe("high");
    // The persist write goes through repository.update with the right patch.
    const repo = repoStub();
    await h.persistArg!(repo);
    expect(repo.update).toHaveBeenCalledWith("a", { priority: "high" });
  });

  it("reverts the cell + surfaces an error when the write FAILS", async () => {
    const issue = mk({ url: "a", priority: "low" });
    const h = makeSeam([issue]);
    toast.error.mockClear();
    const { edit } = makeInlineEditController(h.seam, WF, toast, passThroughGuard);

    edit(issue, "priority", "high");
    expect(h.get().find((i) => i.url === "a")!.priority).toBe("high"); // optimistic

    h.persistResult.reject(new Error("network down"));
    await Promise.resolve(); // let the .catch run
    await Promise.resolve();

    expect(h.get().find((i) => i.url === "a")!.priority).toBe("low"); // reverted
    expect(toast.error).toHaveBeenCalledWith("network down");
    expect(h.refresh).not.toHaveBeenCalled(); // non-conflict → no reconcile
  });

  it("on an ETag ConflictError it reverts AND reconciles from the pod (no clobber)", async () => {
    const issue = mk({ url: "a", title: "Original" });
    const h = makeSeam([issue]);
    toast.error.mockClear();
    const { edit } = makeInlineEditController(h.seam, WF, toast, passThroughGuard);

    edit(issue, "title", "Renamed");
    expect(h.get().find((i) => i.url === "a")!.title).toBe("Renamed");

    h.persistResult.reject(new ConflictError("a"));
    await Promise.resolve();
    await Promise.resolve();

    expect(h.get().find((i) => i.url === "a")!.title).toBe("Original"); // reverted
    expect(h.refresh).toHaveBeenCalledTimes(1); // reconcile, do not clobber
    expect(toast.error).toHaveBeenCalledWith(new ConflictError("a").message);
  });

  it("a status edit routes through the guard and persists via setStatus", async () => {
    const issue = mk({ url: "a", status: "todo", state: "open" });
    const h = makeSeam([issue]);
    const guard = vi.fn((_i: IssueRecord, _s: string, _v: string, proceed: () => void) => proceed());
    const { editStatus } = makeInlineEditController(h.seam, WF, toast, guard);

    editStatus(issue, "in-progress");

    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard.mock.calls[0][1]).toBe("in-progress");
    // Optimistic status applied; persists via the workflow-validating setStatus.
    expect(h.get().find((i) => i.url === "a")!.status).toBe("in-progress");
    const repo = repoStub();
    await h.persistArg!(repo);
    expect((repo as unknown as { setStatus: ReturnType<typeof vi.fn> }).setStatus).toHaveBeenCalledWith("a", "in-progress");
  });

  it("a GUARDED status edit does NOT persist until the user proceeds", async () => {
    const issue = mk({ url: "a", status: "todo", state: "open", blockedBy: ["b"] });
    const h = makeSeam([issue]);
    // A guard that BLOCKS (captures proceed, does not call it) — mimics the open-blocker warning.
    let captured: (() => void) | undefined;
    const blockingGuard = vi.fn((_i: IssueRecord, _s: string, _v: string, proceed: () => void) => {
      captured = proceed;
    });
    const { editStatus } = makeInlineEditController(h.seam, WF, toast, blockingGuard);

    editStatus(issue, "done");
    // Nothing applied yet — the warning is pending the user's override.
    expect(h.get().find((i) => i.url === "a")!.status).toBe("todo");

    // User confirms (override): now the optimistic edit applies + persists.
    captured!();
    expect(h.get().find((i) => i.url === "a")!.status).toBe("done");
    expect(h.get().find((i) => i.url === "a")!.state).toBe("closed"); // terminal → closed
  });

  it("does not persist a no-op edit (re-selecting the current value)", () => {
    const issue = mk({ url: "a", priority: "high" });
    const h = makeSeam([issue]);
    const persistSpy = vi.spyOn(h.seam, "persist");
    const { edit } = makeInlineEditController(h.seam, WF, toast, passThroughGuard);

    edit(issue, "priority", "high"); // unchanged
    // The optimistic apply returns the SAME list (identity) for a no-op and never
    // starts a pod write — so no Saving… and no pointless conditional PUT.
    expect(persistSpy).not.toHaveBeenCalled();
    expect(h.get().find((i) => i.url === "a")!.priority).toBe("high");
  });

  it("decides to persist from getIssues() — NOT from a (possibly deferred) state updater", () => {
    // Regression for the persistence-race: the persist decision must be derived
    // synchronously from getIssues(), so even if setIssuesLocal DEFERS its updater
    // (React batching), the write is never skipped while the UI edit still applies.
    const issue = mk({ url: "a", priority: "low" });
    let live = [issue];
    const persist = vi.fn(() => Promise.resolve());
    const seam: InlineEditSeam = {
      getIssues: () => live,
      // A seam whose updater is NOT run synchronously (mimics a batched/deferred
      // React functional update). The persist decision must not depend on it.
      setIssuesLocal: vi.fn(),
      persist,
      refresh: vi.fn(async () => undefined),
    };
    const { edit } = makeInlineEditController(seam, WF, toast, passThroughGuard);

    edit(issue, "priority", "high");
    // Persist still fired (decision came from getIssues(), not the deferred updater).
    expect(persist).toHaveBeenCalledTimes(1);
    expect(seam.setIssuesLocal).toHaveBeenCalledTimes(1);
    // And the corresponding no-op still does NOT persist.
    live = [mk({ url: "a", priority: "high" })];
    edit(live[0], "priority", "high");
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("editStatus computes the optimistic edit against the LIVE list at confirmation time", () => {
    // A guard that DEFERS the write (captures proceed). Between editStatus() and
    // the user confirming, the live list changes (a refresh/another edit lands a
    // newer title). The deferred confirmation must apply onto the LIVE record, not
    // a stale snapshot — so the newer title survives the status edit.
    const issue = mk({ url: "a", status: "todo", state: "open", title: "Old" });
    const h = makeSeam([issue]);
    let captured: (() => void) | undefined;
    const deferGuard = vi.fn((_i: IssueRecord, _s: string, _v: string, proceed: () => void) => {
      captured = proceed;
    });
    const { editStatus } = makeInlineEditController(h.seam, WF, toast, deferGuard);

    editStatus(issue, "in-progress");
    // A concurrent change to the SAME row lands while the dialog is open.
    h.seam.setIssuesLocal((list) => list.map((i) => (i.url === "a" ? { ...i, title: "Renamed concurrently" } : i)));

    captured!(); // user confirms the override
    const row = h.get().find((i) => i.url === "a")!;
    expect(row.status).toBe("in-progress"); // status edit applied
    expect(row.title).toBe("Renamed concurrently"); // newer concurrent edit preserved (no stale clobber)
  });
});
