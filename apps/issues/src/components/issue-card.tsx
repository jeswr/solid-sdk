"use client";

import type React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CalendarClock,
  CheckCircle2,
  CircleDot,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Share2,
  Tag,
  Trash2,
  Users,
} from "lucide-react";
import type { IssueRecord } from "@/lib/use-issues";
import { STATUSES } from "@/lib/issue";
import { TypeBadge } from "@/components/type-badge";
import { PersonChip } from "@/components/person";

const statusLabel = (slug: string) => STATUSES.find((s) => s.slug === slug)?.label ?? slug;
const statusVariant = (slug: string): "default" | "secondary" | "outline" =>
  slug === "in-progress" ? "default" : slug === "done" ? "secondary" : "outline";

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
export const fmtDate = (d?: Date) => (d ? dateFmt.format(d) : null);
export const shortWebId = (webId: string) => {
  try {
    return new URL(webId).host;
  } catch {
    return webId;
  }
};
export const priorityVariant = (p?: string): "destructive" | "default" | "secondary" =>
  p === "high" ? "destructive" : p === "medium" ? "default" : "secondary";

export interface IssueCardActions {
  isOwner: boolean;
  groupIri?: string;
  onEdit: () => void;
  onComments: () => void;
  onShare: () => void;
  onShareTeam: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

const overdue = (issue: IssueRecord) =>
  issue.state === "open" && issue.dateDue !== undefined && issue.dateDue.getTime() < Date.now();

export function IssueCard({
  issue,
  isOwner,
  groupIri,
  onEdit,
  onComments,
  onShare,
  onShareTeam,
  onToggle,
  onDelete,
  draggable,
  onDragStart,
}: { issue: IssueRecord } & IssueCardActions & {
    draggable?: boolean;
    onDragStart?: (e: React.DragEvent) => void;
  }) {
  const closed = issue.state === "closed";
  const canWrite = issue.canWrite;
  const isOverdue = overdue(issue);

  return (
    <Card
      className={closed ? "opacity-75" : undefined}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <TypeBadge type={issue.issueType} />
            <Badge variant={statusVariant(issue.status)} className="gap-1">
              {issue.status === "done" ? (
                <CheckCircle2 className="size-3" aria-hidden />
              ) : (
                <CircleDot className="size-3" aria-hidden />
              )}
              {statusLabel(issue.status)}
            </Badge>
            {issue.priority && (
              <Badge variant={priorityVariant(issue.priority)} className="capitalize">
                {issue.priority}
              </Badge>
            )}
            <h3 className={`truncate font-medium ${closed ? "line-through" : ""}`}>
              <button
                type="button"
                onClick={onComments}
                className="truncate text-left hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                {issue.title}
              </button>
            </h3>
          </div>
          {issue.labels.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {issue.labels.map((l) => (
                <Badge key={l} variant="outline" className="gap-1 text-xs">
                  <Tag className="size-3" aria-hidden /> {l}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`Actions for ${issue.title}`}>
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onComments}>
              <MessageSquare className="size-4" aria-hidden /> Comments
            </DropdownMenuItem>
            {canWrite && (
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="size-4" aria-hidden /> Edit
              </DropdownMenuItem>
            )}
            {canWrite && (
              <DropdownMenuItem onClick={onToggle}>
                {closed ? (
                  <>
                    <RotateCcw className="size-4" aria-hidden /> Reopen
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="size-4" aria-hidden /> Close
                  </>
                )}
              </DropdownMenuItem>
            )}
            {isOwner && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onShare}>
                  <Share2 className="size-4" aria-hidden /> Share…
                </DropdownMenuItem>
                {groupIri && (
                  <DropdownMenuItem onClick={onShareTeam}>
                    <Users className="size-4" aria-hidden /> Share with team
                  </DropdownMenuItem>
                )}
              </>
            )}
            {canWrite && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <Trash2 className="size-4" aria-hidden /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      {(issue.description || issue.dateDue || issue.assignee || issue.comments.length > 0) && (
        <CardContent className="space-y-2">
          {issue.description && (
            <p className="line-clamp-3 text-sm text-muted-foreground whitespace-pre-wrap">{issue.description}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {issue.dateDue && (
              <span className={`flex items-center gap-1 ${isOverdue ? "font-medium text-destructive" : ""}`}>
                <CalendarClock className="size-3.5" aria-hidden /> Due {fmtDate(issue.dateDue)}
              </span>
            )}
            {issue.assignee && (
              <PersonChip webId={issue.assignee} isTeam={issue.assignee === groupIri} className="max-w-48" />
            )}
            <button
              type="button"
              onClick={onComments}
              className="flex items-center gap-1 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <MessageSquare className="size-3.5" aria-hidden /> {issue.comments.length}
            </button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
