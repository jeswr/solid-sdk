// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// Regression test for the workflow-editor's status-name input (#75 P2-5, roborev
// job 3090, Medium). The status-name field is driven directly from the input's
// `onChange` via `renameStatus` (workflow-editor-section.tsx). Before the fix,
// `renameStatus` THREW on a blank label, so a normal select-all/delete (or clearing
// the field before retyping) surfaced an uncaught error in the React event path and
// crashed the editor. The fix: the live-edit setter stores a transient blank
// verbatim and `validateWorkflow` reports it as a save-blocking problem — the editor
// must show a validation message and disable Save, NEVER throw.
//
// This drives the actual component (not just the pure model) because the finding is
// in the component's onChange handler: the status-name field is a plain text Input,
// reliably interactable in jsdom (the same reasoning as issues-table.test.tsx, which
// avoids the Radix Select cells). The migrate/terminal Radix controls are not
// exercised here.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WorkflowDef } from "@/lib/issue";
import type { IssueStatusRef } from "@/lib/workflow-editor";

// The component imports Repository (the pod write path) and `toast`. Neither is hit
// by this test (no save is triggered, no toast is asserted), but Repository pulls in
// the RDF/pod stack on import, so it is mocked to a no-op constructor. `sonner`'s
// toast is also stubbed so the import resolves without a real toaster mounted.
// Hoisted so the (hoisted) vi.mock factories below can reference these mocks.
// `workflowStrict` backs the partial-failure recovery's strict fresh re-read of the
// persisted workflow (new Repository(trackerUrl).workflowStrict()).
const { defineWorkflow, workflowStrict, toast } = vi.hoisted(() => ({
  defineWorkflow: vi.fn().mockResolvedValue(undefined),
  workflowStrict: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/repository", () => ({
  Repository: class {
    defineWorkflow = defineWorkflow;
    workflowStrict = workflowStrict;
  },
}));
vi.mock("sonner", () => ({ toast }));

import { WorkflowEditorSection } from "@/components/workflow-editor-section";

const WORKFLOW: WorkflowDef = {
  statuses: [
    { slug: "todo", label: "To Do", terminal: false },
    { slug: "doing", label: "Doing", terminal: false },
    { slug: "done", label: "Done", terminal: true },
  ],
  transitions: { todo: ["doing"], doing: ["done", "todo"], done: [] },
};

function renderEditor(over: Partial<Parameters<typeof WorkflowEditorSection>[0]> = {}) {
  const migrateIssues = vi.fn().mockResolvedValue(undefined);
  const onSaved = vi.fn();
  const issueStatusRefs: IssueStatusRef[] = [];
  render(
    <WorkflowEditorSection
      trackerUrl="https://pod.example/alice/issues/"
      workflow={WORKFLOW}
      issueStatusRefs={issueStatusRefs}
      migrateIssues={migrateIssues}
      onSaved={onSaved}
      {...over}
    />,
  );
  return { migrateIssues, onSaved };
}

/**
 * Every per-status name field (aria-label "Status name for <label>"). Used to
 * re-find a field whose label has been cleared to blank — its aria-label is then
 * no longer reliably addressable by label-text (which trims the trailing space),
 * so the test addresses it by its empty value instead.
 */
function statusNameInputs(): HTMLInputElement[] {
  return Array.from(
    document.querySelectorAll<HTMLInputElement>('input[aria-label^="Status name for"]'),
  );
}

afterEach(() => {
  cleanup();
  defineWorkflow.mockReset();
  defineWorkflow.mockResolvedValue(undefined);
  workflowStrict.mockReset();
  toast.error.mockClear();
  toast.success.mockClear();
  toast.info.mockClear();
});

/** Make a label edit so the editor is dirty, then click Save (the dirty-only button). */
function editAndSave(): void {
  const doingInput = screen.getByLabelText("Status name for Doing") as HTMLInputElement;
  fireEvent.change(doingInput, { target: { value: "Working" } });
  const saveButton = screen.getByRole("button", { name: /save workflow/i }) as HTMLButtonElement;
  fireEvent.click(saveButton);
}

