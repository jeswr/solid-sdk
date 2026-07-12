"use client";

import { useState } from "react";
import type { IssueRecord, SprintRecord } from "@/lib/use-issues";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TypeBadge } from "@/components/type-badge";
import { PersonAvatar } from "@/components/person";
import { CalendarRange, CheckCircle2, ChevronDown, Flag, MoreHorizontal, Play, Plus } from "lucide-react";

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const fmtRange = (s?: Date, e?: Date) =>
  s && e ? `${dateFmt.format(s)} – ${dateFmt.format(e)}` : s ? `from ${dateFmt.format(s)}` : null;

const points = (issues: IssueRecord[]) => issues.reduce((sum, i) => sum + (i.estimate ?? 0), 0);

function IssueRow({
  issue,
  sprints,
  currentSprint,
  canWrite,
  onOpen,
  onMoveToSprint,
}: {
  issue: IssueRecord;
  sprints: SprintRecord[];
  currentSprint?: string;
  canWrite: boolean;
  onOpen: () => void;
  onMoveToSprint: (sprintIri: string | null) => void;
}) {
  const done = issue.status === "done";
  const movable = sprints.filter((s) => s.state !== "done" && s.iri !== currentSprint);
  return (
    <li className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
      <TypeBadge type={issue.issueType} />
      <button
        type="button"
        onClick={onOpen}
        className={`min-w-0 flex-1 truncate text-left text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
          done ? "text-muted-foreground line-through" : ""
        }`}
      >
        {issue.title}
      </button>
      {issue.estimate !== undefined && (
        <Badge variant="outline" className="shrink-0 tabular-nums" title="Story points">
          {issue.estimate}
        </Badge>
      )}
      {issue.assignee && <PersonAvatar webId={issue.assignee} className="size-5 shrink-0" />}
      {canWrite && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7" aria-label={`Move ${issue.title}`}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            {movable.map((s) => (
              <DropdownMenuItem key={s.iri} onClick={() => onMoveToSprint(s.iri)}>
                <CalendarRange className="size-4" aria-hidden /> {s.title}
              </DropdownMenuItem>
            ))}
            {currentSprint && (
              <>
                {movable.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem onClick={() => onMoveToSprint(null)}>
                  <Flag className="size-4" aria-hidden /> Backlog
                </DropdownMenuItem>
              </>
            )}
            {movable.length === 0 && !currentSprint && (
              <DropdownMenuLabel className="font-normal text-muted-foreground">No open sprints</DropdownMenuLabel>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}

/**
 * Jira-style backlog: sprint sections (active first) with start/complete and
 * points totals, then the ranked backlog. Issues move between sprints/backlog
 * via the row menu (keyboard-accessible; no drag required).
 */
export function BacklogView({
  issues,
  sprints,
  canWrite,
  onOpenIssue,
  onCreateSprint,
  onStartSprint,
  onCompleteSprint,
  onMove,
  onAddToSprint,
}: {
  issues: IssueRecord[];
  sprints: SprintRecord[];
  canWrite: boolean;
  onOpenIssue: (issue: IssueRecord) => void;
  onCreateSprint: (title: string) => void;
  onStartSprint: (iri: string) => void;
  onCompleteSprint: (iri: string) => void;
  onMove: (issueUrl: string, sprintIri: string | null) => void;
  /** Open the new-issue form; the created issue is added to this sprint (null = backlog). */
  onAddToSprint: (sprintIri: string | null) => void;
}) {
  const [newSprint, setNewSprint] = useState("");
  const [collapsedDone, setCollapsedDone] = useState(true);

  const inSprint = new Set(sprints.flatMap((s) => s.taskUrls));
  const backlog = issues
    .filter((i) => !inSprint.has(i.url) && i.issueType !== "epic" && i.state === "open")
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || (b.created?.getTime() ?? 0) - (a.created?.getTime() ?? 0));
  const issueByUrl = new Map(issues.map((i) => [i.url, i]));
  const doneSprints = sprints.filter((s) => s.state === "done");
  const openSprints = sprints.filter((s) => s.state !== "done");

  const sprintSection = (sprint: SprintRecord) => {
    const members = sprint.taskUrls.map((u) => issueByUrl.get(u)).filter((i): i is IssueRecord => !!i);
    const doneCount = members.filter((i) => i.status === "done").length;
    return (
      <Card key={sprint.iri}>
        <CardHeader className="flex flex-row flex-wrap items-center gap-2 space-y-0">
          <CalendarRange className="size-4 text-primary" aria-hidden />
          <h3 className="font-medium">{sprint.title}</h3>
          {sprint.state === "active" && <Badge className="gap-1">Active</Badge>}
          {sprint.state === "done" && (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="size-3" aria-hidden /> Completed
            </Badge>
          )}
          {fmtRange(sprint.startDate, sprint.endDate) && (
            <span className="text-xs text-muted-foreground">{fmtRange(sprint.startDate, sprint.endDate)}</span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {doneCount}/{members.length} done · {points(members)} pts
          </span>
          {canWrite && sprint.state === "planned" && (
            <Button size="sm" className="gap-1" onClick={() => onStartSprint(sprint.iri)} disabled={members.length === 0}>
              <Play className="size-3.5" aria-hidden /> Start sprint
            </Button>
          )}
          {canWrite && sprint.state === "active" && (
            <Button size="sm" variant="outline" className="gap-1" onClick={() => onCompleteSprint(sprint.iri)}>
              <CheckCircle2 className="size-3.5" aria-hidden /> Complete
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No issues yet — move work in from the backlog.</p>
          ) : (
            <ul className="space-y-1.5">
              {members.map((i) => (
                <IssueRow
                  key={i.url}
                  issue={i}
                  sprints={sprints}
                  currentSprint={sprint.iri}
                  canWrite={canWrite && sprint.state !== "done"}
                  onOpen={() => onOpenIssue(i)}
                  onMoveToSprint={(target) => onMove(i.url, target)}
                />
              ))}
            </ul>
          )}
          {canWrite && sprint.state !== "done" && (
            <Button variant="ghost" size="sm" className="mt-2 gap-1 text-muted-foreground" onClick={() => onAddToSprint(sprint.iri)}>
              <Plus className="size-3.5" aria-hidden /> Add issue
            </Button>
          )}
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-4">
      {openSprints.map(sprintSection)}

      {canWrite && (
        <div className="flex gap-2">
          <Input
            aria-label="New sprint name"
            placeholder="New sprint name…"
            value={newSprint}
            onChange={(e) => setNewSprint(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newSprint.trim()) {
                onCreateSprint(newSprint.trim());
                setNewSprint("");
              }
            }}
            className="max-w-60"
          />
          <Button
            variant="outline"
            className="gap-1"
            disabled={!newSprint.trim()}
            onClick={() => {
              onCreateSprint(newSprint.trim());
              setNewSprint("");
            }}
          >
            <Plus className="size-4" aria-hidden /> Create sprint
          </Button>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 space-y-0">
          <Flag className="size-4 text-muted-foreground" aria-hidden />
          <h3 className="font-medium">Backlog</h3>
          <span className="ml-auto text-xs text-muted-foreground">
            {backlog.length} issues · {points(backlog)} pts
          </span>
          {canWrite && (
            <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground" onClick={() => onAddToSprint(null)}>
              <Plus className="size-3.5" aria-hidden /> Add
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {backlog.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Backlog is empty.</p>
          ) : (
            <ul className="space-y-1.5">
              {backlog.map((i) => (
                <IssueRow
                  key={i.url}
                  issue={i}
                  sprints={sprints}
                  canWrite={canWrite}
                  onOpen={() => onOpenIssue(i)}
                  onMoveToSprint={(target) => onMove(i.url, target)}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {doneSprints.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setCollapsedDone((c) => !c)}
            aria-expanded={!collapsedDone}
            className="mb-2 flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={`size-3.5 transition-transform ${collapsedDone ? "-rotate-90" : ""}`} aria-hidden />
            Completed sprints ({doneSprints.length})
          </button>
          {!collapsedDone && <div className="space-y-4">{doneSprints.map(sprintSection)}</div>}
        </div>
      )}
    </div>
  );
}
