"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { CalendarClock, CheckCircle2, CircleDot, Loader2, MessageSquare, Pencil, Tag, UserRound } from "lucide-react";
import type { IssueRecord } from "@/lib/use-issues";
import { STATUSES } from "@/lib/issue";
import { priorityVariant, shortWebId } from "@/components/issue-card";

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const timeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const statusLabel = (slug: string) => STATUSES.find((s) => s.slug === slug)?.label ?? slug;

type Activity = { at: Date; text: string; kind: "event" | "comment"; author?: string; body?: string };

/** A full issue view: metadata, description, an activity timeline, and commenting. */
export function IssueDetailDialog({
  open,
  onOpenChange,
  issue,
  groupIri,
  canComment,
  onEdit,
  onAddComment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue?: IssueRecord;
  groupIri?: string;
  canComment: boolean;
  onEdit: () => void;
  onAddComment: (content: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const timeline = useMemo<Activity[]>(() => {
    if (!issue) return [];
    const items: Activity[] = [];
    if (issue.created) items.push({ at: issue.created, text: "created this issue", kind: "event", author: issue.creator });
    for (const c of issue.comments)
      if (c.created) items.push({ at: c.created, text: "commented", kind: "comment", author: c.author, body: c.content });
    return items.sort((a, b) => a.at.getTime() - b.at.getTime());
  }, [issue]);

  const submit = async () => {
    const content = text.trim();
    if (!content) return;
    setBusy(true);
    try {
      await onAddComment(content);
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post the comment.");
    } finally {
      setBusy(false);
    }
  };

  if (!issue) return null;
  const assignee = issue.assignee ? (issue.assignee === groupIri ? "Team" : shortWebId(issue.assignee)) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-3">
            <DialogTitle className="text-lg">{issue.title}</DialogTitle>
            {canComment && (
              <Button variant="outline" size="sm" className="gap-1.5" onClick={onEdit}>
                <Pencil className="size-4" aria-hidden /> Edit
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-2 py-3">
          <Badge variant={issue.status === "done" ? "secondary" : issue.status === "in-progress" ? "default" : "outline"} className="gap-1">
            {issue.status === "done" ? <CheckCircle2 className="size-3" aria-hidden /> : <CircleDot className="size-3" aria-hidden />}
            {statusLabel(issue.status)}
          </Badge>
          {issue.priority && (
            <Badge variant={priorityVariant(issue.priority)} className="capitalize">
              {issue.priority} priority
            </Badge>
          )}
          {issue.labels.map((l) => (
            <Badge key={l} variant="outline" className="gap-1">
              <Tag className="size-3" aria-hidden /> {l}
            </Badge>
          ))}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-y py-3 text-sm sm:grid-cols-3">
          {assignee && (
            <div>
              <dt className="text-xs text-muted-foreground">Assignee</dt>
              <dd className="flex items-center gap-1 truncate">
                <UserRound className="size-3.5" aria-hidden /> {assignee}
              </dd>
            </div>
          )}
          {issue.dateDue && (
            <div>
              <dt className="text-xs text-muted-foreground">Due</dt>
              <dd className="flex items-center gap-1">
                <CalendarClock className="size-3.5" aria-hidden /> {dateFmt.format(issue.dateDue)}
              </dd>
            </div>
          )}
          {issue.created && (
            <div>
              <dt className="text-xs text-muted-foreground">Created</dt>
              <dd>{dateFmt.format(issue.created)}</dd>
            </div>
          )}
        </dl>

        {issue.description && (
          <div className="py-3">
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">Description</h3>
            <p className="text-sm whitespace-pre-wrap">{issue.description}</p>
          </div>
        )}

        {/* Activity timeline */}
        <div className="py-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <MessageSquare className="size-3.5" aria-hidden /> Activity
          </h3>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No activity yet.</p>
          ) : (
            <ul className="space-y-3">
              {timeline.map((a, i) => (
                <li key={i} className="text-sm">
                  <div className="flex items-baseline gap-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{a.author ? shortWebId(a.author) : "Someone"}</span>
                    <span>{a.text}</span>
                    <span>· {timeFmt.format(a.at)}</span>
                  </div>
                  {a.body && <p className="mt-1 rounded-md border bg-muted/30 p-2 whitespace-pre-wrap">{a.body}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {canComment && (
          <div className="space-y-2 border-t pt-3">
            <Textarea aria-label="Add a comment" rows={3} placeholder="Add a comment…" value={text} onChange={(e) => setText(e.target.value)} />
            <div className="flex justify-end">
              <Button onClick={submit} disabled={busy || !text.trim()}>
                {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Comment
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
