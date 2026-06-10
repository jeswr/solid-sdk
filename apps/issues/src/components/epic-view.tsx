"use client";

import { useState } from "react";
import { groupByEpic } from "@/lib/epics";
import type { IssueRecord } from "@/lib/use-issues";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { TypeBadge } from "@/components/type-badge";
import { PersonAvatar } from "@/components/person";
import { CheckCircle2, ChevronDown, ChevronRight, CircleDot, Plus, Zap } from "lucide-react";

/**
 * Jira-style epics view: one card per epic with a progress roll-up over its
 * children, expandable child lists, and a bucket for issues not in any epic.
 */
export function EpicView({
  issues,
  canCreate,
  onOpenIssue,
  onAddToEpic,
}: {
  issues: IssueRecord[];
  canCreate: boolean;
  onOpenIssue: (issue: IssueRecord) => void;
  /** Open the new-issue form pre-parented to the epic. */
  onAddToEpic: (epicUrl: string) => void;
}) {
  const { epics, unassigned } = groupByEpic(issues);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggle = (url: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });

  if (epics.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
        <Zap className="size-8 text-purple-500" aria-hidden />
        <div>
          <p className="font-medium">No epics yet</p>
          <p className="text-sm text-muted-foreground">
            Create an issue with type <span className="font-medium">Epic</span>, then group work under it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {epics.map(({ epic, children, done, total, percent }) => {
        const open = !collapsed.has(epic.url);
        return (
          <Card key={epic.url}>
            <CardHeader className="gap-2">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    aria-label={open ? `Collapse ${epic.title}` : `Expand ${epic.title}`}
                    aria-expanded={open}
                    onClick={() => toggle(epic.url)}
                  >
                    {open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
                  </Button>
                  <TypeBadge type="epic" />
                  <h3 className="min-w-0 font-medium">
                    <button
                      type="button"
                      onClick={() => onOpenIssue(epic)}
                      className="truncate text-left hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      {epic.title}
                    </button>
                  </h3>
                  {epic.status === "done" && (
                    <Badge variant="secondary" className="gap-1">
                      <CheckCircle2 className="size-3" aria-hidden /> Done
                    </Badge>
                  )}
                </div>
                {canCreate && (
                  <Button variant="outline" size="sm" className="gap-1" onClick={() => onAddToEpic(epic.url)}>
                    <Plus className="size-3.5" aria-hidden /> Add issue
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Progress value={percent} aria-label={`${percent}% complete`} className="h-2" />
                <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                  {done}/{total} done · {percent}%
                </span>
              </div>
            </CardHeader>
            {open && children.length > 0 && (
              <CardContent>
                <ul className="divide-y">
                  {children.map((c) => (
                    <li key={c.url}>
                      <button
                        type="button"
                        onClick={() => onOpenIssue(c)}
                        className="flex w-full items-center gap-2 py-2 text-left text-sm hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        <TypeBadge type={c.issueType} />
                        {c.status === "done" ? (
                          <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        ) : (
                          <CircleDot className="size-3.5 shrink-0 text-primary" aria-hidden />
                        )}
                        <span className={`min-w-0 truncate ${c.status === "done" ? "text-muted-foreground line-through" : ""}`}>
                          {c.title}
                        </span>
                        {c.assignee && <PersonAvatar webId={c.assignee} className="ml-auto size-5 shrink-0" />}
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}
          </Card>
        );
      })}

      {unassigned.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-medium text-muted-foreground">Not in any epic ({unassigned.length})</h3>
          <ul className="space-y-1">
            {unassigned.map((i) => (
              <li key={i.url}>
                <button
                  type="button"
                  onClick={() => onOpenIssue(i)}
                  className="flex w-full items-center gap-2 rounded-md border bg-card px-3 py-2 text-left text-sm hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <TypeBadge type={i.issueType} />
                  <span className={`min-w-0 truncate ${i.status === "done" ? "text-muted-foreground line-through" : ""}`}>
                    {i.title}
                  </span>
                  {i.assignee && <PersonAvatar webId={i.assignee} className="ml-auto size-5 shrink-0" />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
