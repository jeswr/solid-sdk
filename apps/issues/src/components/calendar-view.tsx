"use client";

import { useMemo, useState } from "react";
import { buildMonth } from "@/lib/timeline";
import type { IssueRecord } from "@/lib/use-issues";
import { Button } from "@/components/ui/button";
import { TypeBadge } from "@/components/type-badge";
import { ChevronLeft, ChevronRight } from "lucide-react";

const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Month calendar: issues appear on their due dates; click to open. */
export function CalendarView({
  issues,
  onOpenIssue,
}: {
  issues: IssueRecord[];
  onOpenIssue: (issue: IssueRecord) => void;
}) {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const weeks = useMemo(() => buildMonth(issues, cursor.year, cursor.month), [issues, cursor]);
  const shift = (delta: number) => {
    const d = new Date(cursor.year, cursor.month + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{monthFmt.format(new Date(cursor.year, cursor.month, 1))}</h2>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}
          >
            Today
          </Button>
          <Button variant="outline" size="icon" aria-label="Next month" onClick={() => shift(1)}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1.5">
              {d}
            </div>
          ))}
        </div>
        {weeks.map((week, w) => (
          <div key={w} className="grid grid-cols-7 border-b last:border-b-0">
            {week.map((day) => (
              <div
                key={day.date.toISOString()}
                className={`min-h-20 border-r p-1 align-top last:border-r-0 ${day.inMonth ? "" : "bg-muted/40"}`}
              >
                <span
                  className={`mb-0.5 inline-flex size-5 items-center justify-center rounded-full text-xs ${
                    day.isToday ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground"
                  }`}
                >
                  {day.date.getDate()}
                </span>
                <ul className="space-y-0.5">
                  {day.issues.slice(0, 3).map((i) => (
                    <li key={i.url}>
                      <button
                        type="button"
                        onClick={() => onOpenIssue(i)}
                        className={`flex w-full items-center gap-1 truncate rounded bg-primary/10 px-1 py-0.5 text-left text-xs hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                          i.status === "done" ? "line-through opacity-60" : ""
                        }`}
                        title={i.title}
                      >
                        <TypeBadge type={i.issueType} />
                        <span className="truncate">{i.title}</span>
                      </button>
                    </li>
                  ))}
                  {day.issues.length > 3 && (
                    <li className="px-1 text-[0.65rem] text-muted-foreground">+{day.issues.length - 3} more</li>
                  )}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
