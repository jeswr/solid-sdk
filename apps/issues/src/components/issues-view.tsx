"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { useSolidSession } from "@/lib/session-context";
import { useIssues, type IssueRecord, type ActivityRecord } from "@/lib/use-issues";
import { Repository } from "@/lib/repository";
import { setGroupAccess } from "@/lib/sharing";
import { type TrackerLocation } from "@/lib/profile";
import { ConflictError } from "@/lib/errors";
import { filterAndSort, facets, DEFAULT_QUERY, type IssueQuery, type SortKey } from "@/lib/filter";
import { SavedViews } from "@/lib/saved-views";
import type { PodSavedView } from "@/lib/pod-saved-views";
import { resolveView, viewHref, VIEW_KEY, type View } from "@/lib/view";
import { DEFAULT_WORKFLOW, safeHttpUrl, type ComponentDef, type FieldDef, type FieldValue, type Priority, type RuleDef, type StatusSlug, type VersionDef, type WipLimits, type WorkflowDef } from "@/lib/issue";
import { dependencyWarning, type OpenBlocker } from "@/lib/dependencies";
import { evaluateRules, type RuleAction, type TriggerEvent } from "@/lib/automation-engine";
import { IssueFormDialog, type IssueFormSubmit } from "@/components/issue-form-dialog";
import { ShareDialog } from "@/components/share-dialog";
import { OpenTrackerDialog } from "@/components/open-tracker-dialog";
import { ProjectSwitcher } from "@/components/project-switcher";
import { IssueDetailDialog } from "@/components/issue-detail-dialog";
import { CommandPalette, type PaletteGroup } from "@/components/command-palette";
import { TeamDialog } from "@/components/team-dialog";
import { FieldsDialog } from "@/components/fields-dialog";
import { IssueBoard } from "@/components/issue-board";
import { SaveIndicator } from "@/components/save-indicator";
import { boardColumns, boardIssues, boardWip, moveForColumn, optimisticMove, revertMoveIfCurrent, wipMoveBreach, type SwimlaneBy } from "@/lib/board";
import { createEpicAncestorResolver } from "@/lib/epics";
import { EpicView } from "@/components/epic-view";
import { DashboardView } from "@/components/dashboard-view";
import { WorkloadView } from "@/components/workload-view";
import { InboxView } from "@/components/inbox-view";
import { BacklogView } from "@/components/backlog-view";
import { TimelineView } from "@/components/timeline-view";
import { CalendarView } from "@/components/calendar-view";
import { RulesDialog } from "@/components/rules-dialog";
import { IssueCard, shortWebId, type IssueCardActions } from "@/components/issue-card";
import { IssuesTable } from "@/components/issues-table";
import { makeInlineEditController, type EditableField } from "@/lib/inline-edit";
import type { IssueStatusRef } from "@/lib/workflow-editor";
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
  Ban,
  Bell,
  Bookmark,
  BookmarkPlus,
  CheckCircle2,
  CircleDot,
  Command as CommandIcon,
  Eye,
  FolderOpen,
  LayoutGrid,
  List as ListIcon,
  Plus,
  RotateCcw,
  Search,
  Share2,
  SlidersHorizontal,
  Tag,
  Trash2,
  Users,
  UsersRound,
  X,
  Zap,
  BarChart3,
  CalendarDays,
  ChartNoAxesGantt,
  ListTodo,
  Table2,
} from "lucide-react";

const PROJECT_KEY = "solid-issues:project";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "created", label: "Created" },
  { key: "updated", label: "Updated" },
  { key: "due", label: "Due date" },
  { key: "priority", label: "Priority" },
  { key: "title", label: "Title" },
];
const PRIORITIES: Priority[] = ["high", "medium", "low"];

/** Tracker config (title, custom fields, components, versions, team), tagged with its tracker. */
interface TrackerInfo {
  tracker: string;
  title?: string;
  fields: FieldDef[];
  components: ComponentDef[];
  versions: VersionDef[];
  group: { iri?: string; members: string[] };
  workflow: WorkflowDef;
  /** Per-column WIP limits (#111), keyed by status slug. */
  wipLimits: WipLimits;
  /** Automation rules (#112) declared on the tracker. */
  rules: RuleDef[];
}
const EMPTY_GROUP: TrackerInfo["group"] = { members: [] };
// Module-level so the derived fallbacks keep a stable identity across renders
// (effects and memos downstream depend on them).
const EMPTY_FIELDS: FieldDef[] = [];
const EMPTY_COMPONENTS: ComponentDef[] = [];
const EMPTY_VERSIONS: VersionDef[] = [];
const EMPTY_WIP: WipLimits = {};
const EMPTY_RULES: RuleDef[] = [];

/**
 * Execute one automation-engine {@link RuleAction} through the EXISTING repository
 * mutation path (#112) — so an automated change goes through the SAME validation
 * the user's own edits do (the workflow transition rules for SetStatus/CloseIssue,
 * the ETag-conditional write, the activity log). The engine has already verified
 * the action is effective + the value valid; this only routes it.
 *
 *  - SetStatus → `setStatus` (workflow-guarded; a disallowed transition throws and
 *    is surfaced as an automation failure, never a silent bad write).
 *  - CloseIssue → `setState("closed")` (resolves the workflow's terminal status).
 *  - SetPriority / Assign → `update`.
 *  - AddComment → `addComment` (authored by the signed-in user).
 */
async function applyRuleAction(
  repo: Repository,
  action: RuleAction,
  actorWebId: string | undefined,
): Promise<void> {
  switch (action.kind) {
    case "SetStatus":
      if (action.value) await repo.setStatus(action.url, action.value);
      break;
    case "CloseIssue":
      await repo.setState(action.url, "closed");
      break;
    case "SetPriority":
      await repo.update(action.url, { priority: action.value as Priority });
      break;
    case "Assign":
      await repo.update(action.url, { assignee: action.value || undefined });
      break;
    case "AddComment":
      if (action.value) await repo.addComment(action.url, action.value, actorWebId);
      break;
  }
}

/** A human "Automation: …" toast lead-in for an applied {@link RuleAction}. */
function automationToast(a: RuleAction): string {
  switch (a.kind) {
    case "SetStatus":
      return `Automation: moved “${a.title}” to ${a.value}`;
    case "CloseIssue":
      return `Automation: completed “${a.title}”`;
    case "SetPriority":
      return `Automation: set “${a.title}” to ${a.value} priority`;
    case "Assign":
      return `Automation: assigned “${a.title}”`;
    case "AddComment":
      return `Automation: commented on “${a.title}”`;
  }
}

