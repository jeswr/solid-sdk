"use client";

import { useMemo, useState } from "react";
import { computeWorkload } from "@/lib/stats";
import type { IssueRecord } from "@/lib/use-issues";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PersonChip } from "@/components/person";
import { UsersRound } from "lucide-react";

const CAPACITY_KEY = "issue-tracker:workload-capacity";
const DEFAULT_CAPACITY = 10;

/**
 * Monday-style workload view: open work per assignee, bucketed by due week,
 * with a per-week capacity threshold that flags overloaded cells.
 */
export function WorkloadView({ issues, groupIri }: { issues: IssueRecord[]; groupIri?: string }) {
  // Capacity is a per-device planning preference.
  const [capacity, setCapacity] = useState(() => {
    const saved = typeof localStorage !== "undefined" ? Number(localStorage.getItem(CAPACITY_KEY)) : NaN;
    return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_CAPACITY;
  });
  const onCapacity = (raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      setCapacity(n);
      localStorage.setItem(CAPACITY_KEY, String(n));
    }
  };

  const workload = useMemo(() => computeWorkload(issues), [issues]);
  const weekCount = workload.bucketLabels.length - 3; // minus Overdue/Later/No date

  if (workload.rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed p-12 text-center">
        <span aria-hidden className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UsersRound className="size-6" />
        </span>
        <div>
          <p className="font-medium">No open work to balance</p>
          <p className="text-sm text-muted-foreground">Open issues appear here grouped by assignee and due week.</p>
        </div>
      </div>
    );
  }

  return (
    <Card data-testid="workload">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-sm">Workload — open points by assignee and due week</CardTitle>
        <span className="flex items-center gap-2">
          <Label htmlFor="workload-capacity" className="text-xs font-normal text-muted-foreground">
            Capacity (points / week)
          </Label>
          <Input
            id="workload-capacity"
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => onCapacity(e.target.value)}
            className="h-8 w-20"
          />
        </span>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-separate border-spacing-y-1 text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="w-44 min-w-44 pb-1 font-medium">
                Assignee
              </th>
              {workload.bucketLabels.map((label) => (
                <th key={label} scope="col" className="pb-1 text-center font-medium">
                  {label}
                </th>
              ))}
              <th scope="col" className="w-16 pb-1 text-right font-medium">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {workload.rows.map((row) => (
              <tr key={row.assignee ?? "unassigned"}>
                <td className="max-w-44 truncate pr-2">
                  {row.assignee ? (
                    <PersonChip webId={row.assignee} isTeam={row.assignee === groupIri} />
                  ) : (
                    <span className="text-muted-foreground">Unassigned</span>
                  )}
                </td>
                {row.buckets.map((bucket, idx) => {
                  // Capacity applies to week buckets; any overdue points are a flag.
                  const isWeek = idx >= 1 && idx <= weekCount;
                  const over = (idx === 0 && bucket.points > 0) || (isWeek && bucket.points > capacity);
                  return (
                    <td key={bucket.label} className="px-1 text-center">
                      {bucket.points > 0 ? (
                        <span
                          title={`${bucket.count} issue${bucket.count === 1 ? "" : "s"}, ${bucket.points} points`}
                          className={`inline-flex min-w-9 items-center justify-center rounded-full px-2 py-1 text-xs font-medium tabular-nums ${
                            over ? "bg-destructive/15 text-destructive" : "bg-primary/10 text-primary"
                          }`}
                        >
                          {bucket.points}
                        </span>
                      ) : (
                        <span aria-hidden className="text-muted-foreground/40">
                          ·
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="text-right text-xs text-muted-foreground tabular-nums">
                  {row.points} pts · {row.count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          Unestimated issues weigh 1 point. Cells over capacity — and any overdue work — are flagged.
        </p>
      </CardContent>
    </Card>
  );
}
