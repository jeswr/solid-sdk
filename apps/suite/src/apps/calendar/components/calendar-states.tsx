// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, EmptyState, ErrorState } from "@jeswr/suite-ui";
import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { addDays, type CalendarView, calendarHref, localDate } from "../state/view";
import { CalendarImportButton } from "./calendar-transfer";

export function CalendarFirstRun({ date, view }: { date: string; view: CalendarView }) {
  const query = new URLSearchParams({
    start: date,
    end: addDays(date, 1),
    return: calendarHref(view, date),
  });
  return (
    <EmptyState
      title="Your calendar starts here"
      body="Keep your plans together. Add an event or import an .ics file, then choose a name for your first calendar."
      icon={<CalendarDays size={24} aria-hidden="true" />}
      primaryAction={
        <Button asChild>
          <Link href={`/calendar/e/new?${query}`}>New event</Link>
        </Button>
      }
      secondaryAction={<CalendarImportButton />}
    />
  );
}

export function CalendarEmptyRange({ from, to }: { from: string; to: string }) {
  const format = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" });
  return (
    <EmptyState
      title="Nothing scheduled"
      body={`There are no events from ${format.format(localDate(from))} to ${format.format(localDate(addDays(to, -1)))}.`}
      icon={<CalendarDays size={24} aria-hidden="true" />}
    />
  );
}

export function CalendarLoadError({ retry }: { retry: () => void }) {
  return (
    <ErrorState error="unreachable" actions={{ retry }}>
      <p>We couldn't load your calendar. Check your connection and try again.</p>
    </ErrorState>
  );
}
