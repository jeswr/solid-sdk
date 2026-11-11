// AUTHORED-BY Codex GPT-6.1-Sol
export type ReminderPreset = "today" | "tomorrow" | "week";

/** Calendar arithmetic in the user's time zone, including DST transitions. */
export function reminderPreset(preset: ReminderPreset, now: Date): Date {
  const date = new Date(now);
  if (preset === "today" && now.getHours() < 18) date.setHours(20, 0, 0, 0);
  else {
    date.setDate(date.getDate() + (preset === "week" ? (8 - date.getDay()) % 7 || 7 : 1));
    date.setHours(8, 0, 0, 0);
  }
  return date;
}

const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (value: number) => String(value).padStart(2, "0");

/** Stable English labels with local calendar dates and a 24-hour clock. */
export function formatReminder(iso: string, now: Date): string {
  const date = new Date(iso);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day =
    date.toDateString() === now.toDateString()
      ? "Today"
      : date.toDateString() === tomorrow.toDateString()
        ? "Tomorrow"
        : `${date.getDate()} ${months[date.getMonth()]}${date.getFullYear() === now.getFullYear() ? "" : ` ${date.getFullYear()}`}`;
  return `${day}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function reminderInput(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
