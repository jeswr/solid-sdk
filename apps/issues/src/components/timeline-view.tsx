"use client";

import { useMemo } from "react";
import { buildTimeline } from "@/lib/timeline";
import { groupByEpic } from "@/lib/epics";
import type { IssueRecord } from "@/lib/use-issues";
import { TypeBadge } from "@/components/type-badge";
import { CalendarRange } from "lucide-react";

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

const barColor = (issue: IssueRecord) =>
  issue.status === "done"
    ? "bg-muted-foreground/40"
    : issue.issueType === "epic"
      ? "bg-purple-500"
      : issue.status === "in-progress"
        ? "bg-primary"
        : "bg-primary/50";

/**
 * Gantt-style timeline: one row per issue, bars spanning created → due, grouped
 * with epics first so initiative spans frame their children. Issues without any
 * date are listed below (a timeline cannot place them).
 */
export function TimelineView({
  issues,
  onOpenIssue,
}: {
  issues: IssueRecord[];
  onOpenIssue: (issue: IssueRecord) => void;
}) {
  const ordered = useMemo(() => {
    // Epics first, each followed by its children, then loose issues.
    const { epics, unassigned } = groupByEpic(issues);
    return [...epics.flatMap(({ epic, children }) => [epic, ...children]), ...unassigned];
  }, [issues]);
  const model = useMemo(() => buildTimeline(ordered), [ordered]);

  if (!model) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-12 text-center">
        <CalendarRange className="size-8 text-muted-foreground" aria-hidden />
        <div>
          <p className="font-medium">Nothing to place on a timeline</p>
          <p className="text-sm text-muted-foreground">Give issues due dates and they will appear here.</p>
        </div>
      </div>
    );
  }

  const undated = ordered.filter((i) => !model.bars.some((b) => b.issue.url === i.url));

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        {dateFmt.format(model.from)} — {dateFmt.format(model.to)}
      </p>

      <div className="overflow-x-auto rounded-lg border bg-card p-3">
        {/* Month axis */}
        <div className="relative ml-56 h-5 border-b text-xs text-muted-foreground">
          {model.ticks.map((t) => (
            <span key={t.at} className="absolute -translate-x-1/2" style={{ left: `${t.at}%` }}>
              {t.label}
            </span>
          ))}
        </div>

        <ul>
          {model.bars.map(({ issue, start, width }) => (
            <li key={issue.url} className="flex items-center gap-2 border-b py-1.5 last:border-b-0">
              <button
                type="button"
                onClick={() => onOpenIssue(issue)}
                className={`flex w-54 shrink-0 items-center gap-1.5 truncate text-left text-sm hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                  issue.issueType === "epic" ? "font-medium" : issue.parent ? "pl-5" : ""
                }`}
                title={issue.title}
              >
                <TypeBadge type={issue.issueType} />
                <span className="truncate">{issue.title}</span>
              </button>
              <div className="relative h-5 flex-1">
                {/* Grid lines under the bars */}
                {model.ticks.map((t) => (
                  <span key={t.at} aria-hidden className="absolute h-full border-l border-border/60" style={{ left: `${t.at}%` }} />
                ))}
                <span
                  role="img"
                  aria-label={`${issue.title}: ${issue.status === "done" ? "done" : issue.status}`}
                  className={`absolute top-0.5 h-4 rounded-full ${barColor(issue)}`}
                  style={{ left: `${start}%`, width: `${width}%` }}
                  title={`${issue.title}${issue.dateDue ? ` · due ${dateFmt.format(issue.dateDue)}` : ""}`}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {undated.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {undated.length} issue{undated.length === 1 ? "" : "s"} without dates not shown.
        </p>
      )}
    </div>
  );
}
