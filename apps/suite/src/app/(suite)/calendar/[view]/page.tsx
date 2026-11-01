// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CalendarScreen } from "@/apps/calendar/components/calendar-views";
import { NativeCalendarView } from "@/apps/calendar/components/native-route";
import { isView } from "@/apps/calendar/state/view";

export const dynamicParams = true;
export function generateStaticParams() {
  return process.env.NEXT_PUBLIC_SUITE_TARGET === "native" ? [{ view: "__" }] : [];
}

export default async function CalendarViewPage({ params }: { params: Promise<{ view: string }> }) {
  if (process.env.NEXT_PUBLIC_SUITE_TARGET === "native")
    return (
      <Suspense fallback={<LoadingSkeleton preset="grid" />}>
        <NativeCalendarView />
      </Suspense>
    );
  const { view } = await params;
  if (!isView(view)) notFound();
  return (
    <Suspense fallback={<LoadingSkeleton preset="grid" />}>
      <CalendarScreen view={view} />
    </Suspense>
  );
}
