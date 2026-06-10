"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useSolidSession } from "@/lib/session-context";
import { useIssues, type IssueRecord } from "@/lib/use-issues";
import { Repository } from "@/lib/repository";
import { setGroupAccess } from "@/lib/sharing";
import { type TrackerLocation } from "@/lib/profile";
import { ConflictError } from "@/lib/errors";
import { filterAndSort, facets, DEFAULT_QUERY, type IssueQuery, type SortKey } from "@/lib/filter";
import { SavedViews, type SavedView } from "@/lib/saved-views";
import { STATUSES, type Priority, type StatusSlug } from "@/lib/issue";
import { IssueFormDialog, type IssueFormSubmit } from "@/components/issue-form-dialog";
import { ShareDialog } from "@/components/share-dialog";
import { OpenTrackerDialog } from "@/components/open-tracker-dialog";
import { IssueDetailDialog } from "@/components/issue-detail-dialog";
import { CommandPalette, type PaletteGroup } from "@/components/command-palette";
import { TeamDialog } from "@/components/team-dialog";
import { IssueBoard } from "@/components/issue-board";
import { EpicView } from "@/components/epic-view";
import { DashboardView } from "@/components/dashboard-view";
import { BacklogView } from "@/components/backlog-view";
import { TimelineView } from "@/components/timeline-view";
import { CalendarView } from "@/components/calendar-view";
import { IssueCard, shortWebId, type IssueCardActions } from "@/components/issue-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardHeader } from "@/components/ui/card";
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
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertCircle,
  ArrowDownUp,
  ArrowLeft,
  Bookmark,
  BookmarkPlus,
  CheckCircle2,
  CircleDot,
  Command as CommandIcon,
  Eye,
  FolderOpen,
  LayoutGrid,
  List as ListIcon,
  LogOut,
  Monitor,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Sun,
  Share2,
  SlidersHorizontal,
  Trash2,
  Users,
  UserRound,
  X,
  Zap,
  BarChart3,
  CalendarDays,
  ChartNoAxesGantt,
  ListTodo,
} from "lucide-react";

type View = "list" | "board" | "epics" | "dashboard" | "backlog" | "timeline" | "calendar";
const VIEWS: View[] = ["list", "board", "epics", "backlog", "timeline", "calendar", "dashboard"];
const VIEW_KEY = "solid-issues:view";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "created", label: "Created" },
  { key: "updated", label: "Updated" },
  { key: "due", label: "Due date" },
  { key: "priority", label: "Priority" },
  { key: "title", label: "Title" },
];
const PRIORITIES: Priority[] = ["high", "medium", "low"];

