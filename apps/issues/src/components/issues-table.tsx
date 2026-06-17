// AUTHORED-BY Claude Opus 4.8
"use client";

import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, CircleDot, Pencil } from "lucide-react";
import type { IssueRecord } from "@/lib/use-issues";
import type { FieldDef, Priority, StatusSlug, WorkflowStatus } from "@/lib/issue";
import { PRIORITIES, safeHttpUrl } from "@/lib/issue";
import { currentValue, normalizeTitle, type EditableField } from "@/lib/inline-edit";
import { priorityVariant, shortWebId } from "@/components/issue-card";
import { TypeBadge } from "@/components/type-badge";

const statusVariant = (slug: string, statuses: WorkflowStatus[]): "default" | "secondary" | "outline" => {
  const terminal = statuses.find((s) => s.slug === slug)?.terminal;
  if (terminal) return "secondary";
  return slug === statuses[0]?.slug ? "outline" : "default";
};
const statusLabel = (slug: string, statuses: WorkflowStatus[]) =>
  statuses.find((s) => s.slug === slug)?.label ?? slug;

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const NONE = "__none__"; // Select needs a non-empty sentinel for the cleared option

/** A select-driven cell: commits on choose (Escape closes without change). */
function SelectCell({
  value,
  options,
  placeholder,
  ariaLabel,
  onCommit,
  disabled,
  children,
}: {
  value: string | undefined;
  options: { value: string; label: string }[];
  placeholder: string;
  ariaLabel: string;
  onCommit: (value: string | undefined) => void;
  disabled?: boolean;
  /** The read-only rendering shown when not editable (no write access). */
  children: React.ReactNode;
}) {
  if (disabled) return <>{children}</>;
  return (
    <Select
      value={value ?? NONE}
      onValueChange={(v) => onCommit(v === NONE ? undefined : v)}
    >
      <SelectTrigger className="h-7 w-full border-transparent text-sm hover:border-input data-[state=open]:border-input" aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * A text-input cell with edit-on-click → commit-on-blur/Enter, cancel-on-Escape.
 * Empty commits are rejected via {@link normalizeTitle} (revert to the prior
 * value) so a title is never wiped. `parse`/`format` adapt non-string fields
 * (number/date) without changing the commit semantics.
 */
function TextCell({
  value,
  ariaLabel,
  onCommit,
  disabled,
  type = "text",
  allowEmpty = true,
  render,
}: {
  value: string;
  ariaLabel: string;
  onCommit: (raw: string) => void;
  disabled?: boolean;
  type?: "text" | "number" | "date" | "url";
  /** Whether an empty commit clears the value (custom fields) vs. reverts (title). */
  allowEmpty?: boolean;
  /** Read-only rendering when not editing / not editable. */
  render: () => React.ReactNode;
}) {
  // `draft === null` means "not editing"; entering edit mode seeds the draft from
  // the current value in the click handler (NOT in an effect — that avoids the
  // cascading-render setState-in-effect anti-pattern). The effect below only
  // focuses + selects the freshly-mounted input.
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) requestAnimationFrame(() => inputRef.current?.select());
  }, [editing]);

  const commit = () => {
    const next = draft ?? value;
    setDraft(null);
    if (next === value) return; // no-op
    if (!allowEmpty && normalizeTitle(next) === undefined) return; // blank → revert
    onCommit(next);
  };

  if (disabled) return <div className="truncate px-2 py-1 text-sm">{render()}</div>;
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setDraft(value)}
        aria-label={`Edit ${ariaLabel}`}
        className="group flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1 truncate">{render()}</span>
        <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </button>
    );
  }
  return (
    <Input
      ref={inputRef}
      type={type === "url" ? "url" : type}
      aria-label={ariaLabel}
      className="h-7"
      value={draft ?? ""}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(null); // cancel — draft discarded
        }
      }}
    />
  );
}

export interface IssuesTableProps {
  issues: IssueRecord[];
  statuses: WorkflowStatus[];
  fieldDefs: FieldDef[];
  /** Assignee suggestions (team group IRI + members), shown in the assignee cell. */
  assigneeSuggestions: string[];
  groupIri?: string;
  /** Whether the multi-select column + checkboxes are shown (writer + own tracker). */
  selectable: boolean;
  selected: Set<string>;
  allSelected: boolean;
  onToggleAll: () => void;
  onToggleSelect: (url: string) => void;
  /** Open the issue's detail dialog (title link / row affordance). */
  onOpen: (issue: IssueRecord) => void;
  /**
   * Commit an inline edit of a NON-status field. The parent applies it
   * optimistically, persists via `repository.update`, and reverts on failure.
   */
  onEdit: (issue: IssueRecord, field: EditableField, value: string | number | Date | undefined) => void;
  /**
   * Commit a STATUS edit. Routed by the parent through the dependency/workflow
   * guard (`guardedTransition` + `setStatus`), so a blocked/invalid transition
   * warns before it persists.
   */
  onStatusEdit: (issue: IssueRecord, status: StatusSlug) => void;
}

