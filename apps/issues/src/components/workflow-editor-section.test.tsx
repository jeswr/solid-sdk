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
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WorkflowDef } from "@/lib/issue";
import type { IssueStatusRef } from "@/lib/workflow-editor";

// The component imports Repository (the pod write path) and `toast`. Neither is hit
// by this test (no save is triggered, no toast is asserted), but Repository pulls in
// the RDF/pod stack on import, so it is mocked to a no-op constructor. `sonner`'s
// toast is also stubbed so the import resolves without a real toaster mounted.
const defineWorkflow = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/repository", () => ({
  Repository: vi.fn().mockImplementation(() => ({ defineWorkflow })),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

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
  defineWorkflow.mockClear();
});

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