describe("WorkflowEditorSection — status-name input (roborev job 3090)", () => {
  it("clearing a status name does not throw; shows a validation message and blocks save", () => {
    renderEditor();

    // The "Doing" status-name field (a plain text input addressed by its aria-label).
    const doingInput = screen.getByLabelText("Status name for Doing") as HTMLInputElement;
    expect(doingInput.value).toBe("Doing");

    // Clearing the field (select-all + delete) must NOT throw — the whole act of
    // firing the empty onChange and re-rendering is wrapped so any thrown error
    // (the pre-fix behaviour) fails the test loudly rather than being swallowed.
    expect(() => fireEvent.change(doingInput, { target: { value: "" } })).not.toThrow();

    // The cleared label is held in the draft (verbatim, transiently blank). The
    // input's aria-label now embeds the blank label, so re-find it by being the
    // one status-name field whose value is empty (label-text matching trims the
    // trailing space away, so we cannot address it by its now-blank aria-label).
    const blankInput = statusNameInputs().find((el) => el.value === "");
    expect(blankInput).toBeTruthy();

    // … and surfaces as a save-blocking validation message.
    expect(screen.getByText("Every status needs a name.")).toBeTruthy();

    // Save is disabled while a status name is blank.
    const saveButton = screen.getByRole("button", { name: /save workflow/i }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it("re-typing a name clears the validation problem and re-enables save", () => {
    renderEditor();

    const doingInput = screen.getByLabelText("Status name for Doing") as HTMLInputElement;
    fireEvent.change(doingInput, { target: { value: "" } });
    expect(screen.getByText("Every status needs a name.")).toBeTruthy();

    // Re-typing a name into the now-blank field (found by its empty value, since
    // its aria-label is no longer addressable once the label is blank).
    const blankInput = statusNameInputs().find((el) => el.value === "");
    expect(blankInput).toBeTruthy();
    fireEvent.change(blankInput!, { target: { value: "In Progress" } });

    expect(screen.queryByText("Every status needs a name.")).toBeNull();
    const saveButton = screen.getByRole("button", { name: /save workflow/i }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });
});

describe("WorkflowEditorSection — save flow (roborev job: partial-failure baseline)", () => {
  it("a clean no-migration save persists once and reloads via onSaved exactly once", async () => {
    const { onSaved } = renderEditor();
    editAndSave();

    // No issues stranded (issueStatusRefs empty) → a single defineWorkflow write.
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(defineWorkflow).toHaveBeenCalledTimes(1);
    // onSaved fires once (the normal reload); NOT the extra partial-failure reload.
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("a no-migration save that fails on the single write does NOT trigger a reload (nothing was written)", async () => {
    defineWorkflow.mockRejectedValueOnce(new Error("network down"));
    const { onSaved } = renderEditor();
    editAndSave();

    // The single write failed before anything landed → wroteToPod stays false, so
    // there is no stale-baseline partial state to reload from.
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(defineWorkflow).toHaveBeenCalledTimes(1);
    expect(onSaved).not.toHaveBeenCalled(); // no reload
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("a successful save whose onSaved throws is NOT misclassified as a failed pod write", async () => {
    // The pod write succeeded; only the parent reload callback throws. This must
    // surface a SUCCESS (not an error/recovery), since the workflow IS persisted
    // (roborev job — onSaved was inside the persistence try block before this fix).
    const onSaved = vi.fn(() => {
      throw new Error("parent reload blew up");
    });
    renderEditor({ onSaved });
    editAndSave();

    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(defineWorkflow).toHaveBeenCalledTimes(1); // exactly the one (successful) write
    expect(onSaved).toHaveBeenCalledTimes(1);
    // No misclassification: no error toast, no partial-save recovery re-read.
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
    expect(workflowStrict).not.toHaveBeenCalled();
  });
});

describe("WorkflowEditorSection — partial-save failure on the intermediate path (roborev job)", () => {
  // The TRUE persisted workflow the recovery re-reads — deliberately DIFFERENT from
  // the user's stale draft ("Doing" renamed to "Server Doing" server-side), so an
  // assertion that the editor shows "Server Doing" proves the stale draft was
  // genuinely REPLACED by a fresh re-read, not merely hidden behind dirty=false.
  const FRESH_WORKFLOW: WorkflowDef = {
    statuses: [
      { slug: "todo", label: "To Do", terminal: false },
      { slug: "doing", label: "Server Doing", terminal: false },
      { slug: "done", label: "Done", terminal: true },
    ],
    transitions: { todo: ["doing"], doing: ["done", "todo"], done: [] },
  };

  // Drive the REAL partial path: remove "Doing" (empty per the edit-time snapshot →
  // no migrate dialog, a plain X-button drop), but have the LIVE refs at save time
  // show an issue still in "doing" (the moved-in-after-remove case). The plan is then
  // non-empty → the intermediate workflow is persisted, then a migration / final
  // write fails → recovery re-reads FRESH_WORKFLOW and re-seeds the draft.
  function renderWithStrandedDoing() {
    workflowStrict.mockResolvedValue(FRESH_WORKFLOW);
    const migrateIssues = vi.fn().mockResolvedValue(undefined);
    const onSaved = vi.fn();
    render(
      <WorkflowEditorSection
        trackerUrl="https://pod.example/alice/issues/"
        workflow={WORKFLOW}
        issueStatusRefs={[]} // edit-time: "doing" looks empty → X removes it without a dialog
        getIssueStatusRefs={() => [{ url: "issue-1", status: "doing" }]} // live: one issue still in "doing"
        migrateIssues={migrateIssues}
        onSaved={onSaved}
      />,
    );
    // Remove "Doing" (plain X button — no migrate dialog since it's empty per snapshot).
    fireEvent.click(screen.getByRole("button", { name: "Remove status Doing" }));
    return { migrateIssues, onSaved };
  }

  it("intermediate write succeeds but migration fails → re-reads + REPLACES the stale draft", async () => {
    const { migrateIssues, onSaved } = renderWithStrandedDoing();
    migrateIssues.mockRejectedValueOnce(new Error("migration failed"));

    expect(screen.getByRole("button", { name: /save workflow/i })).toBeTruthy(); // dirty → Save shown
    fireEvent.click(screen.getByRole("button", { name: /save workflow/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    // Step 1 (intermediate) was written, step 2 (migration) failed → recovery ran.
    expect(defineWorkflow).toHaveBeenCalledTimes(1); // only the intermediate landed
    expect(migrateIssues).toHaveBeenCalledTimes(1);
    expect(workflowStrict).toHaveBeenCalledTimes(1); // fresh re-read
    expect(toast.info).toHaveBeenCalled(); // "Reloaded … after a partial save"
    expect(onSaved).toHaveBeenCalledTimes(1); // parent reload too
    // The stale draft is REPLACED by the fresh re-read (not merely hidden): the editor
    // now shows the server's "Server Doing", and the dirty Save bar is gone — so the
    // next edit can only plan from the true current workflow (no stale-baseline retry),
    // and the editor never deadlocks.
    await waitFor(() => expect(screen.getByDisplayValue("Server Doing")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /save workflow/i })).toBeNull();
  });

  it("intermediate + migration succeed but the FINAL write fails → re-reads + REPLACES the stale draft", async () => {
    // defineWorkflow: 1st call (intermediate) resolves, 2nd call (final) rejects.
    defineWorkflow.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("final write failed"));
    const { migrateIssues, onSaved } = renderWithStrandedDoing();

    fireEvent.click(screen.getByRole("button", { name: /save workflow/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(defineWorkflow).toHaveBeenCalledTimes(2); // intermediate + the failed final
    expect(migrateIssues).toHaveBeenCalledTimes(1); // migration ran between them
    expect(workflowStrict).toHaveBeenCalledTimes(1); // fresh re-read on recovery
    expect(toast.info).toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByDisplayValue("Server Doing")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /save workflow/i })).toBeNull();
  });

  it("a FAILED strict re-read keeps the editor LOCKED (no editable save) with a Reload retry", async () => {
    // Intermediate write succeeds, migration fails → recovery runs, but the strict
    // re-read ALSO fails (network). The pod may hold the intermediate (+ migrated
    // issues), so the editor must NOT unlock for an editable save from the stale
    // baseline (which could drop intermediate-only statuses → orphan issues, roborev
    // job). It stays LOCKED and offers a Reload retry until a fresh read succeeds.
    const { migrateIssues } = renderWithStrandedDoing();
    migrateIssues.mockRejectedValueOnce(new Error("migration failed"));
    // Override the strict re-read (renderWithStrandedDoing made it resolve) to reject.
    workflowStrict.mockReset();
    workflowStrict.mockRejectedValue(new Error("re-read network down"));

    fireEvent.click(screen.getByRole("button", { name: /save workflow/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(workflowStrict).toHaveBeenCalledTimes(1);
    // The recovery banner with a Reload retry is shown; Save is disabled (locked) —
    // not removed-and-re-enabled. A stale-baseline save is impossible.
    await waitFor(() => expect(screen.getByRole("button", { name: /reload from server/i })).toBeTruthy());
    const saveBtn = screen.getByRole("button", { name: /save workflow/i }) as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
    // Editing a field does NOT unlock save while recovery is unresolved. ("Doing" was
    // removed from the draft, so edit a surviving status — "To Do".)
    fireEvent.change(screen.getByLabelText("Status name for To Do"), { target: { value: "Todo 2" } });
    expect((screen.getByRole("button", { name: /save workflow/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("the Reload retry, on success, installs the fresh workflow and unlocks the editor", async () => {
    const { migrateIssues } = renderWithStrandedDoing();
    migrateIssues.mockRejectedValueOnce(new Error("migration failed"));
    // First strict re-read fails (→ locked banner); the retry then succeeds.
    workflowStrict.mockReset();
    workflowStrict
      .mockRejectedValueOnce(new Error("re-read network down"))
      .mockResolvedValueOnce(FRESH_WORKFLOW);

    fireEvent.click(screen.getByRole("button", { name: /save workflow/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /reload from server/i })).toBeTruthy());

    // Click Reload → second strict read succeeds → fresh workflow installed + unlocked.
    fireEvent.click(screen.getByRole("button", { name: /reload from server/i }));
    await waitFor(() => expect(screen.getByDisplayValue("Server Doing")).toBeTruthy());
    expect(workflowStrict).toHaveBeenCalledTimes(2);
    // Recovery banner gone, no stale dirty Save bar — the editor is clean + usable.
    expect(screen.queryByRole("button", { name: /reload from server/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /save workflow/i })).toBeNull();
    // And it is editable again (a fresh edit re-enables Save).
    fireEvent.change(screen.getByLabelText("Status name for Server Doing"), { target: { value: "Server Doing 2" } });
    expect((screen.getByRole("button", { name: /save workflow/i }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("after a recovery re-read, a save plans removals against the RECOVERED baseline, not the stale prop", async () => {
    // The recovered server workflow has an EXTRA status ("extra") that the original
    // `workflow` prop never had. Removing "extra" after recovery must be planned as a
    // removal — which is ONLY possible if planning uses the recovered baseline, not
    // the stale prop (which has no "extra" to remove). An issue stranded in "extra"
    // must therefore be migrated (roborev job: stale-baseline planning would miss it).
    const RECOVERED: WorkflowDef = {
      statuses: [
        { slug: "todo", label: "To Do", terminal: false },
        { slug: "extra", label: "Extra", terminal: false },
        { slug: "done", label: "Done", terminal: true },
      ],
      transitions: { todo: ["extra"], extra: ["done"], done: [] },
    };
    const migrateIssues = vi.fn().mockResolvedValue(undefined);
    let liveStatus = "doing"; // before recovery the stranded issue is in "doing"
    render(
      <WorkflowEditorSection
        trackerUrl="https://pod.example/alice/issues/"
        workflow={WORKFLOW}
        issueStatusRefs={[]}
        getIssueStatusRefs={() => [{ url: "issue-1", status: liveStatus }]}
        migrateIssues={migrateIssues}
        onSaved={vi.fn()}
      />,
    );

    // Force a partial failure to drive recovery: remove "Doing" (empty per snapshot),
    // save → intermediate ok, migration fails → recovery re-reads RECOVERED.
    fireEvent.click(screen.getByRole("button", { name: "Remove status Doing" }));
    migrateIssues.mockRejectedValueOnce(new Error("migration failed"));
    workflowStrict.mockReset();
    workflowStrict.mockResolvedValue(RECOVERED);
    fireEvent.click(screen.getByRole("button", { name: /save workflow/i }));
    // Recovery installed RECOVERED (its "Extra" status is now shown) and unlocked.
    await waitFor(() => expect(screen.getByDisplayValue("Extra")).toBeTruthy());

    // Now the stranded issue is live in "extra"; remove "Extra" and save again.
    liveStatus = "extra";
    migrateIssues.mockClear();
    migrateIssues.mockResolvedValue(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Remove status Extra" }));
    fireEvent.click(screen.getByRole("button", { name: /save workflow/i }));

    // The issue stranded in the recovered-baseline-only "extra" status IS migrated —
    // proving the plan used the recovered baseline (the stale prop has no "extra").
    await waitFor(() => expect(migrateIssues).toHaveBeenCalled());
    const [urls] = migrateIssues.mock.calls[0];
    expect(urls).toEqual(["issue-1"]);
  });
});
