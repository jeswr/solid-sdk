// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { redirect } from "next/navigation";
export default async function CalendarIndex({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const { d } = await searchParams;
  redirect(`/calendar/week${d ? `?d=${encodeURIComponent(d)}` : ""}`);
}
