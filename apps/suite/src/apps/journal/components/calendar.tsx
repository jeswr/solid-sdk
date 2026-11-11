// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { dayKey, daysWritten, type EntryData } from "@jeswr/solid-journal";
import { Button, IconButton } from "@jeswr/suite-ui";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

export function JournalCalendar({
  entries,
  timeZone,
  select,
}: {
  entries: EntryData[];
  timeZone: string;
  select: (day: string) => void;
}) {
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const counts = daysWritten(entries, timeZone);
  const monthKey = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
  const hasEntries = [...counts.keys()].some((day) => day.startsWith(monthKey));
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = (month.getDay() + 6) % 7;
  const label = month.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  return (
    <section className="jn-card" aria-label="Writing calendar">
      <div className="jn-row">
        <h2>{label}</h2>
        <div className="jn-row">
          <IconButton
            label="Previous month"
            variant="ghost"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
          >
            <ChevronLeft aria-hidden="true" size={20} />
          </IconButton>
          <IconButton
            label="Next month"
            variant="ghost"
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          >
            <ChevronRight aria-hidden="true" size={20} />
          </IconButton>
        </div>
      </div>
      <p className="jn-muted">Every little square is a day. Choose one to revisit your words.</p>
      {!hasEntries && (
        <p className="jn-muted">No entries this month. A few words can make your first square.</p>
      )}
      <div className="jn-calendar">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
          <span className="jn-weekday" key={day}>
            {day}
          </span>
        ))}
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].slice(0, offset).map((name) => (
          <span key={name} />
        ))}
        {Array.from({ length: days }, (_, index) => {
          const date = new Date(month.getFullYear(), month.getMonth(), index + 1, 12);
          const key = dayKey(date, Intl.DateTimeFormat().resolvedOptions().timeZone);
          const count = counts.get(key) ?? 0;
          return (
            <Button
              key={key}
              variant="ghost"
              className="jn-calendar-day"
              data-level={Math.min(count, 3)}
              aria-label={`${date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}: ${count} ${count === 1 ? "entry" : "entries"}`}
              onClick={() => select(key)}
            >
              <span>{index + 1}</span>
              <small>{count ? `${count} ${count === 1 ? "entry" : "entries"}` : "—"}</small>
            </Button>
          );
        })}
      </div>
      <p className="jn-muted jn-legend">
        <span className="jn-dot" /> A deeper shade means more entries.
      </p>
    </section>
  );
}