export function IssuesView() {
  const { profile, trackerUrl, logout } = useSolidSession();
  const { theme, setTheme } = useTheme();
  const ownTracker: TrackerLocation = { ownerWebId: profile!.webId, trackerUrl: trackerUrl! };

  const [tracker, setTracker] = useState<TrackerLocation>(ownTracker);
  const isOwn = tracker.ownerWebId === profile?.webId;
  const issues = useIssues(tracker.trackerUrl, profile?.webId ?? null);

  const [query, setQuery] = useState<IssueQuery>(DEFAULT_QUERY);
  const [view, setViewState] = useState<View>(() => {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(VIEW_KEY) : null;
    return VIEWS.includes(saved as View) && saved !== null ? (saved as View) : "list";
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode */
    }
  };
  const [groupBy, setGroupBy] = useState<"status" | "priority">("status");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<IssueRecord | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<IssueRecord | undefined>(undefined);
  const [commentsUrl, setCommentsUrl] = useState<string | undefined>(undefined);
  const [shareResource, setShareResource] = useState<{ url: string; extraUrls?: string[]; label: string } | undefined>(undefined);
  const [openTrackerOpen, setOpenTrackerOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [group, setGroup] = useState<{ iri?: string; members: string[] }>({ members: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const savedViewsStore = useMemo(() => new SavedViews(), []);
  const [views, setViews] = useState<SavedView[]>([]);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [paletteOpen, setPaletteOpen] = useState(false);

  const patchQuery = (p: Partial<IssueQuery>) => setQuery((q) => ({ ...q, ...p }));
  const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

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

  useEffect(() => {
    // localStorage is client-only, so views are read after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViews(savedViewsStore.list());
  }, [savedViewsStore]);

  // Keyboard shortcuts: c = new, / = search, b/l = board/list (ignored while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const typing = t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        document.getElementById("issue-search")?.focus();
        return;
      }
      if (typing) return;
      if (e.key === "c" && issues.canCreate) {
        e.preventDefault();
        setEditing(undefined);
        setFormOpen(true);
      } else if (e.key === "b") setView("board");
      else if (e.key === "l") setView("list");
      else if (e.key === "e") setView("epics");
      else if (e.key === "d") setView("dashboard");
      else if (e.key === "t") setView("timeline");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [issues.canCreate]);

  const saveCurrentView = () => {
    const name = viewName.trim();
    if (!name) return;
    savedViewsStore.save(name, query);
    setViews(savedViewsStore.list());
    setViewName("");
    setSaveViewOpen(false);
    toast.success("View saved");
  };
  const deleteView = (id: string) => {
    savedViewsStore.remove(id);
    setViews(savedViewsStore.list());
  };

  const assigneeSuggestions = useMemo(
    () => (group.iri ? [group.iri, ...group.members] : group.members),
    [group],
  );
  // People who can be @mentioned: team members + anyone currently assigned.
  const people = useMemo(() => {
    const set = new Set<string>(group.members);
    for (const i of issues.issues) if (i.assignee && i.assignee !== group.iri) set.add(i.assignee);
    return [...set];
  }, [group, issues.issues]);

  const counts = useMemo(
    () => ({
      open: issues.issues.filter((i) => i.state === "open").length,
      closed: issues.issues.filter((i) => i.state === "closed").length,
      all: issues.issues.length,
    }),
    [issues.issues],
  );
  const fac = useMemo(() => facets(issues.issues), [issues.issues]);
  const visible = useMemo(() => filterAndSort(issues.issues, query), [issues.issues, query]);
  const commentsIssue = useMemo(
    () => issues.issues.find((i) => i.url === commentsUrl),
    [issues.issues, commentsUrl],
  );
  const activeFilters = query.priorities.length + query.labels.length + query.assignees.length;

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

  const [createDefaults, setCreateDefaults] = useState<{ parent?: string; status?: StatusSlug; sprint?: string }>({});
  const onCreate = (defaults: { parent?: string; status?: StatusSlug; sprint?: string } = {}) => {
    setEditing(undefined);
    setCreateDefaults(defaults);
    setFormOpen(true);
  };
  const onSubmitForm = async (values: IssueFormSubmit) => {
    if (editing) {
      await run(() => issues.update(editing.url, values), "Issue updated");
    } else {
      const { parent, sprint } = createDefaults;
      await run(
        () =>
          issues.batch(async (r) => {
            const url = await r.create({ ...values, parent, creator: profile?.webId });
            if (sprint) await r.setSprintMembership(sprint, url, true);
          }),
        "Issue created",
      );
    }
  };

  const cardActions = (issue: IssueRecord): IssueCardActions => ({
    isOwner: isOwn,
    groupIri: group.iri,
    onEdit: () => {
      setEditing(issue);
      setFormOpen(true);
    },
    onComments: () => setCommentsUrl(issue.url),
    onShare: () => setShareResource({ url: issue.url, label: "this issue" }),
    onShareTeam: () =>
      run(
        () => setGroupAccess(issue.url, profile!.webId, group.iri!, { read: true, write: true, control: false }),
        "Shared with the team",
      ),
    onToggle: () =>
      run(
        () => issues.setState(issue.url, issue.state === "open" ? "closed" : "open"),
        issue.state === "open" ? "Issue closed" : "Issue reopened",
      ),
    onDelete: () => setDeleteTarget(issue),
  });

  // --- Bulk selection (list view) ---
  const selectedVisible = useMemo(() => visible.filter((i) => selected.has(i.url)), [visible, selected]);
  const allSelected = visible.length > 0 && selectedVisible.length === visible.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(visible.map((i) => i.url)));
  const toggleSelect = (url: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });
  const clearSelection = () => setSelected(new Set());
  const bulk = (fn: (r: Repository, url: string) => Promise<void>, success: string) =>
    run(async () => {
      await issues.batch(async (r) => {
        for (const i of selectedVisible) await fn(r, i.url);
      });
      clearSelection();
    }, success);

  const paletteGroups: PaletteGroup[] = [
    {
      heading: "Create",
      items: issues.canCreate
        ? [{ id: "new", label: "New issue", hint: "c", run: () => onCreate() }]
        : [],
    },
    {
      heading: "View",
      items: [
        { id: "list", label: "List view", hint: "l", run: () => setView("list") },
        { id: "board", label: "Board view", hint: "b", run: () => setView("board") },
        { id: "epics", label: "Epics view", hint: "e", run: () => setView("epics") },
        { id: "dashboard", label: "Dashboard", hint: "d", run: () => setView("dashboard") },
        { id: "backlog", label: "Backlog view", run: () => setView("backlog") },
        { id: "timeline", label: "Timeline view", hint: "t", run: () => setView("timeline") },
        { id: "calendar", label: "Calendar view", run: () => setView("calendar") },
        { id: "search", label: "Search issues", hint: "/", run: () => document.getElementById("issue-search")?.focus() },
        { id: "f-open", label: "Show open", run: () => patchQuery({ state: "open" }) },
        { id: "f-closed", label: "Show closed", run: () => patchQuery({ state: "closed" }) },
        { id: "f-all", label: "Show all", run: () => patchQuery({ state: "all" }) },
      ],
    },
    {
      heading: "Tracker",
      items: [
        { id: "open-tracker", label: "Open another tracker…", run: () => setOpenTrackerOpen(true) },
        ...(isOwn
          ? [
              { id: "share", label: "Share tracker…", run: () => setShareResource({ url: repo.containerUrl, extraUrls: [tracker.trackerUrl], label: "this tracker" }) },
              { id: "team", label: "Manage team…", run: () => setTeamOpen(true) },
            ]
          : []),
        { id: "signout", label: "Sign out", run: logout },
      ],
    },
    { heading: "Saved views", items: views.map((v) => ({ id: `v-${v.id}`, label: v.name, run: () => setQuery(v.query) })) },
  ];

  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b bg-card">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden
              className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground"
            >
              <CircleDot className="size-4" />
            </span>
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
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              aria-label="Command palette"
              onClick={() => setPaletteOpen(true)}
            >
              <CommandIcon className="size-4" aria-hidden />
              <span className="hidden text-xs text-muted-foreground lg:inline">⌘K</span>
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
                <div className="flex items-center gap-1 px-2 py-1.5">
                  <span className="mr-auto text-xs text-muted-foreground">Theme</span>
                  {([
                    { k: "light", I: Sun, label: "Light" },
                    { k: "dark", I: Moon, label: "Dark" },
                    { k: "system", I: Monitor, label: "System" },
                  ] as const).map(({ k, I, label }) => (
                    <Button
                      key={k}
                      variant={theme === k ? "secondary" : "ghost"}
                      size="icon"
                      className="size-7"
                      aria-label={`${label} theme`}
                      aria-pressed={theme === k}
                      onClick={() => setTheme(k)}
                    >
                      <I className="size-4" aria-hidden />
                    </Button>
                  ))}
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
            <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-2">
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

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {/* Toolbar */}
        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="issue-search"
                type="search"
                aria-label="Search issues"
                placeholder="Search issues…  ( / )"
                value={query.text}
                onChange={(e) => patchQuery({ text: e.target.value })}
                className="pl-8"
              />
            </div>

            {/* Filters */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-1.5">
                  <SlidersHorizontal className="size-4" aria-hidden /> Filter
                  {activeFilters > 0 && <Badge variant="secondary">{activeFilters}</Badge>}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-96 w-56 overflow-y-auto">
                <DropdownMenuLabel>Priority</DropdownMenuLabel>
                {PRIORITIES.map((p) => (
                  <DropdownMenuCheckboxItem
                    key={p}
                    className="capitalize"
                    checked={query.priorities.includes(p)}
                    onCheckedChange={() => patchQuery({ priorities: toggleIn(query.priorities, p) as Priority[] })}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {p}
                  </DropdownMenuCheckboxItem>
                ))}
                {fac.labels.length > 0 && <DropdownMenuLabel>Labels</DropdownMenuLabel>}
                {fac.labels.map((l) => (
                  <DropdownMenuCheckboxItem
                    key={l}
                    checked={query.labels.includes(l)}
                    onCheckedChange={() => patchQuery({ labels: toggleIn(query.labels, l) })}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {l}
                  </DropdownMenuCheckboxItem>
                ))}
                {fac.assignees.length > 0 && <DropdownMenuLabel>Assignee</DropdownMenuLabel>}
                {fac.assignees.map((a) => (
                  <DropdownMenuCheckboxItem
                    key={a}
                    checked={query.assignees.includes(a)}
                    onCheckedChange={() => patchQuery({ assignees: toggleIn(query.assignees, a) })}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {a === group.iri ? "Team" : shortWebId(a)}
                  </DropdownMenuCheckboxItem>
                ))}
                {activeFilters > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => patchQuery({ priorities: [], labels: [], assignees: [] })}>
                      Clear filters
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Saved views */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-1.5">
                  <Bookmark className="size-4" aria-hidden /> Views
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {views.length === 0 ? (
                  <DropdownMenuLabel className="font-normal text-muted-foreground">No saved views</DropdownMenuLabel>
                ) : (
                  views.map((v) => (
                    <div key={v.id} className="flex items-center">
                      <DropdownMenuItem className="flex-1" onClick={() => setQuery(v.query)}>
                        {v.name}
                      </DropdownMenuItem>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="mr-1 size-7"
                        aria-label={`Delete view ${v.name}`}
                        onClick={() => deleteView(v.id)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setSaveViewOpen(true)}>
                  <BookmarkPlus className="size-4" aria-hidden /> Save current view…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Sort */}
            <Select value={query.sort} onValueChange={(v) => patchQuery({ sort: v as SortKey })}>
              <SelectTrigger className="w-36" aria-label="Sort by">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORTS.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              aria-label={`Sort ${query.sortDir === "asc" ? "ascending" : "descending"}`}
              onClick={() => patchQuery({ sortDir: query.sortDir === "asc" ? "desc" : "asc" })}
            >
              <ArrowDownUp className="size-4" aria-hidden />
            </Button>

            {/* Group-by (board only) */}
            {view === "board" && (
              <Select value={groupBy} onValueChange={(v) => setGroupBy(v as "status" | "priority")}>
                <SelectTrigger className="w-36" aria-label="Group by">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="status">Group: Status</SelectItem>
                  <SelectItem value="priority">Group: Priority</SelectItem>
                </SelectContent>
              </Select>
            )}

            {/* View toggle */}
            <div role="tablist" aria-label="View" className="flex gap-1 rounded-lg bg-muted p-1">
              {([
                { key: "list", label: "List", Icon: ListIcon },
                { key: "board", label: "Board", Icon: LayoutGrid },
                { key: "epics", label: "Epics", Icon: Zap },
                { key: "backlog", label: "Backlog", Icon: ListTodo },
                { key: "timeline", label: "Timeline", Icon: ChartNoAxesGantt },
                { key: "calendar", label: "Calendar", Icon: CalendarDays },
                { key: "dashboard", label: "Dashboard", Icon: BarChart3 },
              ] as const).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={view === key}
                  aria-label={`${label} view`}
                  onClick={() => setView(key)}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    view === key ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <Icon className="size-4" aria-hidden />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div role="tablist" aria-label="Filter by state" className="flex gap-1 rounded-lg bg-muted p-1">
              {(["open", "closed", "all"] as const).map((f) => (
                <button
                  key={f}
                  role="tab"
                  aria-selected={query.state === f}
                  onClick={() => patchQuery({ state: f })}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    query.state === f ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
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
                  onClick={() => setShareResource({ url: repo.containerUrl, extraUrls: [tracker.trackerUrl], label: "this tracker" })}
                >
                  <Share2 className="size-4" aria-hidden /> Share
                </Button>
              )}
              {issues.canCreate && (
                <Button onClick={() => onCreate()} className="gap-1.5">
                  <Plus className="size-4" aria-hidden /> New issue
                </Button>
              )}
            </div>
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
        ) : view === "backlog" ? (
          // The backlog plans over all open work; sprint sections show their own done counts.
          <BacklogView
            issues={issues.issues}
            sprints={issues.sprints}
            canWrite={issues.canCreate}
            onOpenIssue={(i) => setCommentsUrl(i.url)}
            onCreateSprint={(title) => run(() => issues.createSprint(title), "Sprint created")}
            onStartSprint={(iri) => run(() => issues.startSprint(iri), "Sprint started")}
            onCompleteSprint={(iri) => {
              // Release unfinished issues back to the backlog (Jira behaviour).
              const sprint = issues.sprints.find((s) => s.iri === iri);
              const open = (sprint?.taskUrls ?? []).filter(
                (u) => issues.issues.find((i) => i.url === u)?.status !== "done",
              );
              return run(() => issues.completeSprint(iri, open), "Sprint completed");
            }}
            onMove={(url, sprintIri) =>
              run(
                async () => {
                  if (sprintIri) await issues.setSprintMembership(sprintIri, url, true);
                  else {
                    const current = issues.sprints.find((s) => s.taskUrls.includes(url));
                    if (current) await issues.setSprintMembership(current.iri, url, false);
                  }
                },
                sprintIri ? "Moved to sprint" : "Moved to backlog",
              )
            }
            onAddToSprint={(sprintIri) => onCreate(sprintIri ? { sprint: sprintIri } : {})}
          />
        ) : view === "timeline" ? (
          <TimelineView issues={visible} onOpenIssue={(i) => setCommentsUrl(i.url)} />
        ) : view === "calendar" ? (
          <CalendarView issues={visible} onOpenIssue={(i) => setCommentsUrl(i.url)} />
        ) : view === "dashboard" ? (
          // The dashboard aggregates over ALL issues, unfiltered.
          <DashboardView issues={issues.issues} />
        ) : view === "epics" ? (
          // Epics roll up over ALL issues — done children must count toward
          // progress, so the open/closed state filter (and its empty state)
          // doesn't apply here.
          <EpicView
            issues={issues.issues}
            canCreate={issues.canCreate}
            onOpenIssue={(i) => setCommentsUrl(i.url)}
            onAddToEpic={(epicUrl) => onCreate({ parent: epicUrl })}
          />
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
            <CircleDot className="size-8 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-medium">No issues match</p>
              <p className="text-sm text-muted-foreground">
                {query.text || activeFilters > 0
                  ? "Try clearing the search or filters."
                  : !issues.canCreate
                    ? "This tracker has no issues to show."
                    : "Create your first issue to get started."}
              </p>
            </div>
            {issues.canCreate && !query.text && activeFilters === 0 && query.state !== "closed" && (
              <Button onClick={() => onCreate()} variant="outline" className="gap-1.5">
                <Plus className="size-4" aria-hidden /> New issue
              </Button>
            )}
          </div>
        ) : view === "board" ? (
          <IssueBoard
            issues={visible}
            cardActions={cardActions}
            canWrite={issues.canCreate}
            columns={
              groupBy === "status"
                ? STATUSES.map((s) => ({ key: s.slug, label: s.label }))
                : [
                    { key: "high", label: "High" },
                    { key: "medium", label: "Medium" },
                    { key: "low", label: "Low" },
                    { key: "none", label: "No priority" },
                  ]
            }
            groupOf={(i) => (groupBy === "status" ? i.status : (i.priority ?? "none"))}
            onMove={(url, key) =>
              groupBy === "status"
                ? run(() => issues.setStatus(url, key as StatusSlug), "Status updated")
                : run(
                    () => issues.update(url, { priority: key === "none" ? undefined : (key as Priority) }),
                    key === "none" ? "Priority cleared" : `Priority set to ${key}`,
                  )
            }
            onAddToColumn={
              issues.canCreate && groupBy === "status"
                ? (key) => onCreate({ status: key as StatusSlug })
                : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            {issues.canCreate && (
              <>
                {selectedVisible.length > 0 && (
                  <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-sm">
                    <span className="px-1 text-sm font-medium">{selectedVisible.length} selected</span>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => bulk((r, u) => r.setState(u, "closed"), "Issues closed")}>
                      <CheckCircle2 className="size-4" aria-hidden /> Close
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => bulk((r, u) => r.setState(u, "open"), "Issues reopened")}>
                      <RotateCcw className="size-4" aria-hidden /> Reopen
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={() => setBulkDeleteOpen(true)}>
                      <Trash2 className="size-4" aria-hidden /> Delete
                    </Button>
                    <Button variant="ghost" size="sm" className="ml-auto gap-1.5" onClick={clearSelection}>
                      <X className="size-4" aria-hidden /> Clear
                    </Button>
                  </div>
                )}
                <div className="flex items-center gap-2 px-1">
                  <Checkbox id="select-all" checked={allSelected} onCheckedChange={toggleAll} aria-label="Select all issues" />
                  <label htmlFor="select-all" className="cursor-pointer text-xs text-muted-foreground">
                    Select all ({visible.length})
                  </label>
                </div>
              </>
            )}
            <ul className="space-y-3">
              {visible.map((issue) => (
                <li key={issue.url} className="flex items-start gap-2">
                  {issues.canCreate && (
                    <Checkbox
                      className="mt-4"
                      checked={selected.has(issue.url)}
                      onCheckedChange={() => toggleSelect(issue.url)}
                      aria-label={`Select ${issue.title}`}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <IssueCard issue={issue} {...cardActions(issue)} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>

      <IssueFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        defaultStatus={createDefaults.status}
        onSubmit={onSubmitForm}
        assigneeSuggestions={assigneeSuggestions}
      />

      <IssueDetailDialog
        open={!!commentsUrl}
        onOpenChange={(o) => !o && setCommentsUrl(undefined)}
        issue={commentsIssue}
        allIssues={issues.issues}
        people={people}
        groupIri={group.iri}
        canComment={!!commentsIssue?.canWrite}
        onUpdate={(patch) => run(() => issues.update(commentsUrl!, patch), "Issue updated")}
        onUpload={(file) => run(() => issues.uploadAttachment(commentsUrl!, file), "File attached")}
        onRemoveAttachment={(fileUrl) => run(() => issues.removeAttachment(commentsUrl!, fileUrl), "Attachment removed")}
        onEdit={() => {
          if (commentsIssue) {
            setEditing(commentsIssue);
            setCommentsUrl(undefined);
            setFormOpen(true);
          }
        }}
        onAddComment={(content, mentions) => issues.addComment(commentsUrl!, content, mentions)}
      />

      {profile && shareResource && (
        <ShareDialog
          open={!!shareResource}
          onOpenChange={(o) => !o && setShareResource(undefined)}
          resourceUrl={shareResource.url}
          extraResourceUrls={shareResource.extraUrls}
          ownerWebId={profile.webId}
          title={`Share ${shareResource.label}`}
          description="Grant another person access by their WebID. They can open it from their own app."
          onChanged={loadTrackerInfo}
        />
      )}

      {isOwn && (
        <TeamDialog open={teamOpen} onOpenChange={setTeamOpen} trackerUrl={tracker.trackerUrl} onSaved={loadTrackerInfo} />
      )}

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={paletteGroups} />

      <OpenTrackerDialog
        open={openTrackerOpen}
        onOpenChange={setOpenTrackerOpen}
        onOpen={(t) => {
          setTracker(t);
          patchQuery({ state: "open" });
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

      <Dialog open={saveViewOpen} onOpenChange={setSaveViewOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
            <DialogDescription>Remember the current search, filters, and sort under a name.</DialogDescription>
          </DialogHeader>
          <Input
            aria-label="View name"
            placeholder="e.g. My open high-priority"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveCurrentView()}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveViewOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveCurrentView} disabled={!viewName.trim()}>
              Save view
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {selectedVisible.length} issues?</DialogTitle>
            <DialogDescription>
              The selected issues will be permanently removed from the pod. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setBulkDeleteOpen(false);
                await bulk((r, u) => r.remove(u), "Issues deleted");
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
