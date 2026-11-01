// AUTHORED-BY Codex GPT-6
"use client";
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useRouteParams } from "../../../lib/route-params";
import { isView } from "../state/view";
import { CalendarScreen } from "./calendar-views";

export function NativeCalendarView() {
  const params = useRouteParams<{ view: string }>("/calendar/[view]");
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