export function IssuesView() {
  const { profile, trackerUrl, storageUrl, logout } = useSolidSession();
  const ownTracker: TrackerLocation = { ownerWebId: profile!.webId, trackerUrl: trackerUrl! };

  const [tracker, setTracker] = useState<TrackerLocation>(() => {
    // Re-open the project/tracker this account had open last time.
    try {
      const saved = localStorage.getItem(`${PROJECT_KEY}:${profile!.webId}`);
      if (saved) return JSON.parse(saved) as TrackerLocation;
    } catch {
      /* private mode / corrupt entry */
    }
    return ownTracker;
  });
  const switchTracker = useCallback(
    (t: TrackerLocation) => {
      setTracker(t);
      try {
        localStorage.setItem(`${PROJECT_KEY}:${profile!.webId}`, JSON.stringify(t));
      } catch {
        /* private mode */
      }
    },
    [profile],
  );
  const isOwn = tracker.ownerWebId === profile?.webId;
  // The user's own pod storage root — the live-sync SSRF allow-list. A live
  // WebSocket subscription is only opened against the user's OWN pod (a foreign
  // subscription/socket URL degrades to polling — own-pod.ts). Memoised so the
  // live-sync effect identity is stable across renders.
  const ownStorageUrls = useMemo(() => (storageUrl ? [storageUrl] : []), [storageUrl]);
  const issues = useIssues(tracker.trackerUrl, profile?.webId ?? null, ownStorageUrls);

  const [query, setQuery] = useState<IssueQuery>(DEFAULT_QUERY);

  // URL is the source of truth for the active view (?view=board, etc.).
  // localStorage is a fallback used only when the URL has no ?view param
  // (first visit, or the user navigated to "/" bare).
  const searchParams = useSearchParams();
  const router = useRouter();
  const view: View = resolveView(searchParams.get("view"), typeof localStorage !== "undefined" ? localStorage : { getItem: () => null, setItem: () => undefined });

  const setView = useCallback((v: View) => {
    // Drive the URL; the sidebar/bottom-nav highlights follow automatically.
    router.push(viewHref(v), { scroll: false });
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* private mode */
    }
  }, [router]);
  const [groupBy, setGroupBy] = useState<"status" | "priority">("status");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<IssueRecord | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<IssueRecord | undefined>(undefined);
  // Dependency enforcement (#75 P1-4): a pending guarded transition awaiting the
  // user's override confirmation because the issue has open blockers. WARN, never
  // hard-block — `proceed` runs the original transition when the user confirms.
  const [pendingTransition, setPendingTransition] = useState<
    { issue: IssueRecord; verb: string; blockers: OpenBlocker[]; proceed: () => void } | undefined
  >(undefined);
  // WIP limits (#111 P1-1): a board move that would push the target column over its
  // WIP maximum awaits the user's override confirmation — WARN, never hard-block.
  const [pendingWipMove, setPendingWipMove] = useState<
    { title: string; column: string; count: number; max: number; proceed: () => void } | undefined
  >(undefined);
  const [commentsUrl, setCommentsUrl] = useState<string | undefined>(undefined);
  const [shareResource, setShareResource] = useState<{ url: string; extraUrls?: string[]; label: string } | undefined>(undefined);
  const [openTrackerOpen, setOpenTrackerOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  // Derived only when the tag matches the open tracker — a slow info read from
  // a previously-open project can never leak its fields/team into this one
  // (same pattern as useIssues' tagged snapshot).
  const [trackerInfo, setTrackerInfo] = useState<TrackerInfo | null>(null);
  const infoCurrent = trackerInfo !== null && trackerInfo.tracker === tracker.trackerUrl;
  const fieldDefs = infoCurrent ? trackerInfo.fields : EMPTY_FIELDS;
  const componentDefs = infoCurrent ? trackerInfo.components : EMPTY_COMPONENTS;
  const versionDefs = infoCurrent ? trackerInfo.versions : EMPTY_VERSIONS;
  const group = infoCurrent ? trackerInfo.group : EMPTY_GROUP;
  const trackerTitle = infoCurrent ? trackerInfo.title : undefined;
  const workflow = infoCurrent ? trackerInfo.workflow : DEFAULT_WORKFLOW;
  const wipLimits = infoCurrent ? trackerInfo.wipLimits : EMPTY_WIP;
  const rules = infoCurrent ? trackerInfo.rules : EMPTY_RULES;
  // F3: the open issue's provenance log, loaded on demand when the detail dialog opens.
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Board-only: cards the user has archived off the board (still closed in the
  // pod, just removed from the Done column once they're finished with it). This
  // is view state, not persisted — a refresh brings them back if still relevant.
  const [archived, setArchived] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  // P1-6 (deferred): the custom field currently being bulk-set across the
  // selection (the value dialog is open while non-undefined), plus the in-progress
  // raw value the dialog edits.
  const [bulkFieldTarget, setBulkFieldTarget] = useState<FieldDef | undefined>(undefined);
  const [bulkFieldValue, setBulkFieldValue] = useState("");
  // Saved views are now pod-persisted (shareable, cross-device — Jira/Monday
  // saved filters). The localStorage store is kept only to MIGRATE any
  // device-local views the user saved before this change into their pod.
  const [views, setViews] = useState<PodSavedView[]>([]);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [viewName, setViewName] = useState("");
  const [groupBoardBy, setGroupBoardBy] = useState<SwimlaneBy>("none");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  // Rule+issue pairs already actioned this session (`${ruleIri}:${kind}:${url}`) —
  // belt-and-braces against re-firing the same automation on the same issue within
  // a session (the engine's effectiveness check is the primary cascade guard).
  const appliedAutomations = useRef(new Set<string>());

  const patchQuery = (p: Partial<IssueQuery>) => setQuery((q) => ({ ...q, ...p }));
  const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const repo = useMemo(() => new Repository(tracker.trackerUrl), [tracker.trackerUrl]);

  // Monotonic sequence: the tracker tag stops cross-project leaks, but two
  // same-tracker loads can still resolve out of order (e.g. the mount load
  // landing after a refresh that followed a save) — only the latest applies.
  const infoSeq = useRef(0);
  const loadTrackerInfo = useCallback(async () => {
    const url = tracker.trackerUrl;
    const seq = ++infoSeq.current;
    try {
      const info = await new Repository(url).info();
      if (seq !== infoSeq.current) return;
      // Field defs matter on shared trackers too; the team only on your own.
      setTrackerInfo({
        tracker: url,
        title: info.title,
        fields: info.fields,
        components: info.components,
        versions: info.versions,
        group: isOwn ? { iri: info.assigneeGroup, members: info.groupMembers } : EMPTY_GROUP,
        workflow: info.workflow,
        wipLimits: info.wipLimits,
        rules: info.rules,
      });
    } catch {
      if (seq !== infoSeq.current) return;
      // Config is optional sugar, but a failed load must still clear whatever
      // the previous project left behind.
      setTrackerInfo({ tracker: url, fields: [], components: [], versions: [], group: EMPTY_GROUP, workflow: DEFAULT_WORKFLOW, wipLimits: {}, rules: [] });
    }
  }, [isOwn, tracker.trackerUrl]);

  useEffect(() => {
    // Mount fetch; setState only runs after the await inside loadTrackerInfo.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTrackerInfo();
  }, [loadTrackerInfo]);

  // Load the tracker's shareable saved views, MIGRATING any localStorage views
  // saved before pod-backing landed (one-time, only on a writable own tracker).
  // Tagged with the tracker URL so a slow load from a previously-open project
  // can never leak its views into this one (the snapshot/info pattern).
  //
  // Depends ONLY on the stable `useCallback` pieces of the issues hook (not the
  // whole `issues` object, which `useIssues` rebuilds every render) so this
  // callback's identity is stable and the load effect does NOT re-run on every
  // render (which would loop fetch→setState→render).
  const { listSavedViews, saveView } = issues;
  const canCreate = issues.canCreate;
  const loadSavedViews = useCallback(async () => {
    const url = tracker.trackerUrl;
    try {
      let podViews = await listSavedViews();
      // Migrate device-local views into the pod the first time we have a writable
      // own tracker. Only views that actually landed in the pod (or were already
      // present by name) are dropped locally; any that FAILED to migrate stay in
      // localStorage so they can be retried — never cleared wholesale.
      if (isOwn && canCreate) {
        const local = new SavedViews();
        const stale = local.list();
        if (stale.length > 0) {
          const existing = new Set(podViews.map((v) => v.name));
          const migratedIds = new Set<string>();
          for (const v of stale) {
            if (existing.has(v.name)) {
              migratedIds.add(v.id); // already in the pod under this name
              continue;
            }
            try {
              await saveView(v.name, v.query, v.view);
              migratedIds.add(v.id);
            } catch {
              /* leave this one in localStorage to retry on a later load */
            }
          }
          // Re-persist only the views that did NOT migrate (partial-failure safe).
          const remaining = stale.filter((v) => !migratedIds.has(v.id));
          local.replace(remaining);
          podViews = await listSavedViews();
        }
      }
      if (tracker.trackerUrl === url) setViews(podViews);
    } catch {
      if (tracker.trackerUrl === url) setViews([]);
    }
  }, [listSavedViews, saveView, isOwn, canCreate, tracker.trackerUrl]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSavedViews();
  }, [loadSavedViews]);

  // Automation engine (#112 P1-3): pod-persisted ECA rules evaluated CLIENT-SIDE.
  // `runAutomations` evaluates the enabled rules for one trigger event over the
  // CURRENT issue list (read synchronously via getIssues so cascades see prior
  // applied state), then applies each action through the EXISTING repository path
  // (workflow/dep-guarded status, ETag-safe writes) in one batch. After a batch it
  // re-evaluates a `load` pass so a closed parent can cascade to ITS parent —
  // bounded by a depth counter so a self-/mutually-triggering rule never loops.
  // The applied-set (`${ruleIri}:${kind}:${url}`) plus the engine's own
  // effectiveness check (a no-op action is dropped) prevent re-firing.
  const runningAutomations = useRef(false);
  const runAutomations = useCallback(
    async (event: TriggerEvent, depth = 0): Promise<void> => {
      if (!isOwn || depth > 8) return; // depth cap = the cascade bound
      // Serialise: a second pass while one is in flight would act on stale state.
      if (depth === 0 && runningAutomations.current) return;
      if (depth === 0) runningAutomations.current = true;
      try {
        const actions = evaluateRules(issues.getIssues(), rules, event, workflow).filter(
          (a) => !appliedAutomations.current.has(`${a.ruleIri}:${a.kind}:${a.url}`),
        );
        if (actions.length === 0) return;
        for (const a of actions) appliedAutomations.current.add(`${a.ruleIri}:${a.kind}:${a.url}`);
        try {
          await issues.batch(async (r) => {
            for (const a of actions) await applyRuleAction(r, a, profile?.webId);
          });
          for (const a of actions) toast.info(`${automationToast(a)} — ${a.reason}`);
          // A status/close change may satisfy a parent's OnAllSubtasksDone — cascade
          // via a fresh load pass on the now-refreshed list (batch refreshed it).
          await runAutomations({ type: "load" }, depth + 1);
        } catch (e) {
          for (const a of actions) appliedAutomations.current.delete(`${a.ruleIri}:${a.kind}:${a.url}`);
          toast.error(e instanceof Error ? `Automation failed: ${e.message}` : "An automation failed.");
          void issues.refresh(); // partial writes may have landed — show real state
        }
      } finally {
        if (depth === 0) runningAutomations.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isOwn, rules, workflow, profile?.webId, issues.getIssues, issues.batch, issues.refresh],
  );

  // On-load / state-observed triggers (OnDueDatePassed, OnAllSubtasksDone): run a
  // `load` pass whenever fresh issue state arrives. Mutation triggers
  // (OnStatusChange/OnAssigned/OnCreated) are fired from their mutation handlers.
  useEffect(() => {
    if (issues.loading || !isOwn) return;
    void runAutomations({ type: "load" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues.issues, issues.loading, isOwn, rules, workflow]);

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
      else if (e.key === "g") setView("table");
      else if (e.key === "e") setView("epics");
      else if (e.key === "d") setView("dashboard");
      else if (e.key === "t") setView("timeline");
      else if (e.key === "i") setView("inbox");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [issues.canCreate, setView]);

  // Apply a saved view: restore its query AND its captured layout (board/list/…),
  // so reopening a saved view lands you on the same board the way Jira/Monday do.
  const applyView = useCallback(
    (v: PodSavedView) => {
      setQuery(v.query);
      if (v.view) setView(v.view);
    },
    [setView],
  );

  const saveCurrentView = async () => {
    const name = viewName.trim();
    if (!name) return;
    setSaveViewOpen(false);
    setViewName("");
    // Capture the active layout alongside the query so the view restores both.
    await run(async () => {
      await issues.saveView(name, query, view);
      await loadSavedViews();
    }, "View saved");
  };
  const deleteView = (iri: string) =>
    run(async () => {
      await issues.removeView(iri);
      await loadSavedViews();
    }, "View deleted");

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
  // The workflow editor's in-use-state guard (#75 P2-5) needs each issue's current
  // status slug to know which states have issues in them.
  const issueStatusRefs = useMemo(
    () => issues.issues.map((i) => ({ url: i.url, status: i.status })),
    [issues.issues],
  );
  const fac = useMemo(() => facets(issues.issues), [issues.issues]);
  // Component / version slugs → human labels for display in the filter menu and
  // detail view (the issue carries slugs; the tracker config carries labels).
  const componentLabel = useCallback(
    (slug: string) => componentDefs.find((c) => c.slug === slug)?.label ?? slug,
    [componentDefs],
  );
  const versionLabel = useCallback(
    (slug: string) => versionDefs.find((v) => v.slug === slug)?.label ?? slug,
    [versionDefs],
  );
  const visible = useMemo(() => filterAndSort(issues.issues, query), [issues.issues, query]);
  // The board applies the same text/facet filters as the list, but its own state
  // visibility is owned by boardIssues (so the Done column keeps completed cards
  // — pss-w29w). So the board uses the query with state forced to "all", and
  // boardIssues then re-applies the user's state filter + archive hiding.
  const boardVisible = useMemo(
    () => boardIssues(filterAndSort(issues.issues, { ...query, state: "all" }), workflow, query.state, groupBy, archived),
    [issues.issues, query, workflow, groupBy, archived],
  );
  // WIP per-column status (#111): computed over the board's visible cards so the
  // "n / max" cue matches what the user sees. Only status-grouped boards have WIP
  // columns; a priority board passes no limits and every column resolves to "ok".
  const columnWip = useMemo(
    () => boardWip(boardVisible, boardColumns(workflow, groupBy), groupBy === "status" ? wipLimits : {}),
    [boardVisible, workflow, groupBy, wipLimits],
  );
  const commentsIssue = useMemo(
    () => issues.issues.find((i) => i.url === commentsUrl),
    [issues.issues, commentsUrl],
  );
  // Resolve a swimlane value to its label: an assignee WebID → "Team"/short
  // WebID; an epic issue URL → the epic's title (falling back to its short URL).
  const epicTitleByUrl = useMemo(() => {
    const m = new Map<string, string>();
    for (const i of issues.issues) if (i.issueType === "epic") m.set(i.url, i.title);
    return m;
  }, [issues.issues]);
  const swimlaneLabel = useCallback(
    (value: string): string => {
      if (groupBoardBy === "assignee") return value === group.iri ? "Team" : shortWebId(value);
      return epicTitleByUrl.get(value) ?? shortWebId(value);
    },
    [groupBoardBy, group.iri, epicTitleByUrl],
  );
  // Epic swimlanes lane by the nearest EPIC ancestor, not the direct parent
  // (which may be a Feature/Story in the Initiative→Epic→…→Task hierarchy). The
  // resolver is memoized on the issue list so it builds its URL map ONCE per
  // load, keeping board rendering O(n) (not O(n²) — one rebuild per card).
  const epicOf = useMemo(() => createEpicAncestorResolver(issues.issues), [issues.issues]);
  // F3: (re)load the provenance log whenever the open issue or the issue data
  // (which a mutation refreshes) changes. Stale results are dropped if the dialog
  // moved on. `issues.issues` is a dependency so a status/assign change re-fetches.
  // No-URL resolves to [] inside loadActivityLog, so clearing happens off the
  // async path (no synchronous setState in the effect body).
  const { activityLog: loadActivityLog } = issues;
  useEffect(() => {
    let live = true;
    void loadActivityLog(commentsUrl ?? "").then((log) => {
      if (live) setActivity(commentsUrl ? log : []);
    });
    return () => {
      live = false;
    };
  }, [commentsUrl, loadActivityLog, issues.issues]);
  const activeFilters = query.priorities.length + query.labels.length + query.components.length + query.versions.length + query.assignees.length;

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

  // Dependency enforcement (#75 P1-4): gate a status transition behind an
  // open-blocker WARNING (never a hard block). If moving `issue` to
  // `targetStatus` is a guarded transition (starting/completing) AND it has open
  // `dct:requires` blockers, surface them and let the user proceed (override) or
  // cancel. Otherwise the transition runs straight through. The check is the
  // instant in-memory derivation over the loaded list (the board already has it);
  // the authoritative pod-fresh equivalent is `issues.openBlockers`.
  const guardedTransition = (issue: IssueRecord, targetStatus: StatusSlug, verb: string, proceed: () => void) => {
    const warning = dependencyWarning(issue, targetStatus, issues.issues, workflow);
    if (!warning.blocked) {
      proceed();
      return;
    }
    setPendingTransition({ issue, verb, blockers: warning.blockers, proceed });
  };

  const [createDefaults, setCreateDefaults] = useState<{ parent?: string; status?: StatusSlug; sprint?: string }>({});
  const onCreate = (defaults: { parent?: string; status?: StatusSlug; sprint?: string } = {}) => {
    setEditing(undefined);
    setCreateDefaults(defaults);
    setFormOpen(true);
  };
  const onSubmitForm = async (values: IssueFormSubmit) => {
    if (editing) {
      const url = editing.url;
      const assigneeChanged = (values.assignee ?? undefined) !== (editing.assignee ?? undefined);
      const statusChanged = values.status !== editing.status;
      await run(() => issues.update(url, values), "Issue updated");
      // Fire the mutation triggers the edit produced (#112) — the engine reads the
      // refreshed list, so it sees the new status/assignee.
      if (statusChanged) void runAutomations({ type: "OnStatusChange", url });
      if (assigneeChanged) void runAutomations({ type: "OnAssigned", url });
    } else {
      const { parent, sprint } = createDefaults;
      let createdUrl: string | undefined;
      await run(
        () =>
          issues.batch(async (r) => {
            const url = await r.create({ ...values, parent, creator: profile?.webId });
            createdUrl = url;
            if (sprint) await r.setSprintMembership(sprint, url, true);
          }),
        "Issue created",
      );
      // OnCreated (#112): the just-created issue is now in the refreshed list.
      if (createdUrl) {
        void runAutomations({ type: "OnCreated", url: createdUrl });
        // A create that set an assignee also fires OnAssigned.
        if (values.assignee) void runAutomations({ type: "OnAssigned", url: createdUrl });
      }
    }
  };

  // `context` gates board-only actions: Archive removes a card from the board and
  // is meaningless in list/table views, so it is supplied ONLY for `"board"`.
  // Without this, the shared factory leaked the Archive action onto closed cards
  // in non-board views.
  const cardActions = (issue: IssueRecord, context: "board" | "list" = "list"): IssueCardActions => ({
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
    onToggle: () => {
      const closing = issue.state === "open";
      const doToggle = () =>
        run(
          () => issues.setState(issue.url, closing ? "closed" : "open"),
          closing ? "Issue closed" : "Issue reopened",
        );
      if (!closing) {
        doToggle(); // reopening is never guarded (it's not forward progress)
        return;
      }
      // Closing maps to the workflow's first terminal status — guard that target.
      const target = workflow.statuses.find((s) => s.terminal)?.slug ?? "done";
      guardedTransition(issue, target, "complete", doToggle);
    },
    // Board-only: hide a finished card from the board (it stays closed in the
    // pod). The card only renders this when closed (pss-w29w), and it is supplied
    // only from the board path — never on a list/table card.
    onArchive:
      context === "board"
        ? () => {
            setArchived((s) => new Set(s).add(issue.url));
            toast.info("Card archived from the board. Switch to “Closed” to find it.");
          }
        : undefined,
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
  // F8 bulk assign / label: every selected issue updated in the same batch.
  const bulkAssign = (assignee: string | undefined) =>
    bulk((r, u) => r.update(u, { assignee }), assignee ? "Assignee set" : "Assignee cleared");
  const bulkAddLabel = (label: string) =>
    run(async () => {
      await issues.batch(async (r) => {
        for (const i of selectedVisible) {
          // Union the new label with the issue's existing labels (display names).
          const next = i.labels.includes(label) ? i.labels : [...i.labels, label];
          await r.update(i.url, { labels: next });
        }
      });
      clearSelection();
    }, `Labeled “${label}”`);
  // P1-6 (deferred): bulk set a custom field across the selected rows. Reuses the
  // SAME `issues.batch` path bulk-assign/label use (optimistic via the hook's batch
  // + revert-on-failure), persisting each through the existing `repository.update`
  // `fields` map. `value === undefined` clears the field on every selected issue.
  const bulkSetField = (def: FieldDef, value: FieldValue | undefined) =>
    run(async () => {
      await issues.batch(async (r) => {
        for (const i of selectedVisible) await r.update(i.url, { fields: { [def.slug]: value } });
      });
      clearSelection();
    }, value === undefined ? `Cleared ${def.label}` : `Set ${def.label}`);
  // Workflow editor (#75 P2-5) in-use-state migration: move issues to a target
  // status, bypassing the transition rules (an administrative relocation out of a
  // state being deleted, never a user move) — `migrateStatus` keeps the open/closed
  // resolution + activity log. Routed through `issues.batch` so the local list +
  // save indicator stay consistent, exactly like the bulk actions.
  const migrateIssues = useCallback(
    (urls: string[], toStatus: StatusSlug) =>
      issues.batch(async (r) => {
        for (const url of urls) await r.migrateStatus(url, toStatus);
      }),
    // Depends only on the hook's stable `batch` useCallback (not the whole `issues`
    // object, which `useIssues` rebuilds each render) — same convention as
    // `runAutomations` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [issues.batch],
  );
  // The LIVE issue→status refs, read synchronously at call time (not a render
  // snapshot). The workflow editor calls this at SAVE time so its in-use-state
  // reconciliation sees any issue that moved into a to-be-removed state AFTER the
  // user clicked remove (the refs prop would be a stale render snapshot).
  const getIssueStatusRefs = useCallback(
    (): IssueStatusRef[] => issues.getIssues().map((i) => ({ url: i.url, status: i.status })),
    // `getIssues` is the hook's stable synchronous reader (a ref under the hood).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [issues.getIssues],
  );

  // Open the bulk-set value dialog for a field (resetting the in-progress value).
  const openBulkField = (def: FieldDef) => {
    setBulkFieldTarget(def);
    setBulkFieldValue("");
  };
  // Commit the bulk field set: parse the raw value for the field's type and apply
  // it across the selection (or clear it when blank). A non-numeric number / an
  // unsafe URL is rejected before any write. Closes the dialog on success.
  const commitBulkField = (rawValue: string | undefined) => {
    const def = bulkFieldTarget;
    if (!def) return;
    let value: FieldValue | undefined;
    if (rawValue === undefined || rawValue.trim() === "") {
      value = undefined; // clear the field on every selected issue
    } else {
      const raw = rawValue.trim();
      switch (def.type) {
        case "number": {
          const n = Number(raw);
          if (!Number.isFinite(n)) {
            toast.error("Enter a valid number.");
            return;
          }
          value = n;
          break;
        }
        case "date": {
          const d = new Date(raw);
          if (Number.isNaN(d.getTime())) {
            toast.error("Enter a valid date.");
            return;
          }
          value = d;
          break;
        }
        case "url": {
          const safe = safeHttpUrl(raw);
          if (!safe) {
            toast.error("Enter a valid http(s) link.");
            return;
          }
          value = safe;
          break;
        }
        case "select":
          value = raw; // an option IRI chosen from the select
          break;
        default:
          value = raw; // text
      }
    }
    setBulkFieldTarget(undefined);
    void bulkSetField(def, value);
  };

  // --- Inline cell editing (#75 P1-6, Monday-style) ---
  // The optimistic edit controller: a non-status field edit applies immediately,
  // persists via the EXISTING repository.update path (validation + the
  // ETag-conditional write reused), shows the global Saving…/Saved indicator, and
  // reverts the cell (preserving any concurrent edit) + surfaces an error on
  // failure — with an ETag ConflictError reverting and reconciling from the pod
  // rather than clobbering. A status edit routes through the SAME dependency/
  // workflow guard (`guardedTransition`) + the workflow-validating `setStatus`.
  // The flow lives in `makeInlineEditController` (pure + unit-tested); this just
  // hands it the hook's optimistic seam. Created per render (cheap, holds no state)
  // — matching the codebase convention for these handlers (e.g. `cardActions`).
  // Fire the automation triggers an inline cell edit produces (#112). Wrapped in a
  // useCallback so it is a stable value — passing a fresh ref-reading closure into
  // makeInlineEditController during render trips the refs lint.
  const onInlineApplied = useCallback(
    (field: EditableField, url: string) => {
      if (field === "status") void runAutomations({ type: "OnStatusChange", url });
      else if (field === "assignee") void runAutomations({ type: "OnAssigned", url });
    },
    [runAutomations],
  );
  const { edit: inlineEdit, editStatus: inlineStatusEdit } = makeInlineEditController(
    { getIssues: issues.getIssues, setIssuesLocal: issues.setIssuesLocal, persist: issues.persist, refresh: issues.refresh },
    workflow,
    toast,
    guardedTransition,
    // onInlineApplied transitively reads automation refs (the dedupe set + the
    // re-entrancy guard), but ONLY inside the async runAutomations body / effects —
    // never during render. The refs rule can't see that through the indirection.
    // eslint-disable-next-line react-hooks/refs
    onInlineApplied,
  );

  // The shared bulk-action toolbar (selected-rows close/reopen/assign/label/delete)
  // — reused by BOTH the list and the inline-edit table so multi-select behaves
  // identically in either layout. Rendered only when rows are selected.
  const bulkToolbar = selectedVisible.length > 0 && (
    <div className="sticky top-14 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-sm">
      <span className="px-1 text-sm font-medium">{selectedVisible.length} selected</span>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => bulk((r, u) => r.setState(u, "closed"), "Issues closed")}>
        <CheckCircle2 className="size-4" aria-hidden /> Close
      </Button>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => bulk((r, u) => r.setState(u, "open"), "Issues reopened")}>
        <RotateCcw className="size-4" aria-hidden /> Reopen
      </Button>
      {/* F8: bulk assign */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <Users className="size-4" aria-hidden /> Assign
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
          <DropdownMenuLabel>Assign to</DropdownMenuLabel>
          {assigneeSuggestions.length === 0 && (
            <DropdownMenuLabel className="font-normal text-muted-foreground">No team members yet</DropdownMenuLabel>
          )}
          {assigneeSuggestions.map((a) => (
            <DropdownMenuItem key={a} onClick={() => bulkAssign(a)}>
              {a === group.iri ? "Team" : shortWebId(a)}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => bulkAssign(undefined)}>Clear assignee</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* F8: bulk label */}
      {fac.labels.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Tag className="size-4" aria-hidden /> Label
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
            <DropdownMenuLabel>Add label</DropdownMenuLabel>
            {fac.labels.map((l) => (
              <DropdownMenuItem key={l} onClick={() => bulkAddLabel(l)}>
                {l}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {/* P1-6 (deferred): bulk set a custom field across the selected rows. Picks a
          field, then opens a value dialog (a select's options, or a typed input). */}
      {fieldDefs.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <SlidersHorizontal className="size-4" aria-hidden /> Set field
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto">
            <DropdownMenuLabel>Set a field</DropdownMenuLabel>
            {fieldDefs.map((f) => (
              <DropdownMenuItem key={f.iri} onClick={() => openBulkField(f)}>
                {f.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Button variant="outline" size="sm" className="gap-1.5 text-destructive" onClick={() => setBulkDeleteOpen(true)}>
        <Trash2 className="size-4" aria-hidden /> Delete
      </Button>
      <Button variant="ghost" size="sm" className="ml-auto gap-1.5" onClick={clearSelection}>
        <X className="size-4" aria-hidden /> Clear
      </Button>
    </div>
  );

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
        { id: "table", label: "Table view (inline edit)", hint: "g", run: () => setView("table") },
        { id: "board", label: "Board view", hint: "b", run: () => setView("board") },
        { id: "epics", label: "Epics view", hint: "e", run: () => setView("epics") },
        { id: "dashboard", label: "Dashboard", hint: "d", run: () => setView("dashboard") },
        { id: "backlog", label: "Backlog view", run: () => setView("backlog") },
        { id: "timeline", label: "Timeline view", hint: "t", run: () => setView("timeline") },
        { id: "calendar", label: "Calendar view", run: () => setView("calendar") },
        { id: "workload", label: "Workload view", run: () => setView("workload") },
        { id: "inbox", label: "Inbox", hint: "i", run: () => setView("inbox") },
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
              { id: "fields", label: "Fields, components & WIP limits…", run: () => setFieldsOpen(true) },
              { id: "automations", label: "Automations…", run: () => setRulesOpen(true) },
            ]
          : []),
        { id: "signout", label: "Sign out", run: logout },
      ],
    },
    { heading: "Saved views", items: views.map((v) => ({ id: `v-${v.iri}`, label: v.name, run: () => applyView(v) })) },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Project context bar — visible below the AppShell header when viewing
          another user's tracker (replaces the old sticky sub-header). */}
      {!isOwn && (
        <div className="-mx-4 -mt-6 border-b bg-muted/40 px-4 py-2 md:-mx-8 md:px-8">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm text-muted-foreground">
              Viewing <span className="font-medium text-foreground">{shortWebId(tracker.ownerWebId)}</span>&apos;s
              tracker
            </p>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => switchTracker(ownTracker)}>
              <ArrowLeft className="size-4" aria-hidden /> My issues
            </Button>
          </div>
        </div>
      )}

      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {/* Project switcher — pick a different tracker / collaborator's pod. */}
          {profile && storageUrl && (
            <div className="mb-1 flex items-center gap-2">
              <ProjectSwitcher
                webId={profile.webId}
                storageUrl={storageUrl}
                active={tracker}
                onSwitch={(t) => {
                  switchTracker(t);
                  setSelected(new Set());
                }}
              />
            </div>
          )}
          <p className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">Tracker</p>
          <h1 className="mt-0.5 truncate text-2xl font-bold tracking-tight text-balance">
            {trackerTitle ?? "Issues"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground tabular-nums">
            {counts.open} open · {counts.closed} closed
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {isOwn && (
            <Button variant="ghost" size="sm" className="gap-1.5" aria-label="Team" onClick={() => setTeamOpen(true)}>
              <Users className="size-4" aria-hidden />
              <span className="hidden lg:inline">Team</span>
            </Button>
          )}
          {isOwn && (
            <Button variant="ghost" size="sm" className="gap-1.5" aria-label="Fields" onClick={() => setFieldsOpen(true)}>
              <SlidersHorizontal className="size-4" aria-hidden />
              <span className="hidden lg:inline">Fields</span>
            </Button>
          )}
          {isOwn && (
            <Button variant="ghost" size="sm" className="gap-1.5" aria-label="Automations" onClick={() => setRulesOpen(true)}>
              <Zap className="size-4" aria-hidden />
              <span className="hidden lg:inline">Automations</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" className="gap-1.5" aria-label="Open tracker" onClick={() => setOpenTrackerOpen(true)}>
            <FolderOpen className="size-4" aria-hidden />
            <span className="hidden lg:inline">Open tracker</span>
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

        {/* Toolbar */}
        <div className="mb-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                id="issue-search"
                type="search"
                aria-label="Search issues"
                placeholder="Search — or query: status:done p:high label:auth  ( / )"
                title="Query keys: is:open|closed · status: · p[riority]: · type: · label: · assignee: · due:<date|none|overdue · points:>n · has:comments|attachments|blockers · sort:[-]key"
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
                {fac.components.length > 0 && <DropdownMenuLabel>Components</DropdownMenuLabel>}
                {fac.components.map((c) => (
                  <DropdownMenuCheckboxItem
                    key={c}
                    checked={query.components.includes(c)}
                    onCheckedChange={() => patchQuery({ components: toggleIn(query.components, c) })}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {componentLabel(c)}
                  </DropdownMenuCheckboxItem>
                ))}
                {fac.versions.length > 0 && <DropdownMenuLabel>Versions</DropdownMenuLabel>}
                {fac.versions.map((v) => (
                  <DropdownMenuCheckboxItem
                    key={v}
                    checked={query.versions.includes(v)}
                    onCheckedChange={() => patchQuery({ versions: toggleIn(query.versions, v) })}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {versionLabel(v)}
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
                    <DropdownMenuItem onClick={() => patchQuery({ priorities: [], labels: [], components: [], versions: [], assignees: [] })}>
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
                    <div key={v.iri} className="flex items-center">
                      <DropdownMenuItem className="flex-1" onClick={() => applyView(v)}>
                        {v.name}
                      </DropdownMenuItem>
                      {isOwn && issues.canCreate && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="mr-1 size-7"
                          aria-label={`Delete view ${v.name}`}
                          onClick={() => deleteView(v.iri)}
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </Button>
                      )}
                    </div>
                  ))
                )}
                {isOwn && issues.canCreate && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setSaveViewOpen(true)}>
                      <BookmarkPlus className="size-4" aria-hidden /> Save current view…
                    </DropdownMenuItem>
                  </>
                )}
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

            {/* Group-by + swimlanes (board only) */}
            {view === "board" && (
              <>
                <Select value={groupBy} onValueChange={(v) => setGroupBy(v as "status" | "priority")}>
                  <SelectTrigger className="w-36" aria-label="Group by">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="status">Group: Status</SelectItem>
                    <SelectItem value="priority">Group: Priority</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={groupBoardBy} onValueChange={(v) => setGroupBoardBy(v as SwimlaneBy)}>
                  <SelectTrigger className="w-40" aria-label="Swimlanes">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Swimlanes: None</SelectItem>
                    <SelectItem value="assignee">Swimlanes: Assignee</SelectItem>
                    <SelectItem value="epic">Swimlanes: Epic</SelectItem>
                  </SelectContent>
                </Select>
              </>
            )}

            {/* View toggle */}
            <div role="tablist" aria-label="View" className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-muted p-1">
              {([
                { key: "list", label: "List", Icon: ListIcon },
                { key: "table", label: "Table", Icon: Table2 },
                { key: "board", label: "Board", Icon: LayoutGrid },
                { key: "epics", label: "Epics", Icon: Zap },
                { key: "backlog", label: "Backlog", Icon: ListTodo },
                { key: "timeline", label: "Timeline", Icon: ChartNoAxesGantt },
                { key: "calendar", label: "Calendar", Icon: CalendarDays },
                { key: "dashboard", label: "Dashboard", Icon: BarChart3 },
                { key: "workload", label: "Workload", Icon: UsersRound },
                { key: "inbox", label: "Inbox", Icon: Bell },
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
                  <span className="hidden lg:inline">{label}</span>
                </button>
              ))}
            </div>
          </div>

          <div role="tablist" aria-label="Filter by state" className="flex w-fit gap-1 rounded-lg bg-muted p-1">
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
                {f} <span className="text-muted-foreground tabular-nums">{counts[f]}</span>
              </button>
            ))}
          </div>
        </div>

        <div key={view} className="animate-view-in">
        {view === "inbox" ? (
          // The LDN inbox is independent of the open tracker's issue list — it
          // reads the signed-in user's own pod inbox, so it renders regardless of
          // issue load/error state. `ownStorageUrls` is the own-pod SSRF allow-list.
          profile ? (
            <InboxView webId={profile.webId} ownStorageUrls={ownStorageUrls} />
          ) : null
        ) : issues.initialLoading ? (
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
              // Completion is the open/closed resolution, not the literal "done"
              // slug — a custom workflow's terminal status still counts as done.
              const sprint = issues.sprints.find((s) => s.iri === iri);
              const open = (sprint?.taskUrls ?? []).filter(
                (u) => issues.issues.find((i) => i.url === u)?.state !== "closed",
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
          <DashboardView
            issues={issues.issues}
            sprints={issues.sprints}
            workflow={workflow}
            loadStatusHistory={issues.statusHistory}
          />
        ) : view === "workload" ? (
          // Workload balances ALL open work, unfiltered.
          <WorkloadView issues={issues.issues} groupIri={group.iri} />
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
        ) : (view === "board" ? boardVisible.length === 0 : visible.length === 0) ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed p-12 text-center">
            <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CircleDot className="size-6" />
            </span>
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
        ) : view === "table" ? (
          // Monday/Jira-style inline-editable table (#75 P1-6): status / priority /
          // assignee / title / custom-field cells edit in place. Edits are
          // optimistic + persisted via the SAME repository.update / setStatus path
          // (inlineEdit / inlineStatusEdit), with the global SaveIndicator and
          // revert-on-failure. Multi-select + the shared bulk toolbar are reused.
          <div className="space-y-3">
            {bulkToolbar}
            <IssuesTable
              issues={visible}
              statuses={workflow.statuses}
              fieldDefs={fieldDefs}
              assigneeSuggestions={assigneeSuggestions}
              groupIri={group.iri}
              selectable={issues.canCreate}
              selected={selected}
              allSelected={allSelected}
              onToggleAll={toggleAll}
              onToggleSelect={toggleSelect}
              onOpen={(i) => setCommentsUrl(i.url)}
              onEdit={inlineEdit}
              onStatusEdit={inlineStatusEdit}
            />
          </div>
        ) : view === "board" ? (
          // The board shows open work AND completed cards in the Done column
          // (done-and-visible, pss-w29w); boardVisible applies the text/facet
          // filters while keeping terminal-status cards the open-state filter
          // would otherwise hide.
          <IssueBoard
            issues={boardVisible}
            cardActions={(issue) => cardActions(issue, "board")}
            canWrite={issues.canCreate}
            columns={boardColumns(workflow, groupBy)}
            columnWip={groupBy === "status" ? columnWip : undefined}
            swimlaneBy={groupBoardBy}
            labelOf={swimlaneLabel}
            epicOf={epicOf}
            groupOf={(i) => (groupBy === "status" ? i.status : (i.priority ?? "none"))}
            onMove={(url, key) => {
              const move = moveForColumn(groupBy, key);
              const { next, original } = optimisticMove(issues.issues, url, move, groupBy, workflow);
              if (!original) return; // no-op drop (same column)
              // The optimistic move + background persist (pss-w29w): slide the card
              // immediately, persist in the background, revert + toast on failure.
              const performMove = () => {
                // The record this move optimistically wrote — used to detect whether
                // a LATER move of the same card has since superseded it, so a stale
                // failure never clobbers a newer move (revertMoveIfCurrent).
                const optimistic = next.find((i) => i.url === url)!;
                issues.setIssuesLocal(() => next);
                void issues
                  .persist((r) =>
                    move.kind === "status"
                      ? r.setStatus(url, move.status)
                      : r.update(url, { priority: move.priority }),
                  )
                  .then(() => {
                    // OnStatusChange (#112): a successful status move may fire rules.
                    if (move.kind === "status") void runAutomations({ type: "OnStatusChange", url });
                  })
                  .catch((e) => {
                    issues.setIssuesLocal((list) => revertMoveIfCurrent(list, original, optimistic, move));
                    if (e instanceof ConflictError) {
                      toast.error(e.message);
                      void issues.refresh();
                    } else {
                      toast.error(e instanceof Error ? e.message : "Could not move the card.");
                    }
                  });
              };
              // A status move into a column over its WIP max warns FIRST (#111) —
              // advisory, override allowed (never a hard block); then the dependency
              // guard. A priority move runs straight through.
              const proceedAfterWip = () => {
                if (move.kind === "status") {
                  guardedTransition(original, move.status, "move", performMove);
                } else {
                  performMove();
                }
              };
              if (move.kind === "status") {
                const breach = wipMoveBreach(issues.issues, url, move.status, wipLimits, workflow);
                if (breach) {
                  setPendingWipMove({
                    title: original.title,
                    column: boardColumns(workflow, groupBy).find((c) => c.key === move.status)?.label ?? move.status,
                    count: breach.count,
                    max: breach.max,
                    proceed: proceedAfterWip,
                  });
                  return;
                }
              }
              proceedAfterWip();
            }}
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
                {bulkToolbar}
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
                    <IssueCard issue={issue} {...cardActions(issue, "list")} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        </div>

      {/* Non-intrusive global save indicator for optimistic board writes. */}
      <SaveIndicator state={issues.saveState} />

      <IssueFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        initial={editing}
        defaultStatus={createDefaults.status}
        onSubmit={onSubmitForm}
        assigneeSuggestions={assigneeSuggestions}
        fieldDefs={fieldDefs}
        componentDefs={componentDefs}
        versionDefs={versionDefs}
        statuses={workflow.statuses}
      />

      <IssueDetailDialog
        open={!!commentsUrl}
        onOpenChange={(o) => !o && setCommentsUrl(undefined)}
        issue={commentsIssue}
        allIssues={issues.issues}
        people={people}
        groupIri={group.iri}
        fieldDefs={fieldDefs}
        componentDefs={componentDefs}
        versionDefs={versionDefs}
        activity={activity}
        workflowStatuses={workflow.statuses}
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
        onLogWork={(seconds, note) => issues.logWork(commentsUrl!, seconds, note)}
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

      {isOwn && (
        <FieldsDialog
          open={fieldsOpen}
          onOpenChange={setFieldsOpen}
          trackerUrl={tracker.trackerUrl}
          issueStatusRefs={issueStatusRefs}
          getIssueStatusRefs={getIssueStatusRefs}
          migrateIssues={migrateIssues}
          onSaved={loadTrackerInfo}
        />
      )}

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} groups={paletteGroups} />

      {isOwn && (
        <RulesDialog
          open={rulesOpen}
          onOpenChange={setRulesOpen}
          trackerUrl={tracker.trackerUrl}
          statuses={workflow.statuses}
          teamMembers={group.members}
          onSaved={loadTrackerInfo}
        />
      )}

      <OpenTrackerDialog
        open={openTrackerOpen}
        onOpenChange={setOpenTrackerOpen}
        onOpen={(t) => {
          switchTracker(t);
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

      {/* Dependency enforcement (#75 P1-4): WARN before starting/completing an
          issue that still has open blockers — the user may proceed (override) or
          cancel. Never a hard block. */}
      <Dialog open={!!pendingTransition} onOpenChange={(o) => !o && setPendingTransition(undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>This issue is still blocked</DialogTitle>
            <DialogDescription>
              “{pendingTransition?.issue.title}” is blocked by {pendingTransition?.blockers.length === 1 ? "an issue that is" : "issues that are"} not done yet. You can still proceed.
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {pendingTransition?.blockers.map((b) => (
              <li key={b.url} className="flex items-center gap-2">
                <Ban className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{b.title ?? b.url}</span>
                <Badge variant="outline" className="shrink-0">open</Badge>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingTransition(undefined)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const pending = pendingTransition;
                setPendingTransition(undefined);
                pending?.proceed();
              }}
            >
              Proceed anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* WIP-limit move warning (#111 P1-1) — advisory, override allowed. */}
      <Dialog open={!!pendingWipMove} onOpenChange={(o) => !o && setPendingWipMove(undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Over the WIP limit</DialogTitle>
            <DialogDescription>
              Moving “{pendingWipMove?.title}” into “{pendingWipMove?.column}” would make {pendingWipMove?.count} cards
              there — over the column&apos;s limit of {pendingWipMove?.max}. You can still proceed.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingWipMove(undefined)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                const pending = pendingWipMove;
                setPendingWipMove(undefined);
                pending?.proceed();
              }}
            >
              Move anyway
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

      {/* P1-6 (deferred): bulk set a custom field's value across the selection.
          A select field offers its options; other types take a typed input. An
          empty value clears the field on every selected issue. */}
      <Dialog open={!!bulkFieldTarget} onOpenChange={(o) => !o && setBulkFieldTarget(undefined)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Set “{bulkFieldTarget?.label}”</DialogTitle>
            <DialogDescription>
              Apply a value for “{bulkFieldTarget?.label}” to the {selectedVisible.length} selected{" "}
              {selectedVisible.length === 1 ? "issue" : "issues"}. Leave it blank to clear the field.
            </DialogDescription>
          </DialogHeader>
          {bulkFieldTarget?.type === "select" ? (
            <Select value={bulkFieldValue} onValueChange={setBulkFieldValue}>
              <SelectTrigger aria-label={`Value for ${bulkFieldTarget.label}`}>
                <SelectValue placeholder="Choose a value" />
              </SelectTrigger>
              <SelectContent>
                {bulkFieldTarget.options.map((o) => (
                  <SelectItem key={o.iri} value={o.iri}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              aria-label={`Value for ${bulkFieldTarget?.label ?? "field"}`}
              type={
                bulkFieldTarget?.type === "number"
                  ? "number"
                  : bulkFieldTarget?.type === "date"
                    ? "date"
                    : bulkFieldTarget?.type === "url"
                      ? "url"
                      : "text"
              }
              value={bulkFieldValue}
              onChange={(e) => setBulkFieldValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && commitBulkField(bulkFieldValue)}
              autoFocus
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkFieldTarget(undefined)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => commitBulkField(undefined)}>
              Clear on all
            </Button>
            <Button onClick={() => commitBulkField(bulkFieldValue)} disabled={!bulkFieldValue.trim()}>
              Set on all
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
