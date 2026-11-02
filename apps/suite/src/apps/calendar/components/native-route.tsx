// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { usePageRouteParams } from "../../../lib/route-params";
import { isView } from "../state/view";
import { CalendarScreen } from "./calendar-views";
import { CalendarEditorRoute } from "./event-editor";

export function NativeCalendarView() {
  const params = usePageRouteParams<{ view: string }>("/calendar/[view]");
  if (!params) return <LoadingSkeleton preset="grid" />;
  if (!isView(params.view)) notFound();
  return <CalendarScreen view={params.view} />;
}

/** The export cannot read request searchParams on the server. Keep the date on navigation. */
export function NativeCalendarIndex() {
  const router = useRouter();
  const date = useSearchParams().get("d");
  useEffect(() => {
    router.replace(`/calendar/week${date ? `?d=${encodeURIComponent(date)}` : ""}`);
  }, [router, date]);
  return <LoadingSkeleton preset="grid" />;
}

/** Reads the event ref on the client, so the native export's placeholder page works too. */
export function EventRoute() {
  const params = usePageRouteParams<{ ref: string }>("/calendar/e/[ref]");
  if (!params) return <LoadingSkeleton preset="detail" />;
  return <CalendarEditorRoute eventRef={params.ref} />;
}
