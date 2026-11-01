// AUTHORED-BY Codex GPT-6.1-Sol
import { CalendarEditorRoute } from "@/apps/calendar/components/event-editor";
export default async function EventPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return <CalendarEditorRoute eventRef={ref} />;
}
