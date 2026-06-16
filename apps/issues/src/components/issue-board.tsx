"use client";

import { useState } from "react";
import { Plus as PlusIcon } from "lucide-react";
import { IssueCard, type IssueCardActions } from "@/components/issue-card";
import type { IssueRecord } from "@/lib/use-issues";
import { swimlanes, UNGROUPED_LANE, type SwimlaneBy } from "@/lib/board";

export interface BoardColumn {
  key: string;
  label: string;
}

/**
 * Generic Kanban board: columns + a grouping function + a move handler. Cards drag
 * between columns (HTML5 DnD) to change the grouping field (status or priority);
 * the card's actions menu remains the keyboard-accessible path.
 *
 * Optionally partitions cards into horizontal SWIMLANES (`swimlaneBy` — by
 * assignee or epic, the Jira board hallmark). With `swimlaneBy: "none"` (the
 * default) the board is a single flat lane. `labelOf` resolves a lane value (a
 * WebID / epic URL) to its display label.
 */
export function IssueBoard({
  issues,
  columns,
  groupOf,
  onMove,
  onAddToColumn,
  cardActions,
  canWrite,
  swimlaneBy = "none",
  labelOf = (k) => k,
}: {
  issues: IssueRecord[];
  columns: BoardColumn[];
  groupOf: (issue: IssueRecord) => string;
  onMove: (url: string, columnKey: string) => void;
  /** Render a "+" in each column header that creates an issue pre-set to it. */
  onAddToColumn?: (columnKey: string) => void;
  cardActions: (issue: IssueRecord) => IssueCardActions;
  canWrite: boolean;
  /** How to partition cards into horizontal swimlanes (default: a flat board). */
  swimlaneBy?: SwimlaneBy;
  /** Resolve a swimlane value (WebID / epic URL) to its display label. */
  labelOf?: (value: string) => string;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);

  const drop = (key: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const url = e.dataTransfer.getData("text/plain");
    if (url) onMove(url, key);
  };

  const lanes = swimlanes(issues, swimlaneBy, labelOf);
  const showLaneHeadings = swimlaneBy !== "none";

  // The drop target is unique across lanes: a column key alone repeats per lane,
  // so the highlight key is namespaced by lane to avoid every lane lighting up.
  const dropKey = (laneKey: string, colKey: string) => `${laneKey}::${colKey}`;

  return (
    <div className="flex flex-col gap-5">
      {lanes.map((lane) => (
        <div key={lane.key} className="flex flex-col gap-2">
          {showLaneHeadings && (
            <h2 className="flex items-center gap-2 px-1 text-sm font-semibold">
              <span className={lane.key === UNGROUPED_LANE ? "text-muted-foreground" : ""}>{lane.label}</span>
              <span className="rounded-full bg-muted px-1.5 py-px text-xs font-medium text-muted-foreground tabular-nums">
                {lane.issues.length}
              </span>
            </h2>
          )}
          <div className="flex gap-4 overflow-x-auto pb-2">
            {columns.map((col) => {
              const items = lane.issues.filter((i) => groupOf(i) === col.key);
              const k = dropKey(lane.key, col.key);
              return (
                <section
                  key={col.key}
                  aria-label={
                    showLaneHeadings
                      ? `${lane.label} — ${col.label} (${items.length})`
                      : `${col.label} (${items.length})`
                  }
                  onDragOver={canWrite ? (e) => { e.preventDefault(); setDragOver(k); } : undefined}
                  onDragLeave={() => setDragOver((c) => (c === k ? null : c))}
                  onDrop={canWrite ? drop(col.key) : undefined}
                  className={`flex w-72 shrink-0 flex-col gap-2 rounded-xl bg-muted/50 p-2 transition-[box-shadow,background-color] duration-150 ${
                    dragOver === k ? "bg-primary/5 ring-2 ring-primary/60" : ""
                  }`}
                >
                  <h3 className="flex items-center gap-2 px-1.5 py-1 text-[0.8rem] font-semibold tracking-wide">
                    <span>{col.label}</span>
                    <span className="rounded-full bg-background px-1.5 py-px text-xs font-medium text-muted-foreground tabular-nums ring-1 ring-border">
                      {items.length}
                    </span>
                    {/* Add-to-column only on the flat board: in a swimlane the new
                        card's lane (assignee/epic) is ambiguous from a column header. */}
                    {onAddToColumn && !showLaneHeadings && (
                      <button
                        type="button"
                        aria-label={`New issue in ${col.label}`}
                        onClick={() => onAddToColumn(col.key)}
                        className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <PlusIcon className="size-4" aria-hidden />
                      </button>
                    )}
                  </h3>
                  <div className="flex flex-col gap-2">
                    {items.map((issue) => (
                      <IssueCard
                        key={issue.url}
                        issue={issue}
                        {...cardActions(issue)}
                        draggable={canWrite && issue.canWrite}
                        onDragStart={(e) => e.dataTransfer.setData("text/plain", issue.url)}
                      />
                    ))}
                    {items.length === 0 && (
                      <p className="px-1 py-4 text-center text-xs text-muted-foreground">Drop issues here</p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
