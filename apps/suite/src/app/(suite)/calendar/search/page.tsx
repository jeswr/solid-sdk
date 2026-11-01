// AUTHORED-BY Codex GPT-6.1-Sol
import { LoadingSkeleton } from "@jeswr/suite-ui";
import { Suspense } from "react";
import { CalendarSearch } from "@/apps/calendar/components/calendar-views";
export default function SearchPage() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <CalendarSearch />
    </Suspense>
  );
}
