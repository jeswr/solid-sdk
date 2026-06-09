"use client";

import { useState } from "react";
import { IssueCard, type IssueCardActions } from "@/components/issue-card";
import type { IssueRecord } from "@/lib/use-issues";

export interface BoardColumn {
  key: string;
  label: string;
}

/**
 * Generic Kanban board: columns + a grouping function + a move handler. Cards drag
 * between columns (HTML5 DnD) to change the grouping field (status or priority);
 * the card's actions menu remains the keyboard-accessible path.
 */
export function IssueBoard({
  issues,
  columns,
  groupOf,
  onMove,
  cardActions,
  canWrite,
}: {
  issues: IssueRecord[];
  columns: BoardColumn[];
  groupOf: (issue: IssueRecord) => string;
  onMove: (url: string, columnKey: string) => void;
  cardActions: (issue: IssueRecord) => IssueCardActions;
  canWrite: boolean;
}) {
  const [dragOver, setDragOver] = useState<string | null>(null);

  const drop = (key: string) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const url = e.dataTransfer.getData("text/plain");
    if (url) onMove(url, key);
  };

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {columns.map((col) => {
        const items = issues.filter((i) => groupOf(i) === col.key);
        return (
          <section
            key={col.key}
            aria-label={`${col.label} (${items.length})`}
            onDragOver={canWrite ? (e) => { e.preventDefault(); setDragOver(col.key); } : undefined}
            onDragLeave={() => setDragOver((c) => (c === col.key ? null : c))}
            onDrop={canWrite ? drop(col.key) : undefined}
            className={`flex w-72 shrink-0 flex-col gap-2 rounded-lg border bg-muted/30 p-2 transition-colors ${
              dragOver === col.key ? "ring-2 ring-primary" : ""
            }`}
          >
            <h3 className="flex items-center justify-between px-1 text-sm font-medium">
              <span>{col.label}</span>
              <span className="text-muted-foreground">{items.length}</span>
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
  );
}
