"use client";

import { useMemo } from "react";
import { buildTimeline, timelineDependencies } from "@/lib/timeline";
import { groupByEpic } from "@/lib/epics";
import type { IssueRecord } from "@/lib/use-issues";
import { TypeBadge } from "@/components/type-badge";
import { CalendarRange } from "lucide-react";

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });

// Row geometry (must match the list rows below): each <li> is the bar track
// (h-5 = 20px) plus py-1.5 (6px top + 6px bottom), so 32px per row; the bar sits
// vertically centred in the 20px track. The dependency-arrow SVG overlay aligns
// its row Y centres to these pixels, and starts at the label column's right edge.
const ROW_H = 32;
const ROW_MID = 16; // vertical centre of a row (px from its top)
const LABEL_W = 224; // w-54 (13.5rem) label button + gap-2 (0.5rem) = 14rem = 224px

const barColor = (issue: IssueRecord) =>
  issue.status === "done"
    ? "bg-muted-foreground/40"
    : issue.issueType === "epic"
      ? "bg-(--chart-1)"
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
  // #75 P1-4: dependency arrows between placed bars (blockers + soft relations).
  const deps = useMemo(() => (model ? timelineDependencies(model.bars, { includeRelates: true }) : []), [model]);

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

        <div className="relative">
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

        {/* #75 P1-4: dependency arrows overlaid on the bar track. The SVG starts
            at the label column's right edge and spans the rows; x maps 0–100
            across the track (preserveAspectRatio="none"), y is 1:1 px so row
            centres land on the bars. A blocker → blocked arrow is solid; a soft
            relation is dashed. Decorative (pointer-events-none, aria-hidden) —
            the textual "Blocked by"/"Relates to" links in the detail dialog carry
            the same information accessibly. */}
        {deps.length > 0 && (
          <svg
            aria-hidden
            className="pointer-events-none absolute top-0"
            style={{ left: LABEL_W, width: `calc(100% - ${LABEL_W}px)`, height: model.bars.length * ROW_H }}
            viewBox={`0 0 100 ${model.bars.length * ROW_H}`}
            preserveAspectRatio="none"
          >
            <defs>
              <marker id="tl-dep-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                <path d="M0,0 L6,3 L0,6 Z" className="fill-primary/70" />
              </marker>
            </defs>
            {deps.map((d) => {
              const y1 = d.fromRow * ROW_H + ROW_MID;
              const y2 = d.toRow * ROW_H + ROW_MID;
              return (
                <line
                  key={`${d.kind}:${d.fromUrl}->${d.toUrl}`}
                  x1={d.fromAt}
                  y1={y1}
                  x2={d.toAt}
                  y2={y2}
                  // Non-scaling stroke so the line stays a hairline despite the
                  // non-uniform x-stretch of preserveAspectRatio="none".
                  vectorEffect="non-scaling-stroke"
                  className={d.kind === "blocks" ? "stroke-primary/70" : "stroke-muted-foreground/50"}
                  strokeWidth={1.5}
                  strokeDasharray={d.kind === "relates" ? "4 3" : undefined}
                  markerEnd={d.kind === "blocks" ? "url(#tl-dep-arrow)" : undefined}
                />
              );
            })}
          </svg>
        )}
        </div>
      </div>

      {deps.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <svg width="20" height="6" aria-hidden className="shrink-0">
              <line x1="0" y1="3" x2="20" y2="3" className="stroke-primary/70" strokeWidth="1.5" />
            </svg>
            Blocks (depends on)
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="20" height="6" aria-hidden className="shrink-0">
              <line x1="0" y1="3" x2="20" y2="3" className="stroke-muted-foreground/50" strokeWidth="1.5" strokeDasharray="4 3" />
            </svg>
            Relates to
          </span>
        </p>
      )}

      {undated.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {undated.length} issue{undated.length === 1 ? "" : "s"} without dates not shown.
        </p>
      )}
    </div>
  );
}
