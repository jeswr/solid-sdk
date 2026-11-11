// AUTHORED-BY Codex (GPT-6.1 Sol)

import type { EventData, InviteeData, RsvpData } from "./generated/model.js";
import { entities } from "./generated/model.js";

export type { EventData, InviteeData, RsvpData };
export { entities };
export const EVENT_STATUS = {
  scheduled: "https://schema.org/EventScheduled",
  cancelled: "https://schema.org/EventCancelled",
  postponed: "https://schema.org/EventPostponed",
} as const;
export const RSVP_RESPONSE = {
  yes: "https://schema.org/RsvpResponseYes",
  no: "https://schema.org/RsvpResponseNo",
  maybe: "https://schema.org/RsvpResponseMaybe",
} as const;

/** Shared lexical HTTP(S) validation for event, WebID and image URLs. */
export function validateHttpUrl(value: string): URL {
  const url = new URL(value);
  if (
    !/^https?:$/.test(url.protocol) ||
    url.username ||
    url.password ||
    /[\s\p{Cc}<>"{}|^`\\]/u.test(value)
  )
    throw new TypeError("Use an http(s) URL without credentials");
  return url;
}

/** Retain document identity while removing the generated entity fragment. */
export function eventDocumentUrl(value: string): string {
  const url = validateHttpUrl(value);
  if (url.search) throw new TypeError("Use an event URL without a query");
  url.hash = "";
  return url.href;
}

/** Cross-field policy is separate from generated property access. */
export function validateEvent(data: EventData): void {
  const parsed = entities.Event.parse(
    "https://validation.example/event",
    entities.Event.build("https://validation.example/event", data),
  );
  if (!parsed || !data.name.trim())
    throw new TypeError("An event needs a name, start time and invitation settings");
  if (data.endDate && (!Number.isFinite(data.endDate.getTime()) || data.endDate <= data.startDate))
    throw new TypeError("The end must be after the start");
  if (
    data.rsvpDeadline &&
    (!Number.isFinite(data.rsvpDeadline.getTime()) || data.rsvpDeadline > data.startDate)
  )
    throw new TypeError("The reply deadline must be before the event starts");
  if (
    data.capacity !== undefined &&
    (!Number.isSafeInteger(data.capacity) || data.capacity < 0 || data.capacity > 1000000)
  )
    throw new TypeError("Capacity must be a whole number between 0 and 1000000");
  for (const value of [data.organizer, data.onlineUrl, data.image])
    if (value !== undefined) validateHttpUrl(value);
}

export function validateRsvp(reply: RsvpData): void {
  const parsed = entities.Rsvp.parse(
    "https://validation.example/reply",
    entities.Rsvp.build("https://validation.example/reply", reply),
  );
  if (!parsed || (!reply.agent && (!reply.displayName?.trim() || !reply.guestKey?.trim())))
    throw new TypeError("A reply needs a WebID or a guest name and guest key");
  if (reply.additionalGuests !== parsed.additionalGuests || reply.agent !== parsed.agent)
    throw new TypeError("Invalid guest count or WebID");
}

export function validateInvitee(invitee: InviteeData): void {
  if (
    (!invitee.webId && !invitee.displayName?.trim()) ||
    !entities.Invitee.parse(
      "https://validation.example/invitee",
      entities.Invitee.build("https://validation.example/invitee", invitee),
    )
  )
    throw new TypeError("An invitee needs a WebID or name");
  if (invitee.webId) eventDocumentUrl(invitee.webId);
}
