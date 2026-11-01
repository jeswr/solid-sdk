// AUTHORED-BY Codex GPT-6.1-Sol
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CalendarScreen } from "@/apps/calendar/components/calendar-views";
import { isView } from "@/apps/calendar/state/view";
export default async function CalendarViewPage({ params }: { params: Promise<{ view: string }> }) {
  const { view } = await params;
  if (!isView(view)) notFound();
  return (
    <Suspense fallback={<LoadingSkeleton preset="grid" />}>
      <CalendarScreen view={view} />
    </Suspense>
  );
}
