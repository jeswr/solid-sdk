"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useSolidSession } from "@/lib/session-context";
import { useIssues, type IssueRecord } from "@/lib/use-issues";
import { Repository } from "@/lib/repository";
import { setGroupAccess } from "@/lib/sharing";
import { type TrackerLocation } from "@/lib/profile";
import { ConflictError } from "@/lib/errors";
import { IssueFormDialog, type IssueFormSubmit } from "@/components/issue-form-dialog";
import { ShareDialog } from "@/components/share-dialog";
import { OpenTrackerDialog } from "@/components/open-tracker-dialog";
import { CommentsDialog } from "@/components/comments-dialog";
import { TeamDialog } from "@/components/team-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Eye,
  FolderOpen,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Share2,
  Tag,
  Trash2,
  Users,
  UserRound,
} from "lucide-react";

type Filter = "open" | "closed" | "all";

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const fmtDate = (d?: Date) => (d ? dateFmt.format(d) : null);
const shortWebId = (webId: string) => {
  try {
    return new URL(webId).host;
  } catch {
    return webId;
  }
};
const priorityVariant = (p?: string): "destructive" | "default" | "secondary" =>
  p === "high" ? "destructive" : p === "medium" ? "default" : "secondary";

export function IssuesView() {
  const { profile, trackerUrl, logout } = useSolidSession();
  const ownTracker: TrackerLocation = { ownerWebId: profile!.webId, trackerUrl: trackerUrl! };

  const [tracker, setTracker] = useState<TrackerLocation>(ownTracker);
  const isOwn = tracker.ownerWebId === profile?.webId;
  const issues = useIssues(tracker.trackerUrl, profile?.webId ?? null);

  const [filter, setFilter] = useState<Filter>("open");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<IssueRecord | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<IssueRecord | undefined>(undefined);
  const [commentsUrl, setCommentsUrl] = useState<string | undefined>(undefined);
  const [shareResource, setShareResource] = useState<{ url: string; label: string } | undefined>(undefined);
  const [openTrackerOpen, setOpenTrackerOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [group, setGroup] = useState<{ iri?: string; members: string[] }>({ members: [] });

  const repo = useMemo(() => new Repository(tracker.trackerUrl), [tracker.trackerUrl]);

  const loadTrackerInfo = useCallback(async () => {
    if (!isOwn) return;
    try {
      const info = await repo.info();
      setGroup({ iri: info.assigneeGroup, members: info.groupMembers });
    } catch {
      /* tracker config is optional UI sugar */
    }
  }, [isOwn, repo]);

  useEffect(() => {
    // Mount fetch; setState only runs after the await inside loadTrackerInfo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTrackerInfo();
  }, [loadTrackerInfo]);

  const assigneeSuggestions = useMemo(
    () => (group.iri ? [group.iri, ...group.members] : group.members),
    [group],
  );

  const counts = useMemo(
    () => ({
      open: issues.issues.filter((i) => i.state === "open").length,
      closed: issues.issues.filter((i) => i.state === "closed").length,
      all: issues.issues.length,
    }),
    [issues.issues],
  );
  const visible = useMemo(
    () => (filter === "all" ? issues.issues : issues.issues.filter((i) => i.state === filter)),
    [issues.issues, filter],
  );
  const commentsIssue = useMemo(
    () => issues.issues.find((i) => i.url === commentsUrl),
    [issues.issues, commentsUrl],
  );

  async function run(action: () => Promise<void>, success: string) {
    try {
      await action();
      toast.success(success);
    } catch (e) {
      if (e instanceof ConflictError) {
        toast.error(e.message);
        await issues.refresh();
      } else {
        toast.error(e instanceof Error ? e.message : "Something went wrong.");
      }
    }
  }

  const onCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const onSubmitForm = async (values: IssueFormSubmit) => {
    if (editing) await run(() => issues.update(editing.url, values), "Issue updated");
    else await run(() => issues.create(values), "Issue created");
  };
  const shareWithTeam = (issue: IssueRecord) =>
    run(
      () => setGroupAccess(issue.url, profile!.webId, group.iri!, { read: true, write: true, control: false }),
      "Shared with the team",
    );

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <CircleDot className="size-5 shrink-0 text-primary" aria-hidden />
            <span className="text-lg font-semibold tracking-tight">Solid Issues</span>
          </div>
          <div className="flex items-center gap-1">
            {isOwn && (
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setTeamOpen(true)}>
                <Users className="size-4" aria-hidden />
                <span className="hidden sm:inline">Team</span>
              </Button>
            )}
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setOpenTrackerOpen(true)}>
              <FolderOpen className="size-4" aria-hidden />
              <span className="hidden sm:inline">Open tracker</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2">
                  <span
                    aria-hidden
                    className="flex size-7 items-center justify-center rounded-full bg-primary/10 text-primary"
                  >
                    <UserRound className="size-4" />
                  </span>
                  <span className="hidden max-w-[10rem] truncate sm:inline">
                    {profile?.name ?? profile?.webId}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <div className="px-2 py-1.5">
                  <p className="truncate text-sm font-medium">{profile?.name ?? "Signed in"}</p>
                  <p className="truncate text-xs text-muted-foreground">{profile?.webId}</p>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout}>
                  <LogOut className="size-4" aria-hidden /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {!isOwn && (
          <div className="border-t bg-muted/40">
            <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-2">
              <p className="min-w-0 truncate text-sm text-muted-foreground">
                Viewing <span className="font-medium text-foreground">{shortWebId(tracker.ownerWebId)}</span>&apos;s
                tracker
              </p>
              <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setTracker(ownTracker)}>
                <ArrowLeft className="size-4" aria-hidden /> My issues
              </Button>
            </div>
          </div>
        )}
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div role="tablist" aria-label="Filter issues" className="flex gap-1 rounded-lg bg-muted p-1">
            {(["open", "closed", "all"] as const).map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                  filter === f ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f} <span className="text-muted-foreground">{counts[f]}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!issues.canCreate && (
              <Badge variant="secondary" className="gap-1">
                <Eye className="size-3" aria-hidden /> Read-only
              </Badge>
            )}
            {isOwn && (
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() => setShareResource({ url: repo.containerUrl, label: "this tracker" })}
              >
                <Share2 className="size-4" aria-hidden /> Share
              </Button>
            )}
            {issues.canCreate && (
              <Button onClick={onCreate} className="gap-1.5">
                <Plus className="size-4" aria-hidden /> New issue
              </Button>
            )}
          </div>
        </div>

        {issues.loading ? (
          <ul className="space-y-3" aria-busy="true" aria-label="Loading issues">
            {[0, 1, 2].map((i) => (
              <li key={i}>
                <Card>
                  <CardHeader className="gap-2">
                    <Skeleton className="h-5 w-2/3" />
                    <Skeleton className="h-4 w-1/3" />
                  </CardHeader>
                </Card>
              </li>
            ))}
          </ul>
        ) : issues.error ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center"
          >
            <AlertCircle className="size-8 text-destructive" aria-hidden />
            <p className="text-sm text-destructive">{issues.error}</p>
            <Button variant="outline" onClick={() => issues.refresh()}>
              Try again
            </Button>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
            <CircleDot className="size-8 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-medium">No {filter === "all" ? "" : filter} issues</p>
              <p className="text-sm text-muted-foreground">
                {!issues.canCreate
                  ? "This tracker has no issues to show."
                  : filter === "closed"
                    ? "Closed issues will show up here."
                    : "Create your first issue to get started."}
              </p>
            </div>
            {issues.canCreate && filter !== "closed" && (
              <Button onClick={onCreate} variant="outline" className="gap-1.5">
                <Plus className="size-4" aria-hidden /> New issue
              </Button>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((issue) => (
              <li key={issue.url}>
                <IssueCard
                  issue={issue}
                  isOwner={isOwn}
                  groupIri={group.iri}
                  onEdit={() => {
                    setEditing(issue);
                    setFormOpen(true);
                  }}
                  onComments={() => setCommentsUrl(issue.url)}
                  onShare={() => setShareResource({ url: issue.url, label: "this issue" })}
                  onShareTeam={() => shareWithTeam(issue)}
                  onToggle={() =>
                    run(
                      () => issues.setState(issue.url, issue.state === "open" ? "closed" : "open"),
                      issue.state === "open" ? "Issue closed" : "Issue reopened",
                    )
                  }
                  onDelete={() => setDeleteTarget(issue)}
                />
              </li>
            ))}
          </ul>
        )}
      </main>

      <IssueFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        onSubmit={onSubmitForm}
        assigneeSuggestions={assigneeSuggestions}
      />

      <CommentsDialog
        open={!!commentsUrl}
        onOpenChange={(o) => !o && setCommentsUrl(undefined)}
        issue={commentsIssue}
        canComment={!!commentsIssue?.canWrite}
        onAdd={(content) => issues.addComment(commentsUrl!, content)}
      />

      {profile && shareResource && (
        <ShareDialog
          open={!!shareResource}
          onOpenChange={(o) => !o && setShareResource(undefined)}
          resourceUrl={shareResource.url}
          ownerWebId={profile.webId}
          title={`Share ${shareResource.label}`}
          description="Grant another person access by their WebID. They can open it from their own app."
          onChanged={loadTrackerInfo}
        />
      )}

      {isOwn && (
        <TeamDialog
          open={teamOpen}
          onOpenChange={setTeamOpen}
          trackerUrl={tracker.trackerUrl}
          onSaved={loadTrackerInfo}
        />
      )}

      <OpenTrackerDialog
        open={openTrackerOpen}
        onOpenChange={setOpenTrackerOpen}
        onOpen={(t) => {
          setTracker(t);
          setFilter("open");
          if (t.ownerWebId === profile?.webId) toast.info("That's your own tracker.");
        }}
      />

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this issue?</DialogTitle>
            <DialogDescription>
              “{deleteTarget?.title}” will be permanently removed from the pod. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(undefined)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                const target = deleteTarget;
                setDeleteTarget(undefined);
                if (target) await run(() => issues.remove(target.url), "Issue deleted");
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function IssueCard({
  issue,
  isOwner,
  groupIri,
  onEdit,
  onComments,
  onShare,
  onShareTeam,
  onToggle,
  onDelete,
}: {
  issue: IssueRecord;
  isOwner: boolean;
  groupIri?: string;
  onEdit: () => void;
  onComments: () => void;
  onShare: () => void;
  onShareTeam: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const closed = issue.state === "closed";
  const canWrite = issue.canWrite;
  const assigneeLabel = issue.assignee
    ? issue.assignee === groupIri
      ? "Team"
      : shortWebId(issue.assignee)
    : null;

  return (
    <Card className={closed ? "opacity-75" : undefined}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={closed ? "secondary" : "default"} className="gap-1">
              {closed ? <CheckCircle2 className="size-3" aria-hidden /> : <CircleDot className="size-3" aria-hidden />}
              {closed ? "Closed" : "Open"}
            </Badge>
            {issue.priority && (
              <Badge variant={priorityVariant(issue.priority)} className="capitalize">
                {issue.priority}
              </Badge>
            )}
            <h3 className={`truncate font-medium ${closed ? "line-through" : ""}`}>{issue.title}</h3>
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
      {(issue.description || issue.dateDue || assigneeLabel || issue.comments.length > 0) && (
        <CardContent className="space-y-2">
          {issue.description && (
            <p className="line-clamp-3 text-sm text-muted-foreground whitespace-pre-wrap">{issue.description}</p>
          )}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {issue.dateDue && (
              <span className="flex items-center gap-1">
                <CalendarClock className="size-3.5" aria-hidden /> Due {fmtDate(issue.dateDue)}
              </span>
            )}
            {assigneeLabel && (
              <span className="flex items-center gap-1">
                <UserRound className="size-3.5" aria-hidden /> {assigneeLabel}
              </span>
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
