"use client";

import { useState } from "react";
import { IssueCard, type IssueCardActions } from "@/components/issue-card";
import type { IssueRecord } from "@/lib/use-issues";
import type { Priority } from "@/lib/issue";

type ColumnKey = Priority | "none";
const COLUMNS: { key: ColumnKey; label: string }[] = [
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
  { key: "none", label: "No priority" },
];

/**
 * Kanban board grouped by priority. Cards drag between columns to change priority
 * (HTML5 drag-and-drop); the card's actions menu also offers an accessible
 * keyboard path for every operation including priority via Edit.
 */
export function IssueBoard({
  issues,
  cardActions,
  onMovePriority,
  canWrite,
}: {
  issues: IssueRecord[];
  cardActions: (issue: IssueRecord) => IssueCardActions;
  onMovePriority: (url: string, priority: Priority | undefined) => void;
  canWrite: boolean;
}) {
  const [dragOver, setDragOver] = useState<ColumnKey | null>(null);
  const grouped = (key: ColumnKey) =>
    issues.filter((i) => (i.priority ?? "none") === key);

  const drop = (key: ColumnKey) => (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(null);
    const url = e.dataTransfer.getData("text/plain");
    if (url) onMovePriority(url, key === "none" ? undefined : key);
  };

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {COLUMNS.map((col) => {
        const items = grouped(col.key);
        return (
          <section
            key={col.key}
            aria-label={`${col.label} (${items.length})`}
            onDragOver={canWrite ? (e) => { e.preventDefault(); setDragOver(col.key); } : undefined}
            onDragLeave={() => setDragOver((c) => (c === col.key ? null : c))}
            onDrop={canWrite ? drop(col.key) : undefined}
            className={`flex flex-col gap-2 rounded-lg border bg-muted/30 p-2 transition-colors ${
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
