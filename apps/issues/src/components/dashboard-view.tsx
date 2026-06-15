"use client";

import { useEffect, useMemo, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";
import { computeBurndown, computeCumulativeFlowBands, computeStats, computeVelocity, type StatusTransition } from "@/lib/stats";
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
  const [statusHistory, setStatusHistory] = useState<ReadonlyMap<string, StatusTransition[]>>(new Map());
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
    // Resolve through a promise (even the empty/no-loader case) so the state
    // update is always asynchronous, never a synchronous cascade in the effect.
    const load =
      !loadStatusHistory || issueUrls.length === 0
        ? Promise.resolve(new Map<string, StatusTransition[]>())
        : loadStatusHistory(issueUrls);
    load
      .then((history) => {
        if (!cancelled) setStatusHistory(history);
      })
      .catch(() => {
        if (!cancelled) setStatusHistory(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [loadStatusHistory, issueRevisionKey, issueUrls]);
  const flow = useMemo(
    () => computeCumulativeFlowBands(issues, statusHistory, workflow),
    [issues, statusHistory, workflow],
  );
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
