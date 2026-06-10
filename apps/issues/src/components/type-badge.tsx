"use client";

import { Bookmark, Bug, CheckSquare, Zap } from "lucide-react";
import type { IssueType } from "@/lib/issue";

/** Jira-style issue-type marker: colored icon + label. */
const TYPES: Record<IssueType, { label: string; icon: typeof Zap; className: string }> = {
  epic: { label: "Epic", icon: Zap, className: "text-purple-600 dark:text-purple-400" },
  story: { label: "Story", icon: Bookmark, className: "text-green-600 dark:text-green-400" },
  task: { label: "Task", icon: CheckSquare, className: "text-blue-600 dark:text-blue-400" },
  bug: { label: "Bug", icon: Bug, className: "text-red-600 dark:text-red-400" },
};

export function TypeBadge({ type, withLabel = false }: { type: IssueType; withLabel?: boolean }) {
  const t = TYPES[type];
  const Icon = t.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${t.className}`} title={t.label}>
      <Icon className="size-3.5" aria-hidden />
      {withLabel ? t.label : <span className="sr-only">{t.label}</span>}
    </span>
  );
}

export const typeLabel = (type: IssueType) => TYPES[type].label;
