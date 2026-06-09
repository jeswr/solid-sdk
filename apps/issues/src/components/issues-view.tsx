"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useSolidSession } from "@/lib/session-context";
import { useIssues, type IssueView } from "@/lib/use-issues";
import { type TrackerLocation } from "@/lib/profile";
import { listCollaborators } from "@/lib/sharing";
import { ConflictError } from "@/lib/errors";
import { IssueFormDialog, type IssueFormSubmit } from "@/components/issue-form-dialog";
import { ShareDialog } from "@/components/share-dialog";
import { OpenTrackerDialog } from "@/components/open-tracker-dialog";
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
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Share2,
  Trash2,
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

export function IssuesView() {
  const { profile, issuesUrl, logout } = useSolidSession();
  const ownTracker: TrackerLocation = { ownerWebId: profile!.webId, issuesUrl: issuesUrl! };

  const [tracker, setTracker] = useState<TrackerLocation>(ownTracker);
  const isOwn = tracker.ownerWebId === profile?.webId;
  const issues = useIssues(tracker.issuesUrl, profile?.webId ?? null);

  const [filter, setFilter] = useState<Filter>("open");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<IssueView | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<IssueView | undefined>(undefined);
  const [shareOpen, setShareOpen] = useState(false);
  const [openTrackerOpen, setOpenTrackerOpen] = useState(false);
  const [collaborators, setCollaborators] = useState<string[]>([]);

  // Collaborators of the owner's tracker → assignee autocomplete (owner view only).
  // No synchronous setState before the await keeps this effect-safe; non-owner
  // views simply ignore the list (see assigneeSuggestions below).
  const refreshCollaborators = useCallback(async () => {
    if (!isOwn || !profile) return;
    try {
      const list = await listCollaborators(tracker.issuesUrl, profile.webId);
      setCollaborators(list.map((c) => c.webId));
    } catch {
      /* sharing info is optional UI sugar */
    }
  }, [isOwn, profile, tracker.issuesUrl]);

  useEffect(() => {
    // Mount fetch; setState only runs after the await inside refreshCollaborators.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshCollaborators();
  }, [refreshCollaborators]);

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
  const readOnly = !issues.canWrite;

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
  const onEdit = (issue: IssueView) => {
    setEditing(issue);
    setFormOpen(true);
  };
  const onSubmitForm = async (values: IssueFormSubmit) => {
    if (editing) await run(() => issues.update(editing.id, values), "Issue updated");
    else await run(() => issues.create(values), "Issue created");
  };

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <CircleDot className="size-5 shrink-0 text-primary" aria-hidden />
            <span className="text-lg font-semibold tracking-tight">Solid Issues</span>
          </div>
          <div className="flex items-center gap-1">
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
            {readOnly && (
              <Badge variant="secondary" className="gap-1">
                <Eye className="size-3" aria-hidden /> Read-only
              </Badge>
            )}
            {isOwn && (
              <Button variant="outline" onClick={() => setShareOpen(true)} className="gap-1.5">
                <Share2 className="size-4" aria-hidden /> Share
              </Button>
            )}
            {!readOnly && (
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
                {readOnly
                  ? "This tracker has no issues to show."
                  : filter === "closed"
                    ? "Closed issues will show up here."
                    : "Create your first issue to get started."}
              </p>
            </div>
            {!readOnly && filter !== "closed" && (
              <Button onClick={onCreate} variant="outline" className="gap-1.5">
                <Plus className="size-4" aria-hidden /> New issue
              </Button>
            )}
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map((issue) => (
              <li key={issue.id}>
                <IssueCard
                  issue={issue}
                  readOnly={readOnly}
                  onEdit={() => onEdit(issue)}
                  onToggle={() =>
                    run(
                      () => issues.setState(issue.id, issue.state === "open" ? "closed" : "open"),
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
        assigneeSuggestions={isOwn ? collaborators : []}
      />

      {isOwn && profile && (
        <ShareDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          resourceUrl={tracker.issuesUrl}
          ownerWebId={profile.webId}
          onChanged={refreshCollaborators}
        />
      )}

      <OpenTrackerDialog
        open={openTrackerOpen}
        onOpenChange={setOpenTrackerOpen}
        onOpen={async (t) => {
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
                if (target) await run(() => issues.remove(target.id), "Issue deleted");
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
  readOnly,
  onEdit,
  onToggle,
  onDelete,
}: {
  issue: IssueView;
  readOnly: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const closed = issue.state === "closed";
  return (
    <Card className={closed ? "opacity-75" : undefined}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant={closed ? "secondary" : "default"} className="gap-1">
              {closed ? <CheckCircle2 className="size-3" aria-hidden /> : <CircleDot className="size-3" aria-hidden />}
              {closed ? "Closed" : "Open"}
            </Badge>
            <h3 className={`truncate font-medium ${closed ? "line-through" : ""}`}>{issue.title}</h3>
          </div>
        </div>
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${issue.title}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="size-4" aria-hidden /> Edit
              </DropdownMenuItem>
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
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2 className="size-4" aria-hidden /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </CardHeader>
      {(issue.description || issue.dateDue || issue.assignee) && (
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
            {issue.assignee && (
              <span className="flex items-center gap-1">
                <UserRound className="size-3.5" aria-hidden />
                <span className="max-w-[16rem] truncate">{issue.assignee}</span>
              </span>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
}
