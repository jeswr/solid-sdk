// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { NativeCalendarIndex } from "@/apps/calendar/components/native-route";
export default async function CalendarIndex({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  if (process.env.NEXT_PUBLIC_SUITE_TARGET === "native")
    return (
      <Suspense>
        <NativeCalendarIndex />
      </Suspense>
    );
  const { d } = await searchParams;
  redirect(`/calendar/week${d ? `?d=${encodeURIComponent(d)}` : ""}`);
}
