// AUTHORED-BY Codex (GPT-6.1 Sol)
import {
  EVENT_STATUS,
  type EventData,
  type Invitation,
  type InviteeData,
  validateEvent,
  validateInvitee,
} from "@jeswr/solid-events";

export function localDateTime(date?: Date): string {
  if (!date) return "";
  return new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function invitationForm(
  form: FormData,
  owner: string,
  existing?: Invitation,
  now = new Date(),
): EventData {
  const text = (key: string) => String(form.get(key) ?? "").trim();
  const fields = {
    name: text("name"),
    description: text("description") || undefined,
    startDate: new Date(text("startDate")),
    endDate: text("endDate") ? new Date(text("endDate")) : undefined,
    location: text("location") || undefined,
    address: text("address") || undefined,
    onlineUrl: text("onlineUrl") || undefined,
    image: text("image") || undefined,
    organizer: owner,
    eventStatus: existing?.eventStatus ?? EVENT_STATUS.scheduled,
    capacity: text("capacity") ? Number(text("capacity")) : undefined,
    rsvpDeadline: text("rsvpDeadline") ? new Date(text("rsvpDeadline")) : undefined,
    visibility: existing?.visibility ?? (text("visibility") === "link" ? "link" : "invitees"),
    guestListVisible: existing?.guestListVisible ?? form.get("guestListVisible") === "on",
    publication: existing
      ? existing.publication === "draft" && text("publication") === "published"
        ? "published"
        : existing.publication
      : text("publication") === "draft"
        ? "draft"
        : "published",
    created: existing?.created ?? now,
    modified: now,
  };
  const data = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  ) as unknown as EventData;
  validateEvent(data);
  return data;
}
export function inviteesFromText(value: string, now = new Date()): InviteeData[] {
  const values = [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  if (values.length > 50) throw new TypeError("Invite up to 50 people at a time");
  return values.map((webId) => {
    const invitee = { webId, event: "https://invitation.example/pending#it", invitedAt: now };
    validateInvitee(invitee);
    return invitee;
  });
}
export type EventFilter = "Upcoming" | "Past" | "Drafts" | "Cancelled";
export function filterInvitations(
  events: readonly Invitation[],
  filter: EventFilter,
  now: Date,
): Invitation[] {
  return events
    .filter((e) =>
      filter === "Cancelled"
        ? e.eventStatus === EVENT_STATUS.cancelled
        : filter === "Drafts"
          ? e.publication === "draft" && e.eventStatus !== EVENT_STATUS.cancelled
          : e.publication === "published" &&
            e.eventStatus !== EVENT_STATUS.cancelled &&
            (filter === "Past"
              ? (e.endDate ?? e.startDate) < now
              : (e.endDate ?? e.startDate) >= now),
    )
    .sort((a, b) =>
      filter === "Past" ? +b.startDate - +a.startDate : +a.startDate - +b.startDate,
    );
}
