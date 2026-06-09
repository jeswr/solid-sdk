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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ban, CalendarClock, CheckCircle2, CircleDot, Download, GitBranch, Link2, Loader2, MessageSquare, Paperclip, Pencil, Plus, Tag, Upload, UserRound, X } from "lucide-react";

const fileName = (url: string) => {
  const last = url.split("/").pop() ?? url;
  const noUuid = last.replace(/^[0-9a-f-]{36}-/i, "");
  try {
    return decodeURIComponent(noUuid);
  } catch {
    return noUuid;
  }
};

/** Render comment text with @mentions highlighted. */
const renderBody = (text: string) =>
  text.split(/(@\S+)/g).map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="font-medium text-primary">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
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
  allIssues,
  people,
  groupIri,
  canComment,
  onEdit,
  onAddComment,
  onUpdate,
  onUpload,
  onRemoveAttachment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue?: IssueRecord;
  allIssues: IssueRecord[];
  people: string[];
  groupIri?: string;
  canComment: boolean;
  onEdit: () => void;
  onAddComment: (content: string, mentions: string[]) => Promise<void>;
  onUpdate: (patch: { parent?: string; blockedBy?: string[] }) => Promise<void>;
  onUpload: (file: { name: string; type: string; data: ArrayBuffer }) => Promise<void>;
  onRemoveAttachment: (fileUrl: string) => Promise<void>;
}) {
  const [uploading, setUploading] = useState(false);
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
      const mentions = people.filter((p) => content.includes(`@${shortWebId(p)}`));
      await onAddComment(content, mentions);
      setText("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not post the comment.");
    } finally {
      setBusy(false);
    }
  };

  if (!issue) return null;
  const assignee = issue.assignee ? (issue.assignee === groupIri ? "Team" : shortWebId(issue.assignee)) : null;

  const self = issue;
  const titleOf = (url: string) => allIssues.find((i) => i.url === url)?.title ?? "(unknown issue)";
  const candidates = allIssues.filter((i) => i.url !== self.url);
  const subTasks = allIssues.filter((i) => i.parent === self.url);
  const blocking = allIssues.filter((i) => i.blockedBy.includes(self.url));
  const addableBlockers = candidates.filter((i) => !self.blockedBy.includes(i.url) && i.url !== self.parent);

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

        {/* Relationships */}
        <div className="space-y-3 border-b py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <GitBranch className="size-3.5" aria-hidden /> Parent
            </h3>
            {canComment ? (
              <Select
                value={issue.parent ?? "none"}
                onValueChange={(v) => onUpdate({ parent: v === "none" ? undefined : v })}
              >
                <SelectTrigger className="h-7 w-56 text-sm" aria-label="Parent issue">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {candidates.map((c) => (
                    <SelectItem key={c.url} value={c.url}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="text-sm">{issue.parent ? titleOf(issue.parent) : "None"}</span>
            )}
          </div>

          <div className="space-y-1">
            <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Ban className="size-3.5" aria-hidden /> Blocked by
            </h3>
            {issue.blockedBy.length === 0 && !canComment && <p className="text-sm text-muted-foreground">Nothing.</p>}
            <ul className="space-y-1">
              {issue.blockedBy.map((b) => (
                <li key={b} className="flex items-center gap-2 text-sm">
                  <span className="truncate">{titleOf(b)}</span>
                  {canComment && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label={`Remove blocker ${titleOf(b)}`}
                      onClick={() => onUpdate({ blockedBy: issue.blockedBy.filter((x) => x !== b) })}
                    >
                      <X className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {canComment && addableBlockers.length > 0 && (
              <Select value="" onValueChange={(v) => onUpdate({ blockedBy: [...issue.blockedBy, v] })}>
                <SelectTrigger className="h-7 w-56 text-sm" aria-label="Add blocker">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Plus className="size-3.5" aria-hidden /> Add blocker
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {addableBlockers.map((c) => (
                    <SelectItem key={c.url} value={c.url}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {subTasks.length > 0 && (
            <div className="space-y-1">
              <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Link2 className="size-3.5" aria-hidden /> Sub-tasks
              </h3>
              <ul className="space-y-0.5 text-sm">
                {subTasks.map((s) => (
                  <li key={s.url} className={s.state === "closed" ? "text-muted-foreground line-through" : ""}>
                    {s.title}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {blocking.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-xs font-medium text-muted-foreground">Blocking</h3>
              <ul className="space-y-0.5 text-sm">
                {blocking.map((s) => (
                  <li key={s.url}>{s.title}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Attachments */}
        <div className="space-y-2 border-b py-3">
          <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Paperclip className="size-3.5" aria-hidden /> Attachments
          </h3>
          {issue.attachments.length === 0 ? (
            !canComment && <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="space-y-1">
              {issue.attachments.map((a) => (
                <li key={a} className="flex items-center gap-2 text-sm">
                  <a
                    href={a}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-w-0 items-center gap-1 text-primary underline-offset-4 hover:underline"
                  >
                    <Download className="size-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{fileName(a)}</span>
                  </a>
                  {canComment && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label={`Remove attachment ${fileName(a)}`}
                      onClick={() => onRemoveAttachment(a)}
                    >
                      <X className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canComment && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline">
              {uploading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Upload className="size-3.5" aria-hidden />}
              {uploading ? "Uploading…" : "Upload a file"}
              <input
                type="file"
                className="sr-only"
                disabled={uploading}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setUploading(true);
                  try {
                    await onUpload({ name: f.name, type: f.type, data: await f.arrayBuffer() });
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Upload failed.");
                  } finally {
                    setUploading(false);
                    e.target.value = "";
                  }
                }}
              />
            </label>
          )}
        </div>

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
                  {a.body && (
                    <p className="mt-1 rounded-md border bg-muted/30 p-2 whitespace-pre-wrap">{renderBody(a.body)}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {canComment && (
          <div className="space-y-2 border-t pt-3">
            {people.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-muted-foreground">Mention:</span>
                {people.map((p) => (
                  <Button
                    key={p}
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@${shortWebId(p)} `)}
                  >
                    @{shortWebId(p)}
                  </Button>
                ))}
              </div>
            )}
            <Textarea aria-label="Add a comment" rows={3} placeholder="Add a comment…  (@ to mention)" value={text} onChange={(e) => setText(e.target.value)} />
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
