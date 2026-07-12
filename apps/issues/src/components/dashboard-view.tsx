"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, ReferenceLine, Scatter, XAxis, YAxis, ZAxis } from "recharts";
import {
  computeBurndown,
  computeControlChart,
  computeCumulativeFlowBands,
  computeStats,
  computeVelocity,
  controlChartRows,
  type StatusTransition,
} from "@/lib/stats";
import { DEFAULT_WORKFLOW, type WorkflowDef } from "@/lib/issue";
import type { IssueRecord, SprintRecord } from "@/lib/use-issues";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { PersonChip } from "@/components/person";
import { AlertTriangle, CheckCircle2, CircleDot, Loader2 } from "lucide-react";

// Theme chart tokens (dark-mode aware): 1 violet · 2 green · 3 amber · 4 red · 5 blue.
const STATUS_COLORS: Record<string, string> = {
  todo: "var(--chart-5)",
  "in-progress": "var(--chart-1)",
  done: "var(--chart-2)",
};
const TYPE_COLORS: Record<string, string> = {
  epic: "var(--chart-1)",
  story: "var(--chart-2)",
  task: "var(--chart-5)",
  bug: "var(--chart-4)",
};
const PRIORITY_COLORS: Record<string, string> = {
  high: "var(--chart-4)",
  medium: "var(--chart-3)",
  low: "var(--chart-5)",
  none: "var(--muted-foreground)",
};

const chartConfig: ChartConfig = { count: { label: "Issues" } };

// Control chart series: cycle-time scatter + its rolling average.
const controlConfig: ChartConfig = {
  cycle: { label: "Cycle time (days)", color: "var(--chart-1)" },
  rolling: { label: "Rolling avg", color: "var(--chart-4)" },
};

/** Round a day count to one decimal for compact display. */
const days1 = (d: number): number => Math.round(d * 10) / 10;

/**
 * Sentinel "no load has resolved yet" loader identity. Distinct from any real
 * loader AND from `undefined` (the no-loader prop), so the first render with issues
 * reads as loading until the first fan-out resolves, instead of momentarily showing
 * the empty initial map as if it were ready.
 */
const INITIAL_LOADER = Symbol("initial-loader");

