"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Ban, CalendarClock, CheckCircle2, CircleDot, Copy as CopyIcon, Download, GitBranch, Link2, Loader2, MessageSquare, Paperclip, Pencil, Plus, Tag, Upload, X } from "lucide-react";

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
import { STATUSES, safeHttpUrl, canNest, type FieldDef } from "@/lib/issue";
import { linksOf, rollupOf, descendantUrlsOf } from "@/lib/rollups";
import { priorityVariant, shortWebId } from "@/components/issue-card";
import { PersonChip } from "@/components/person";
import { TypeBadge, typeLabel } from "@/components/type-badge";

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
  fieldDefs = [],
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
  /** Custom-field definitions, used to label and format `issue.fields`. */
  fieldDefs?: FieldDef[];
  canComment: boolean;
  onEdit: () => void;
  onAddComment: (content: string, mentions: string[]) => Promise<void>;
  onUpdate: (patch: {
    parent?: string;
    blockedBy?: string[];
    relatesTo?: string[];
    duplicateOf?: string;
    clonedFrom?: string;
  }) => Promise<void>;
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

  // F5: compute descendants BEFORE the early return so the hook order is stable.
  // When `issue` is undefined this returns an empty set (no-op); it's only used after
  // the guard below.
  const selfDescendants = useMemo(
    () => (issue ? descendantUrlsOf(issue, allIssues) : new Set<string>()),
    [issue, allIssues],
  );

  if (!issue) return null;

  const self = issue;
  const titleOf = (url: string) => allIssues.find((i) => i.url === url)?.title ?? "(unknown issue)";
  // F5: parent candidates must be strictly coarser types (canNest enforces the
  // Initiative→Epic→Feature→Story→Task/Bug hierarchy), must not be self, and must
  // not be an existing descendant (to prevent cycles in the tree).
  const candidates = allIssues.filter(
    (i) => i.url !== self.url && !selfDescendants.has(i.url) && canNest(i.issueType, self.issueType),
  );
  const subTasks = allIssues.filter((i) => i.parent === self.url);
  const blocking = allIssues.filter((i) => i.blockedBy.includes(self.url));
  const addableBlockers = candidates.filter((i) => !self.blockedBy.includes(i.url) && i.url !== self.parent);
  // F2: bidirectional links (relates is symmetric; duplicate/clone show inverses).
  const links = linksOf(self, allIssues);
  const addableRelated = candidates.filter((i) => !links.relates.includes(i.url));
  // F6: roll up child completion to the parent ("3/5 done").
  const rollup = rollupOf(self, allIssues);

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
          <DialogDescription className="sr-only">
            Issue details: status, relationships, attachments, and activity.
          </DialogDescription>
        </DialogHeader>

        {/* Metadata */}
        <div className="flex flex-wrap items-center gap-2 py-3">
          <Badge variant="outline" className="gap-1" title={typeLabel(issue.issueType)}>
            <TypeBadge type={issue.issueType} withLabel />
          </Badge>
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
          {issue.assignee && (
            <div>
              <dt className="text-xs text-muted-foreground">Assignee</dt>
              <dd className="truncate">
                <PersonChip webId={issue.assignee} isTeam={issue.assignee === groupIri} />
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
          {fieldDefs
            .filter((def) => issue.fields[def.slug] !== undefined)
            .map((def) => {
              const value = issue.fields[def.slug]!;
              // Pod data is untrusted — only http(s) values become links.
              const href = def.type === "url" ? safeHttpUrl(String(value)) : undefined;
              return (
                <div key={def.iri}>
                  <dt className="text-xs text-muted-foreground">{def.label}</dt>
                  <dd className="truncate">
                    {def.type === "date" ? (
                      dateFmt.format(value as Date)
                    ) : def.type === "select" ? (
                      (def.options.find((o) => o.iri === value)?.label ?? String(value))
                    ) : href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary underline-offset-2 hover:underline"
                      >
                        {String(value)}
                      </a>
                    ) : (
                      String(value)
                    )}
                  </dd>
                </div>
              );
            })}
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
              <h3 className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Link2 className="size-3.5" aria-hidden /> Sub-tasks
                {/* F6: roll up child completion to the parent. */}
                <span className="tabular-nums text-muted-foreground">
                  · {rollup.done}/{rollup.total} done ({rollup.percent}%)
                </span>
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

          {/* F2: Relates-to (symmetric, non-blocking) */}
          <div className="space-y-1">
            <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Link2 className="size-3.5" aria-hidden /> Relates to
            </h3>
            {links.relates.length === 0 && !canComment && <p className="text-sm text-muted-foreground">Nothing.</p>}
            <ul className="space-y-1">
              {links.relates.map((rUrl) => (
                <li key={rUrl} className="flex items-center gap-2 text-sm">
                  <span className="truncate">{titleOf(rUrl)}</span>
                  {canComment && self.relatesTo.includes(rUrl) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      aria-label={`Remove related ${titleOf(rUrl)}`}
                      onClick={() => onUpdate({ relatesTo: self.relatesTo.filter((x) => x !== rUrl) })}
                    >
                      <X className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            {canComment && addableRelated.length > 0 && (
              <Select value="" onValueChange={(v) => onUpdate({ relatesTo: [...self.relatesTo, v] })}>
                <SelectTrigger className="h-7 w-56 text-sm" aria-label="Add related issue">
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Plus className="size-3.5" aria-hidden /> Add related
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {addableRelated.map((c) => (
                    <SelectItem key={c.url} value={c.url}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* F2: Duplicate-of (supersession) */}
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <CopyIcon className="size-3.5" aria-hidden /> Duplicate of
            </h3>
            {canComment ? (
              <Select
                value={self.duplicateOf ?? "none"}
                onValueChange={(v) => onUpdate({ duplicateOf: v === "none" ? undefined : v })}
              >
                <SelectTrigger className="h-7 w-56 text-sm" aria-label="Duplicate of">
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
              <span className="text-sm">{self.duplicateOf ? titleOf(self.duplicateOf) : "None"}</span>
            )}
          </div>
          {(links.duplicatedBy.length > 0 || links.clones.length > 0 || self.clonedFrom) && (
            <div className="space-y-1 text-sm">
              {links.duplicatedBy.length > 0 && (
                <p className="text-muted-foreground">
                  Duplicated by: {links.duplicatedBy.map(titleOf).join(", ")}
                </p>
              )}
              {self.clonedFrom && (
                <p className="text-muted-foreground">Cloned from: {titleOf(self.clonedFrom)}</p>
              )}
              {links.clones.length > 0 && (
                <p className="text-muted-foreground">Clones: {links.clones.map(titleOf).join(", ")}</p>
              )}
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
                    {a.author ? (
                      <PersonChip webId={a.author} className="font-medium text-foreground" />
                    ) : (
                      <span className="font-medium text-foreground">Someone</span>
                    )}
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