/**
 * The Monday/Jira-style inline-editable table (#75 P1-6). Each row is one issue;
 * status / priority / assignee / title / custom-field cells are editable in place
 * (edit-on-click, commit on blur/Enter, cancel on Escape). Read-only cells render
 * when the user lacks write access to that issue (`issue.canWrite`).
 *
 * Editing is OPTIMISTIC + PERSISTED by the parent: this component only emits the
 * committed value via `onEdit`/`onStatusEdit`; the parent owns the optimistic
 * apply, the background `repository` write, the Saving…/Saved indicator, and the
 * revert-on-failure (so the persistence + ETag-conflict handling reuse the SAME
 * path as the board and the form dialog).
 */
export function IssuesTable({
  issues,
  statuses,
  fieldDefs,
  assigneeSuggestions,
  groupIri,
  selectable,
  selected,
  allSelected,
  onToggleAll,
  onToggleSelect,
  onOpen,
  onEdit,
  onStatusEdit,
}: IssuesTableProps) {
  const optionFor = (a: string) => ({ value: a, label: a === groupIri ? "Team" : shortWebId(a) });
  const baseAssigneeOptions = assigneeSuggestions.map(optionFor);
  // The assignee options for a given row ALWAYS include that issue's current
  // assignee — even when it is outside the team/suggestion list (e.g. assigned by
  // another app, or a since-removed member). Without this the controlled Select
  // would have no matching item and render the cell blank/misleading while
  // editing is enabled (roborev finding). The current assignee is appended once.
  const assigneeOptionsFor = (assignee: string | undefined) =>
    assignee && !assigneeSuggestions.includes(assignee)
      ? [...baseAssigneeOptions, optionFor(assignee)]
      : baseAssigneeOptions;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[56rem] border-collapse text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
            {selectable && (
              <th scope="col" className="w-10 px-2 py-2">
                <Checkbox checked={allSelected} onCheckedChange={onToggleAll} aria-label="Select all issues" />
              </th>
            )}
            <th scope="col" className="min-w-[16rem] px-2 py-2">Title</th>
            <th scope="col" className="w-36 px-2 py-2">Status</th>
            <th scope="col" className="w-32 px-2 py-2">Priority</th>
            <th scope="col" className="w-44 px-2 py-2">Assignee</th>
            {fieldDefs.map((def) => (
              <th key={def.iri} scope="col" className="w-40 px-2 py-2">{def.label}</th>
            ))}
            <th scope="col" className="w-28 px-2 py-2">Due</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => {
            const canWrite = issue.canWrite;
            const closed = issue.state === "closed";
            return (
              <tr key={issue.url} className="border-b last:border-0 hover:bg-muted/20">
                {selectable && (
                  <td className="px-2 py-1.5 align-middle">
                    <Checkbox
                      checked={selected.has(issue.url)}
                      onCheckedChange={() => onToggleSelect(issue.url)}
                      aria-label={`Select ${issue.title}`}
                    />
                  </td>
                )}
                {/* Title — editable text + a link to open the detail dialog. */}
                <td className="px-2 py-1.5 align-middle">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <TypeBadge type={issue.issueType} />
                    <div className="min-w-0 flex-1">
                      <TextCell
                        value={issue.title}
                        ariaLabel={`title of ${issue.title}`}
                        disabled={!canWrite}
                        allowEmpty={false}
                        onCommit={(raw) => {
                          const t = normalizeTitle(raw);
                          if (t !== undefined) onEdit(issue, "title", t);
                        }}
                        render={() => (
                          <span className={closed ? "line-through opacity-70" : ""}>{issue.title}</span>
                        )}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpen(issue)}
                      aria-label={`Open ${issue.title}`}
                      className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <CircleDot className="size-3.5" aria-hidden />
                    </button>
                  </div>
                </td>
                {/* Status — workflow-validated via the parent's guarded transition. */}
                <td className="px-2 py-1.5 align-middle">
                  <SelectCell
                    value={issue.status}
                    ariaLabel={`status of ${issue.title}`}
                    placeholder="Status"
                    disabled={!canWrite}
                    options={statuses.map((s) => ({ value: s.slug, label: s.label }))}
                    onCommit={(v) => {
                      if (v !== undefined && v !== issue.status) onStatusEdit(issue, v as StatusSlug);
                    }}
                  >
                    <Badge variant={statusVariant(issue.status, statuses)} className="gap-1">
                      {closed ? <CheckCircle2 className="size-3" aria-hidden /> : <CircleDot className="size-3" aria-hidden />}
                      {statusLabel(issue.status, statuses)}
                    </Badge>
                  </SelectCell>
                </td>
                {/* Priority */}
                <td className="px-2 py-1.5 align-middle">
                  <SelectCell
                    value={issue.priority}
                    ariaLabel={`priority of ${issue.title}`}
                    placeholder="None"
                    disabled={!canWrite}
                    options={PRIORITIES.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))}
                    onCommit={(v) => onEdit(issue, "priority", v as Priority | undefined)}
                  >
                    {issue.priority ? (
                      <Badge variant={priorityVariant(issue.priority)} className="capitalize">
                        {issue.priority}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </SelectCell>
                </td>
                {/* Assignee */}
                <td className="px-2 py-1.5 align-middle">
                  <SelectCell
                    value={issue.assignee}
                    ariaLabel={`assignee of ${issue.title}`}
                    placeholder="Unassigned"
                    disabled={!canWrite}
                    options={assigneeOptionsFor(issue.assignee)}
                    onCommit={(v) => onEdit(issue, "assignee", v)}
                  >
                    <span className={issue.assignee ? "" : "text-muted-foreground"}>
                      {issue.assignee ? (issue.assignee === groupIri ? "Team" : shortWebId(issue.assignee)) : "Unassigned"}
                    </span>
                  </SelectCell>
                </td>
                {/* Custom fields */}
                {fieldDefs.map((def) => (
                  <td key={def.iri} className="px-2 py-1.5 align-middle">
                    <CustomFieldCell issue={issue} def={def} disabled={!canWrite} onEdit={onEdit} />
                  </td>
                ))}
                {/* Due date (read-only here; edited from the form/detail dialog). */}
                <td className="px-2 py-1.5 align-middle text-muted-foreground">
                  {issue.dateDue ? dateFmt.format(issue.dateDue) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** One custom-field cell — select fields use the dropdown, others a typed text input. */
function CustomFieldCell({
  issue,
  def,
  disabled,
  onEdit,
}: {
  issue: IssueRecord;
  def: FieldDef;
  disabled?: boolean;
  onEdit: (issue: IssueRecord, field: EditableField, value: string | number | Date | undefined) => void;
}) {
  const field = `field:${def.slug}` as const;
  const raw = currentValue(issue, field);

  if (def.type === "select") {
    return (
      <SelectCell
        value={typeof raw === "string" ? raw : undefined}
        ariaLabel={`${def.label} of ${issue.title}`}
        placeholder="—"
        disabled={disabled}
        options={def.options.map((o) => ({ value: o.iri, label: o.label }))}
        onCommit={(v) => onEdit(issue, field, v)}
      >
        <span className={raw === undefined ? "text-muted-foreground" : ""}>
          {raw === undefined ? "—" : (def.options.find((o) => o.iri === raw)?.label ?? String(raw))}
        </span>
      </SelectCell>
    );
  }

  // text / number / date / url — a typed input. The committed string is parsed to
  // the field's value type before it reaches the parent's persist path.
  //
  // `asLink` controls URL rendering: only the READ-ONLY (disabled) cell renders a
  // clickable <a>. The EDITABLE cell renders the URL as plain text so it is NOT a
  // nested interactive element inside the edit <button> (invalid HTML, and a click
  // would otherwise open the link instead of entering edit mode) — the user opens
  // the link from the read-only cell or the issue detail dialog.
  const display = (asLink: boolean): React.ReactNode => {
    if (raw === undefined) return <span className="text-muted-foreground">—</span>;
    if (def.type === "date") return dateFmt.format(raw as Date);
    if (def.type === "url") {
      const href = asLink ? safeHttpUrl(String(raw)) : undefined;
      return href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
          {String(raw)}
        </a>
      ) : (
        String(raw)
      );
    }
    return String(raw);
  };
  const inputValue =
    raw === undefined ? "" : def.type === "date" ? toDateInputValue(raw as Date) : String(raw);

  return (
    <TextCell
      value={inputValue}
      ariaLabel={`${def.label} of ${issue.title}`}
      disabled={disabled}
      type={def.type === "number" ? "number" : def.type === "date" ? "date" : def.type === "url" ? "url" : "text"}
      onCommit={(committed) => onEdit(issue, field, parseFieldValue(def.type, committed))}
      // Only the read-only cell (disabled) gets a clickable link; the editable
      // cell shows plain text so the edit button has no nested anchor.
      render={() => display(disabled === true)}
    />
  );
}

/** Parse a committed string into the field's value type (undefined clears it). */
function parseFieldValue(type: FieldDef["type"], raw: string): string | number | Date | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (type === "number") {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === "date") {
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? undefined : d;
  }
  return trimmed; // text, url, select-as-text (select uses SelectCell, not this)
}

/** A Date → `yyyy-mm-dd` for an `<input type="date">` (UTC day, matching storage). */
function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}