function StatCard({ label, value, icon, accent }: { label: string; value: number; icon: React.ReactNode; accent?: boolean }) {
  return (
    <Card className="gap-2 py-4">
      <CardContent className="flex items-center gap-3">
        <span
          aria-hidden
          className={`flex size-9 items-center justify-center rounded-lg ${accent ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}
        >
          {icon}
        </span>
        <span>
          <span className="block text-2xl leading-none font-semibold tracking-tight tabular-nums">{value}</span>
          <span className="text-xs text-muted-foreground">{label}</span>
        </span>
      </CardContent>
    </Card>
  );
}

/** Jira/Monday-style dashboard: stat cards + distribution charts + workload. */
export function DashboardView({
  issues,
  sprints = [],
  workflow = DEFAULT_WORKFLOW,
  loadStatusHistory,
}: {
  issues: IssueRecord[];
  sprints?: SprintRecord[];
  /** The tracker's configured workflow (for the three-band CFD state resolution). */
  workflow?: WorkflowDef;
  /** Bounded fan-out of the F3 status-transition history (for the three-band CFD). */
  loadStatusHistory?: (urls: string[]) => Promise<Map<string, StatusTransition[]>>;
}) {
  const velocity = useMemo(() => computeVelocity(sprints, issues), [sprints, issues]);
  const stats = useMemo(() => computeStats(issues), [issues]);
  // Burn down the active sprint; fall back to the most recently completed one.
  const burnSprint = useMemo(
    () =>
      sprints.find((s) => s.state === "active" && s.startDate && s.endDate) ??
      [...sprints]
        .filter((s) => s.state === "done" && s.startDate && s.endDate)
        .sort((a, b) => (b.endDate?.getTime() ?? 0) - (a.endDate?.getTime() ?? 0))[0],
    [sprints],
  );
  const burndown = useMemo(
    () => (burnSprint ? computeBurndown(burnSprint, issues) : []),
    [burnSprint, issues],
  );
  // Three-band cumulative flow: fan out a bounded read of each issue's F3
  // status-transition history, then replay it into not-started / in-progress /
  // done bands per day. Until the history loads, the bands are empty (the chart
  // hides itself when there is <2 days of data).
  // The status-history fan-out result, tagged with the EXACT inputs it resolved for
  // — the issue-revision key AND the loader reference — plus whether that load
  // failed. The control chart derives per-issue cycle times from this log and would
  // otherwise paint MISLEADING cycle-0 points off the initially-empty (or stale)
  // map, so it must wait for the current load. Tagging by inputs (rather than a
  // synchronous "loading" setState in the effect, which the react-hooks rule
  // forbids) lets the loading state be PURELY DERIVED during render: a load is
  // pending whenever the result's (key, loader) ≠ the current (key, loader). Keying
  // off BOTH inputs — not just the revision key — means a swapped `loadStatusHistory`
  // (same issue set) correctly reads as loading instead of showing stale history. A
  // sentinel initial loader (never equal to a real one) makes the first render with
  // issues read as loading until the first load resolves. The CFD tolerates the
  // empty/stale map (it self-hides under 2 days of data), so only the control chart
  // consults the load state.
  const [history, setHistory] = useState<{
    key: string;
    loader: typeof loadStatusHistory | symbol;
    map: ReadonlyMap<string, StatusTransition[]>;
    error: boolean;
  }>({ key: "", loader: INITIAL_LOADER, map: new Map(), error: false });
  const statusHistory = history.map;
  // Revision key: re-fetch history whenever the set of issue URLs changes OR
  // any issue's status/modification time changes. A URL-only key would leave
  // statusHistory stale after a status mutation (URL set unchanged, but
  // statusHistory reflects the old state). Including status + modified + endedAt
  // ensures the effect re-runs on every issue state change, not just adds/removes.
  const issueRevisionKey = useMemo(
    () =>
      issues
        .map((i) => `${i.url}\x01${i.status}\x01${i.modified?.toISOString() ?? ""}\x01${i.endedAt?.toISOString() ?? ""}`)
        .sort()
        .join("\n"),
    [issues],
  );
  // The URL list is stable for the same issueRevisionKey (URLs are embedded as
  // the first segment of each row). Derived here so the effect has a stable
  // reference without listing `issues` (which changes on every render cycle)
  // as a raw effect dependency.
  const issueUrls = useMemo(
    () =>
      issueRevisionKey === ""
        ? []
        : issueRevisionKey.split("\n").map((row) => row.split("\x01")[0]).filter(Boolean),
    [issueRevisionKey],
  );
  useEffect(() => {
    let cancelled = false;
    // Capture the inputs THIS run loads for, so the resolved state is tagged with
    // them and the loading flag can be derived during render (no synchronous
    // setState in the effect body — the react-hooks rule forbids it). Resolve
    // through a promise in BOTH branches so every state update is asynchronous (in
    // the .then/.catch). No loader / no URLs ⇒ the empty map is the final state.
    const key = issueRevisionKey;
    const loader = loadStatusHistory;
    const load =
      !loadStatusHistory || issueUrls.length === 0
        ? Promise.resolve(new Map<string, StatusTransition[]>())
        : loadStatusHistory(issueUrls);
    load
      .then((map) => {
        if (!cancelled) setHistory({ key, loader, map, error: false });
      })
      .catch(() => {
        if (!cancelled) setHistory({ key, loader, map: new Map(), error: true });
      });
    return () => {
      cancelled = true;
    };
  }, [loadStatusHistory, issueRevisionKey, issueUrls]);
  // Loading is PURELY DERIVED: a fan-out is pending whenever the history we hold did
  // NOT resolve for the current inputs — the issue revision changed OR the loader
  // reference swapped (keying off BOTH, not just the revision, is the stale-loader
  // fix). The error flag is carried on the loaded state. "ready" = resolved for the
  // current (key, loader), no error.
  const historyStatus: "loading" | "ready" | "error" =
    history.key !== issueRevisionKey || history.loader !== loadStatusHistory
      ? "loading"
      : history.error
        ? "error"
        : "ready";
  const flow = useMemo(
    () => computeCumulativeFlowBands(issues, statusHistory, workflow),
    [issues, statusHistory, workflow],
  );
  // Control chart: cycle/lead time per closed issue, replayed from the SAME F3
  // status-transition history the CFD uses. The scatter rows + rolling average are
  // derived from the computed points; summary stats drive the reference band.
  const control = useMemo(
    () => computeControlChart(issues, statusHistory, workflow),
    [issues, statusHistory, workflow],
  );
  const controlRows = useMemo(() => controlChartRows(control.points), [control.points]);
  // Whether any issue is closed at all — drives showing the control-chart card
  // (with a loading/error state while the history that feeds it is fetched) vs.
  // hiding it entirely when there is nothing to chart. `state === "closed"` tracks
  // the open/closed lifecycle for every workflow (custom terminal statuses keep
  // wf:Closed in sync), so it is workflow-correct.
  const hasClosedIssues = useMemo(() => issues.some((i) => i.state === "closed"), [issues]);
  const open = stats.byStatus.find((s) => s.status === "todo")?.count ?? 0;
  const inProgress = stats.byStatus.find((s) => s.status === "in-progress")?.count ?? 0;
  const done = stats.byStatus.find((s) => s.status === "done")?.count ?? 0;

  const statusData = stats.byStatus.map((s) => ({ name: s.label, count: s.count, fill: STATUS_COLORS[s.status] }));
  const typeData = stats.byType.map((t) => ({ name: t.label, count: t.count, fill: TYPE_COLORS[t.type] }));
  const priorityData = stats.byPriority.map((p) => ({
    name: p.priority === "none" ? "No priority" : p.priority,
    count: p.count,
    fill: PRIORITY_COLORS[p.priority],
  }));

  return (
    <div className="space-y-4" data-testid="dashboard">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="To Do" value={open} icon={<CircleDot className="size-4" />} />
        <StatCard label="In Progress" value={inProgress} icon={<Loader2 className="size-4" />} />
        <StatCard label="Done" value={done} icon={<CheckCircle2 className="size-4" />} />
        <StatCard label="Overdue" value={stats.overdue} icon={<AlertTriangle className="size-4" />} accent />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Status distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-56">
              <PieChart>
                <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
                <Pie data={statusData} dataKey="count" nameKey="name" innerRadius={48} strokeWidth={4}>
                  {statusData.map((d) => (
                    <Cell key={d.name} fill={d.fill} />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <ul className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {statusData.map((d) => (
                <li key={d.name} className="flex items-center gap-1.5">
                  <span aria-hidden className="size-2.5 rounded-full" style={{ background: d.fill }} />
                  {d.name} ({d.count})
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">By type</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="max-h-56 w-full">
              <BarChart data={typeData}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="name" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis allowDecimals={false} width={24} tickLine={false} axisLine={false} fontSize={12} />
                <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {typeData.map((d) => (
                    <Cell key={d.name} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">By priority</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="max-h-56 w-full">
              <BarChart data={priorityData} layout="vertical">
                <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} />
                <YAxis type="category" dataKey="name" width={84} tickLine={false} axisLine={false} fontSize={12} className="capitalize" />
                <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {priorityData.map((d) => (
                    <Cell key={d.name} fill={d.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Open workload</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.byAssignee.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No open issues.</p>
            ) : (
              <ul className="space-y-2">
                {stats.byAssignee.slice(0, 8).map((a) => {
                  const max = stats.byAssignee[0]?.count || 1;
                  return (
                    <li key={a.assignee ?? "unassigned"} className="flex items-center gap-2 text-sm">
                      <span className="w-40 shrink-0 truncate">
                        {a.assignee ? <PersonChip webId={a.assignee} /> : <span className="text-muted-foreground">Unassigned</span>}
                      </span>
                      <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(6, (a.count / max) * 100)}%` }}
                        />
                      </span>
                      <span className="w-6 text-right text-xs text-muted-foreground">{a.count}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {burndown.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Burndown — {burnSprint!.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="max-h-56 w-full">
              <LineChart data={burndown}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} fontSize={12} />
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Line type="monotone" dataKey="ideal" stroke="var(--muted-foreground)" strokeDasharray="5 5" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="remaining" stroke="var(--primary)" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ChartContainer>
            <p className="mt-1 text-center text-xs text-muted-foreground">Estimated points remaining vs ideal</p>
          </CardContent>
        </Card>
      )}

      {velocity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Velocity (points per completed sprint)</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="max-h-48 w-full">
              <BarChart data={velocity}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="sprint" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis allowDecimals={false} width={24} tickLine={false} axisLine={false} fontSize={12} />
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Bar dataKey="committed" fill="var(--muted-foreground)" opacity={0.35} radius={[4, 4, 0, 0]} />
                <Bar dataKey="done" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
            <p className="mt-1 text-center text-xs text-muted-foreground">Done vs committed</p>
          </CardContent>
        </Card>
      )}

      {flow.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Cumulative flow</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="max-h-56 w-full">
              <AreaChart data={flow}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} fontSize={12} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Area type="monotone" dataKey="done" stackId="1" name="Done" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.5} />
                <Area type="monotone" dataKey="inProgress" stackId="1" name="In progress" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.35} />
                <Area type="monotone" dataKey="notStarted" stackId="1" name="Not started" stroke="var(--chart-5)" fill="var(--chart-5)" fillOpacity={0.25} />
              </AreaChart>
            </ChartContainer>
            <p className="mt-1 text-center text-xs text-muted-foreground">Issues per day by disposition: not started · in progress · done</p>
          </CardContent>
        </Card>
      )}

      {/*
        The control chart derives cycle times from the F3 status-history fan-out.
        While that load is in flight (or if it fails) the chart would otherwise show
        misleading cycle-0 points off the empty map, so the card is gated on
        `historyStatus`: a loading state until the history resolves, an error state
        if it rejects, and the chart only once the data is ready. The card itself
        only appears when there are closed issues to chart.
      */}
      {hasClosedIssues && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Control chart — cycle time</CardTitle>
          </CardHeader>
          <CardContent>
            {historyStatus === "loading" ? (
              <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Loading cycle-time history…
              </p>
            ) : historyStatus === "error" ? (
              <p className="py-10 text-center text-sm text-destructive">
                Unable to load the cycle-time history. Try refreshing.
              </p>
            ) : controlRows.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No completion history recorded yet for closed issues.
              </p>
            ) : (
              <>
                <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
                  {control.medianCycle !== undefined && <span>Median cycle: {days1(control.medianCycle)}d</span>}
                  {control.p85Cycle !== undefined && <span>85th pct cycle: {days1(control.p85Cycle)}d</span>}
                  {control.medianLead !== undefined && <span>Median lead: {days1(control.medianLead)}d</span>}
                  {control.p85Lead !== undefined && <span>85th pct lead: {days1(control.p85Lead)}d</span>}
                </div>
                <ChartContainer config={controlConfig} className="max-h-56 w-full">
                  <ComposedChart data={controlRows}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" />
                    <XAxis dataKey="completed" tickLine={false} axisLine={false} fontSize={11} />
                    <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} fontSize={12} />
                    <ZAxis range={[60, 60]} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    {control.p85Cycle !== undefined && (
                      <ReferenceLine
                        y={days1(control.p85Cycle)}
                        stroke="var(--chart-3)"
                        strokeDasharray="5 5"
                        label={{ value: "85th pct", position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }}
                      />
                    )}
                    <Scatter name="Cycle time (days)" dataKey="cycle" fill="var(--chart-1)" />
                    <Line type="monotone" dataKey="rolling" name="Rolling avg" stroke="var(--chart-4)" strokeWidth={2} dot={false} legendType="line" />
                  </ComposedChart>
                </ChartContainer>
                <p className="mt-1 text-center text-xs text-muted-foreground">
                  Cycle time (in-progress → closed) per closed issue, by completion date · with a rolling average and the 85th-percentile line
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {stats.createdPerWeek.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Created per week</CardTitle>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="max-h-48 w-full">
              <BarChart data={stats.createdPerWeek}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis allowDecimals={false} width={24} tickLine={false} axisLine={false} fontSize={12} />
                <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
