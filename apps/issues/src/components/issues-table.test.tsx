// @vitest-environment jsdom
// AUTHORED-BY Claude Opus 4.8
//
// The inline-editable table (#75 P1-6). These tests drive the TITLE cell — a
// plain text input, reliably interactable in jsdom — to prove the edit-on-click →
// commit-on-Enter / commit-on-blur / cancel-on-Escape semantics and that the
// committed value flows out via `onEdit` (which IssuesView wires to the optimistic
// + persisted repository path; that flow is unit-tested in inline-edit.test.ts via
// makeInlineEditController). Status/priority/assignee cells use a Radix Select
// (portal + pointer events) that is unreliable in jsdom, so the select-cell
// persistence is covered by the controller/pure-logic tests, not a DOM click here.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IssuesTable, type IssuesTableProps } from "@/components/issues-table";
import { DEFAULT_WORKFLOW } from "@/lib/issue";
import type { IssueRecord } from "@/lib/repository";

const base: IssueRecord = {
  url: "https://pod.example/issues/a.ttl",
  title: "Original title",
  state: "open",
  status: "todo",
  issueType: "task",
  priority: "low",
  labels: [],
  components: [],
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

function renderTable(over: Partial<IssuesTableProps> = {}) {
  const onEdit = vi.fn();
  const onStatusEdit = vi.fn();
  const props: IssuesTableProps = {
    issues: [mk({})],
    statuses: DEFAULT_WORKFLOW.statuses,
    fieldDefs: [],
    assigneeSuggestions: [],
    selectable: true,
    selected: new Set(),
    allSelected: false,
    onToggleAll: vi.fn(),
    onToggleSelect: vi.fn(),
    onOpen: vi.fn(),
    onEdit,
    onStatusEdit,
    ...over,
  };
  render(<IssuesTable {...props} />);
  return { onEdit, onStatusEdit };
}

afterEach(cleanup);

describe("IssuesTable inline editing (#75 P1-6)", () => {
  it("commits a title edit on Enter via onEdit (edit-on-click → type → Enter)", () => {
    const { onEdit } = renderTable();
    // Edit-on-click: the read affordance toggles into an input.
    fireEvent.click(screen.getByLabelText("Edit title of Original title"));
    const input = screen.getByLabelText("title of Original title") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "New title" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ url: base.url }), "title", "New title");
  });

  it("commits a title edit on blur", () => {
    const { onEdit } = renderTable();
    fireEvent.click(screen.getByLabelText("Edit title of Original title"));
    const input = screen.getByLabelText("title of Original title");
    fireEvent.change(input, { target: { value: "Blur committed" } });
    fireEvent.blur(input);
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ url: base.url }), "title", "Blur committed");
  });

  it("cancels on Escape — no edit emitted, value restored", () => {
    const { onEdit } = renderTable();
    fireEvent.click(screen.getByLabelText("Edit title of Original title"));
    const input = screen.getByLabelText("title of Original title");
    fireEvent.change(input, { target: { value: "Discard me" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onEdit).not.toHaveBeenCalled();
    // Back to the read affordance with the original title.
    expect(screen.getByLabelText("Edit title of Original title")).toBeTruthy();
  });

  it("rejects a BLANK title commit (never wipes the title)", () => {
    const { onEdit } = renderTable();
    fireEvent.click(screen.getByLabelText("Edit title of Original title"));
    const input = screen.getByLabelText("title of Original title");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("does NOT emit when the title is unchanged (no spurious write)", () => {
    const { onEdit } = renderTable();
    fireEvent.click(screen.getByLabelText("Edit title of Original title"));
    const input = screen.getByLabelText("title of Original title");
    // Commit without changing the value.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("renders read-only cells (no edit affordance) when the issue is not writable", () => {
    renderTable({ issues: [mk({ canWrite: false })] });
    // No edit button for the title — the value is shown as static text.
    expect(screen.queryByLabelText("Edit title of Original title")).toBeNull();
    expect(screen.getByText("Original title")).toBeTruthy();
  });

  it("commits a custom number field edit, parsed to a number", () => {
    const { onEdit } = renderTable({
      issues: [mk({ fields: { points: 3 } })],
      fieldDefs: [{ iri: "https://t/#field-points", slug: "points", label: "Points", type: "number", options: [] }],
    });
    fireEvent.click(screen.getByLabelText("Edit Points of Original title"));
    const input = screen.getByLabelText("Points of Original title");
    fireEvent.change(input, { target: { value: "8" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ url: base.url }), "field:points", 8);
  });

  it("clears a custom text field when committed empty", () => {
    const { onEdit } = renderTable({
      issues: [mk({ fields: { note: "hi" } })],
      fieldDefs: [{ iri: "https://t/#field-note", slug: "note", label: "Note", type: "text", options: [] }],
    });
    fireEvent.click(screen.getByLabelText("Edit Note of Original title"));
    const input = screen.getByLabelText("Note of Original title");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ url: base.url }), "field:note", undefined);
  });

  it("shows the multi-select checkboxes only when selectable", () => {
    renderTable({ selectable: true });
    expect(screen.getByLabelText("Select all issues")).toBeTruthy();
    cleanup();
    renderTable({ selectable: false });
    expect(screen.queryByLabelText("Select all issues")).toBeNull();
  });

  it("shows an assignee outside the suggestion list (no blank select; roborev fix)", () => {
    // The issue is assigned to a WebID NOT in assigneeSuggestions — the cell must
    // still render that assignee (its short host), not a blank value.
    renderTable({
      issues: [mk({ assignee: "https://stranger.example/profile/card#me" })],
      assigneeSuggestions: ["https://team.example/bob#me"],
    });
    expect(screen.getByText("stranger.example")).toBeTruthy();
  });

  it("renders an editable URL custom field WITHOUT a nested anchor (roborev fix)", () => {
    renderTable({
      issues: [mk({ fields: { link: "https://example.com/spec" } })],
      fieldDefs: [{ iri: "https://t/#field-link", slug: "link", label: "Link", type: "url", options: [] }],
    });
    // Editable (canWrite) → the URL is shown as plain text inside the edit button,
    // NOT as a clickable <a> (which would be invalid nested-interactive HTML).
    const editBtn = screen.getByLabelText("Edit Link of Original title");
    expect(editBtn.querySelector("a")).toBeNull();
    expect(editBtn.textContent).toContain("https://example.com/spec");
  });

  it("renders a read-only URL custom field AS a clickable link", () => {
    renderTable({
      issues: [mk({ canWrite: false, fields: { link: "https://example.com/spec" } })],
      fieldDefs: [{ iri: "https://t/#field-link", slug: "link", label: "Link", type: "url", options: [] }],
    });
    const link = screen.getByRole("link", { name: "https://example.com/spec" }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://example.com/spec");
    expect(link.getAttribute("rel")).toContain("noopener");
  });
});
